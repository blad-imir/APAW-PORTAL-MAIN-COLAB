/**
 * Unified Trends Chart - Daily rainfall OR water level visualization
 * Uses window.CHART_CONFIG from config.py - no hardcoded values
 * Mobile: 6-month pagination (Jan-Jun, Jul-Dec) with nav buttons
 *
 * Usage:
 *   const rainfallChart = new TrendsChart({ dataType: 'rainfall', chartId: 'rainfallTrendsChart', ... });
 *   const waterChart = new TrendsChart({ dataType: 'waterlevel', chartId: 'waterLevelTrendsChart', ... });
 */

class TrendsChart {
	constructor(config) {
		// Data type: 'rainfall' or 'waterlevel'
		this.dataType = config.dataType || "rainfall";

		// Chart identifiers
		this.chartId =
			config.chartId ||
			(this.dataType === "rainfall"
				? "rainfallTrendsChart"
				: "waterLevelTrendsChart");

		// API endpoints based on data type
		const defaultEndpoint =
			this.dataType === "rainfall"
				? "/api/rainfall-trends"
				: "/api/water-level-trends";
		this.apiEndpoint = config.apiEndpoint || defaultEndpoint;
		this.periodsEndpoint =
			config.periodsEndpoint || `${defaultEndpoint}/periods`;

		// Station configuration
		if (
			!config.stationConfig ||
			Object.keys(config.stationConfig).length === 0
		) {
			console.warn(
				`[${this.chartId}] stationConfig not provided, will use defaults`,
			);
		}
		this.stationConfig = config.stationConfig || {};
		this.allStationIds = Object.keys(this.stationConfig);

		// Callbacks
		this.onDataLoaded = config.onDataLoaded || null;

		// Chart state
		this.chart = null;
		this.chartData = null;
		this.periodsData = null;
		this.currentPeriod = null;
		this.currentYear = new Date().getFullYear();
		this.currentMonth = null;
		this.isLoading = false;
		this.elements = {};
		this._resizeTimer = null;
		this._resizeHandler = null;

		// Mobile pagination for year view (0 = Jan-Jun, 1 = Jul-Dec)
		this.currentHalf = 0;

		// Unit configuration based on data type
		this.unit = this.dataType === "rainfall" ? "mm" : "cm";
		this.yAxisTitle =
			this.dataType === "rainfall" ? "Daily Rainfall (mm)" : "Water Level (cm)";

		console.log(`[${this.chartId}] ${this.dataType} chart initialized`);
	}

	_getConfig() {
		return window.CHART_CONFIG || {};
	}

	_getStyling() {
		return window.CHART_STYLING || this._getConfig().styling || {};
	}

	_getBreakpoints() {
		return (
			this._getConfig().breakpoints || {
				mobile_sm: 480,
				mobile: 768,
				tablet: 1024,
			}
		);
	}

	_getAnimation() {
		return this._getConfig().animation || {};
	}

	_isMobile() {
		const breakpoints = this._getBreakpoints();
		return window.innerWidth < breakpoints.mobile;
	}

