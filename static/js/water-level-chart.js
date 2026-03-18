/**
 * Water Level Chart - Flood monitoring visualization with threshold alerts
 * Reads configuration from window.APP_CONFIG (injected by Flask from config.py)
 */

class WaterLevelChart {
	constructor(config) {
		this.chartId = config.chartId || "waterLevelChart";
		this.apiEndpoint = config.apiEndpoint || "/api/water-level-data";
		this.showControls = config.showControls !== false;
		this.autoLoad = config.autoLoad !== false;

		this.thresholds =
			this._validateThresholds(config.thresholds) ||
			this._getDefaultThresholds();
		this.onThresholdBreach = config.onThresholdBreach || null;
		this.onDataLoaded = config.onDataLoaded || null;

		if (
			!config.stationConfig ||
			Object.keys(config.stationConfig).length === 0
		) {
			throw new Error("[WATER_LEVEL] stationConfig is required!");
		}
		this.stationConfig = config.stationConfig;
		this.filterStations = config.filterStations || null;

		this.chart = null;
		this.chartData = null;
		this.dateRange = null;
		this.elements = {};
		this.currentAlerts = new Set();
		this._resizeTimer = null;
		this._resizeHandler = null;
		this._retryTimeout = null;
		this._loadDebounceTimer = null;

		this.currentPage = 0;
		this.totalPages = 2;
		this.hoursPerPage = 12;
		this.dataCache = new Map();
		this.yAxisMax = 700;
	}

	_validateThresholds(thresholds) {
		if (!thresholds || typeof thresholds !== "object") return null;
		const required = ["advisory", "alert", "warning", "critical"];
		const hasAll = required.every((key) => typeof thresholds[key] === "number");
		return hasAll ? thresholds : null;
	}

	_getConfig() {
		return window.APP_CONFIG || {};
	}

	_getChartConfig() {
		return this._getConfig().chart_config || {};
	}

	_getDefaultThresholds() {
		const config = this._getConfig();
		return (
			config.thresholds?.water_level || {
				advisory: 180,
				alert: 250,
				warning: 400,
				critical: 600,
			}
		);
	}

	_isMobile() {
		const bp = this._getChartConfig().breakpoints || {};
		return window.innerWidth < (bp.mobile || 768);
	}

	_getResponsiveDimensions() {
		const width = window.innerWidth;
		const chartConfig = this._getChartConfig();

		const DEFAULT_RESPONSIVE = {
			mobile_sm: {
				height: 230,
				fontSize: 10,
				iconSize: 20,
				lineThickness: 2,
				markerSize: 4,
			},
			mobile: {
				height: 280,
				fontSize: 11,
				iconSize: 28,
				lineThickness: 2.5,
				markerSize: 5,
			},
			tablet: {
				height: 320,
				fontSize: 12,
				iconSize: 32,
				lineThickness: 3,
				markerSize: 6,
			},
			desktop: {
				height: 340,
				fontSize: 12,
				iconSize: 36,
				lineThickness: 3,
				markerSize: 6,
			},
		};

		const bp = chartConfig.breakpoints || {
			mobile_sm: 480,
			mobile: 768,
			tablet: 1024,
		};
		const responsive = chartConfig.responsive || DEFAULT_RESPONSIVE;

		if (width < bp.mobile_sm)
			return { ...DEFAULT_RESPONSIVE.mobile_sm, ...responsive.mobile_sm };
		if (width < bp.mobile)
			return { ...DEFAULT_RESPONSIVE.mobile, ...responsive.mobile };
		if (width < bp.tablet)
			return { ...DEFAULT_RESPONSIVE.tablet, ...responsive.tablet };
		return { ...DEFAULT_RESPONSIVE.desktop, ...responsive.desktop };
	}

	_getStyling() {
		const DEFAULT_STYLING = {
			labelFontColor: "#64748b",
			lineColor: "#e2e8f0",
			tickColor: "#e2e8f0",
			gridColor: "#f1f5f9",
			legendFontColor: "#475569",
		};
		return { ...DEFAULT_STYLING, ...this._getChartConfig().styling };
	}

	_getRetryConfig() {
		return (
			this._getChartConfig().retry || {
				maxAttempts: 3,
				delays: [1000, 2000, 5000],
			}
		);
	}

	_getAnimationConfig() {
		return (
			this._getChartConfig().animation || { duration: 400, resizeDebounce: 230 }
		);
	}

