class HourlyMetricChart {
	constructor(config) {
		this.chartId = config.chartId;
		this.metricType = config.metricType || "temperature";
		this.apiEndpoint = config.apiEndpoint;
		this.dateRangeEndpoint = config.dateRangeEndpoint;
		this.datePickerId = config.datePickerId;
		this.loadingId = config.loadingId;
		this.errorId = config.errorId;
		this.unit = config.unit || "";
		this.yAxisTitle = config.yAxisTitle || "";
		this.valueDecimals = Number.isInteger(config.valueDecimals)
			? config.valueDecimals
			: 1;
		this.stationConfig = config.stationConfig || {};
		this.onDataLoaded = config.onDataLoaded || null;

		this.chart = null;
		this.chartData = null;
		this.dateRange = null;
		this.dataCache = new Map();
		this.elements = {};
		this._resizeHandler = null;
		this._resizeTimer = null;
		this._loadDebounceTimer = null;
	}

	_getChartConfig() {
		return window.CHART_CONFIG || {};
	}

	_getStyling() {
		return window.CHART_STYLING || this._getChartConfig().styling || {};
	}

	_getBreakpoints() {
		return (
			this._getChartConfig().breakpoints || {
				mobile_sm: 480,
				mobile: 768,
				tablet: 1024,
			}
		);
	}

	_getResponsiveDimensions() {
		const width = window.innerWidth;
		const breakpoints = this._getBreakpoints();

		if (width < breakpoints.mobile_sm) {
			return { height: 230, fontSize: 10, lineThickness: 2, markerSize: 4 };
		}
		if (width < breakpoints.mobile) {
			return { height: 280, fontSize: 11, lineThickness: 2.5, markerSize: 5 };
		}
		if (width < breakpoints.tablet) {
			return { height: 320, fontSize: 12, lineThickness: 3, markerSize: 6 };
		}
		return { height: 340, fontSize: 12, lineThickness: 3, markerSize: 6 };
	}

	async init() {
		this._cacheElements();

		if (!this.elements.chartContainer) {
			console.error(`[${this.chartId}] Chart container not found`);
			return;
		}

		this._setupResizeHandler();
		await this._loadDateRange();
		await this.loadLatestData();
	}

	_cacheElements() {
		this.elements = {
			chartContainer: document.getElementById(this.chartId),
			loading: document.getElementById(this.loadingId),
			error: document.getElementById(this.errorId),
			errorMessage: document.querySelector(`#${this.errorId} .chart-error__message`),
			datePicker: document.getElementById(this.datePickerId),
		};
	}

	_setupResizeHandler() {
		this._resizeHandler = () => {
			if (this._resizeTimer) clearTimeout(this._resizeTimer);
			this._resizeTimer = setTimeout(() => {
				if (this.chart && this.chartData) {
					this._renderChart(this.chartData);
				}
			}, 220);
		};
		window.addEventListener("resize", this._resizeHandler);
	}

	async _loadDateRange() {
		if (!this.dateRangeEndpoint) return;

		try {
			const response = await fetch(this.dateRangeEndpoint);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			const data = await response.json();
			if (!data.success) throw new Error(data.error || "Invalid date range");

			this.dateRange = {
				earliest: data.earliest_date,
				latest: data.latest_date,
			};

			if (this.elements.datePicker) {
				this.elements.datePicker.min = this.dateRange.earliest;
				this.elements.datePicker.max = this.dateRange.latest;
				this.elements.datePicker.value = this.dateRange.latest;
			}
		} catch (error) {
			console.warn(`[${this.chartId}] Date range load failed:`, error);
		}
	}

	async loadLatestData() {
		return this._loadData();
	}

	loadSpecificDate(dateString) {
		if (this._loadDebounceTimer) clearTimeout(this._loadDebounceTimer);
		return new Promise((resolve) => {
			this._loadDebounceTimer = setTimeout(async () => {
				const data = await this._loadData(dateString);
				resolve(data);
			}, 300);
		});
	}

	retry() {
		this._hideError();
		return this.loadLatestData();
	}

