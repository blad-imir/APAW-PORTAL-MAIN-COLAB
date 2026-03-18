/**
 * Real-time Weather Card with Caching and Dynamic Icons
 * Station configuration loaded from config.py via APP_CONFIG.weatherCardConfig
 */
class RealTimeWeatherCard {
	constructor(config = {}) {
		// Load station config from config.py
		const weatherCardConfig = window.APP_CONFIG?.weatherCardConfig || {};

		// Configuration - consolidate all settings here
		this.config = {
			stationId: config.stationId || weatherCardConfig.stationId || "St5",
			stationIds: config.stationIds || weatherCardConfig.stationIds || ["St5"],
			stationName:
				config.stationName ||
				weatherCardConfig.stationName ||
				"St5 - Luluasan Station",
			apiEndpoint: config.apiEndpoint || "/api/weather-data",
			refreshInterval: config.refreshInterval || 60000,
			enableAutoRefresh: config.enableAutoRefresh !== false,
			apiTimeout: 10000,
			maxRetries: 3,
			baseRetryDelay: 2000,
			pulseAnimationDuration: 500,
		};

		this.lastUpdate = null;
		this.refreshTimer = null;
		this.retryCount = 0;
		this.isUpdating = false;
		this.lastDataTimestamp = null;

		this.cachedData = null;
		this.lastSuccessfulFetch = null;
		this.consecutiveErrors = 0;
		this.backoffMultiplier = 1;
	}

	async initialize() {
		await this.updateWeatherCard();

		if (this.config.enableAutoRefresh) {
			this.startAutoRefresh();
		}

		this.setupRefreshButton();
	}

	async updateWeatherCard() {
		if (this.isUpdating) return;
		this.isUpdating = true;

		try {
			this.showLoadingState();
			const data = await this.fetchWeatherData();

			if (data === null) {
				if (this.cachedData) {
					this.updateCardElements(this.cachedData);
				}
				return;
			}

			const stationData = this.findDisplayStationData(data);

			if (stationData) {
				this.cachedData = stationData;
				this.lastSuccessfulFetch = new Date();
				this.consecutiveErrors = 0;
				this.backoffMultiplier = 1;

				this.updateCardElements(stationData);
				this.lastDataTimestamp =
					stationData.DateTime || stationData.DateTimeStamp;
				this.lastUpdate = new Date();
				this.retryCount = 0;
				this.hideErrorIndicator();
			} else {
				throw new Error(`No data for station ${this.config.stationId}`);
			}
		} catch (error) {
			if (error.name === "AbortError") return;

			console.warn("[WEATHER_CARD] Fetch failed:", error.message);
			this.handleUpdateError(error);
		} finally {
			this.isUpdating = false;
			this.hideLoadingState();
		}
	}

	async fetchWeatherData() {
		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			this.config.apiTimeout,
		);

