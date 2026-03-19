class PrecipitationChart {
	constructor(config) {
		this.chartId = config.chartId || "precipitationChart";
		this.apiEndpoint = config.apiEndpoint || "/api/precipitation-data";
		this.showControls = config.showControls !== false;
		this.autoLoad = config.autoLoad !== false;

		if (
			!config.stationConfig ||
			Object.keys(config.stationConfig).length === 0
		) {
			throw new Error("[CHART] stationConfig is required!");
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
		this.weatherIcons = [];
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

		// Heights include space for: legend (top) + icons + chart + x-axis label
		if (width < 480) {
			return {
				height: 230,
				fontSize: 10,
				iconSize: 20,
				lineThickness: 2,
				markerSize: 4,
			};
		}
		if (width < 768) {
			return {
				height: 280,
				fontSize: 11,
				iconSize: 28,
				lineThickness: 2.5,
				markerSize: 5,
			};
		}
		if (width < 1024) {
			return {
				height: 320,
				fontSize: 12,
				iconSize: 32,
				lineThickness: 3,
				markerSize: 6,
			};
		}
		return {
			height: 340,
			fontSize: 12,
			iconSize: 36,
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
			loading: document.getElementById("chart-loading"),
			error: document.getElementById("chart-error"),
			errorMessage: document.getElementById("chart-error-message"),
			dateBadge: document.getElementById("chart-date-display"),
			datePicker: document.getElementById("datePicker"),
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
						this.chart.options.legend.horizontalAlign = isMobile
							? "center"
							: "center";
					}

					if (this.chart.options.data) {
						this.chart.options.data.forEach((series) => {
							series.lineThickness = dims.lineThickness;
							series.markerSize = dims.markerSize;

							// Update station name based on screen size
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
					this._positionWeatherIcons();
					this._repositionCredit();
				}
			}, 230);
		};
		window.addEventListener("resize", this._resizeHandler);
	}

	// =========================================================================
	// PUBLIC API
	// =========================================================================

	loadLatestData() {
		this._loadPrecipitationData();
	}

	loadSpecificDate(dateString) {
		console.log(`[${this.chartId}] Loading date: ${dateString}`);
		this.currentPage = 0;

		if (this._loadDebounceTimer) {
			clearTimeout(this._loadDebounceTimer);
		}

		this._loadDebounceTimer = setTimeout(() => {
			this._loadPrecipitationData(dateString);
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
		this._clearWeatherIcons();
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
			const response = await fetch("/api/precipitation-date-range");

			if (!response.ok) {
				let errorMessage = `HTTP ${response.status}`;
				try {
					const errorData = await response.json();
					errorMessage = errorData.error || errorMessage;
				} catch (parseError) {
					console.warn("[CHART] Could not parse error response as JSON");
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

	async _loadPrecipitationData(dateString = null) {
		if (dateString && this.dataCache.has(dateString)) {
			console.log(`[${this.chartId}] Using cached data for ${dateString}`);
			const cachedData = this.dataCache.get(dateString);
			this.chartData = cachedData;

			if (this.elements.dateBadge) {
				this.elements.dateBadge.textContent = cachedData.date_display;
			}

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
					console.error("[CHART] Non-JSON error response:", parseError);
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

			if (this.elements.dateBadge) {
				this.elements.dateBadge.textContent = data.date_display;
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
					`[${this.chartId}] API unavailable after ${MAX_RETRIES} attempts, using cached data`,
				);
				this._useCachedDataFallback(dateString);
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

			// Hide legend for single-station charts (station name already in header)
			const isSingleStation =
				this.filterStations && this.filterStations.length === 1;

			// Shorter names on mobile (remove "Station" suffix)
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

	_getDataPointsForCurrentPage(allDataPoints) {
		const startIndex = this.currentPage * this.hoursPerPage;
		const endIndex = startIndex + this.hoursPerPage;
		return allDataPoints.slice(startIndex, endIndex);
	}

	_updateChart(dataSeries) {
		const dims = this._getResponsiveDimensions();
		const isMobile = this._isMobile();

		this._clearWeatherIcons();

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
			this.chart.options.legend.horizontalAlign = isMobile ? "left" : "center";
		}

		this.chart.options.data = dataSeries.map((series) => ({
			...series,
			lineThickness: dims.lineThickness,
			markerSize: dims.markerSize,
		}));

		this.chart.render();
		setTimeout(() => {
			this._addWeatherIcons();
			this._repositionCredit();
		}, 100);
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
				title: "Rainfall (mm/hr)",
				titleFontSize: dims.fontSize,
				labelFontSize: dims.fontSize,
				labelFontColor: "#64748b",
				lineColor: "#e2e8f0",
				tickColor: "#e2e8f0",
				gridColor: "#f1f5f9",
				gridThickness: 1,
				minimum: 0,
				suffix: " mm",
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

			// Only show legend for multi-station charts (home page)
			// Single-station charts (site_detail) have station name in header
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
								setTimeout(() => {
									self._addWeatherIcons();
									self._repositionCredit();
								}, 100);
							},
							// Smaller font on mobile for better fit
							fontSize: self._isMobile()
								? dims.fontSize - 1
								: dims.fontSize + 4,
							fontWeight: 500,

							fontColor: "#475569",
							// Left-align on mobile, center on desktop
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
		setTimeout(() => {
			this._addWeatherIcons();
			this._repositionCredit();
		}, 100);
	}

	// =========================================================================
	// CANVASJS CREDIT REPOSITIONING & LEGEND CENTERING
	// =========================================================================

	_repositionCredit() {
		const chartContainer = document.getElementById(this.chartId);
		if (!chartContainer) return;

		const canvasContainer = chartContainer.querySelector(
			".canvasjs-chart-container",
		);
		if (!canvasContainer) return;

		// CanvasJS legend is typically in a div at the bottom
		const allDivs = canvasContainer.querySelectorAll(":scope > div");

		allDivs.forEach((div) => {
			// Check if this div contains legend items (has the marker circles)
			const hasLegendItems =
				div.querySelector('[style*="cursor: pointer"]') ||
				div.querySelector('[style*="cursor:pointer"]');

			if (hasLegendItems) {
				// Force center alignment
				div.style.cssText += `
					text-align: center !important;
					width: 100% !important;
					display: flex !important;
					justify-content: center !important;
					flex-wrap: wrap !important;
					gap: 8px !important;
				`;

				// Center each legend item
				const items = div.querySelectorAll(":scope > div");
				items.forEach((item) => {
					item.style.cssText += `
						float: none !important;
						display: inline-flex !important;
						align-items: center !important;
					`;
				});
			}
		});
	}
	// =========================================================================
	// CONTINUOUS SLIDING
	// =========================================================================

	async slidePrev() {
		if (this.currentPage > 0) {
			this.currentPage--;
			this._renderChart(this.chartData);
			console.log(`[CHART] Slid to ${this._getWindowLabel()}`);
		} else {
			await this._slideToPreviousDate();
		}
	}

	async slideNext() {
		if (this.currentPage < this.totalPages - 1) {
			this.currentPage++;
			this._renderChart(this.chartData);
			console.log(`[CHART] Slid to ${this._getWindowLabel()}`);
		} else {
			await this._slideToNextDate();
		}
	}

	async _slideToPreviousDate() {
		if (!this.dateRange || !this.chartData) return;

		const currentDate = new Date(this.chartData.date);
		const prevDate = new Date(currentDate);
		prevDate.setDate(prevDate.getDate() - 1);
		const prevDateStr = this._formatDate(prevDate);

		if (prevDateStr < this.dateRange.earliest) {
			console.log("[CHART] At earliest date");
			return;
		}

		console.log(`[CHART] Loading previous date: ${prevDateStr}`);
		await this._loadPrecipitationData(prevDateStr);
		this.currentPage = this.totalPages - 1;
		this._renderChart(this.chartData);
		console.log(`[CHART] Slid to ${prevDateStr} PM`);
	}

	async _slideToNextDate() {
		if (!this.dateRange || !this.chartData) return;

		const currentDate = new Date(this.chartData.date);
		const nextDate = new Date(currentDate);
		nextDate.setDate(nextDate.getDate() + 1);
		const nextDateStr = this._formatDate(nextDate);

		if (nextDateStr > this.dateRange.latest) {
			console.log("[CHART] At latest date");
			return;
		}

		console.log(`[CHART] Loading next date: ${nextDateStr}`);
		await this._loadPrecipitationData(nextDateStr);
		this.currentPage = 0;
		this._renderChart(this.chartData);
		console.log(`[CHART] Slid to ${nextDateStr} AM`);
	}

	_getWindowLabel() {
		const period = this.currentPage === 0 ? "AM" : "PM";
		return `${this.chartData.date} ${period}`;
	}

	_formatDate(date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}

	_updateNavigationButtons() {
		const prevBtn = document.getElementById("btn-prev-day");
		const nextBtn = document.getElementById("btn-next-day");

		if (!prevBtn || !nextBtn) return;

		const isMobile = this._isMobile();

		if (isMobile) {
			const atEarliestDate = this.chartData.date <= this.dateRange.earliest;
			const atLatestDate = this.chartData.date >= this.dateRange.latest;

			const canGoPrev = !(atEarliestDate && this.currentPage === 0);
			const canGoNext = !(
				atLatestDate && this.currentPage === this.totalPages - 1
			);

			prevBtn.style.display = canGoPrev ? "flex" : "none";
			nextBtn.style.display = canGoNext ? "flex" : "none";
		} else {
			if (this.dateRange && this.chartData) {
				const currentDate = this.chartData.date;
				prevBtn.disabled = currentDate <= this.dateRange.earliest;
				nextBtn.disabled = currentDate >= this.dateRange.latest;
			}
		}
	}

	_setupTouchGestures() {
		const chartElement = document.getElementById(this.chartId);
		if (!chartElement) return;

		let touchStartX = 0;
		let touchEndX = 0;

		chartElement.addEventListener(
			"touchstart",
			(e) => {
				touchStartX = e.changedTouches[0].screenX;
			},
			{ passive: true },
		);

		chartElement.addEventListener(
			"touchend",
			(e) => {
				touchEndX = e.changedTouches[0].screenX;
				this._handleSwipe(touchStartX, touchEndX);
			},
			{ passive: true },
		);
	}

	_handleSwipe(startX, endX) {
		const swipeThreshold = 50;
		const diff = startX - endX;

		if (Math.abs(diff) < swipeThreshold) return;

		if (diff > 0) {
			this.slideNext();
		} else {
			this.slidePrev();
		}
	}

	// =========================================================================
	// WEATHER ICONS - Day/Night aware (Option 1: Flat Style)
	// =========================================================================

	_addWeatherIcons() {
		this._clearWeatherIcons();
		if (!this.chart || !this.chartData) return;

		const firstStation = Object.values(this.chartData.stations)[0];
		if (!firstStation || !firstStation.data) return;

		const chartContainer = document.getElementById(this.chartId);
		if (!chartContainer) return;

		const dims = this._getResponsiveDimensions();
		const dataPoints = firstStation.data;

		const ICON_INTERVAL = 2;

		dataPoints.forEach((dataPoint, index) => {
			if (index % ICON_INTERVAL !== 0) return;

			let totalRainfall = 0;
			let visibleStations = 0;

			if (this.chart && this.chart.options.data) {
				this.chart.options.data.forEach((series) => {
					const isVisible =
						typeof series.visible === "undefined" || series.visible;

					if (isVisible) {
						const stationId = series.stationId;
						if (stationId) {
							const stationData =
								this.chartData.stations[stationId].data[index];
							if (stationData) {
								totalRainfall += stationData.y || 0;
								visibleStations++;
							}
						}
					}
				});
			}

			const avgRainfall =
				visibleStations > 0 ? totalRainfall / visibleStations : 0;

			const hour = this._getHourFromLabel(dataPoint.label);
			const iconUrl = this._getWeatherIcon(avgRainfall, hour);

			const icon = document.createElement("img");
			icon.src = iconUrl;
			icon.style.cssText = `
				width: ${dims.iconSize}px;
				height: ${dims.iconSize}px;
				position: absolute;
				pointer-events: none;
				user-select: none;
				z-index: 10;
				filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.1));
				transition: left 0.3s ease, top 0.3s ease;
			`;
			icon.classList.add("weather-icon");
			icon.dataset.index = index;
			icon.title = `${dataPoint.label}: ${avgRainfall.toFixed(1)} mm/hr`;

			chartContainer.appendChild(icon);
			this.weatherIcons.push(icon);
		});

		this._positionWeatherIcons();
	}

	_positionWeatherIcons() {
		if (!this.chart || this.weatherIcons.length === 0) return;

		const dims = this._getResponsiveDimensions();
		const halfIconSize = dims.iconSize / 2;

		this.weatherIcons.forEach((icon) => {
			const dataIndex = parseInt(icon.dataset.index);

			try {
				const xPosition = this.chart.axisX[0].convertValueToPixel(dataIndex);
				// Icons positioned above plot area (below legend when legend is at top)
				const yPosition = this.chart.plotArea.y1 - 22;

				icon.style.left = `${xPosition - halfIconSize}px`;
				icon.style.top = `${yPosition}px`;
			} catch (error) {
				console.warn("[CHART] Icon position error:", error);
			}
		});
	}

	_getHourFromLabel(label) {
		if (!label) return 12;

		const match = label.match(/(\d{1,2})\s*(AM|PM)/i);
		if (!match) return 12;

		let hour = parseInt(match[1]);
		const period = match[2].toUpperCase();

		if (period === "AM" && hour === 12) {
			hour = 0;
		} else if (period === "PM" && hour !== 12) {
			hour += 12;
		}

		return hour;
	}

	_getDaylightFactor(hour) {
		// 0 = full night, 1 = full daylight, smooth transitions at dawn/dusk
		if (hour >= 7 && hour < 17) return 1;
		if (hour >= 19 || hour < 5) return 0;

		if (hour >= 5 && hour < 7) {
			return (hour - 5) / 2;
		}

		if (hour >= 17 && hour < 19) {
			return 1 - (hour - 17) / 2;
		}

		return 0;
	}

	_lerpHexColor(fromHex, toHex, t) {
		const from = fromHex.replace("#", "");
		const to = toHex.replace("#", "");
		const clampT = Math.max(0, Math.min(1, t));

		const fromR = parseInt(from.substring(0, 2), 16);
		const fromG = parseInt(from.substring(2, 4), 16);
		const fromB = parseInt(from.substring(4, 6), 16);

		const toR = parseInt(to.substring(0, 2), 16);
		const toG = parseInt(to.substring(2, 4), 16);
		const toB = parseInt(to.substring(4, 6), 16);

		const r = Math.round(fromR + (toR - fromR) * clampT);
		const g = Math.round(fromG + (toG - fromG) * clampT);
		const b = Math.round(fromB + (toB - fromB) * clampT);

		return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
	}

	_svgToDataUrl(svg) {
		return `data:image/svg+xml,${encodeURIComponent(svg)}`;
	}

	_getWeatherIcon(rainfall, hour) {
		const daylight = this._getDaylightFactor(hour);
		const isNightIcon = daylight < 0.5;

		if (rainfall > 0.5) {
			const cloudColor = this._lerpHexColor("#6B7C93", "#90A4AE", daylight);
			const rainColor = this._lerpHexColor("#4FC3F7", "#64B5F6", daylight);

			return this._svgToDataUrl(
				`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>
					<path fill='${cloudColor}' d='M75 45c0-1.7-0.2-3.3-0.5-4.9C72.2 27.6 61.5 18 48.5 18c-10.8 0-20.1 6.5-24.2 15.8C23.6 33.3 22.8 33 22 33c-7.2 0-13 5.8-13 13s5.8 13 13 13h53c6.1 0 11-4.9 11-11 0-5.5-4-10-9.2-10.8-.5-.1-.8-.1-.8-.2z'/>
					<path fill='${rainColor}' d='M30 65l-4 12M40 65l-4 12M50 65l-4 12M60 65l-4 12M70 65l-4 12' stroke='${rainColor}' stroke-width='3' stroke-linecap='round'/>
				</svg>`,
			);
		}

		if (isNightIcon) {
			const moonColor = this._lerpHexColor("#F4E08A", "#9EC5FE", 1 - daylight);
			const starColor = this._lerpHexColor("#FFE082", "#D6E4FF", 1 - daylight);

			return this._svgToDataUrl(
				`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>
					<path fill='${moonColor}' d='M50 20c-16.6 0-30 13.4-30 30s13.4 30 30 30c4.1 0 8-0.8 11.6-2.3-9.3-3.6-15.9-12.6-15.9-23.2 0-13.7 9.2-25.1 21.8-28.6C62.3 22 56.4 20 50 20z'/>
					<circle cx='73' cy='28' r='2.5' fill='${starColor}'/>
					<circle cx='80' cy='38' r='1.5' fill='${starColor}'/>
				</svg>`,
			);
		}

		const sunCore = this._lerpHexColor("#FFD54F", "#FFC857", 1 - daylight);
		const sunRay = this._lerpHexColor("#FDBA74", "#F59E0B", 1 - daylight);

		return this._svgToDataUrl(
			`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>
				<circle cx='50' cy='50' r='20' fill='${sunCore}'/>
				<g stroke='${sunRay}' stroke-width='3.5' stroke-linecap='round'>
					<line x1='50' y1='15' x2='50' y2='25'/>
					<line x1='50' y1='75' x2='50' y2='85'/>
					<line x1='15' y1='50' x2='25' y2='50'/>
					<line x1='75' y1='50' x2='85' y2='50'/>
					<line x1='25.3' y1='25.3' x2='32.3' y2='32.3'/>
					<line x1='67.7' y1='67.7' x2='74.7' y2='74.7'/>
					<line x1='25.3' y1='74.7' x2='32.3' y2='67.7'/>
					<line x1='67.7' y1='32.3' x2='74.7' y2='25.3'/>
				</g>
			</svg>`,
		);
	}

	_clearWeatherIcons() {
		this.weatherIcons.forEach((icon) => {
			if (icon.parentNode) {
				icon.parentNode.removeChild(icon);
			}
		});
		this.weatherIcons = [];
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

		let html = `<div class="prec-tooltip" style="width: ${tooltipWidth};">`;

		const firstPoint = e.entries[0].dataPoint;
		const timeLabel = firstPoint.actualLabel || firstPoint.label;
		const dayLabel = firstPoint.day || "Today";

		html += `
			<div class="prec-tooltip__header">
				${dayLabel} ${timeLabel}
			</div>
		`;

		const valueGroups = new Map();
		let stationsWithData = 0;

		e.entries.forEach((entry) => {
			const count = entry.dataPoint.count || 0;
			if (count === 0) return;

			stationsWithData++;
			const rainfall = entry.dataPoint.y;
			const roundedValue = rainfall.toFixed(2);

			if (!valueGroups.has(roundedValue)) {
				valueGroups.set(roundedValue, []);
			}
			valueGroups.get(roundedValue).push(entry);
		});

		let maxDuplicateCount = 0;

		valueGroups.forEach((entries) => {
			if (entries.length > 1 && entries.length > maxDuplicateCount) {
				maxDuplicateCount = entries.length;
			}
		});

		if (maxDuplicateCount > 1) {
			html += `
				<div class="prec-tooltip__warning">
					<i class="fas fa-exclamation-triangle"></i>
					<span>${maxDuplicateCount} stations reporting identical values</span>
				</div>
			`;
		}

		html += `<div class="prec-tooltip__body">`;

		e.entries.forEach((entry) => {
			const color = entry.dataSeries.color;
			const name = entry.dataPoint.stationName || entry.dataSeries.name;
			const rainfall = entry.dataPoint.y;
			const count = entry.dataPoint.count || 0;

			let displayValue;
			let valueColor;

			if (count === 0) {
				displayValue = "Offline";
				valueColor = "#94a3b8";
			} else if (rainfall === 0) {
				displayValue = "No Rain";
				valueColor = "#94a3b8";
			} else {
				displayValue = `${rainfall.toFixed(2)} mm/hr`;
				valueColor = color;
			}

			html += `
				<div class="prec-tooltip__station">
					<div class="prec-tooltip__station-left">
						<span class="prec-tooltip__dot" style="background: ${color};"></span>
						<span class="prec-tooltip__station-name">${name}:</span>
					</div>
					<span class="prec-tooltip__value" style="color: ${valueColor};">
						${displayValue}
					</span>
				</div>
			`;
		});

		html += `</div></div>`;
		return html;
	}

	// =========================================================================
	// UI STATE
	// =========================================================================

	_showLoading() {
		if (this.elements.loading) {
			this.elements.loading.classList.remove("hidden");
		}
		this._hideError();
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
		if (this.elements.chartContainer) {
			this.elements.chartContainer.style.display = "none";
		}
		this._hideLoading();
	}

	_hideError() {
		if (this.elements.error) {
			this.elements.error.classList.remove("show");
		}
		if (this.elements.chartContainer) {
			this.elements.chartContainer.style.display = "block";
		}
	}

	_useCachedDataFallback(requestedDate) {
		if (requestedDate && this.dataCache.has(requestedDate)) {
			console.log(`[${this.chartId}] Using cached data for ${requestedDate}`);
			const cachedData = this.dataCache.get(requestedDate);
			this.chartData = cachedData;
			this._renderChart(cachedData);
			this._hideLoading();
			return;
		}

		if (this.dataCache.size > 0) {
			console.log(`[${this.chartId}] Using most recent cached data`);
			const mostRecent = Array.from(this.dataCache.values())[
				this.dataCache.size - 1
			];
			this.chartData = mostRecent;
			this._renderChart(mostRecent);
			this._hideLoading();
			return;
		}

		console.error(`[${this.chartId}] No cached data available`);
		this._showError("No data available. Please try again later.");
	}
}

// Export
if (typeof module !== "undefined" && module.exports) {
	module.exports = PrecipitationChart;
} else {
	window.PrecipitationChart = PrecipitationChart;
}
