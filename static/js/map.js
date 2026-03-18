/**
 * Interactive Station Map
 * Displays weather stations on Leaflet map with real-time status
 */

const StationMap = {
	map: null,
	markers: {},
	stationLabels: {},
	refreshTimer: null,
	cachedWeatherData: null,
	isInitialized: false,
	dataLoaded: false,

	config: null,
	mapCenter: null,
	mapZoom: null,
	stationCoordinates: {},
	thresholds: null,
	rainfallThresholds: null,

	async initialize() {
		if (this.isInitialized) return;

		// Register with PageLoader - call markReady() early so page preloader hides
		const markReady = window.PageLoader
			? window.PageLoader.register("map")
			: () => {};

		try {
			this.loadConfig();
			await this.initializeMap();

			// Show map's own loading overlay and render faded markers
			this.showLoadingOverlay();
			this.renderAllMarkers();

			// Hide PAGE preloader now - map is visible with its own spinner
			markReady();
			console.log("[MAP] Map visible, fetching station data...");

			// Fetch data (this is the slow part - external API)
			await this.loadInitialData();

			// Hide map's loading overlay, update markers with real data
			this.hideLoadingOverlay();
			this.renderAllMarkers();
			console.log("[MAP] Data loaded, markers updated");

			this.startAutoRefresh();
			this.isInitialized = true;

			console.log(
				"[MAP] Ready with",
				Object.keys(this.stationCoordinates).length,
				"stations"
			);
		} catch (error) {
			console.error("[MAP] Init failed:", error);
			this.hideLoadingOverlay();
			this.showError("Failed to load map");
			markReady();
		}
	},

	showLoadingOverlay() {
		const mapContainer = document.querySelector(".map-container");
		if (!mapContainer) return;

		// Don't add duplicate overlay
		if (mapContainer.querySelector(".map-loading-overlay")) return;

		const overlay = document.createElement("div");
		overlay.className = "map-loading-overlay";
		overlay.innerHTML = `
			<div class="map-loading-content">
				<div class="spinner-border text-primary" role="status">
					<span class="visually-hidden">Loading...</span>
				</div>
				<span class="map-loading-text">Loading station data...</span>
			</div>
		`;
		mapContainer.appendChild(overlay);
	},

	hideLoadingOverlay() {
		const overlay = document.querySelector(".map-loading-overlay");
		if (overlay) {
			overlay.classList.add("map-loading-overlay--hidden");
			setTimeout(() => overlay.remove(), 300);
		}
	},

	loadConfig() {
		const APP = window.APP_CONFIG;
		if (!APP) throw new Error("APP_CONFIG not found");

		this.config = APP.mapConfig || {
			apiEndpoint: "/api/weather-data",
			apiTimeout: 8000,
			refreshInterval: 60000,
			onlineThresholdMinutes: 60,
			mobileBreakpoint: 768,
			mapTiles: {
				url: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
				attribution: "&copy; OpenStreetMap",
				maxZoom: 19,
				minZoom: 10,
			},
			popupDimensions: {
				mobile: { maxWidth: 280, minWidth: 200 },
				desktop: { maxWidth: 320, minWidth: 240 },
			},
			dataAge: { fresh: 20, normal: 45, stale: 60 },
		};

		this.mapCenter = APP.map?.center || [13.335841, 123.2508871];
		this.mapZoom = APP.map?.zoom || 13;

		this.thresholds = APP.thresholds?.water_level || {
			advisory: 180,
			alert: 250,
			warning: 400,
			critical: 600,
		};
		this.rainfallThresholds = APP.thresholds?.rainfall || {
			light: 0.5,
			moderate: 2.5,
			heavy: 7.5,
		};

		if (!APP.stations?.length) {
			throw new Error("No station configuration found");
		}

		APP.stations.forEach((s) => {
			if (!s.id || !s.location) return;
			this.stationCoordinates[s.id] = {
				lat: s.location.lat,
				lng: s.location.lng,
				name: s.name || s.id,
				label: s.label || s.name || s.id,
				labelDirection: s.label_direction || "right",
				stationIds: s.station_ids || [s.id],
				hasWaterLevel: s.has_water_level !== false,
				color: s.color || ColorConfig?.getStationColor?.(s.id) || "#409ac7",
			};
		});
	},

	async initializeMap() {
		this.map = L.map("station-map", {
			center: this.mapCenter,
			zoom: this.mapZoom,
			zoomControl: true,
		});

		const tileLayer = L.tileLayer(this.config.mapTiles.url, {
			attribution: this.config.mapTiles.attribution,
			maxZoom: this.config.mapTiles.maxZoom,
			minZoom: this.config.mapTiles.minZoom,
		});

		this.addLegendControl();

		return new Promise((resolve) => {
			tileLayer.once("load", resolve);
			tileLayer.addTo(this.map);
			setTimeout(resolve, 3000);
		});
	},

	addLegendControl() {
		const legend = L.control({ position: "bottomright" });

		legend.onAdd = () => {
			const div = L.DomUtil.create("div", "map-legend");
			// Use ColorConfig as primary source, APP_CONFIG as fallback
			const getColor = (level) =>
				ColorConfig?.getFloodColor?.(level) ||
				window.APP_CONFIG?.colors?.flood_colors?.[level] ||
				"#6b7280";

			div.innerHTML = `
				<span class="legend-seg legend-normal" style="background:${getColor(
					"normal"
				)}">Normal</span>
				<span class="legend-seg legend-advisory" style="background:${getColor(
					"advisory"
				)}">Advisory</span>
				<span class="legend-seg legend-alert" style="background:${getColor(
					"alert"
				)}">Alert</span>
				<span class="legend-seg legend-warning" style="background:${getColor(
					"warning"
				)}">Warning</span>
				<span class="legend-seg legend-critical" style="background:${getColor(
					"critical"
				)}">Critical</span>
			`;
			return div;
		};

		legend.addTo(this.map);
	},

	async loadInitialData() {
		await this.fetchWeatherData();
		this.dataLoaded = true;
		console.log("[MAP] Station data loaded");
	},

	async fetchWeatherData() {
		const controller = new AbortController();
		const timeoutId = setTimeout(
			() => controller.abort(),
			this.config.apiTimeout
		);

		try {
			const response = await fetch(
				this.config.apiEndpoint + "?latest_only=true",
				{ signal: controller.signal }
			);
			clearTimeout(timeoutId);

			if (!response.ok) throw new Error(`HTTP ${response.status}`);

			const data = await response.json();
			this.cachedWeatherData = Array.isArray(data) ? data : data.data || [];
			return this.cachedWeatherData;
		} catch (error) {
			clearTimeout(timeoutId);
			console.warn("[MAP] Fetch failed, using cached data");
			return this.cachedWeatherData || [];
		}
	},

	renderAllMarkers() {
		const data = this.cachedWeatherData || [];

		Object.keys(this.stationCoordinates).forEach((stationKey) => {
			const reading = this.getLatestReading(data, stationKey);
			this.createOrUpdateMarker(stationKey, reading);
		});
	},

	getLatestReading(weatherData, stationKey) {
		const config = this.stationCoordinates[stationKey];
		if (!config || !weatherData?.length) return null;

		const readings = weatherData
			.filter((r) => config.stationIds.includes(r.StationID))
			.sort((a, b) => {
				const timeA = new Date(a.DateTime || a.DateTimeStamp || 0);
				const timeB = new Date(b.DateTime || b.DateTimeStamp || 0);
				return timeB - timeA;
			});

		return readings[0] || null;
	},

	createOrUpdateMarker(stationKey, data) {
		const config = this.stationCoordinates[stationKey];
		if (!config) return;

		const hasWaterLevel = config.hasWaterLevel;
		const alertLevel = hasWaterLevel
			? this.getAlertLevel(data?.WaterLevel)
			: "normal";
		const isOnline = this.isOnline(data);

		// Markers are faded during loading OR when station is offline
		const isLoading = !this.dataLoaded;
		const icon = this.createIcon(alertLevel, isOnline, isLoading);
		const latlng = [config.lat, config.lng];

		if (this.markers[stationKey]) {
			this.markers[stationKey].setIcon(icon);
			if (this.stationLabels[stationKey]) {
				const opacityConfig = this.config.markerOpacity || {
					online: 1,
					offline: 0.5,
					loading: 0.4,
				};
				const labelOpacity = isLoading
					? opacityConfig.loading
					: isOnline
					? opacityConfig.online
					: opacityConfig.offline;
				this.stationLabels[stationKey].setOpacity(labelOpacity);
			}
		} else {
			const isMobile = window.innerWidth < this.config.mobileBreakpoint;
			const dims = isMobile
				? this.config.popupDimensions.mobile
				: this.config.popupDimensions.desktop;

			const marker = L.marker(latlng, { icon });
			const self = this;

			marker.bindPopup(
				function () {
					const currentData = self.getLatestReading(
						self.cachedWeatherData || [],
						stationKey
					);
					const currentAlertLevel = hasWaterLevel
						? self.getAlertLevel(currentData?.WaterLevel)
						: "normal";
					const currentIsOnline = self.isOnline(currentData);
					return self.buildPopup(
						stationKey,
						config,
						currentData,
						currentAlertLevel,
						currentIsOnline
					);
				},
				{
					className: "station-popup-wrapper",
					maxWidth: dims.maxWidth,
					minWidth: dims.minWidth,
					autoPan: true,
					autoPanPadding: L.point(
						...(this.config.popupBehavior?.autoPanPadding || [50, 50])
					),
					closeButton: true,
				}
			);

			marker.addTo(this.map);
			this.markers[stationKey] = marker;

			const opacity = this.config.markerOpacity || {
				online: 1,
				offline: 0.5,
				loading: 0.4,
			};
			const labelOpacity = isLoading
				? opacity.loading
				: isOnline
				? opacity.online
				: opacity.offline;
			this.addStationLabel(stationKey, config, latlng, labelOpacity);

			marker.on("popupopen", () => {
				this.stationLabels[stationKey]?.setOpacity(0);

				const isMobile = window.innerWidth < this.config.mobileBreakpoint;
				const offsetConfig = this.config.popupBehavior?.centerOffset || {
					mobile: 160,
					desktop: 140,
				};
				const yOffset = isMobile ? offsetConfig.mobile : offsetConfig.desktop;

				const point = this.map.project(latlng, this.map.getZoom());
				point.y -= yOffset;
				const targetLatLng = this.map.unproject(point, this.map.getZoom());

				this.map.setView(targetLatLng, this.map.getZoom(), {
					animate: true,
					duration: 0.25,
				});
			});

			marker.on("popupclose", () => {
				const currentData = this.getLatestReading(
					this.cachedWeatherData || [],
					stationKey
				);
				const currentIsOnline = this.isOnline(currentData);
				const opacityConfig = this.config.markerOpacity || {
					online: 1,
					offline: 0.5,
					loading: 0.4,
				};
				this.stationLabels[stationKey]?.setOpacity(
					currentIsOnline ? opacityConfig.online : opacityConfig.offline
				);

				if (this.config.popupBehavior?.resetOnClose !== false) {
					this.map.setView(this.mapCenter, this.mapZoom, {
						animate: true,
						duration: 0.3,
					});
				}
			});

			if (
				["critical", "warning"].includes(alertLevel) &&
				window.AlertManager &&
				hasWaterLevel
			) {
				window.AlertManager.triggerAlert(
					stationKey,
					alertLevel,
					data?.WaterLevel
				);
			}
		}
	},

	addStationLabel(stationKey, config, latlng, opacity) {
		const isRight = config.labelDirection === "right";

		const labelIcon = L.divIcon({
			className: `station-label station-label--${isRight ? "right" : "left"}`,
			html: `<span class="station-label__text">${config.label}</span>`,
			iconSize: [0, 0],
			iconAnchor: [0, 10],
		});

		const label = L.marker(latlng, {
			icon: labelIcon,
			interactive: false,
			keyboard: false,
		});
		label.setOpacity(opacity);
		label.addTo(this.map);
		this.stationLabels[stationKey] = label;
	},

	createIcon(alertLevel, isOnline, isLoading = false) {
		const color = ColorConfig.getFloodColor(alertLevel);
		const pulse = alertLevel === "critical" ? "pulse-marker" : "";

		// Use config for marker opacity
		const opacityConfig = this.config?.markerOpacity || {
			online: 1,
			offline: 0.5,
			loading: 0.4,
		};
		const opacity = isLoading
			? opacityConfig.loading
			: isOnline
			? opacityConfig.online
			: opacityConfig.offline;

		return L.divIcon({
			className: `custom-marker ${pulse}`,
			html: `<div style="opacity:${opacity}">
				<svg width="30" height="40" viewBox="0 0 24 32">
					<path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20c0-6.6-5.4-12-12-12z" fill="${color}"/>
					<circle cx="12" cy="12" r="5" fill="white"/>
				</svg>
			</div>`,
			iconSize: [30, 40],
			iconAnchor: [15, 40],
			popupAnchor: [0, -40],
		});
	},

	buildPopup(stationKey, config, data, alertLevel, isOnline) {
		// If no data available (either not loaded yet or station offline)
		if (!data) {
			return `
				<div class="station-popup">
					<div class="station-popup__header">
						<div class="station-popup__title">${config.name}</div>
						<span class="station-popup__status station-popup__status--offline">Offline</span>
					</div>
					<div class="station-popup__update">
						<span class="station-popup__update-label">Last Update:</span>
						<span class="station-popup__age station-popup__age--old">No data</span>
					</div>
					<p class="station-popup__no-data">No data available</p>
					<div class="station-popup__actions">
						<a href="/sites/${stationKey}" class="cus-btn">View Details</a>
					</div>
				</div>`;
		}

		const statusClass = isOnline
			? "station-popup__status--online"
			: "station-popup__status--offline";
		const dataAge = this.getDataAge(data.DateTime || data.DateTimeStamp);

		const timestamp = data.DateTime || data.DateTimeStamp;
		const formattedTime = timestamp
			? new Date(timestamp).toLocaleDateString("en-US", {
					month: "short",
					day: "numeric",
					year: "numeric",
					hour: "numeric",
					minute: "2-digit",
					hour12: true,
			  })
			: "";

		let metricsHtml = "";
		if (config.hasWaterLevel) {
			const waterLevel =
				data.WaterLevel != null && data.WaterLevel !== ""
					? parseFloat(data.WaterLevel).toFixed(1)
					: "--";
			metricsHtml += `
				<div class="station-popup__metric">
					<span class="station-popup__metric-level station-popup__metric-level--${alertLevel}">
						${alertLevel.charAt(0).toUpperCase() + alertLevel.slice(1)} Water Level:
					</span>
					<span class="station-popup__metric-value">${waterLevel} cm</span>
				</div>`;
		}

		const rainfall =
			data.HourlyRain != null && data.HourlyRain !== ""
				? parseFloat(data.HourlyRain)
				: null;
		const rainInfo = this.getRainfallInfo(rainfall);
		const rainDisplay =
			rainfall !== null && !isNaN(rainfall) ? rainfall.toFixed(2) : "--";

		metricsHtml += `
			<div class="station-popup__metric">
				<span class="station-popup__metric-level station-popup__metric-level--${rainInfo.level}">
					${rainInfo.label}:
				</span>
				<span class="station-popup__metric-value">${rainDisplay} mm/hr</span>
			</div>`;

		return `
			<div class="station-popup">
				<div class="station-popup__header">
					<div class="station-popup__title">${config.name}</div>
					<div class="station-popup__meta">
						<span class="station-popup__status ${statusClass}">${
			isOnline ? "Online" : "Offline"
		}</span>
						<span class="station-popup__timestamp">${formattedTime}</span>
					</div>
				</div>
				<div class="station-popup__update">
					<span class="station-popup__update-label">Last Update:</span>
					<span class="station-popup__age ${dataAge.class}">${dataAge.text}</span>
				</div>
				<div class="station-popup__metrics">${metricsHtml}</div>
				<div class="station-popup__actions">
					<a href="/sites/${stationKey}" class="cus-btn">View Details</a>
				</div>
			</div>`;
	},

	isOnline(data) {
		if (!data) return false;
		const timestamp = data.DateTime || data.DateTimeStamp;
		if (!timestamp) return false;

		const diffMinutes = (Date.now() - new Date(timestamp)) / 60000;
		return diffMinutes <= this.config.onlineThresholdMinutes;
	},

	getDataAge(timestamp) {
		if (!timestamp)
			return { text: "No data", class: "station-popup__age--old" };

		const diffMinutes = Math.floor((Date.now() - new Date(timestamp)) / 60000);
		const { fresh, normal, stale } = this.config.dataAge;

		if (diffMinutes < fresh)
			return { text: "Just now", class: "station-popup__age--fresh" };
		if (diffMinutes < normal)
			return {
				text: `${diffMinutes} min ago`,
				class: "station-popup__age--normal",
			};
		if (diffMinutes < stale)
			return {
				text: `${diffMinutes} min ago`,
				class: "station-popup__age--stale",
			};

		const hours = Math.floor(diffMinutes / 60);
		const mins = diffMinutes % 60;
		return { text: `${hours}h ${mins}m ago`, class: "station-popup__age--old" };
	},

	getAlertLevel(waterLevel) {
		if (!waterLevel) return "normal";
		const level = parseFloat(waterLevel);

		if (level >= this.thresholds.critical) return "critical";
		if (level >= this.thresholds.warning) return "warning";
		if (level >= this.thresholds.alert) return "alert";
		if (level >= this.thresholds.advisory) return "advisory";
		return "normal";
	},

	getRainfallInfo(rainfall) {
		const value = parseFloat(rainfall);
		if (isNaN(value) || value < this.rainfallThresholds.light) {
			return { level: "none", label: "No Rain" };
		}
		if (value < this.rainfallThresholds.moderate) {
			return { level: "light", label: "Light Rainfall" };
		}
		if (value < this.rainfallThresholds.heavy) {
			return { level: "moderate", label: "Moderate Rainfall" };
		}
		return { level: "heavy", label: "Heavy Rainfall" };
	},

	startAutoRefresh() {
		if (this.refreshTimer) clearInterval(this.refreshTimer);
		this.refreshTimer = setInterval(async () => {
			await this.fetchWeatherData();
			this.renderAllMarkers();
		}, this.config.refreshInterval);
	},

	stopAutoRefresh() {
		if (this.refreshTimer) {
			clearInterval(this.refreshTimer);
			this.refreshTimer = null;
		}
	},

	async refresh() {
		await this.fetchWeatherData();
		this.renderAllMarkers();
	},

	showError(message) {
		const el = document.getElementById("station-map");
		if (el) {
			el.innerHTML = `
				<div class="d-flex align-items-center justify-content-center h-100 text-danger">
					<p class="m-0 fw-semibold">${message}</p>
				</div>`;
		}
	},

	destroy() {
		this.stopAutoRefresh();
		Object.values(this.markers).forEach((m) => this.map?.removeLayer(m));
		Object.values(this.stationLabels).forEach((l) => this.map?.removeLayer(l));
		this.markers = {};
		this.stationLabels = {};
		if (this.map) this.map.remove();
		this.cachedWeatherData = null;
		this.isInitialized = false;
		this.dataLoaded = false;
	},
};

document.addEventListener("DOMContentLoaded", () => {
	StationMap.initialize().catch(console.error);
});

window.StationMap = StationMap;
