/**
 * Temperature Chart - Hourly and daily temperature visualization
 * Reads configuration from window.APP_CONFIG (injected by Flask from config.py)
 */

class TemperatureChart {
	constructor(config) {
		this.chartId = config.chartId || "temperatureChart";
		this.apiEndpoint = config.apiEndpoint || "/api/temperature-data";
		this.showControls = config.showControls !== false;
		this.autoLoad = config.autoLoad !== false;

		if (
			!config.stationConfig ||
			Object.keys(config.stationConfig).length === 0
		) {
			throw new Error("[TEMPERATURE] stationConfig is required!");
		}
		this.stationConfig = config.stationConfig;

		this.filterStations = config.filterStations || null;
		if (this.filterStations) {
			console.log(
				`[${this.chartId}] Filtering to stations:`,
				this.filterStations,
			);
		}

		this.onDataLoaded = config.onDataLoaded || null;

		// Internal state
		this.chart = null;
		this.chartData = null;
		this.dateRange = null;
		this.elements = {};
		this._resizeTimer = null;
		this._resizeHandler = null;
		this._retryTimeout = null;
		this._loadDebounceTimer = null;

		// Sliding state
		this.currentPage = 0;
		this.totalPages = 2;
		this.hoursPerPage = 12;
		this.dataCache = new Map();

		console.log(`[${this.chartId}] Chart initialized`);
	}

	// =========================================================================
	// RESPONSIVE HELPERS
	// =========================================================================

	_isMobile() {
		return window.innerWidth < 768;
	}

	_getResponsiveDimensions() {
		const width = window.innerWidth;

		if (width < 480) {
			return {
				height: 280,
				fontSize: 10,
				lineThickness: 2,
				markerSize: 4,
			};
		}
		if (width < 768) {
			return {
				height: 300,
				fontSize: 11,
				lineThickness: 2.5,
				markerSize: 5,
			};
		}
		if (width < 1024) {
			return {
				height: 340,
				fontSize: 12,
				lineThickness: 3,
				markerSize: 6,
			};
		}
		return {
			height: 360,
			fontSize: 12,
			lineThickness: 3,
			markerSize: 6,
		};
	}

	// =========================================================================
	// INITIALIZATION
	// =========================================================================

	async init() {
		console.log(`[${this.chartId}] Setting up...`);

		this._cacheElements();

		if (!this.elements.chartContainer) {
			console.error(`[${this.chartId}] Chart container not found!`);
			return;
		}

		const container = this.elements.chartContainer;
		const computedStyle = window.getComputedStyle(container);
		if (computedStyle.position === "static") {
			container.style.position = "relative";
		}

		this._setupResizeHandler();

		if (this.showControls) {
			await this._loadDateRange();
		}

		if (this.autoLoad) {
			this.loadLatestData();
		}
	}

	_cacheElements() {
		this.elements = {
			chartContainer: document.getElementById(this.chartId),
			loading: document.getElementById("temperature-chart-loading"),
			error: document.getElementById("temperature-chart-error"),
			datePicker: document.getElementById("temperatureDatePicker"),
		};
	}

	_setupResizeHandler() {
		this._resizeHandler = () => {
			if (this._resizeTimer) clearTimeout(this._resizeTimer);
			this._resizeTimer = setTimeout(() => {
				if (this.chart) {
					const dims = this._getResponsiveDimensions();
					const isMobile = this._isMobile();

					this.chart.options.height = dims.height;
					this.chart.options.axisX.labelFontSize = dims.fontSize;
					this.chart.options.axisY.labelFontSize = dims.fontSize;
					this.chart.options.axisX.titleFontSize = dims.fontSize + 2;
					this.chart.options.axisY.titleFontSize = dims.fontSize + 2;
					if (this.chart.options.legend) {
						this.chart.options.legend.fontSize = isMobile
							? dims.fontSize
							: dims.fontSize + 4;
						this.chart.options.legend.markerMargin = isMobile ? 4 : 8;
						this.chart.options.legend.itemSpacing = isMobile ? 8 : 15;
					}

					if (this.chart.options.data) {
						this.chart.options.data.forEach((series) => {
							series.lineThickness = dims.lineThickness;
							series.markerSize = dims.markerSize;

							if (series.stationId) {
								const config = this.stationConfig[series.stationId];
								if (config) {
									series.name = isMobile
										? config.name.replace(" Station", "")
										: config.name;
								}
							}
						});
					}

					this.chart.render();
				}
			}, 230);
		};
		window.addEventListener("resize", this._resizeHandler);
	}