		try {
			const response = await fetch(
				this.config.apiEndpoint + "?latest_only=true",
				{
					method: "GET",
					headers: { Accept: "application/json" },
					signal: controller.signal,
				},
			);

			clearTimeout(timeoutId);

			if (response.status >= 500) {
				return null;
			}

			if (!response.ok) throw new Error(`HTTP ${response.status}`);

			const data = await response.json();

			if (Array.isArray(data)) return data;
			if (data?.success && Array.isArray(data.data)) return data.data;
			if (Array.isArray(data?.data)) return data.data;

			throw new Error("Invalid response format");
		} catch (error) {
			clearTimeout(timeoutId);
			throw error;
		}
	}

	findDisplayStationData(dataArray) {
		if (!Array.isArray(dataArray) || dataArray.length === 0) return null;

		// Use station IDs from config
		const targetStationIds = this.config.stationIds;
		const stationReadings = dataArray.filter((r) =>
			targetStationIds.includes(r.StationID),
		);

		if (stationReadings.length === 0) return null;

		stationReadings.sort((a, b) => {
			const timeA = new Date(a.DateTime || a.DateTimeStamp || 0);
			const timeB = new Date(b.DateTime || b.DateTimeStamp || 0);
			return timeB - timeA;
		});

		return stationReadings[0];
	}

	updateCardElements(data) {
		const timestamp = this.formatTimestamp(data.DateTime || data.DateTimeStamp);
		this.updateElement(
			".weather-card__latest-reading",
			`Last Update: ${timestamp}`,
		);

		const rainfall =
			data.HourlyRain != null ? parseFloat(data.HourlyRain) : null;
		const rainfallDisplay =
			rainfall != null
				? `${rainfall.toFixed(2)}<small>mm/hr</small>`
				: `--<small>mm/hr</small>`;
		this.updateElement(".weather-card__main-value", rainfallDisplay);

		const windSpeed =
			data.WindSpeed != null ? parseFloat(data.WindSpeed) : null;
		if (windSpeed != null) {
			this.updateMetricValue(
				"wind speed",
				`${windSpeed.toFixed(
					2,
				)}<span class="weather-card__unit text-secondary fw-normal">m/s</span>`,
			);
		}

		const windDegree =
			data.WindDegree != null ? parseFloat(data.WindDegree) : null;
		const windDirection = data.WindDirection || "";
		if (windDegree != null) {
			this.updateMetricValue(
				"wind direction",
				`${Math.round(
					windDegree,
				)}<span class="weather-card__metric-value fw-bold text-dark">&deg;</span> <span class="weather-card__unit text-secondary fw-normal">${windDirection}</span>`,
			);
		}

		// Water Level with threshold-based alert coloring
		const waterLevel =
			data.WaterLevel != null ? parseFloat(data.WaterLevel) : null;
		this.updateWaterLevel(waterLevel);

		const temperature =
			data.Temperature != null ? parseFloat(data.Temperature) : null;
		if (temperature != null) {
			this.updateMetricValue(
				"temperature",
				`${temperature.toFixed(
					2,
				)}<span class="weather-card__unit text-secondary fw-normal"> &deg;C</span>`,
			);
		}

		const dataTimestamp = data.DateTime || data.DateTimeStamp;
		this.updateWeatherIcon(rainfall);
		this.pulseCard();
	}

	updateMetricValue(metricType, html) {
		const metrics = document.querySelectorAll(".weather-card__metric");

		for (const metric of metrics) {
			const icon = metric.querySelector(".weather-card__metric-icon");
			if (icon?.alt?.toLowerCase().includes(metricType.replace("_", " "))) {
				const valueElement = metric.querySelector(
					".weather-card__metric-value",
				);
				if (valueElement) {
					valueElement.innerHTML = html;
					break;
				}
			}
		}
	}

	updateElement(selector, content) {
		const element = document.querySelector(selector);
		if (element) {
			element.innerHTML = content;
		}
	}

	updateWaterLevel(waterLevel) {
		const element = document.getElementById("weather-card-water-level");
		if (!element) return;

		const waterThresholds = window.APP_CONFIG?.thresholds?.water_level || {
			advisory: 180,
			alert: 250,
			warning: 400,
			critical: 600,
		};

		if (waterLevel != null) {
			const alertColor = this.getWaterLevelColor(waterLevel, waterThresholds);
			element.style.color = alertColor;
			element.innerHTML = `${waterLevel.toFixed(
				1,
			)}<span class="weather-card__unit text-secondary fw-normal">cm</span>`;
		} else {
			element.style.color = "";
			element.innerHTML = `--<span class="weather-card__unit text-secondary fw-normal">cm</span>`;
		}
	}

	getWaterLevelColor(waterLevel, thresholds) {
		const colors = window.APP_CONFIG?.colors?.alert_colors || {
			critical: "#dc2626",
			warning: "#fb8500",
			alert: "#ffbe0b",
			advisory: "#0ea5e9",
			normal: "#409ac7",
		};

		if (waterLevel >= thresholds.critical) return colors.critical;
		if (waterLevel >= thresholds.warning) return colors.warning;
		if (waterLevel >= thresholds.alert) return colors.alert;
		if (waterLevel >= thresholds.advisory) return colors.advisory;
		return "";
	}

	/**
	 * Update weather icon using shared WeatherIcons utility
	 * Uses current time for day/night icon (not data timestamp)
	 */
	updateWeatherIcon(rainfall) {
		const iconElement = document.querySelector(".weather-card__icon img");
		if (!iconElement || !window.WeatherIcons) return;

		WeatherIcons.updateIcon(iconElement, rainfall);
	}

	formatTimestamp(timestamp) {
		if (!timestamp) return "--:--";

		try {
			const date = new Date(timestamp);
			const hours = date.getHours();
			const minutes = date.getMinutes().toString().padStart(2, "0");
			const ampm = hours >= 12 ? "PM" : "AM";
			const displayHours = (hours % 12 || 12).toString().padStart(2, "0");
			return `${displayHours}:${minutes} ${ampm}`;
		} catch {
			return "--:--";
		}
	}

	startAutoRefresh() {
		if (this.refreshTimer) clearInterval(this.refreshTimer);

		const actualInterval = this.config.refreshInterval * this.backoffMultiplier;

		this.refreshTimer = setInterval(() => {
			this.updateWeatherCard();
		}, actualInterval);
	}

	showLoadingState() {
		const card = document.querySelector(".weather-card");
		if (card) card.classList.add("weather-card--updating");
	}

	hideLoadingState() {
		const card = document.querySelector(".weather-card");
		if (card) card.classList.remove("weather-card--updating");
	}

	pulseCard() {
		const card = document.querySelector(".weather-card");
		if (card) {
			card.classList.add("weather-card--pulse");
			setTimeout(
				() => card.classList.remove("weather-card--pulse"),
				this.config.pulseAnimationDuration,
			);
		}
	}

	setupRefreshButton() {
		const refreshBtn = document.getElementById("weather-card-refresh");
		if (refreshBtn) {
			refreshBtn.addEventListener("click", async (e) => {
				e.preventDefault();
				await this.updateWeatherCard();
			});
		}
	}

	handleUpdateError(error) {
		this.consecutiveErrors++;

		if (this.cachedData) {
			this.updateCardElements(this.cachedData);
			this.showStaleDataIndicator();

			if (this.consecutiveErrors >= 3) {
				this.backoffMultiplier = Math.min(this.backoffMultiplier * 2, 5);
				this.restartWithBackoff();
			}
		} else if (this.retryCount < this.config.maxRetries) {
			this.retryCount++;
			const retryDelay =
				this.config.baseRetryDelay * Math.pow(2, this.retryCount);
			setTimeout(() => this.updateWeatherCard(), retryDelay);
		} else {
			this.showErrorState();
		}
	}

	restartWithBackoff() {
		if (this.refreshTimer) clearInterval(this.refreshTimer);
		const newInterval = this.config.refreshInterval * this.backoffMultiplier;

		this.refreshTimer = setInterval(() => {
			this.updateWeatherCard();
		}, newInterval);
	}

	showStaleDataIndicator() {
		const timeElement = document.querySelector(".weather-card__latest-reading");
		if (timeElement && !timeElement.querySelector(".stale-indicator")) {
			const indicator = document.createElement("span");
			indicator.className = "stale-indicator";
			indicator.style.cssText =
				"color: #f59e0b; font-size: 0.7rem; margin-left: 8px;";
			indicator.textContent = "(cached)";
			timeElement.appendChild(indicator);
		}
	}

	hideErrorIndicator() {
		const indicator = document.querySelector(".stale-indicator");
		if (indicator) indicator.remove();
	}

	showErrorState() {
		const timeElement = document.querySelector(".weather-card__latest-reading");
		if (timeElement) {
			timeElement.innerHTML = `
				<span style="color: #ef4444; font-size: 0.8rem;">
					Connection Error - 
					<a href="#" onclick="window.weatherCard.updateWeatherCard(); return false;" 
					   style="color: white; text-decoration: underline;">Retry</a>
				</span>
			`;
		}
	}

	destroy() {
		if (this.refreshTimer) clearInterval(this.refreshTimer);
		this.cachedData = null;
	}
}

