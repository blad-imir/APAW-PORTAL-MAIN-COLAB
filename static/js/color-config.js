/**
 * Color Configuration Utility
 * Single source of truth for all JavaScript color references
 * Reads from config.py via Flask-injected window.APP_CONFIG
 *
 * Priority:
 * 1. window.APP_CONFIG.colors (Flask-injected from config.py)
 * 2. CSS variables in DOM (fallback)
 * 3. Neutral gray (last resort)
 */

const ColorConfig = {
	_cached: null,

	getColors() {
		if (this._cached) return this._cached;

		if (window.APP_CONFIG?.colors) {
			this._cached = window.APP_CONFIG.colors;
			return this._cached;
		}

		console.warn(
			"[ColorConfig] window.APP_CONFIG.colors not found, reading from CSS"
		);
		this._cached = this.getColorsFromCSS();
		return this._cached;
	},

	getColorsFromCSS() {
		const root = document.documentElement;
		const getVar = (name) =>
			getComputedStyle(root).getPropertyValue(name).trim();

		return {
			flood_colors: {
				normal: getVar("--flood-normal"),
				advisory: getVar("--flood-advisory"),
				alert: getVar("--flood-alert"),
				warning: getVar("--flood-warning"),
				critical: getVar("--flood-critical"),
			},
			alert_colors: {
				normal: getVar("--alert-normal"),
				advisory: getVar("--alert-advisory"),
				alert: getVar("--alert-alert"),
				warning: getVar("--alert-warning"),
				critical: getVar("--alert-critical"),
			},
			station_colors: {
				st1: getVar("--station-st1"),
				st2: getVar("--station-st2"),
				st3: getVar("--station-st3"),
				st4: getVar("--station-st4"),
				st5: getVar("--station-st5"),
			},
		};
	},

	getFloodColor(level) {
		const colors = this.getColors();
		return colors?.flood_colors?.[level] || "#6b7280";
	},

	getAlertColor(level) {
		const colors = this.getColors();
		return colors?.alert_colors?.[level] || "#6b7280";
	},

	getStationColor(stationKey) {
		const colors = this.getColors();
		const key = stationKey.toLowerCase();
		return colors?.station_colors?.[key] || "#409ac7";
	},

	clearCache() {
		this._cached = null;
	},
};

window.ColorConfig = ColorConfig;