	// =========================================================================
	// PUBLIC API
	// =========================================================================

	loadLatestData() {
		this._loadTemperatureData();
	}

	loadSpecificDate(dateString) {
		console.log(`[${this.chartId}] Loading date: ${dateString}`);
		this.currentPage = 0;

		if (this._loadDebounceTimer) {
			clearTimeout(this._loadDebounceTimer);
		}

		this._loadDebounceTimer = setTimeout(() => {
			this._loadTemperatureData(dateString);
		}, 300);

		return new Promise((resolve) => {
			const originalCallback = this.onDataLoaded;
			this.onDataLoaded = (data) => {
				if (originalCallback) originalCallback(data);
				resolve(data);
			};
		});
	}

	retry() {
		this._hideError();
		this.loadLatestData();
	}

	refresh() {
		if (this.chartData && this.chartData.date) {
			this.dataCache.delete(this.chartData.date);
		}
		this.loadLatestData();
	}

	destroy() {
		if (this._resizeTimer) clearTimeout(this._resizeTimer);
		if (this._retryTimeout) clearTimeout(this._retryTimeout);
		if (this._loadDebounceTimer) clearTimeout(this._loadDebounceTimer);
		if (this._resizeHandler) {
			window.removeEventListener("resize", this._resizeHandler);
		}
		if (this.chart) this.chart.destroy();
		this.chartData = null;
		this.dateRange = null;
		this.dataCache.clear();
		this.elements = {};
	}

	getCurrentData() {
		return this.chartData;
	}

	// =========================================================================
	// DATA LOADING
	// =========================================================================

	async _loadDateRange() {
		try {
			const response = await fetch("/api/temperature-date-range");

			if (!response.ok) {
				let errorMessage = `HTTP ${response.status}`;
				try {
					const errorData = await response.json();
					errorMessage = errorData.error || errorMessage;
				} catch (parseError) {
					console.warn("[TEMPERATURE] Could not parse error response as JSON");
				}
				throw new Error(errorMessage);
			}

			const data = await response.json();
			if (!data.success) throw new Error(data.error || "Invalid date range");

			this.dateRange = {
				earliest: data.earliest_date,
				latest: data.latest_date,
				earliestDisplay: data.earliest_display,
				latestDisplay: data.latest_display,
			};

			if (this.elements.datePicker) {
				this.elements.datePicker.min = this.dateRange.earliest;
				this.elements.datePicker.max = this.dateRange.latest;
				this.elements.datePicker.value = this.dateRange.latest;
			}
		} catch (error) {
			console.warn(`[${this.chartId}] Date range error:`, error);
		}
	}

	async _loadTemperatureData(dateString = null) {
		if (dateString && this.dataCache.has(dateString)) {
			console.log(`[${this.chartId}] Using cached data for ${dateString}`);
			const cachedData = this.dataCache.get(dateString);
			this.chartData = cachedData;

			this._renderChart(cachedData);

			if (typeof this.onDataLoaded === "function") {
				this.onDataLoaded(cachedData);
			}

			return cachedData;
		}

		return this._loadWithRetry(dateString, 1);
	}

	async _loadWithRetry(dateString, attempt) {
		const MAX_RETRIES = 3;
		const RETRY_DELAYS = [1000, 2000, 5000];

		this._showLoading();

		try {
			const apiUrl = dateString
				? `${this.apiEndpoint}?date=${dateString}`
				: this.apiEndpoint;

			const response = await fetch(apiUrl);

			if (!response.ok) {
				let errorMessage = `HTTP ${response.status}`;
				try {
					const errorData = await response.json();
					errorMessage = errorData.error || errorMessage;
				} catch (parseError) {
					console.error("[TEMPERATURE] Non-JSON error response:", parseError);
					errorMessage = `Server error (${response.status}). Please try again.`;
				}
				throw new Error(errorMessage);
			}

			const data = await response.json();

			if (!data.success) {
				if (data.retry_in && attempt < MAX_RETRIES) {
					await this._sleep(data.retry_in * 1000);
					return this._loadWithRetry(dateString, attempt + 1);
				}
				throw new Error(data.error || "Failed to load data");
			}

			const hasData = Object.values(data.stations).some(
				(station) => station.data && station.data.length > 0,
			);

			if (!hasData) {
				throw new Error(`No data available for ${data.date_display}`);
			}

			this.chartData = data;

			if (data.date) {
				this.dataCache.set(data.date, data);
				console.log(`[${this.chartId}] Cached data for ${data.date}`);
			}

			this._renderChart(data);
			this._hideLoading();

			if (typeof this.onDataLoaded === "function") {
				this.onDataLoaded(data);
			}

			return data;
		} catch (error) {
			console.error(`[${this.chartId}] Error:`, error);

			if (attempt < MAX_RETRIES) {
				const retryDelay = RETRY_DELAYS[attempt - 1];
				this._showRetryMessage(attempt, MAX_RETRIES, retryDelay);
				await this._sleep(retryDelay);
				return this._loadWithRetry(dateString, attempt + 1);
			} else {
				console.warn(
					`[${this.chartId}] API unavailable after ${MAX_RETRIES} attempts`,
				);
				this._showError("Failed to load temperature data. Please try again later.");
			}
		}
	}