document.addEventListener("DOMContentLoaded", function () {
	// Station config is loaded from APP_CONFIG.weatherCardConfig (set in config.py)
	window.weatherCard = new RealTimeWeatherCard({
		refreshInterval: 60000,
		enableAutoRefresh: true,
	});

	window.weatherCard.initialize();
});

window.addEventListener("beforeunload", function () {
	if (window.weatherCard) window.weatherCard.destroy();
});

/**
 * Dashboard Metrics Sync - Updates metric cards when map data changes
 * Hooks into StationMap's refresh cycle (no extra API calls)
 * All config from APP_CONFIG
 */
class DashboardMetricsSync {
	constructor() {
		this.isInitialized = false;
		this.lastMetrics = null;

		// All config from APP_CONFIG
		const APP = window.APP_CONFIG || {};
		this.thresholds = APP.thresholds || {};
		this.alertConfig = APP.alertLevels || {};
		this.rainfallConfig = APP.rainfallLevels || {};
		this.stations = APP.stations || [];

		// Use alert_colors for card icons
		const alertColors = APP.colors?.alert_colors || {};
		this.colors = {
			primary: alertColors.normal,
			critical: alertColors.critical,
			warning: alertColors.warning,
		};
	}

	initialize() {
		if (this.isInitialized) return;

		this.hookIntoMap();
		this.isInitialized = true;
		console.log("[DASHBOARD_SYNC] Initialized");
	}

