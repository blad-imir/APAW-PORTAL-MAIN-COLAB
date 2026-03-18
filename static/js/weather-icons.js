/**
 * Used by: weather-card-realtime.js, site_detail.html, and any page needing weather icons
 * Config source: APP_CONFIG.weatherIconConfig from config.py
 */
const WeatherIcons = {
	getConfig() {
		return window.APP_CONFIG?.weatherIconConfig || null;
	},

	getThresholds() {
		return (
			window.APP_CONFIG?.thresholds?.rainfall || {
				light: 0.5,
				moderate: 2.5,
				heavy: 7.5,
			}
		);
	},

	/**
	 * Check if given hour is night time (6 PM - 6 AM)
	 */
	isNightTime(hour) {
		const config = this.getConfig();
		if (!config?.nightHours) return hour >= 18 || hour < 6;
		const { start, end } = config.nightHours;
		return hour >= start || hour < end;
	},

	/**
	 * Get rainfall category based on PAGASA thresholds
	 * @returns {'clear'|'light'|'moderate'|'heavy'}
	 */
	getRainfallCategory(rainfall) {
		const { light, moderate, heavy } = this.getThresholds();
		if (rainfall == null || rainfall < light) return "clear";
		if (rainfall < moderate) return "light";
		if (rainfall < heavy) return "moderate";
		return "heavy";
	},

	/**
	 * Get weather icon filename based on rainfall and time
	 * @param {number|null} rainfall - Rainfall in mm/hr
	 * @param {Date|string|null} timestamp - Optional timestamp for hour calculation
	 * @returns {string} Icon filename (e.g., 'night-clear.png', 'day-heavy-rain.png')
	 */
	getIconFilename(rainfall, timestamp = null) {
		const config = this.getConfig();
		if (!config?.icons) {
			console.warn("[WeatherIcons] APP_CONFIG.weatherIconConfig not found");
			return "sunny2.png";
		}

		let hour = new Date().getHours();
		if (timestamp) {
			const dt = timestamp instanceof Date ? timestamp : new Date(timestamp);
			if (!isNaN(dt.getTime())) {
				hour = dt.getHours();
			}
		}

		const timeOfDay = this.isNightTime(hour) ? "night" : "day";
		const category = this.getRainfallCategory(rainfall);

		const iconKey =
			category === "clear"
				? `${timeOfDay}_clear`
				: `${timeOfDay}_${category}_rain`;

		return config.icons[iconKey] || "sunny2.png";
	},

	/**
	 * Get human-readable weather description
	 */
	getDescription(rainfall, timestamp = null) {
		let hour = new Date().getHours();
		if (timestamp) {
			const dt = timestamp instanceof Date ? timestamp : new Date(timestamp);
			if (!isNaN(dt.getTime())) hour = dt.getHours();
		}

		const timeOfDay = this.isNightTime(hour) ? "Night" : "Day";
		const category = this.getRainfallCategory(rainfall);

		if (category === "clear") return `${timeOfDay} - Clear`;
		return `${timeOfDay} - ${
			category.charAt(0).toUpperCase() + category.slice(1)
		} Rain`;
	},

	/**
	 * Update an image element with the correct weather icon
	 * @param {HTMLImageElement|string} imgElement - Image element or selector
	 * @param {number|null} rainfall - Rainfall in mm/hr
	 * @param {Date|string|null} timestamp - Optional timestamp
	 */
	updateIcon(imgElement, rainfall, timestamp = null) {
		const el =
			typeof imgElement === "string"
				? document.querySelector(imgElement)
				: imgElement;

		if (!el) return;

		const iconFilename = this.getIconFilename(rainfall, timestamp);
		const basePath = el.src?.includes("/static/")
			? "/static/media/forecast-icons/"
			: "/media/forecast-icons/";

		const newSrc = `${basePath}${iconFilename}`;
		if (el.src !== newSrc) {
			el.src = newSrc;
			el.alt = this.getDescription(rainfall, timestamp);
		}
	},
};

window.WeatherIcons = WeatherIcons;