	_getResponsiveDimensions() {
		const width = window.innerWidth;
		const breakpoints = this._getBreakpoints();

		if (width < breakpoints.mobile_sm) {
			return {
				height: 230,
				fontSize: 10,
				lineThickness: 1,
				markerSize: 0,
			};
		}
		if (width < breakpoints.mobile) {
			return {
				height: 280,
				fontSize: 11,
				lineThickness: 1,
				markerSize: 0,
			};
		}
		if (width < breakpoints.tablet) {
			return {
				height: 320,
				fontSize: 12,
				lineThickness: 1.5,
				markerSize: 0,
			};
		}
		return {
			height: 340,
			fontSize: 12,
			lineThickness: 1.5,
			markerSize: 0,
		};
	}

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
	}

	_cacheElements() {
		this.elements = {
			chartContainer: document.getElementById(this.chartId),
			loading: document.getElementById("trendsLoading"),
			error: document.getElementById("trendsError"),
			periodSelect: document.getElementById("trendsPeriodSelect"),
			monthSelect: document.getElementById("trendsMonthSelect"),
			prevBtn: document.getElementById("trendsPrevBtn"),
			nextBtn: document.getElementById("trendsNextBtn"),
		};
	}

	_setupResizeHandler() {
		const debounceMs = this._getAnimation().resizeDebounce || 150;
		this._resizeHandler = () => {
			if (this._resizeTimer) clearTimeout(this._resizeTimer);
			this._resizeTimer = setTimeout(() => {
				if (this.chart && this.chartData) {
					this._renderChart(this.chartData);
					this._updateNavButtons();
				}
			}, debounceMs);
		};
		window.addEventListener("resize", this._resizeHandler);
	}

	_navigateHalf(direction) {
		const newHalf = this.currentHalf + direction;
		if (newHalf < 0 || newHalf > 1) return;

		this.currentHalf = newHalf;
		if (this.chartData) {
			this._renderChart(this.chartData);
		}
		this._updateNavButtons();
	}

	_updateNavButtons() {
		const isMobile = this._isMobile();
		const isYearView = !this.currentMonth && this.currentYear;
		const showNav = isMobile && isYearView;

		if (this.elements.prevBtn) {
			this.elements.prevBtn.style.display = showNav ? "flex" : "none";
			this.elements.prevBtn.disabled = this.currentHalf === 0;
		}
		if (this.elements.nextBtn) {
			this.elements.nextBtn.style.display = showNav ? "flex" : "none";
			this.elements.nextBtn.disabled = this.currentHalf === 1;
		}
	}

	async _loadAvailablePeriods() {
		try {
			const response = await fetch(this.periodsEndpoint);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);

			const result = await response.json();
			if (!result.success) throw new Error("Invalid response");

			this.periodsData = result;
			this._populatePeriodSelect(result);
		} catch (error) {
			console.warn(`[${this.chartId}] Failed to load periods:`, error);
		}
	}

	_populatePeriodSelect(data) {
		const select = this.elements.periodSelect;
		if (!select) return;

		select.innerHTML = "";

		if (data.periods) {
			data.periods.forEach((period) => {
				// Skip "Last 12 months" - only show specific years
				if (period.value === "last12") return;

				const option = document.createElement("option");
				option.value = period.value;
				option.textContent = period.label;

				if (period.value === String(this.currentYear)) {
					option.selected = true;
				}
				select.appendChild(option);
			});
		}

		this._populateMonthSelect(this.currentYear, false);
	}

	_populateMonthSelect(yearOrPeriod, isLast12 = false) {
		const select = this.elements.monthSelect;
		if (!select) return;

		select.innerHTML = '<option value="">All months</option>';

		const MONTH_NAMES = [
			"January",
			"February",
			"March",
			"April",
			"May",
			"June",
			"July",
			"August",
			"September",
			"October",
			"November",
			"December",
		];

		// Only show months for specific year selection
		const year = parseInt(yearOrPeriod, 10);
		if (isNaN(year)) return;

		MONTH_NAMES.forEach((name, idx) => {
			const option = document.createElement("option");
			option.value = idx + 1;
			option.textContent = name;
			select.appendChild(option);
		});
	}

	async loadData(period = null, year = null, month = null) {
		if (this.isLoading) return;
		this.isLoading = true;

		if (year !== null) {
			this.currentYear = year;
			this.currentPeriod = null;
		} else {
			const periodSelect = this.elements.periodSelect;
			if (periodSelect) {
				const val = periodSelect.value;
				this.currentYear = parseInt(val, 10);
				this.currentPeriod = null;
			}
		}

		if (month !== null) {
			this.currentMonth = month;
		} else {
			const monthSelect = this.elements.monthSelect;
			if (monthSelect) {
				this.currentMonth = monthSelect.value
					? parseInt(monthSelect.value, 10)
					: null;
			}
		}

		this._showLoading();
		this._hideError();

		try {
			const params = new URLSearchParams();

			if (this.currentYear) {
				params.set("year", this.currentYear);
			}

			if (this.currentMonth) {
				params.set("month", this.currentMonth);
			}

			const url = `${this.apiEndpoint}?${params.toString()}`;
			const response = await fetch(url);

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}

			const result = await response.json();

			if (!result.success || !result.stations) {
				throw new Error("Invalid response format");
			}

			this.chartData = result;
			this._renderChart(result);
			this._updateNavButtons();

			if (this.onDataLoaded) {
				this.onDataLoaded({ data: this.chartData });
			}
		} catch (error) {
			console.error(`[${this.chartId}] Failed to load data:`, error);
			this._showError(`Failed to load ${this.dataType} trends data`);
		} finally {
			this.isLoading = false;
			this._hideLoading();
		}
	}

	_renderChart(apiData) {
		const container = this.elements.chartContainer;
		if (!container) {
			console.error(`[${this.chartId}] Container not found!`);
			return;
		}

		const dataSeries = [];
		const isMobile = this._isMobile();
		const dims = this._getResponsiveDimensions();

		const allStationIds =
			this.allStationIds.length > 0
				? this.allStationIds
				: Object.keys(apiData.stations);

		const dateFilter = this._getDateFilter(apiData.date_range);

		for (const stationId of allStationIds) {
			const stationData = apiData.stations[stationId];
			const config = this.stationConfig[stationId] || {
				name: stationData?.name || stationId,
				color: this._getStationColor(stationId),
			};

			let dataPoints = [];

			const rawData = stationData?.data || stationData;

			if (Array.isArray(rawData)) {
				dataPoints = rawData
					.filter((point) => {
						if (!dateFilter) return true;
						const pointDate = new Date(point.date);
						return pointDate >= dateFilter.start && pointDate <= dateFilter.end;
					})
					.map((point) => ({
						x: new Date(point.date),
						y: point.y,
						date: point.date,
						label: point.label,
						stationName: config.name,
						count: point.count || 0,
					}));
			}

			const displayName = isMobile
				? config.name.replace(" Station", "")
				: config.name;

			dataSeries.push({
				type: "spline",
				name: displayName,
				showInLegend: true,
				visible: true,
				color: config.color,
				dataPoints: dataPoints,
				stationId: stationId,
				markerSize: 0,
				markerType: "none",
			});
		}

		if (this.chart) {
			this.chart.destroy();
		}

		this._createChart(dataSeries, apiData.date_range, dateFilter);
	}

	_getDateFilter(dateRange) {
		const isMobile = this._isMobile();
		const isYearView = !this.currentMonth && this.currentYear;

		if (!isMobile || !isYearView || !dateRange) {
			return null;
		}

		const rangeType = dateRange.type;

		if (rangeType === "year" && this.currentYear) {
			if (this.currentHalf === 0) {
				return {
					start: new Date(this.currentYear, 0, 1),
					end: new Date(this.currentYear, 5, 30),
					label: "Jan - Jun",
				};
			} else {
				return {
					start: new Date(this.currentYear, 6, 1),
					end: new Date(this.currentYear, 11, 31),
					label: "Jul - Dec",
				};
			}
		}

		return null;
	}

	_getStationColor(stationId) {
		const colors = window.CHART_COLORS?.station_colors || {};
		const styling = this._getStyling();
		return colors[stationId] || styling.offlineColor || "#94a3b8";
	}

	_createChart(dataSeries, dateRange, dateFilter) {
		const self = this;
		const dims = this._getResponsiveDimensions();
		const isMobile = this._isMobile();
		const styling = this._getStyling();
		const animation = this._getAnimation();

		let minDate, maxDate;
		let intervalType = "month";
		let interval = 1;
		let valueFormatString = "MMM";

		const rangeType = dateRange?.type || "year";

		if (rangeType === "month") {
			minDate = new Date(dateRange.start);
			const year = minDate.getFullYear();
			const month = minDate.getMonth();
			maxDate = new Date(year, month + 1, 0);
			intervalType = "day";
			interval = isMobile ? 2 : 1;
			valueFormatString = "D";
		} else if (dateFilter) {
			minDate = dateFilter.start;
			maxDate = dateFilter.end;
			intervalType = "month";
			interval = 1;
			valueFormatString = "MMM";
		} else if (rangeType === "year" && this.currentYear) {
			minDate = new Date(this.currentYear, 0, 1);
			maxDate = new Date(this.currentYear, 11, 31);
			intervalType = "month";
			interval = 1;
			valueFormatString = "MMM";
		} else {
			const now = new Date();
			minDate = new Date(now.getFullYear(), 0, 1);
			maxDate = new Date(now.getFullYear(), 11, 31);
		}

		this.chart = new CanvasJS.Chart(this.chartId, {
			animationEnabled: animation.enabled !== false,
			animationDuration: animation.duration || 500,

			toolTip: {
				shared: true,
				contentFormatter: (e) => this._formatTooltip(e),
				borderThickness: 0,
				borderColor: "transparent",
				cornerRadius: 12,
				backgroundColor: "transparent",
				animationEnabled: false,
			},

			axisX: {
				minimum: minDate,
				maximum: maxDate,
				intervalType: intervalType,
				interval: interval,
				valueFormatString: valueFormatString,
				labelFontSize: dims.fontSize,
				labelFontColor: styling.labelFontColor || "#64748b",
				lineColor: styling.lineColor || "#e2e8f0",
				tickColor: styling.tickColor || "#e2e8f0",
				labelAngle: 0,
			},

			axisY: {
				title: isMobile ? "" : this.yAxisTitle,
				titleFontSize: dims.fontSize,
				titleFontColor: styling.titleFontColor || "#64748b",
				labelFontSize: dims.fontSize,
				labelFontColor: styling.labelFontColor || "#64748b",
				lineColor: styling.lineColor || "#e2e8f0",
				gridColor: styling.gridColor || "#f1f5f9",
				tickColor: styling.tickColor || "#e2e8f0",
				minimum: 0,
				suffix: ` ${this.unit}`,
			},

			backgroundColor: "transparent",
			zoomEnabled: false,
			culture: "en",

			creditText: styling.creditText || "CanvasJS Trial",
			creditHref: "",

			title: {
				text: "",
				margin: 0,
				padding: 0,
				cornerRadius: 12,
				backgroundColor: "transparent",
				animationEnabled: false,
			},

			legend: {
				cursor: "pointer",
				itemclick: function (e) {
					e.dataSeries.visible =
						typeof e.dataSeries.visible === "undefined"
							? false
							: !e.dataSeries.visible;
					e.chart.render();
					setTimeout(() => {
						self._repositionCredit();
					}, 100);
				},
				fontSize: isMobile ? dims.fontSize - 1 : dims.fontSize + 4,
				fontWeight: 500,
				fontColor: styling.legendFontColor || "#475569",
				horizontalAlign: isMobile ? "center" : "center",
				verticalAlign: "bottom",
				dockInsidePlotArea: false,
				markerMargin: isMobile ? 4 : 8,
				itemSpacing: isMobile ? 8 : 15,
			},

			data: dataSeries.map((series) => ({
				...series,
				lineThickness: dims.lineThickness,
				markerSize: 0,
				markerType: "none",
			})),
		});

		this.chart.render();
		setTimeout(() => {
			this._repositionCredit();
		}, animation.tooltipDelay || 100);
	}

	_formatTooltip(e) {
		if (!e.entries || e.entries.length === 0) return "";

		const firstPoint = e.entries[0]?.dataPoint;
		if (!firstPoint) return "";

		const isMobile = this._isMobile();
		const width = window.innerWidth;
		const breakpoints = this._getBreakpoints();
		const styling = this._getStyling();
		const offlineColor = styling.offlineColor || "#94a3b8";

		let tooltipWidth = "280px";
		if (width < breakpoints.mobile_sm) {
			tooltipWidth = "180px";
		} else if (width < breakpoints.mobile) {
			tooltipWidth = "200px";
		}

		let html = `<div class="prec-tooltip" style="width: ${tooltipWidth};">`;

		const dateStr = this._formatTooltipDate(firstPoint.x);
		html += `<div class="prec-tooltip__header">${dateStr}</div>`;

		const valueGroups = new Map();
		let stationsWithData = 0;

		e.entries.forEach((entry) => {
			const value = entry.dataPoint.y;
			if (value === null || value === undefined) return;

			stationsWithData++;
			const roundedValue = value.toFixed(1);

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

		const entryMap = new Map();
		e.entries.forEach((entry) => {
			const stationId = entry.dataSeries.stationId;
			const name = entry.dataSeries.name;
			if (stationId) {
				entryMap.set(stationId, entry);
			}
			if (name) {
				entryMap.set(name, entry);
			}
		});

		const allStationIds =
			this.allStationIds.length > 0
				? this.allStationIds
				: Object.keys(this.stationConfig);

		for (const stationId of allStationIds) {
			const config = this.stationConfig[stationId] || {
				name: stationId,
				color: this._getStationColor(stationId),
			};

			const displayName = isMobile
				? config.name.replace(" Station", "")
				: config.name;

			const entry =
				entryMap.get(stationId) ||
				entryMap.get(displayName) ||
				entryMap.get(config.name);
			const value = entry?.dataPoint?.y;

			let displayValue;
			let valueColor;

			if (value === null || value === undefined) {
				displayValue = "Offline";
				valueColor = offlineColor;
			} else if (value === 0) {
				displayValue = this.dataType === "rainfall" ? "No Rain" : "0 cm";
				valueColor = offlineColor;
			} else {
				displayValue = `${value.toFixed(1)} ${this.unit}`;
				valueColor = config.color;
			}

			html += `
				<div class="prec-tooltip__station">
					<div class="prec-tooltip__station-left">
						<span class="prec-tooltip__dot" style="background: ${config.color};"></span>
						<span class="prec-tooltip__station-name">${config.name}:</span>
					</div>
					<span class="prec-tooltip__value" style="color: ${valueColor};">
						${displayValue}
					</span>
				</div>
			`;
		}

		html += `</div></div>`;
		return html;
	}

	_formatTooltipDate(date) {
		if (!date) return "";
		const d = date instanceof Date ? date : new Date(date);
		return d.toLocaleDateString("en-US", {
			weekday: "short",
			month: "long",
			day: "numeric",
			year: "numeric",
		});
	}

	_repositionCredit() {
		const container = this.elements.chartContainer;
		if (!container) return;

		const styling = this._getStyling();
		const creditColor =
			styling.creditColor || styling.offlineColor || "#94a3b8";

		const creditLink = container.querySelector(".canvasjs-chart-credit");
		if (creditLink) {
			creditLink.style.cssText = `
				position: absolute !important;
				bottom: 6px !important;
				left: 10px !important;
				right: auto !important;
				font-size: 10px !important;
				color: ${creditColor} !important;
				text-decoration: none !important;
				pointer-events: none !important;
				z-index: 5 !important;
			`;
		}
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
		const errorEl =
			this.elements.error || document.getElementById("trendsError");
		if (errorEl) {
			const msgEl = errorEl.querySelector(".chart-error__message");
			if (msgEl) msgEl.textContent = message;
			errorEl.classList.add("show");
		}
		this._hideLoading();
	}

	_hideError() {
		const errorEl =
			this.elements.error || document.getElementById("trendsError");
		if (errorEl) {
			errorEl.classList.remove("show");
		}
	}

	show() {
		if (this.elements.chartContainer) {
			this.elements.chartContainer.classList.remove("hidden");
		}
	}

	hide() {
		if (this.elements.chartContainer) {
			this.elements.chartContainer.classList.add("hidden");
		}
	}

	retry() {
		this._hideError();
		this.loadData();
	}

	refresh() {
		this.loadData();
	}

	destroy() {
		if (this._resizeTimer) clearTimeout(this._resizeTimer);
		if (this._resizeHandler) {
			window.removeEventListener("resize", this._resizeHandler);
		}
		if (this.chart) {
			this.chart.destroy();
			this.chart = null;
		}
		this.chartData = null;
		this.elements = {};
	}

	getCurrentData() {
		return this.chartData;
	}
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = TrendsChart;
} else {
	window.TrendsChart = TrendsChart;
}