	hookIntoMap() {
		const checkMap = setInterval(() => {
			if (window.StationMap?.isInitialized) {
				clearInterval(checkMap);

				const originalRender = window.StationMap.renderAllMarkers.bind(
					window.StationMap,
				);
				window.StationMap.renderAllMarkers = () => {
					originalRender();
					this.syncFromMapData();
				};

				this.syncFromMapData();
			}
		}, 100);
	}

	syncFromMapData() {
		const weatherData = window.StationMap?.cachedWeatherData;
		if (!weatherData?.length) return;

		const metrics = this.calculateMetrics(weatherData);

		if (this.hasChanged(metrics)) {
			this.updateUI(metrics);
			this.lastMetrics = metrics;
		}
	}

	calculateMetrics(weatherData) {
		const waterThresholds = this.thresholds.water_level || {};
		const rainThresholds = this.thresholds.rainfall || {};

		// Get stations config from APP_CONFIG
		const allStationIds = this.stations.map((s) => s.id);
		if (!allStationIds.length) {
			console.warn("[DASHBOARD_SYNC] No stations in APP_CONFIG.stations");
			return null;
		}
		const waterLevelStationIds = this.stations
			.filter((s) => s.has_water_level !== false)
			.map((s) => s.id);

		const alertCounts = {
			critical: 0,
			warning: 0,
			alert: 0,
			advisory: 0,
			normal: 0,
		};
		const rainfallCounts = { heavy: 0, moderate: 0, light: 0, none: 0 };
		const attentionStations = [];
		let onlineCount = 0;

		// Get only the LATEST reading per valid station (real-time, not historical)
		const latestPerStation = {};
		weatherData.forEach((reading) => {
			const stationId = reading.StationID;
			if (!allStationIds.includes(stationId)) return;

			const timestamp = reading.DateTime || reading.DateTimeStamp || "";
			if (
				!latestPerStation[stationId] ||
				timestamp > (latestPerStation[stationId].DateTime || "")
			) {
				latestPerStation[stationId] = reading;
			}
		});

		const filteredData = Object.values(latestPerStation);
		console.log(
			"[DASHBOARD_SYNC] Latest per station:",
			filteredData.map((r) => r.StationID),
		);

		filteredData.forEach((reading) => {
			const stationId = reading.StationID;
			const isOnline = this.isOnline(reading);

			if (isOnline) onlineCount++;

			// Water level alerts (only for stations with sensors)
			if (waterLevelStationIds.includes(stationId)) {
				const waterLevel = parseFloat(reading.WaterLevel) || 0;
				const alertLevel = this.getAlertLevel(waterLevel, waterThresholds);
				alertCounts[alertLevel]++;

				if (["critical", "warning", "alert"].includes(alertLevel)) {
					attentionStations.push(stationId);
				}
			}

			// Rainfall for all stations (handle null/undefined properly)
			const rawRainfall = reading.HourlyRain;
			const rainfall =
				rawRainfall !== null && rawRainfall !== undefined
					? parseFloat(rawRainfall)
					: 0;
			const rainLevel = this.getRainfallLevel(
				isNaN(rainfall) ? 0 : rainfall,
				rainThresholds,
			);

			console.log(
				`[DASHBOARD_SYNC] ${stationId}: HourlyRain=${rawRainfall} Ã¢â€ â€™ level=${rainLevel}`,
			);

			rainfallCounts[rainLevel]++;
		});

		// Determine highest levels
		let highestAlert = "none";
		for (const level of ["critical", "warning", "alert", "advisory"]) {
			if (alertCounts[level] > 0) {
				highestAlert = level;
				break;
			}
		}

		let highestRainfall = "none";
		let highestRainfallCount = 0;
		for (const level of ["heavy", "moderate", "light"]) {
			if (rainfallCounts[level] > 0) {
				highestRainfall = level;
				highestRainfallCount = rainfallCounts[level];
				break;
			}
		}

		return {
			highestAlert,
			alertCounts,
			highestRainfall,
			highestRainfallCount,
			attentionCount: attentionStations.length,
			onlineCount,
			totalStations: allStationIds.length,
			waterLevelStations: waterLevelStationIds.length,
		};
	}