	_getFloodColor(level) {
		const config = this._getConfig();
		const colors = config.flood_colors ||
			config.colors?.flood_colors || {
				normal: "#10b981",
				advisory: "#0ea5e9",
				alert: "#eab308",
				warning: "#fb8500",
				critical: "#dc2626",
			};
		return colors[level] || colors.normal;
	}

	async init() {
		this._cacheElements();

		if (!this.elements.chartContainer) {
			console.error(`[${this.chartId}] Chart container not found!`);
			return;
		}

		const container = this.elements.chartContainer;
		if (window.getComputedStyle(container).position === "static") {
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
		const prefix = this.chartId.includes("-") ? this.chartId.split("-")[1] : "";

		this.elements = {
			chartContainer: document.getElementById(this.chartId),
			loading:
				document.getElementById(`water-chart-loading`) ||
				document.getElementById(`waterLoading-${prefix}`),
			error:
				document.getElementById(`water-chart-error`) ||
				document.getElementById(`waterError-${prefix}`),
			errorMessage:
				document.getElementById(`water-chart-error-message`) ||
				document.querySelector(`#waterError-${prefix} .chart-error__message`),
			dateBadge:
				document.getElementById(`water-chart-date-display`) ||
				document.getElementById(`waterDate-${prefix}`),
			datePicker:
				document.getElementById(`waterDatePicker`) ||
				document.getElementById(`waterPicker-${prefix}`),
			alertBanner: document.getElementById("water-alert-banner"),
		};
	}

	_setupResizeHandler() {
		const animation = this._getAnimationConfig();

		this._resizeHandler = () => {
			if (this._resizeTimer) clearTimeout(this._resizeTimer);
			this._resizeTimer = setTimeout(() => {
				if (this.chart) {
					const dims = this._getResponsiveDimensions();

					this.chart.options.height = dims.height;
					this.chart.options.axisX.labelFontSize = dims.fontSize;
					this.chart.options.axisY.labelFontSize = dims.fontSize;
					this.chart.options.axisX.titleFontSize = dims.fontSize + 2;
					this.chart.options.axisY.titleFontSize = dims.fontSize + 2;

					if (this.chart.options.data) {
						this.chart.options.data.forEach((series) => {
							series.lineThickness = dims.lineThickness;
							series.markerSize = dims.markerSize;
						});
					}

					this.chart.render();
				}
			}, animation.resizeDebounce);
		};
		window.addEventListener("resize", this._resizeHandler);
	}

	loadLatestData() {
		this._loadWaterLevelData();
	}

	loadSpecificDate(dateString) {
		this.currentPage = 0;
		if (this._loadDebounceTimer) clearTimeout(this._loadDebounceTimer);

		this._loadDebounceTimer = setTimeout(() => {
			this._loadWaterLevelData(dateString);
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
		if (this.chartData?.date) {
			this.dataCache.delete(this.chartData.date);
		}
		this.loadLatestData();
	}

	destroy() {
		if (this._resizeTimer) clearTimeout(this._resizeTimer);
		if (this._retryTimeout) clearTimeout(this._retryTimeout);
		if (this._loadDebounceTimer) clearTimeout(this._loadDebounceTimer);
		if (this._resizeHandler)
			window.removeEventListener("resize", this._resizeHandler);
		if (this.chart) this.chart.destroy();
		this.chartData = null;
		this.dateRange = null;
		this.dataCache.clear();
		this.currentAlerts.clear();
		this.elements = {};
	}

	getCurrentData() {
		return this.chartData;
	}

	getActiveAlerts() {
		return Array.from(this.currentAlerts);
	}

	async _loadDateRange() {
		try {
			const response = await fetch("/api/water-level-date-range");
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
			console.warn(`[${this.chartId}] Date range error:`, error);
		}
	}

	async _loadWaterLevelData(dateString = null) {
		if (dateString && this.dataCache.has(dateString)) {
			const cachedData = this.dataCache.get(dateString);
			this.chartData = cachedData;
			if (this.elements.dateBadge)
				this.elements.dateBadge.textContent = cachedData.date_display;
			this._renderChart(cachedData);
			this._checkThresholds(cachedData);
			if (typeof this.onDataLoaded === "function")
				this.onDataLoaded(cachedData);
			return cachedData;
		}
		return this._loadWithRetry(dateString, 1);
	}

	async _loadWithRetry(dateString, attempt) {
		const retryConfig = this._getRetryConfig();
		const MAX_RETRIES = retryConfig.maxAttempts;
		const RETRY_DELAYS = retryConfig.delays;

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
				} catch {
					errorMessage = `Server error (${response.status})`;
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
				(s) => s.data?.length > 0,
			);
			if (!hasData)
				throw new Error(`No data available for ${data.date_display}`);

			this.chartData = data;
			if (data.date) this.dataCache.set(data.date, data);
			if (this.elements.dateBadge)
				this.elements.dateBadge.textContent = data.date_display;

			this._renderChart(data);
			this._checkThresholds(data);
			this._hideLoading();

			if (typeof this.onDataLoaded === "function") this.onDataLoaded(data);
			return data;
		} catch (error) {
			console.error(`[${this.chartId}] Error:`, error);

			if (attempt < MAX_RETRIES) {
				const retryDelay = RETRY_DELAYS[attempt - 1];
				this._showRetryMessage(attempt, MAX_RETRIES, retryDelay);
				await this._sleep(retryDelay);
				return this._loadWithRetry(dateString, attempt + 1);
			}
			this._useCachedDataFallback(dateString);
		}
	}

	_sleep(ms) {
		return new Promise((resolve) => {
			this._retryTimeout = setTimeout(resolve, ms);
		});
	}

	_showRetryMessage(attempt, maxAttempts, delayMs) {
		const seconds = Math.ceil(delayMs / 1000);
		if (this.elements.loading) {
			const text = this.elements.loading.querySelector(".chart-loading__text");
			if (text)
				text.textContent = `Retrying ${attempt}/${maxAttempts} in ${seconds}s...`;
		}
	}

	_checkThresholds(apiData) {
		this.currentAlerts.clear();

		// Only show alert banner for today's data (real-time), not historical
		if (!this._isViewingToday(apiData.date)) {
			if (this.elements.alertBanner) {
				this.elements.alertBanner.classList.add("hidden");
			}
			return;
		}

		for (const stationId in apiData.stations) {
			const stationData = apiData.stations[stationId];
			const config = this.stationConfig[stationId];

			if (!config || !stationData.data || stationData.data.length === 0)
				continue;
			if (this.filterStations && !this.filterStations.includes(stationId))
				continue;

			// Real-time only: evaluate LATEST data point per station, not historical
			const latestPoint = this._getLatestDataPoint(stationData.data);
			if (!latestPoint) continue;

			const level = latestPoint.y;
			const alertLevel = this._getAlertLevel(level);

			if (alertLevel !== "normal") {
				const alert = {
					stationId,
					stationName: config.name,
					level,
					alertLevel,
					time: latestPoint.label,
					timestamp: latestPoint.timestamp,
				};

				this.currentAlerts.add(alert);

				if (alertLevel === "critical") {
					console.error(
						`CRITICAL FLOOD ALERT: ${config.name} at ${level}cm (${latestPoint.label})`,
					);
				} else if (alertLevel === "warning") {
					console.warn(
						`FLOOD WARNING: ${config.name} at ${level}cm (${latestPoint.label})`,
					);
				}

				if (typeof this.onThresholdBreach === "function") {
					this.onThresholdBreach(alert);
				}
			}
		}

		this._updateAlertBanner();
	}

	_getLatestDataPoint(dataPoints) {
		if (!dataPoints || dataPoints.length === 0) return null;

		// Find the most recent data point by timestamp
		return dataPoints.reduce((latest, point) => {
			if (!latest) return point;
			if (!point.timestamp) return latest;
			if (!latest.timestamp) return point;
			return point.timestamp > latest.timestamp ? point : latest;
		}, null);
	}

	_isViewingToday(dateString) {
		if (!dateString) return true; // No date = default to today
		const today = new Date().toISOString().split("T")[0];
		return dateString === today;
	}

	_getAlertLevel(waterLevel) {
		if (waterLevel >= this.thresholds.critical) return "critical";
		if (waterLevel >= this.thresholds.warning) return "warning";
		if (waterLevel >= this.thresholds.alert) return "alert";
		if (waterLevel >= this.thresholds.advisory) return "advisory";
		return "normal";
	}

	_updateAlertBanner() {
		if (!this.elements.alertBanner) return;

		if (this.currentAlerts.size === 0) {
			this.elements.alertBanner.classList.add("hidden");
			return;
		}

		let highestLevel = "advisory";
		for (const alert of this.currentAlerts) {
			if (alert.alertLevel === "critical") {
				highestLevel = "critical";
				break;
			}
			if (alert.alertLevel === "warning" && highestLevel !== "critical") {
				highestLevel = "warning";
			}
			if (
				alert.alertLevel === "alert" &&
				!["critical", "warning"].includes(highestLevel)
			) {
				highestLevel = "alert";
			}
		}

		this.elements.alertBanner.className = `water-alert-banner water-alert-banner--${highestLevel}`;
		this.elements.alertBanner.classList.remove("hidden");

		const messageEl = this.elements.alertBanner.querySelector(
			".water-alert-banner__message",
		);
		if (messageEl) {
			messageEl.innerHTML = this._getAlertMessage(
				highestLevel,
				this.currentAlerts.size,
			);
		}
	}

	_getAlertMessage(level, count) {
		const messages = {
			critical: `CRITICAL FLOOD LEVEL - ${count} station(s) require immediate attention`,
			warning: `FLOOD WARNING - ${count} station(s) approaching critical levels`,
			alert: `FLOOD ALERT - ${count} station(s) above normal levels`,
			advisory: `FLOOD ADVISORY - ${count} station(s) under monitoring`,
		};
		return messages[level] || "Monitoring flood levels";
	}

	_renderChart(apiData) {
		const dataSeries = [];
		let maxDataValue = 0;

		for (const stationId in apiData.stations) {
			const stationData = apiData.stations[stationId];
			const config = this.stationConfig[stationId];

			if (!config) continue;
			if (this.filterStations && !this.filterStations.includes(stationId))
				continue;

			const dataPoints = stationData.data.map((point) => ({
				label: point.label,
				y: point.y,
				actualLabel: point.label,
				day: point.day,
				stationName: config.name,
				alertLevel: this._getAlertLevel(point.y),
				count: point.count || 0,
				timestamp: point.timestamp,
			}));

			const stationMax = Math.max(...dataPoints.map((p) => p.y));
			if (stationMax > maxDataValue) maxDataValue = stationMax;

			dataSeries.push({
				type: "spline",
				name: config.name,
				showInLegend: false,
				visible: true,
				color: config.color,
				dataPoints,
			});
		}

		const criticalThreshold = this.thresholds.critical || 600;
		this.yAxisMax = Math.max(maxDataValue * 1.2, criticalThreshold + 100);

		if (this.chart) {
			this._updateChart(dataSeries);
		} else {
			this._createNewChart(dataSeries);
		}
	}

	_updateChart(dataSeries) {
		const dims = this._getResponsiveDimensions();

		this.chart.options.height = dims.height;
		this.chart.options.axisX.labelFontSize = dims.fontSize;
		this.chart.options.axisY.labelFontSize = dims.fontSize;
		this.chart.options.axisX.titleFontSize = dims.fontSize + 2;
		this.chart.options.axisY.titleFontSize = dims.fontSize + 2;
		this.chart.options.axisY.maximum = this.yAxisMax;

		this.chart.options.data = dataSeries.map((series) => ({
			...series,
			lineThickness: dims.lineThickness,
			markerSize: dims.markerSize,
		}));

		this.chart.render();
	}

	_createNewChart(dataSeries) {
		const dims = this._getResponsiveDimensions();
		const styling = this._getStyling();
		const animation = this._getAnimationConfig();

		this.chart = new CanvasJS.Chart(this.chartId, {
			animationEnabled: true,
			animationDuration: animation.duration,
			theme: "light1",
			height: dims.height,

			title: { text: "", fontSize: 0 },

			axisX: {
				title: "Time of Day",
				titleFontSize: dims.fontSize + 2,
				labelFontSize: dims.fontSize,
				labelFontColor: styling.labelFontColor,
				lineColor: styling.lineColor,
				tickColor: styling.tickColor,
				interval: 2,
			},

			axisY: {
				title: "Water Level (centimeters)",
				titleFontSize: dims.fontSize + 2,
				labelFontSize: dims.fontSize,
				labelFontColor: styling.labelFontColor,
				lineColor: styling.lineColor,
				tickColor: styling.tickColor,
				gridColor: styling.gridColor,
				gridThickness: 1,
				minimum: 0,
				maximum: this.yAxisMax,
				suffix: " cm",
				stripLines: this._createThresholdLines(),
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

			data: dataSeries.map((series) => ({
				...series,
				lineThickness: dims.lineThickness,
				markerSize: dims.markerSize,
			})),
		});

		this.chart.render();
	}

	_createThresholdLines() {
		return [
			{
				value: this.thresholds.advisory,
				color: this._getFloodColor("advisory"),
				label: `Advisory (${this.thresholds.advisory}cm)`,
				labelFontColor: this._getFloodColor("advisory"),
				labelFontSize: 11,
				labelAlign: "far",
				thickness: 2,
				lineDashType: "dot",
			},
			{
				value: this.thresholds.alert,
				color: this._getFloodColor("alert"),
				label: `Alert (${this.thresholds.alert}cm)`,
				labelFontColor: this._getFloodColor("alert"),
				labelFontSize: 11,
				labelAlign: "far",
				thickness: 2,
				lineDashType: "dash",
			},
			{
				value: this.thresholds.warning,
				color: this._getFloodColor("warning"),
				label: `Warning (${this.thresholds.warning}cm)`,
				labelFontColor: this._getFloodColor("warning"),
				labelFontSize: 11,
				labelAlign: "far",
				thickness: 2,
				lineDashType: "dash",
			},
			{
				value: this.thresholds.critical,
				color: this._getFloodColor("critical"),
				label: `Critical (${this.thresholds.critical}cm)`,
				labelFontColor: this._getFloodColor("critical"),
				labelFontSize: 11,
				labelAlign: "far",
				thickness: 3,
				lineDashType: "solid",
			},
		];
	}

	async slidePrev() {
		if (this.currentPage > 0) {
			this.currentPage--;
			this._renderChart(this.chartData);
		} else {
			await this._slideToPreviousDate();
		}
	}

	async slideNext() {
		if (this.currentPage < this.totalPages - 1) {
			this.currentPage++;
			this._renderChart(this.chartData);
		} else {
			await this._slideToNextDate();
		}
	}

	async _slideToPreviousDate() {
		if (!this.dateRange || !this.chartData) return;
		const prevDate = new Date(this.chartData.date);
		prevDate.setDate(prevDate.getDate() - 1);
		const prevDateStr = this._formatDate(prevDate);
		if (prevDateStr < this.dateRange.earliest) return;

		await this._loadWaterLevelData(prevDateStr);
		this.currentPage = this.totalPages - 1;
		this._renderChart(this.chartData);
	}

	async _slideToNextDate() {
		if (!this.dateRange || !this.chartData) return;
		const nextDate = new Date(this.chartData.date);
		nextDate.setDate(nextDate.getDate() + 1);
		const nextDateStr = this._formatDate(nextDate);
		if (nextDateStr > this.dateRange.latest) return;

		await this._loadWaterLevelData(nextDateStr);
		this.currentPage = 0;
		this._renderChart(this.chartData);
	}

	_formatDate(date) {
		const y = date.getFullYear();
		const m = String(date.getMonth() + 1).padStart(2, "0");
		const d = String(date.getDate()).padStart(2, "0");
		return `${y}-${m}-${d}`;
	}

	_setupTouchGestures() {
		const el = document.getElementById(this.chartId);
		if (!el) return;

		let startX = 0;
		el.addEventListener(
			"touchstart",
			(e) => (startX = e.changedTouches[0].screenX),
			{ passive: true },
		);
		el.addEventListener(
			"touchend",
			(e) => {
				const diff = startX - e.changedTouches[0].screenX;
				if (Math.abs(diff) >= 50)
					diff > 0 ? this.slideNext() : this.slidePrev();
			},
			{ passive: true },
		);
	}

	_formatTooltip(e) {
		if (!e.entries?.length) return "";

		const allNoData = e.entries.every(
			(entry) => (entry.dataPoint.count || 0) === 0,
		);
		if (allNoData) {
			const firstPoint = e.entries[0].dataPoint;
			if (firstPoint.timestamp && new Date(firstPoint.timestamp) > new Date())
				return "";
		}

		const width = window.innerWidth;
		let tooltipWidth = width < 480 ? "180px" : width < 768 ? "200px" : "280px";

		const firstPoint = e.entries[0].dataPoint;
		const dateHeader = this._formatTooltipDate(
			firstPoint.timestamp,
			firstPoint.actualLabel || firstPoint.label,
		);

		const valueGroups = new Map();
		let highestAlertLevel = "normal";

		e.entries.forEach((entry) => {
			if ((entry.dataPoint.count || 0) === 0) return;
			const level = entry.dataPoint.y;
			const val = level.toFixed(2);
			if (!valueGroups.has(val)) valueGroups.set(val, []);
			valueGroups.get(val).push(entry);

			const alertLevel = this._getAlertLevel(level);
			if (alertLevel === "critical") highestAlertLevel = "critical";
			else if (alertLevel === "warning" && highestAlertLevel !== "critical")
				highestAlertLevel = "warning";
			else if (
				alertLevel === "alert" &&
				!["critical", "warning"].includes(highestAlertLevel)
			)
				highestAlertLevel = "alert";
			else if (
				alertLevel === "advisory" &&
				!["critical", "warning", "alert"].includes(highestAlertLevel)
			)
				highestAlertLevel = "advisory";
		});

		let maxDupes = 0;
		valueGroups.forEach((entries) => {
			if (entries.length > 1 && entries.length > maxDupes)
				maxDupes = entries.length;
		});

		const headerColors = {
			critical: this._getFloodColor("critical"),
			warning: this._getFloodColor("warning"),
			alert: this._getFloodColor("alert"),
			advisory: this._getFloodColor("advisory"),
			normal: "#409ac7",
		};

		let html = `<div class="water-tooltip" style="width:${tooltipWidth};">`;
		html += `<div class="water-tooltip__header" style="background:${headerColors[highestAlertLevel]};">${dateHeader}</div>`;

		if (maxDupes > 1) {
			html += `<div class="water-tooltip__warning"><i class="fas fa-exclamation-triangle"></i><span>${maxDupes} stations reporting identical values</span></div>`;
		}

		if (highestAlertLevel !== "normal") {
			const alertLabels = {
				critical: "CRITICAL FLOOD LEVEL",
				warning: "FLOOD WARNING",
				alert: "FLOOD ALERT",
				advisory: "FLOOD ADVISORY",
			};
			html += `<div class="water-tooltip__alert water-tooltip__alert--${highestAlertLevel}">${alertLabels[highestAlertLevel]}</div>`;
		}

		html += `<div class="water-tooltip__body">`;
		e.entries.forEach((entry) => {
			const color = entry.dataSeries.color;
			const name = entry.dataPoint.stationName || entry.dataSeries.name;
			const level = entry.dataPoint.y;
			const count = entry.dataPoint.count || 0;
			const alertLevel = this._getAlertLevel(level);

			let displayValue, valueColor;
			if (count === 0) {
				displayValue = "Offline";
				valueColor = "#94a3b8";
			} else {
				displayValue = `${level.toFixed(1)} cm`;
				valueColor = alertLevel !== "normal" ? headerColors[alertLevel] : color;
			}

			html += `<div class="water-tooltip__station"><div class="water-tooltip__station-left"><span class="water-tooltip__dot" style="background:${color};"></span><span class="water-tooltip__station-name">${name}:</span></div><span class="water-tooltip__value" style="color:${valueColor};">${displayValue}</span></div>`;
		});

		return html + `</div></div>`;
	}

	_formatTooltipDate(timestamp, timeLabel) {
		if (!timestamp) return timeLabel || "";

		const date = new Date(timestamp);
		const options = {
			weekday: "short",
			month: "long",
			day: "numeric",
			year: "numeric",
		};
		const dateStr = date.toLocaleDateString("en-US", options);

		let hours = date.getHours();
		const ampm = hours >= 12 ? "PM" : "AM";
		hours = hours % 12 || 12;
		const timeStr = `${hours} ${ampm}`;

		return `${dateStr} ${timeStr}`;
	}

	_showLoading() {
		this.elements.loading?.classList.remove("hidden");
		this._hideError();
	}

	_hideLoading() {
		this.elements.loading?.classList.add("hidden");
	}

	_showError(message) {
		if (this.elements.errorMessage)
			this.elements.errorMessage.textContent = message;
		this.elements.error?.classList.add("show");
		if (this.elements.chartContainer)
			this.elements.chartContainer.style.display = "none";
		this._hideLoading();
	}

	_hideError() {
		this.elements.error?.classList.remove("show");
		if (this.elements.chartContainer)
			this.elements.chartContainer.style.display = "block";
	}

	_useCachedDataFallback(requestedDate) {
		if (requestedDate && this.dataCache.has(requestedDate)) {
			this.chartData = this.dataCache.get(requestedDate);
			this._renderChart(this.chartData);
			this._hideLoading();
			return;
		}
		if (this.dataCache.size > 0) {
			this.chartData = Array.from(this.dataCache.values()).pop();
			this._renderChart(this.chartData);
			this._hideLoading();
			return;
		}
		this._showError("No data available. Please try again later.");
	}
}

if (typeof module !== "undefined" && module.exports) {
	module.exports = WaterLevelChart;
} else {
	window.WaterLevelChart = WaterLevelChart;
}
