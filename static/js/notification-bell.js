/**
 * Notification Bell - Alert History Dropdown
 * Fetches and displays historical threshold breaches (flood alerts, heavy rainfall)
 */

const NotificationBell = {
	elements: {
		badge: null,
		list: null,
		loading: null,
		empty: null,
		period: null,
		filterButtons: null,
		// Mobile elements
		mobileBadge: null,
		mobileToggle: null,
		mobilePage: null,
		mobileBack: null,
		mobileList: null,
		mobileLoading: null,
		mobileEmpty: null,
		mobileFilterButtons: null,
	},

	config: {
		endpoint: "/api/alert-history",
		days: 10,
		limit: 50,
		refreshInterval: 5 * 60 * 1000, // 5 minutes
	},

	// Colors from config.py - populated in init() via _loadColors()
	colors: null,

	notifications: [],
	filteredNotifications: [],
	currentFilter: "all",
	isLoaded: false,
	totalCount: 0,

	init() {
		// Load colors from APP_CONFIG (injected from config.py)
		this._loadColors();

		// Desktop elements
		this.elements.badge = document.getElementById("notificationBadge");
		this.elements.list = document.getElementById("notificationList");
		this.elements.loading = document.getElementById("notificationLoading");
		this.elements.empty = document.getElementById("notificationEmpty");
		this.elements.period = document.getElementById("notificationPeriod");
		this.elements.filterButtons = document.querySelectorAll(
			".notification-filter",
		);

		// Mobile elements
		this.elements.mobileBadge = document.getElementById(
			"mobileNotificationBadge",
		);
		this.elements.mobileToggle = document.getElementById(
			"mobileNotificationToggle",
		);
		this.elements.mobilePage = document.getElementById(
			"mobileNotificationPage",
		);
		this.elements.mobileBack = document.getElementById(
			"mobileNotificationBack",
		);
		this.elements.mobileList = document.getElementById(
			"mobileNotificationList",
		);
		this.elements.mobileLoading = document.getElementById(
			"mobileNotificationLoading",
		);
		this.elements.mobileEmpty = document.getElementById(
			"mobileNotificationEmpty",
		);
		this.elements.mobileFilterButtons = document.querySelectorAll(
			".mobile-notification-filter",
		);

		// Set up desktop filter button listeners
		this.setupFilterListeners();

		// Set up mobile handlers
		this.setupMobileHandlers();

		// Load on first dropdown open (lazy load) - Desktop
		const dropdown = document.getElementById("notificationDropdown");
		if (dropdown) {
			dropdown.addEventListener("show.bs.dropdown", () => {
				if (!this.isLoaded) {
					this.fetchNotifications();
				}
			});
		}

		// Also fetch on page load to show badge count
		this.fetchBadgeCount();

		// Periodic refresh
		setInterval(() => this.fetchBadgeCount(), this.config.refreshInterval);
	},

	_loadColors() {
		// Load colors from window.APP_CONFIG (injected from config.py via base.html)
		// Falls back to CSS variables if APP_CONFIG not available
		const APP = window.APP_CONFIG || {};
		const alertColors = APP.colors?.alert_colors || {};

		// Helper to get CSS variable value
		const getCssVar = (name) =>
			getComputedStyle(document.documentElement).getPropertyValue(name).trim();

		this.colors = {
			alert: {
				critical: alertColors.critical || getCssVar("--alert-critical"),
				warning: alertColors.warning || getCssVar("--alert-warning"),
				alert: alertColors.alert || getCssVar("--alert-alert"),
				advisory: alertColors.advisory || getCssVar("--alert-advisory"),
				normal: alertColors.normal || getCssVar("--alert-normal"),
			},
			ui: {
				textPrimary: getCssVar("--color-text-primary"),
				white: getCssVar("--color-white") || "#ffffff",
				hoverBg: getCssVar("--color-background-light") || "#f8f9fa",
			},
		};

		console.debug("[NotificationBell] Colors loaded from APP_CONFIG");
	},

	setupMobileHandlers() {
		// Open mobile notification page
		if (this.elements.mobileToggle) {
			this.elements.mobileToggle.addEventListener("click", (e) => {
				e.preventDefault();
				this.openMobilePage();
			});
		}

		// Close mobile notification page
		if (this.elements.mobileBack) {
			this.elements.mobileBack.addEventListener("click", () => {
				this.closeMobilePage();
			});
		}

		// Mobile filter buttons
		this.elements.mobileFilterButtons.forEach((btn) => {
			btn.addEventListener("click", (e) => {
				const filter = e.currentTarget.dataset.filter;
				this.setMobileFilter(filter);
			});
		});
	},

	openMobilePage() {
		if (this.elements.mobilePage) {
			this.elements.mobilePage.classList.add("show");
			document.body.style.overflow = "hidden"; // Prevent background scroll

			if (!this.isLoaded) {
				this.fetchNotifications();
			} else {
				this.renderMobile();
			}
		}
	},

	closeMobilePage() {
		if (this.elements.mobilePage) {
			this.elements.mobilePage.classList.remove("show");
			document.body.style.overflow = ""; // Restore scroll
		}
	},

	setMobileFilter(filter) {
		this.currentFilter = filter;

		// Update mobile button states using CSS classes
		this.elements.mobileFilterButtons.forEach((btn) => {
			btn.classList.toggle("active", btn.dataset.filter === filter);
		});

		// Also sync desktop buttons
		this.elements.filterButtons.forEach((btn) => {
			btn.classList.toggle("active", btn.dataset.filter === filter);
		});

		this.applyFilter();
		this.render();
		this.renderMobile();
	},

	setupFilterListeners() {
		this.elements.filterButtons.forEach((btn) => {
			btn.addEventListener("click", (e) => {
				const filter = e.currentTarget.dataset.filter;
				this.setFilter(filter);
			});
		});
	},

	setFilter(filter) {
		this.currentFilter = filter;

		// Update desktop button states using CSS classes
		this.elements.filterButtons.forEach((btn) => {
			btn.classList.toggle("active", btn.dataset.filter === filter);
		});

		// Also sync mobile buttons
		this.elements.mobileFilterButtons.forEach((btn) => {
			btn.classList.toggle("active", btn.dataset.filter === filter);
		});

		// Apply filter and re-render
		this.applyFilter();
		this.render();
		this.renderMobile();
	},

	applyFilter() {
		if (this.currentFilter === "all") {
			this.filteredNotifications = [...this.notifications];
		} else {
			this.filteredNotifications = this.notifications.filter(
				(n) => n.type === this.currentFilter,
			);
		}
	},

	async fetchBadgeCount() {
		try {
			const response = await fetch(
				`${this.config.endpoint}?days=${this.config.days}&limit=${this.config.limit}`,
			);
			if (!response.ok) return;

			const data = await response.json();
			if (data.success) {
				const count = data.notifications?.length || 0;
				this.totalCount = count;
				this.updateBadge(count);
			}
		} catch (error) {
			console.warn("[NotificationBell] Badge fetch error:", error);
		}
	},

	async fetchNotifications() {
		this.showLoading();
		this.showMobileLoading();

		try {
			const response = await fetch(
				`${this.config.endpoint}?days=${this.config.days}&limit=${this.config.limit}`,
			);

			if (!response.ok) throw new Error(`HTTP ${response.status}`);

			const data = await response.json();

			if (data.success) {
				this.notifications = data.notifications || [];
				this.totalCount = this.notifications.length; // Store total count
				this.applyFilter();
				this.render();
				this.renderMobile();
				this.updateBadge(this.totalCount); // Always show total, not filtered
				this.isLoaded = true;
			} else {
				throw new Error(data.error || "Failed to load notifications");
			}
		} catch (error) {
			console.error("[NotificationBell] Fetch error:", error);
			this.showError();
			this.showMobileError();
		}
	},

	render() {
		if (!this.elements.list) return;

		this.hideLoading();

		if (this.filteredNotifications.length === 0) {
			this.showEmpty();
			return;
		}

		this.hideEmpty();

		// Group notifications by date
		const grouped = this.groupByDate(this.filteredNotifications);
		let html = "";

		for (const [dateLabel, items] of Object.entries(grouped)) {
			html += `<div class="px-3 py-1 bg-light border-bottom">
				<small class="text-muted fw-semibold">${dateLabel}</small>
			</div>`;

			for (const item of items) {
				html += this.renderNotificationItem(item);
			}
		}

		// Remove loading/empty states and add notifications
		this.elements.loading?.classList.add("d-none");
		this.elements.empty?.classList.add("d-none");

		// Find or create notifications container
		let container = this.elements.list.querySelector(".notification-items");
		if (!container) {
			container = document.createElement("div");
			container.className = "notification-items";
			this.elements.list.appendChild(container);
		}
		container.innerHTML = html;
	},

	renderMobile() {
		if (!this.elements.mobileList) return;

		// Hide loading
		this.elements.mobileLoading?.classList.add("d-none");

		if (this.filteredNotifications.length === 0) {
			this.elements.mobileEmpty?.classList.remove("d-none");
			const container = this.elements.mobileList.querySelector(
				".mobile-notification-items",
			);
			if (container) container.innerHTML = "";
			return;
		}

		this.elements.mobileEmpty?.classList.add("d-none");

		// Group notifications by date
		const grouped = this.groupByDate(this.filteredNotifications);
		let html = "";

		for (const [dateLabel, items] of Object.entries(grouped)) {
			html += `<div class="px-3 py-2 bg-light border-bottom">
				<span class="text-muted fw-semibold">${dateLabel}</span>
			</div>`;

			for (const item of items) {
				html += this.renderMobileNotificationItem(item);
			}
		}

		// Find or create mobile notifications container
		let container = this.elements.mobileList.querySelector(
			".mobile-notification-items",
		);
		if (!container) {
			container = document.createElement("div");
			container.className = "mobile-notification-items";
			this.elements.mobileList.appendChild(container);
		}
		container.innerHTML = html;
	},

	renderMobileNotificationItem(item) {
		const iconHtml = this.getIconHtml(item.type, item.level);
		const formattedMessage = this.formatMessage(item);
		const timeAgo = this.formatTimeAgo(item.timestamp);

		// Slightly larger for mobile touch targets
		return `<div class="d-flex align-items-start gap-3 px-3 py-3 border-bottom" style="background: ${this.colors.ui.white};">
			<div class="flex-shrink-0" style="width: 44px; height: 44px">
				${iconHtml}
			</div>
			<div class="flex-grow-1 min-width-0">
				<p class="mb-1 lh-sm" style="font-size: 14px">${formattedMessage}</p>
				<small class="text-muted">${timeAgo}</small>
			</div>
		</div>`;
	},

	renderNotificationItem(item) {
		const iconHtml = this.getIconHtml(item.type, item.level);
		const formattedMessage = this.formatMessage(item);
		const timeAgo = this.formatTimeAgo(item.timestamp);
		const hoverBg = this.colors.ui.hoverBg;

		return `<div class="d-flex align-items-start gap-3 px-3 py-2 border-bottom notification-item" style="transition: background 0.2s" onmouseover="this.style.backgroundColor='${hoverBg}'" onmouseout="this.style.backgroundColor='transparent'">
			<div class="flex-shrink-0" style="width: 40px; height: 40px">
				${iconHtml}
			</div>
			<div class="flex-grow-1 min-width-0">
				<p class="mb-1 small lh-sm">${formattedMessage}</p>
				<small class="text-muted">${timeAgo}</small>
			</div>
		</div>`;
	},

	getIconHtml(type, level) {
		if (type === "water_level") {
			// Use SVG icons from /static/media/icons/
			const iconMap = {
				critical: "flood-critical.svg",
				warning: "flood-warning.svg",
				alert: "flood-alert.svg",
				advisory: "flood-advisory.svg",
			};
			const iconFile = iconMap[level] || "flood-advisory.svg";
			return `<img src="/static/media/icons/${iconFile}" alt="${level}" style="width: 40px; height: 40px; object-fit: contain">`;
		}

		// Rainfall - use colors from config.py via APP_CONFIG
		const isHeavy = level === "heavy";
		const iconColor = isHeavy
			? this.colors.alert.critical
			: this.colors.alert.warning;
		const bgColor = this._hexToRgba(iconColor, 0.1);
		const icon = isHeavy ? "fa-cloud-showers-heavy" : "fa-cloud-rain";

		return `<div class="d-flex align-items-center justify-content-center rounded-circle" style="width: 40px; height: 40px; background: ${bgColor}">
			<i class="fas ${icon}" style="font-size: 1rem; color: ${iconColor}"></i>
		</div>`;
	},

	_hexToRgba(hex, alpha) {
		// Convert hex color to rgba for background tint
		const r = parseInt(hex.slice(1, 3), 16);
		const g = parseInt(hex.slice(3, 5), 16);
		const b = parseInt(hex.slice(5, 7), 16);
		return `rgba(${r}, ${g}, ${b}, ${alpha})`;
	},

	formatMessage(item) {
		const stationName = this.escapeHtml(item.station_name);
		const value = item.value;
		const unit = item.unit;

		// Extract time from timestamp
		const date = new Date(item.timestamp);
		const timeStr = date.toLocaleTimeString("en-US", {
			hour: "numeric",
			minute: "2-digit",
			hour12: true,
		});

		// Semi-bold style for important text - uses color from config
		const textColor = this.colors.ui.textPrimary;
		const emphasis = (text) =>
			`<span style="font-weight: 600; color: ${textColor}">${text}</span>`;

		if (item.type === "water_level") {
			const levelLabels = {
				critical: "CRITICAL",
				warning: "Flood Warning",
				alert: "Flood Alert",
				advisory: "Advisory",
			};
			const label = levelLabels[item.level] || "Alert";

			return `${emphasis(label + ":")} Water level at ${emphasis(stationName)} reached ${emphasis(value + " " + unit)} at ${emphasis(timeStr)}.`;
		}

		// Rainfall
		const rainLabels = {
			heavy: "Heavy Rainfall",
			moderate: "Moderate Rainfall",
		};
		const label = rainLabels[item.level] || "Rainfall";

		return `${emphasis(label + ":")} ${emphasis(stationName)} recorded ${emphasis(value + " " + unit)} at ${emphasis(timeStr)}.`;
	},

	getIcon(type, level) {
		if (type === "water_level") {
			const icons = {
				critical: "fa-exclamation-triangle",
				warning: "fa-exclamation-circle",
				alert: "fa-exclamation",
				advisory: "fa-info-circle",
			};
			return icons[level] || "fa-water";
		}
		return level === "heavy" ? "fa-cloud-showers-heavy" : "fa-cloud-rain";
	},

	getIconBgClass(type, level) {
		if (type === "water_level") {
			const bgClasses = {
				critical: "bg-danger bg-opacity-10",
				warning: "bg-warning bg-opacity-10",
				alert: "bg-warning bg-opacity-10",
				advisory: "bg-info bg-opacity-10",
			};
			return bgClasses[level] || "bg-primary bg-opacity-10";
		}
		return level === "heavy"
			? "bg-primary bg-opacity-10"
			: "bg-info bg-opacity-10";
	},

	getIconColorClass(type, level) {
		if (type === "water_level") {
			const colors = {
				critical: "text-danger",
				warning: "text-warning",
				alert: "text-warning",
				advisory: "text-info",
			};
			return colors[level] || "text-primary";
		}
		return level === "heavy" ? "text-primary" : "text-info";
	},

	groupByDate(notifications) {
		const groups = {};
		const today = new Date().toDateString();
		const yesterday = new Date(Date.now() - 86400000).toDateString();

		for (const item of notifications) {
			const date = new Date(item.timestamp);
			const dateString = date.toDateString();

			let label;
			if (dateString === today) {
				label = "Today";
			} else if (dateString === yesterday) {
				label = "Yesterday";
			} else {
				label = date.toLocaleDateString("en-US", {
					weekday: "short",
					month: "short",
					day: "numeric",
				});
			}

			if (!groups[label]) {
				groups[label] = [];
			}
			groups[label].push(item);
		}

		return groups;
	},

	formatTimeAgo(timestamp) {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now - date;
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return "Just now";
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;

		return date.toLocaleDateString("en-US", {
			month: "short",
			day: "numeric",
			hour: "numeric",
			minute: "2-digit",
		});
	},

	updateBadge(count) {
		// Update desktop badge
		if (this.elements.badge) {
			if (count > 0) {
				this.elements.badge.textContent = count > 99 ? "99+" : count;
				this.elements.badge.classList.remove("d-none");
			} else {
				this.elements.badge.classList.add("d-none");
			}
		}

		// Update mobile badge
		if (this.elements.mobileBadge) {
			if (count > 0) {
				this.elements.mobileBadge.textContent = count > 99 ? "99+" : count;
				this.elements.mobileBadge.classList.remove("d-none");
			} else {
				this.elements.mobileBadge.classList.add("d-none");
			}
		}
	},

	showLoading() {
		this.elements.loading?.classList.remove("d-none");
		this.elements.empty?.classList.add("d-none");
		const container = this.elements.list?.querySelector(".notification-items");
		if (container) container.innerHTML = "";
	},

	hideLoading() {
		this.elements.loading?.classList.add("d-none");
	},

	showEmpty() {
		this.elements.empty?.classList.remove("d-none");
		const container = this.elements.list?.querySelector(".notification-items");
		if (container) container.innerHTML = "";
	},

	hideEmpty() {
		this.elements.empty?.classList.add("d-none");
	},

	showError() {
		this.hideLoading();
		const container =
			this.elements.list?.querySelector(".notification-items") ||
			this.elements.list;
		if (container) {
			container.innerHTML = `<div class="text-center py-4">
				<i class="fas fa-exclamation-circle text-danger fs-3 mb-2"></i>
				<p class="text-muted small mb-2">Failed to load alerts</p>
				<button class="btn btn-sm btn-outline-primary" style="border-radius: 8px" onclick="NotificationBell.fetchNotifications()">
					<i class="fas fa-redo me-1"></i>Try again
				</button>
			</div>`;
		}
	},

	// Mobile helper functions
	showMobileLoading() {
		this.elements.mobileLoading?.classList.remove("d-none");
		this.elements.mobileEmpty?.classList.add("d-none");
		const container = this.elements.mobileList?.querySelector(
			".mobile-notification-items",
		);
		if (container) container.innerHTML = "";
	},

	showMobileError() {
		this.elements.mobileLoading?.classList.add("d-none");
		const container =
			this.elements.mobileList?.querySelector(".mobile-notification-items") ||
			this.elements.mobileList;
		if (container) {
			container.innerHTML = `<div class="text-center py-5">
				<i class="fas fa-exclamation-circle text-danger" style="font-size: 2.5rem"></i>
				<p class="text-muted mt-3 mb-3">Failed to load alerts</p>
				<button class="btn btn-outline-primary" style="border-radius: 8px" onclick="NotificationBell.fetchNotifications()">
					<i class="fas fa-redo me-1"></i>Try again
				</button>
			</div>`;
		}
	},

	escapeHtml(text) {
		const div = document.createElement("div");
		div.textContent = text;
		return div.innerHTML;
	},
};

// Initialize on DOM ready
document.addEventListener("DOMContentLoaded", () => {
	NotificationBell.init();
});

window.NotificationBell = NotificationBell;