	getAlertLevel(waterLevel, thresholds) {
		if (waterLevel >= thresholds.critical) return "critical";
		if (waterLevel >= thresholds.warning) return "warning";
		if (waterLevel >= thresholds.alert) return "alert";
		if (waterLevel >= thresholds.advisory) return "advisory";
		return "normal";
	}

	getRainfallLevel(rainfall, thresholds) {
		// Defensive: ensure thresholds exist
		if (!thresholds?.heavy) return "none";

		if (rainfall >= thresholds.heavy) return "heavy";
		if (rainfall >= thresholds.moderate) return "moderate";
		if (rainfall >= thresholds.light) return "light";
		return "none";
	}

	isOnline(reading) {
		const timestamp = reading.DateTime || reading.DateTimeStamp;
		if (!timestamp) return false;
		const diffMinutes = (Date.now() - new Date(timestamp)) / 60000;
		return diffMinutes <= 60;
	}

	hasChanged(metrics) {
		if (!this.lastMetrics) return true;
		return JSON.stringify(metrics) !== JSON.stringify(this.lastMetrics);
	}

	updateUI(metrics) {
		console.log("[DASHBOARD_SYNC] Updating cards:", {
			alert: metrics.highestAlert,
			rainfall: metrics.highestRainfall,
			rainfallCount: metrics.highestRainfallCount,
			attention: metrics.attentionCount,
			online: metrics.onlineCount,
		});

		this.updateAlertCard(metrics);
		this.updateRainfallCard(metrics);
		this.updateAttentionCard(metrics);
		this.updateOnlineCard(metrics);
		this.updateBanners(metrics);
	}

	updateAlertCard(metrics) {
		const alertCard = document.querySelector(".alert-card");
		if (!alertCard) return;

		const level = metrics.highestAlert;
		const config = this.alertConfig[level] || this.alertConfig["normal"] || {};

		alertCard.className = alertCard.className.replace(/alert-card--\w+/g, "");
		alertCard.classList.add(`alert-card--${level}`);

		const valueEl = alertCard.querySelector(".fs-3");
		const iconEl = alertCard.querySelector(".fs-2 i");

		if (valueEl) valueEl.textContent = config.level || "None";
		if (iconEl) {
			iconEl.className = `fas ${config.icon || "fa-check-circle"}`;
			iconEl.style.color = config.color || "";
		}
	}

	updateRainfallCard(metrics) {
		const cards = document.querySelectorAll(
			".row.g-3.g-md-4 > .col-6.col-xl-3",
		);
		if (cards.length < 2) return;

		const rainfallCard = cards[1];
		const config =
			this.rainfallConfig[metrics.highestRainfall] ||
			this.rainfallConfig["none"] ||
			{};

		const valueEl = rainfallCard.querySelector(".fs-3");
		const iconEl = rainfallCard.querySelector(".fs-2 i");

		const displayText =
			metrics.highestRainfallCount > 0
				? `${config.level} (${metrics.highestRainfallCount})`
				: config.level || "No Rain";

		if (valueEl) valueEl.textContent = displayText;
		if (iconEl) {
			iconEl.className = `fas ${config.icon || "fa-sun"}`;
			iconEl.style.color = config.color || "";
		}
	}