	async _loadData(dateString = null) {
		if (dateString && this.dataCache.has(dateString)) {
			const cached = this.dataCache.get(dateString);
			this.chartData = cached;
			this._renderChart(cached);
			if (this.onDataLoaded) this.onDataLoaded(cached);
			return cached;
		}

		this._showLoading();
		this._hideError();

		try {
			const apiUrl = dateString
				? `${this.apiEndpoint}?date=${dateString}`
				: this.apiEndpoint;
			const response = await fetch(apiUrl);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);

			const data = await response.json();
			if (!data.success || !data.stations) {
				throw new Error(data.error || "Invalid response format");
			}

			this.chartData = data;
			if (data.date) this.dataCache.set(data.date, data);
			if (this.elements.datePicker && data.date) {
				this.elements.datePicker.value = data.date;
			}

			this._renderChart(data);
			if (this.onDataLoaded) this.onDataLoaded(data);
			return data;
		} catch (error) {
			console.error(`[${this.chartId}] Load failed:`, error);
			this._showError(`Error loading ${this.metricType} data.`);
			return null;
		} finally {
			this._hideLoading();
		}
	}

	_renderChart(apiData) {
		const dims = this._getResponsiveDimensions();
		const styling = this._getStyling();
		const stationColors = (window.CHART_COLORS && window.CHART_COLORS.station_colors) || {};

		const dataSeries = [];
		Object.keys(apiData.stations || {}).forEach((stationId) => {
			const station = apiData.stations[stationId];
			const cfg = this.stationConfig[stationId] || {};
			const name = cfg.name || station.name || stationId;
			const color = cfg.color || stationColors[stationId] || "#409ac7";

			const dataPoints = (station.data || []).map((point) => {
				let x = 0;
				if (point.timestamp) {
					x = new Date(point.timestamp);
				} else if (point.label) {
					const hour = parseInt(String(point.label).split(":")[0], 10) || 0;
					x = new Date(2000, 0, 1, hour, 0, 0, 0);
				}

				return {
					x,
					y: point.y,
					label: point.label,
					count: point.count || 0,
				};
			});

			dataSeries.push({
				type: "spline",
				name,
				stationId,
				showInLegend: true,
				visible: true,
				color,
				lineThickness: dims.lineThickness,
				markerSize: dims.markerSize,
				dataPoints,
			});
		});

		if (this.chart) this.chart.destroy();

		this.chart = new CanvasJS.Chart(this.chartId, {
			animationEnabled: true,
			animationDuration: 400,
			height: dims.height,
			axisX: {
				labelFontSize: dims.fontSize,
				labelFontColor: styling.labelFontColor || "#64748b",
				lineColor: styling.lineColor || "#e2e8f0",
				tickColor: styling.tickColor || "#e2e8f0",
				gridColor: styling.gridColor || "#f1f5f9",
				intervalType: "hour",
				interval: 2,
				valueFormatString: "HH:mm",
				title: "Time",
				titleFontSize: dims.fontSize + 2,
			},
			axisY: {
				includeZero: false,
				labelFontSize: dims.fontSize,
				labelFontColor: styling.labelFontColor || "#64748b",
				lineColor: styling.lineColor || "#e2e8f0",
				tickColor: styling.tickColor || "#e2e8f0",
				gridColor: styling.gridColor || "#f1f5f9",
				title: this.yAxisTitle,
				titleFontSize: dims.fontSize + 2,
			},
			legend: {
				fontSize: dims.fontSize + 2,
				fontColor: styling.legendFontColor || "#475569",
				horizontalAlign: "center",
				verticalAlign: "top",
			},
			toolTip: {
				shared: true,
				contentFormatter: (e) => this._formatTooltip(e),
			},
			data: dataSeries,
		});

		this.chart.render();
	}

	_formatTooltip(e) {
		if (!e.entries || e.entries.length === 0) return "";

		const first = e.entries[0];
		const date = first?.dataPoint?.x;
		const timeLabel = date instanceof Date
			? date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", hour12: false })
			: first?.dataPoint?.label || "--:--";

		let html = `<div class="prec-tooltip" style="width: 240px;">`;
		html += `<div class="prec-tooltip__header">${timeLabel}</div>`;
		html += `<div class="prec-tooltip__body">`;

		e.entries.forEach((entry) => {
			const stationColor = entry.dataSeries.color || "#64748b";
			const value = entry.dataPoint?.y;
			const displayValue =
				value === null || value === undefined
					? "Offline"
					: `${value.toFixed(this.valueDecimals)} ${this.unit}`;

			html += `
				<div class="prec-tooltip__station">
					<div class="prec-tooltip__station-left">
						<span class="prec-tooltip__dot" style="background: ${stationColor};"></span>
						<span class="prec-tooltip__station-name">${entry.dataSeries.name}:</span>
					</div>
					<span class="prec-tooltip__value" style="color: ${stationColor};">${displayValue}</span>
				</div>
			`;
		});

		html += `</div></div>`;
		return html;
	}

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
		if (this.elements.errorMessage) {
			this.elements.errorMessage.textContent = message;
		}
		if (this.elements.error) {
			this.elements.error.classList.add("show");
		}
	}

	_hideError() {
		if (this.elements.error) {
			this.elements.error.classList.remove("show");
		}
	}

	destroy() {
		if (this._resizeTimer) clearTimeout(this._resizeTimer);
		if (this._loadDebounceTimer) clearTimeout(this._loadDebounceTimer);
		if (this._resizeHandler) {
			window.removeEventListener("resize", this._resizeHandler);
		}
		if (this.chart) this.chart.destroy();
		this.chart = null;
		this.chartData = null;
		this.dataCache.clear();
	}
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = HourlyMetricChart;
}
if (typeof window !== "undefined") {
	window.HourlyMetricChart = HourlyMetricChart;
}