	_sleep(ms) {
		return new Promise((resolve) => {
			this._retryTimeout = setTimeout(resolve, ms);
		});
	}

	_showRetryMessage(attempt, maxAttempts, delayMs) {
		const seconds = Math.ceil(delayMs / 1000);
		const message = `Retrying ${attempt}/${maxAttempts} in ${seconds}s...`;

		if (this.elements.loading) {
			let loadingText = this.elements.loading.querySelector(
				".chart-loading__text",
			);
			if (loadingText) {
				loadingText.textContent = message;
			}
		}
	}

	// =========================================================================
	// CHART RENDERING
	// =========================================================================

	_renderChart(apiData) {
		const dataSeries = [];
		const isMobile = this._isMobile();

		for (const stationId in apiData.stations) {
			const stationData = apiData.stations[stationId];
			const config = this.stationConfig[stationId];

			if (!config) {
				console.warn(`No config for station: ${stationId}`);
				continue;
			}

			if (this.filterStations && !this.filterStations.includes(stationId)) {
				console.log(
					`[${this.chartId}] Skipping station ${stationId} (not in filter)`,
				);
				continue;
			}

			const dataPoints = stationData.data.map((point) => ({
				label: point.label,
				y: point.y,
				actualLabel: point.label,
				day: point.day,
				stationName: config.name,
				count: point.count || 0,
				timestamp: point.timestamp,
			}));

			const isSingleStation =
				this.filterStations && this.filterStations.length === 1;

			const displayName = isMobile
				? config.name.replace(" Station", "")
				: config.name;

			dataSeries.push({
				type: "spline",
				name: displayName,
				showInLegend: !isSingleStation,
				visible: true,
				color: config.color,
				dataPoints: dataPoints,
				stationId: stationId,
			});
		}

		if (this.chart) {
			this._updateChart(dataSeries);
		} else {
			this._createNewChart(dataSeries);
		}
	}

	_updateChart(dataSeries) {
		const dims = this._getResponsiveDimensions();
		const isMobile = this._isMobile();

		this.chart.options.height = dims.height;
		this.chart.options.axisX.labelFontSize = dims.fontSize;
		this.chart.options.axisY.labelFontSize = dims.fontSize;
		this.chart.options.axisX.titleFontSize = dims.fontSize + 2;
		this.chart.options.axisY.titleFontSize = dims.fontSize + 2;
		if (this.chart.options.legend) {
			this.chart.options.legend.fontSize = isMobile
				? dims.fontSize
				: dims.fontSize + 4;
			this.chart.options.legend.markerMargin = isMobile ? 4 : 8;
			this.chart.options.legend.itemSpacing = isMobile ? 8 : 15;
		}

		this.chart.options.data = dataSeries.map((series) => ({
			...series,
			lineThickness: dims.lineThickness,
			markerSize: dims.markerSize,
		}));

		this.chart.render();
	}

