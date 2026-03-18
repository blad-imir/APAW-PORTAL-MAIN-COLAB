/**
 * Dashboard Alert Manager
 * Syncs alerts between map, metric cards, and alert banners
 */

const AlertManager = {
	// Will be loaded from config
	totalStations: 5,
	stationIds: [],
	alertConfig: null,

	thresholds: null,
	currentAlerts: new Map(),

	initialize() {
		this.loadConfig();
	},

	loadConfig() {
		// Load station info from APP_CONFIG
		const stations = window.APP_CONFIG?.stations || [];
		this.stationIds = stations.map((s) => s.id);
		this.totalStations = stations.length || 5;

		// Load alert config
		this.alertConfig = window.APP_CONFIG?.alert_config || {
			bannerLabels: {
				critical: "Critical Flood",
				warning: "Flood Warning",
				alert: "Flood Alert",
				advisory: "Flood Advisory",
				normal: "Normal",
				none: "No Alert",
			},
			bannerIcons: {
				critical: "fa-exclamation-triangle",
				warning: "fa-exclamation-circle",
				alert: "fa-bolt",
				advisory: "fa-info-circle",
				normal: "fa-check-circle",
				none: "fa-check-circle",
			},
			metricIcons: {
				critical: { cls: "fa-exclamation-triangle", color: "text-danger" },
				warning: { cls: "fa-exclamation-circle", color: "text-warning" },
				alert: { cls: "fa-bolt", color: "text-warning" },
				advisory: { cls: "fa-info-circle", color: "text-info" },
				normal: { cls: "fa-check-circle", color: "text-success" },
				none: { cls: "fa-check-circle", color: "text-primary" },
			},
			offlineThresholdMs: 60 * 60 * 1000,
		};

		// Load thresholds
		if (window.APP_CONFIG?.thresholds?.water_level) {
			this.thresholds = window.APP_CONFIG.thresholds.water_level;
		} else {
			this.thresholds = {
				advisory: 180,
				alert: 250,
				warning: 400,
				critical: 600,
			};
		}
	},

	getAlertLevel(waterLevel) {
		if (!waterLevel && waterLevel !== 0) return "normal";
		const level = parseFloat(waterLevel);
		if (isNaN(level)) return "normal";

		if (level >= this.thresholds.critical) return "critical";
		if (level >= this.thresholds.warning) return "warning";
		if (level >= this.thresholds.alert) return "alert";
		if (level >= this.thresholds.advisory) return "advisory";
		return "normal";
	},

	updateFromStationData(stationsData) {
		if (!stationsData) return;

		const alerts = {
			critical: [],
			warning: [],
			alert: [],
			advisory: [],
			normal: [],
		};
		const attentionStations = [];
		const now = new Date();
		const offlineThreshold =
			this.alertConfig?.offlineThresholdMs || 60 * 60 * 1000;
		const cutoffTime = new Date(now.getTime() - offlineThreshold);

		const dataArray = Array.isArray(stationsData)
			? stationsData
			: Object.values(stationsData);

		const latestByStation = new Map();
		dataArray.forEach((reading) => {
			const stationId = reading.StationID;
			if (!stationId || !this.stationIds.includes(stationId)) return;

			const existing = latestByStation.get(stationId);
			if (!existing) {
				latestByStation.set(stationId, reading);
			} else {
				const existingTime = new Date(
					existing.DateTime || existing.DateTimeStamp || 0
				);
				const currentTime = new Date(
					reading.DateTime || reading.DateTimeStamp || 0
				);
				if (currentTime > existingTime) {
					latestByStation.set(stationId, reading);
				}
			}
		});

		let onlineCount = 0;

		latestByStation.forEach((data, stationId) => {
			const timestamp = new Date(data.DateTime || data.DateTimeStamp);
			const isOnline = timestamp > cutoffTime;

			if (isOnline) onlineCount++;

			const waterLevel = parseFloat(data.WaterLevel) || 0;
			const alertLevel = this.getAlertLevel(waterLevel);

			alerts[alertLevel].push({ stationId, waterLevel, isOnline });

			if (["critical", "warning", "alert"].includes(alertLevel)) {
				attentionStations.push(stationId);
			}

			this.currentAlerts.set(stationId, {
				level: alertLevel,
				waterLevel,
				isOnline,
				timestamp,
			});
		});

		this.updateAlertBanners(alerts);
		this.updateMetricCards(alerts, onlineCount, attentionStations);

		return {
			alerts,
			onlineCount,
			totalCount: this.totalStations,
			attentionStations,
		};
	},

	updateAlertBanners(alerts) {
		let container = document.querySelector(".alert-banners-row");

		if (!container) {
			const existingSection = document.getElementById("dynamic-alert-section");
			if (existingSection) {
				container = existingSection.querySelector(".alert-banners-row");
			}
		}

		if (!container) {
			const section = document.createElement("section");
			section.className = "pb-2";
			section.id = "dynamic-alert-section";
			section.innerHTML =
				'<div class="container-fluid px-2 px-md-3"><div class="row g-2 alert-banners-row"></div></div>';

			const metricSection = document.querySelector("section.py-40");
			if (metricSection) {
				metricSection.after(section);
				container = section.querySelector(".alert-banners-row");
			}
		}

		if (!container) return;

		const hasAlerts =
			alerts.critical.length > 0 ||
			alerts.warning.length > 0 ||
			alerts.alert.length > 0 ||
			alerts.advisory.length > 0;

		const section = container.closest("section");
		if (section) section.style.display = hasAlerts ? "block" : "none";

		if (!hasAlerts) {
			container.innerHTML = "";
			return;
		}

		let html = "";

		if (alerts.critical.length > 0) {
			html += this.createBanner("critical", alerts.critical.length);
		}
		if (alerts.warning.length > 0) {
			html += this.createBanner("warning", alerts.warning.length);
		}
		if (alerts.alert.length > 0) {
			html += this.createBanner("alert", alerts.alert.length);
		}
		if (alerts.advisory.length > 0) {
			html += this.createBanner("advisory", alerts.advisory.length);
		}

		container.innerHTML = html;
	},

	createBanner(level, count) {
		const labels = this.alertConfig?.bannerLabels || {
			critical: "Critical Flood",
			warning: "Flood Warning",
			alert: "Flood Alert",
			advisory: "Flood Advisory",
		};

		const icons = this.alertConfig?.bannerIcons || {
			critical: "fa-exclamation-triangle",
			warning: "fa-exclamation-circle",
			alert: "fa-bolt",
			advisory: "fa-info-circle",
		};

		const labelText = `${labels[level]} (${count})`;

		return `<div class="col-6 col-md-auto">
			<div class="d-flex align-items-center gap-2 py-2 px-3 rounded-pill shadow-sm text-white text-uppercase fw-semibold alert-banner alert-banner--${level}" 
			     role="alert" 
			     aria-live="${level === "critical" ? "assertive" : "polite"}"
			     style="font-size: 0.6rem;">
				<i class="fas ${icons[level]} flex-shrink-0" aria-hidden="true"></i>
				<span>${labelText}</span>
			</div>
		</div>`;
	},

	updateMetricCards(alerts, onlineCount, attentionStations) {
		const alertCard = document.querySelector(".alert-card");
		if (alertCard) {
			let highestLevel = "none";
			for (const level of ["critical", "warning", "alert", "advisory"]) {
				if (alerts[level].length > 0) {
					highestLevel = level;
					break;
				}
			}

			alertCard.className = alertCard.className.replace(/alert-card--\w+/g, "");
			alertCard.classList.add(`alert-card--${highestLevel}`);

			const levelText = alertCard.querySelector(".fs-3.fw-bold");
			if (levelText) {
				const displayText =
					highestLevel === "none"
						? "None"
						: highestLevel.charAt(0).toUpperCase() + highestLevel.slice(1);
				levelText.textContent = displayText;
			}

			const icon = alertCard.querySelector(".fs-2 i");
			if (icon) {
				const metricIcons = this.alertConfig?.metricIcons || {
					critical: { cls: "fa-exclamation-triangle" },
					warning: { cls: "fa-exclamation-circle" },
					alert: { cls: "fa-bolt" },
					advisory: { cls: "fa-info-circle" },
					none: { cls: "fa-check-circle" },
					normal: { cls: "fa-check-circle" },
				};
				const cfg = metricIcons[highestLevel] || metricIcons.none;
				icon.className = `fas ${cfg.cls}`;
				icon.style.color = ColorConfig.getFloodColor(highestLevel) || "#409ac7";
			}
		}

		const cards = document.querySelectorAll(".card.border-0.shadow-sm");
		cards.forEach((card) => {
			const title = card.querySelector("h6");
			if (!title) return;
			const titleText = title.textContent.trim();

			if (titleText.includes("Stations Requiring Attention")) {
				const valueEl = card.querySelector(".fs-3.fw-bold");
				const iconEl = card.querySelector(".fs-2 i");

				if (valueEl)
					valueEl.textContent = `${attentionStations.length}/${this.totalStations}`;
				if (iconEl) {
					iconEl.className =
						attentionStations.length > 0
							? "fas fa-exclamation-triangle text-danger"
							: "fas fa-check-circle text-primary";
				}
			}

			if (titleText.includes("Weather Stations Online")) {
				const valueEl = card.querySelector(".fs-3.fw-bold");
				const iconEl = card.querySelector(".fs-2 i");

				if (valueEl)
					valueEl.textContent = `${onlineCount}/${this.totalStations}`;
				if (iconEl) {
					iconEl.className =
						onlineCount === this.totalStations
							? "fas fa-check-circle text-primary"
							: "fas fa-exclamation-circle text-warning";
				}
			}
		});
	},

	triggerAlert(stationId, alertLevel, waterLevel) {
		if (alertLevel === "critical") {
			this.showNotification(stationId, waterLevel);
		}
		document.dispatchEvent(
			new CustomEvent("stationAlert", {
				detail: { stationId, alertLevel, waterLevel },
			})
		);
	},

	showNotification(stationId, waterLevel) {
		if ("Notification" in window && Notification.permission === "granted") {
			new Notification("CRITICAL WATER LEVEL", {
				body: `Station ${stationId}: Water level at ${waterLevel}cm`,
				icon: "/static/media/logo.png",
				requireInteraction: true,
			});
		}
	},

	requestNotificationPermission() {
		if ("Notification" in window && Notification.permission === "default") {
			Notification.requestPermission();
		}
	},
};

document.addEventListener("DOMContentLoaded", () => {
	AlertManager.initialize();
	AlertManager.requestNotificationPermission();
});

window.AlertManager = AlertManager;