	updateAttentionCard(metrics) {
		const cards = document.querySelectorAll(
			".row.g-3.g-md-4 > .col-6.col-xl-3",
		);
		if (cards.length < 3) return;

		const attentionCard = cards[2];
		const count = metrics.attentionCount;

		const valueEl = attentionCard.querySelector(".fs-3");
		const iconEl = attentionCard.querySelector(".fs-2 i");

		if (valueEl) valueEl.textContent = `${count}/${metrics.waterLevelStations}`;
		if (iconEl) {
			iconEl.className =
				count > 0 ? "fas fa-exclamation-triangle" : "fas fa-check-circle";
			iconEl.style.color =
				count > 0 ? this.colors.critical : this.colors.primary;
		}
	}

	updateOnlineCard(metrics) {
		const cards = document.querySelectorAll(
			".row.g-3.g-md-4 > .col-6.col-xl-3",
		);
		if (cards.length < 4) return;

		const onlineCard = cards[3];
		const { onlineCount, totalStations } = metrics;

		const valueEl = onlineCard.querySelector(".fs-3");
		const iconEl = onlineCard.querySelector(".fs-2 i");

		if (valueEl) valueEl.textContent = `${onlineCount}/${totalStations}`;
		if (iconEl) {
			iconEl.className =
				onlineCount === totalStations
					? "fas fa-check-circle"
					: "fas fa-exclamation-circle";
			iconEl.style.color =
				onlineCount === totalStations
					? this.colors.primary
					: this.colors.warning;
		}
	}

	updateBanners(metrics) {
		const bannersRow = document.querySelector(".alert-banners-row");
		let bannersSection = bannersRow?.closest("section");

		const { alertCounts } = metrics;
		const hasAlerts =
			alertCounts.critical +
				alertCounts.warning +
				alertCounts.alert +
				alertCounts.advisory >
			0;

		if (!hasAlerts) {
			if (bannersSection) bannersSection.style.display = "none";
			return;
		}

		if (!bannersSection) {
			const metricSection = document.querySelector("section.py-40");
			if (metricSection) {
				bannersSection = document.createElement("section");
				bannersSection.className = "pb-2";
				bannersSection.innerHTML =
					'<div class="container-fluid px-2 px-md-3"><div class="row g-2 alert-banners-row"></div></div>';
				metricSection.after(bannersSection);
			}
		}

		if (bannersSection) bannersSection.style.display = "block";
		const container = bannersSection?.querySelector(".alert-banners-row");
		if (!container) return;

		const alertConfig = this.alertConfig;
		let html = "";
		if (alertCounts.critical > 0)
			html += this.bannerHTML(
				"critical",
				alertConfig.critical?.icon,
				alertCounts.critical,
			);
		if (alertCounts.warning > 0)
			html += this.bannerHTML(
				"warning",
				alertConfig.warning?.icon,
				alertCounts.warning,
			);
		if (alertCounts.alert > 0)
			html += this.bannerHTML(
				"alert",
				alertConfig.alert?.icon,
				alertCounts.alert,
			);
		if (alertCounts.advisory > 0)
			html += this.bannerHTML(
				"advisory",
				alertConfig.advisory?.icon,
				alertCounts.advisory,
			);

		container.innerHTML = html;
	}

	bannerHTML(level, icon, count) {
		const labels = {
			critical: "CRITICAL FLOOD",
			warning: "FLOOD WARNING",
			alert: "FLOOD ALERT",
			advisory: "FLOOD ADVISORY",
		};

		return `<div class="col-6 col-md-auto">
			<div class="d-flex align-items-center gap-2 py-2 px-3 rounded-pill shadow-sm text-white text-uppercase fw-semibold alert-banner alert-banner--${level}"
			     role="alert" style="font-size: 0.6rem;">
				<i class="fas ${
					icon || "fa-exclamation-circle"
				} flex-shrink-0" aria-hidden="true"></i>
				<span>${count} ${labels[level]}</span>
			</div>
		</div>`;
	}
}

// Initialize dashboard sync (skip in test mode)
document.addEventListener("DOMContentLoaded", function () {
	if (!document.body.classList.contains("test-mode")) {
		window.dashboardSync = new DashboardMetricsSync();
		window.dashboardSync.initialize();
	}
});