	_createNewChart(dataSeries) {
		const self = this;
		const dims = this._getResponsiveDimensions();

		this.chart = new CanvasJS.Chart(this.chartId, {
			animationEnabled: true,
			animationDuration: 400,
			theme: "light1",
			height: dims.height,

			title: {
				text: "",
				fontSize: 0,
				margin: 30,
			},

			axisX: {
				title: "Time of Day",
				titleFontSize: dims.fontSize + 2,
				labelFontSize: dims.fontSize,
				labelFontColor: "#64748b",
				lineColor: "#e2e8f0",
				tickColor: "#e2e8f0",
				interval: 2,
				margin: 0,
			},

			axisY: {
				title: "Temperature (°C)",
				titleFontSize: dims.fontSize,
				labelFontSize: dims.fontSize,
				labelFontColor: "#64748b",
				lineColor: "#e2e8f0",
				tickColor: "#e2e8f0",
				gridColor: "#f1f5f9",
				gridThickness: 1,
				suffix: " °C",
			},

			toolTip: {
				shared: true,
				contentFormatter: (e) => this._formatTooltip(e),
				borderThickness: 0,
				borderColor: "transparent",
				cornerRadius: 12,
				backgroundColor: "transparent",
				animationEnabled: false,
			},

			...(this.filterStations && this.filterStations.length === 1
				? {}
				: {
						legend: {
							cursor: "pointer",
							itemclick: function (e) {
								e.dataSeries.visible =
									typeof e.dataSeries.visible === "undefined"
										? false
										: !e.dataSeries.visible;
								e.chart.render();
							},
							fontSize: self._isMobile()
								? dims.fontSize - 1
								: dims.fontSize + 4,
							fontWeight: 500,
							fontColor: "#475569",
							horizontalAlign: self._isMobile() ? "left" : "center",
							verticalAlign: "bottom",
							dockInsidePlotArea: false,
							markerType: "circle",
							markerMargin: self._isMobile() ? 4 : 8,
							itemSpacing: self._isMobile() ? 8 : 15,
						},
					}),

			data: dataSeries.map((series) => ({
				...series,
				lineThickness: dims.lineThickness,
				markerSize: dims.markerSize,
			})),
		});

		this.chart.render();
	}

	// =========================================================================
	// UI FEEDBACK
	// =========================================================================

	_showLoading() {
		if (this.elements.loading) {
			this.elements.loading.classList.remove("hidden");
		}
	}

	_hideLoading() {
		if (this.elements.loading) {
			this.elements.loading.classList.add("hidden");
		}
	}

	_showError(message) {
		if (this.elements.error) {
			this.elements.error.classList.remove("hidden");
			const messageElement = this.elements.error.querySelector(
				".chart-error__message",
			);
			if (messageElement) {
				messageElement.textContent = message;
			}
		}
	}

	_hideError() {
		if (this.elements.error) {
			this.elements.error.classList.add("hidden");
		}
	}

	// =========================================================================
	// TOOLTIP
	// =========================================================================

	_formatTooltip(e) {
		if (!e.entries || e.entries.length === 0) return "";

		const isMobile = this._isMobile();
		const width = window.innerWidth;

		const allNoData = e.entries.every(
			(entry) => (entry.dataPoint.count || 0) === 0,
		);
		if (allNoData) {
			const firstPoint = e.entries[0].dataPoint;
			if (firstPoint.timestamp) {
				const pointTime = new Date(firstPoint.timestamp);
				const now = new Date();
				if (pointTime > now) {
					return "";
				}
			}
		}

		let tooltipWidth = "280px";
		if (width < 480) {
			tooltipWidth = "180px";
		} else if (width < 768) {
			tooltipWidth = "200px";
		}

		let html = `<div class="temp-tooltip" style="width: ${tooltipWidth};">`;

		const firstPoint = e.entries[0].dataPoint;
		const timeLabel = firstPoint.actualLabel || firstPoint.label;
		const dayLabel = firstPoint.day || "Today";

		html += `
			<div class="temp-tooltip__header">
				${dayLabel} ${timeLabel}
			</div>
		`;

		html += `<div class="temp-tooltip__body">`;

		e.entries.forEach((entry) => {
			const color = entry.dataSeries.color;
			const name = entry.dataPoint.stationName || entry.dataSeries.name;
			const temperature = entry.dataPoint.y;
			const count = entry.dataPoint.count || 0;

			let displayValue;
			let valueColor;

			if (count === 0) {
				displayValue = "Offline";
				valueColor = "#94a3b8";
			} else if (temperature === null || isNaN(temperature)) {
				displayValue = "--";
				valueColor = "#94a3b8";
			} else {
				displayValue = `${temperature.toFixed(1)} °C`;
				valueColor = color;
			}

			html += `
				<div class="temp-tooltip__row">
					<span class="temp-tooltip__label">${name}</span>
					<span class="temp-tooltip__value" style="color: ${valueColor}; font-weight: 600;">
						${displayValue}
					</span>
				</div>
			`;
		});

		html += `</div></div>`;

		return html;
	}
}
