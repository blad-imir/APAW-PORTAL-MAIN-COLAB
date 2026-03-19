/**
 * APAW Home Dashboard Initialization
 * Coordinates with PageLoader to ensure preloader waits for all data
 */

const HomeInit = (function () {
	"use strict";

	const CONFIG = window.APP_CONFIG || {};
	const CHART_CONFIG = CONFIG.chart_config || {};
	const REFRESH_CONFIG = CHART_CONFIG.refresh || {};

	const AUTO_REFRESH_INTERVAL = REFRESH_CONFIG.dataInterval || 120000;
	const INITIAL_REFRESH_DELAY = REFRESH_CONFIG.initialDelay || 10000;

	const WATER_STATIONS = (function () {
		const sites = CONFIG.sites || [];
		const stationsWithWater = sites
			.filter((s) => s.has_water_level === true)
			.map((s) => s.id);

		if (stationsWithWater.length > 0) return stationsWithWater;
		return ["St1", "St2", "St3", "St5"];
	})();

	let refreshCount = 0;
	let precipChart = null;
	let temperatureChart = null;
	let humidityChart = null;
	let waterCharts = {};
	let trendsChart = null;
	let waterLevelTrendsChart = null;
	let temperatureTrendsChart = null;
	let humidityTrendsChart = null;
	let activeTrendsTab = "rainfall";

	async function loadStationConfig() {
		try {
			let response = await fetch("/api/config/stations");
			let data = await response.json();

			if (data.success && data.stations) {
				const stationConfig = {};
				data.stations.forEach((station) => {
					stationConfig[station.id] = {
						name: station.name,
						color: station.color || "#409ac7",
					};
				});

				// Store chart config globally for all charts to use
				if (data.chart_config) {
					window.CHART_CONFIG = data.chart_config;
				}
				if (data.styling) {
					window.CHART_STYLING = data.styling;
				}
				if (data.colors) {
					window.CHART_COLORS = data.colors;
				}

				return stationConfig;
			}

			response = await fetch("/api/config/complete");
			data = await response.json();

			if (data.success && data.sites) {
				const stationConfig = {};
				data.sites.forEach((site) => {
					stationConfig[site.id] = {
						name: site.name,
						color: site.color || "#409ac7",
					};
				});

				if (data.chart_config) {
					window.CHART_CONFIG = data.chart_config;
				}

				return stationConfig;
			}

			throw new Error("No valid configuration found");
		} catch (error) {
			console.warn("[HOME] Config API unavailable, using template config");

			// Use fallback chart config from template
			window.CHART_CONFIG = CONFIG.chart_config || {};
			window.CHART_STYLING = window.CHART_CONFIG.styling || {};

			if (CONFIG.sites?.length > 0) {
				const stationConfig = {};
				CONFIG.sites.forEach((site) => {
					stationConfig[site.id] = {
						name: site.name,
						color: site.color || CONFIG.station_colors?.[site.id] || "#409ac7",
					};
				});
				return stationConfig;
			}

			const colors = CONFIG.station_colors || {};
			return {
				St1: { name: "Binudegahan Station", color: colors.St1 || "#409ac7" },
				St2: { name: "Mang-it Station", color: colors.St2 || "#8a60ec" },
				St3: { name: "Laganac Station", color: colors.St3 || "#ec4899" },
				St4: { name: "MDRRMO Station", color: colors.St4 || "#FABC2B" },
				St5: { name: "Luluasan Station", color: colors.St5 || "#26E4EE" },
			};
		}
	}

	async function refreshWeatherData() {
		try {
			refreshCount++;
			const response = await fetch("/api/weather-data?latest_only=true", {
				headers: { "Cache-Control": "no-cache" },
			});

			if (!response.ok) {
				if (response.status >= 500) return;
				throw new Error(`HTTP ${response.status}`);
			}

			const data = await response.json();
			const newWeatherData = data.data || data;

			if (Array.isArray(newWeatherData) && newWeatherData.length > 0) {
				window.weatherData = newWeatherData;
				window.INITIAL_WEATHER_DATA = newWeatherData;

				if (window.StationMap?.isInitialized) {
					await window.StationMap.refresh();
				}
			}
		} catch (error) {
			// Silent fail - cached data remains valid
		}
	}

	function syncAllWaterCharts(newDate) {
		// Update consolidated picker
		const pickerAll = document.getElementById("waterPickerAll");
		if (pickerAll) pickerAll.value = newDate;

		// Update all charts
		WATER_STATIONS.forEach((stationId) => {
			if (waterCharts[stationId]) {
				waterCharts[stationId].loadSpecificDate(newDate);
			}
		});
	}

	function navigateWaterChart(stationId, days) {
		const picker = document.getElementById("waterPickerAll");
		if (!picker?.value) return;

		const date = new Date(picker.value);
		date.setDate(date.getDate() + days);
		const newDate = date.toISOString().split("T")[0];
		syncAllWaterCharts(newDate);
	}

	function navigatePrecipChart(days, precipPicker) {
		if (!precipPicker?.value) return;

		const date = new Date(precipPicker.value);
		date.setDate(date.getDate() + days);
		const newDate = date.toISOString().split("T")[0];

		precipPicker.value = newDate;
		if (precipChart) precipChart.loadSpecificDate(newDate);
	}

	async function initializeCharts(stationConfig) {
		const today = new Date().toISOString().split("T")[0];
		const precipPicker = document.getElementById("datePicker");
		const waterPickerAll = document.getElementById("waterPickerAll");

		if (precipPicker) precipPicker.value = today;
		if (waterPickerAll) waterPickerAll.value = today;

		const csvExporter = new (
			window.CSVExporter ||
			class {
				exportPrecipitationData() {
					console.warn("CSV exporter not loaded");
				}
				exportWaterLevelData() {
					console.warn("CSV exporter not loaded");
				}
			}
		)();

		if (document.getElementById("precipitationChart")) {
			precipChart = new PrecipitationChart({
				chartId: "precipitationChart",
				apiEndpoint: "/api/precipitation-data",
				autoLoad: true,
				stationConfig,
				onDataLoaded: (data) => {
					if (precipPicker && data.date) precipPicker.value = data.date;
				},
			});
			await precipChart.init();
		}

		if (document.getElementById("temperatureChart") && window.EnvironmentalChart) {
			temperatureChart = new EnvironmentalChart({
				chartId: "temperatureChart",
				apiEndpoint: "/api/temperature-data",
				dateRangeEndpoint: "/api/temperature-date-range",
				unit: "degC",
				yAxisTitle: "Temperature (degC)",
				loadingId: "temp-chart-loading",
				errorId: "temp-chart-error",
				datePickerId: "tempDatePicker",
				prevBtnId: "btn-prev-temp-day",
				nextBtnId: "btn-next-temp-day",
				stationConfig,
				autoLoad: true,
			});
			await temperatureChart.init();
		}

		if (document.getElementById("humidityChart") && window.EnvironmentalChart) {
			humidityChart = new EnvironmentalChart({
				chartId: "humidityChart",
				apiEndpoint: "/api/humidity-data",
				dateRangeEndpoint: "/api/humidity-date-range",
				unit: "%",
				yAxisTitle: "Humidity (%)",
				loadingId: "humidity-chart-loading",
				errorId: "humidity-chart-error",
				datePickerId: "humidityDatePicker",
				prevBtnId: "btn-prev-humidity-day",
				nextBtnId: "btn-next-humidity-day",
				stationConfig,
				autoLoad: true,
			});
			await humidityChart.init();
		}

		const thresholds =
			window.WATER_LEVEL_THRESHOLDS || CONFIG.water_level_thresholds || {};
		const defaultThresholds = CONFIG.thresholds?.water_level || {
			advisory: 180,
			alert: 250,
			warning: 400,
			critical: 600,
		};

		for (const stationId of WATER_STATIONS) {
			const chartId = `waterChart-${stationId}`;

			if (!document.getElementById(chartId)) continue;

			const stationThresholds = thresholds[stationId] || defaultThresholds;

			waterCharts[stationId] = new WaterLevelChart({
				chartId: chartId,
				apiEndpoint: "/api/water-level-data",
				autoLoad: true,
				stationConfig,
				filterStations: [stationId],
				thresholds: stationThresholds,
				onDataLoaded: (data) => {
					if (waterPickerAll && data.date) waterPickerAll.value = data.date;
				},
				onThresholdBreach: (alert) => {
					console.warn(`[FLOOD ALERT - ${stationId}]`, alert);
				},
			});

			await waterCharts[stationId].init();
		}

		// Initialize Rainfall Trends Chart
		if (document.getElementById("rainfallTrendsChart") && window.TrendsChart) {
			trendsChart = new TrendsChart({
				dataType: "rainfall",
				chartId: "rainfallTrendsChart",
				apiEndpoint: "/api/rainfall-trends",
				periodsEndpoint: "/api/rainfall-trends/periods",
				stationConfig,
			});
			await trendsChart.init();
			await trendsChart._loadAvailablePeriods();
			await trendsChart.loadData();
		}

		// Initialize Water Level Trends Chart
		if (
			document.getElementById("waterLevelTrendsChart") &&
			window.TrendsChart
		) {
			// Filter stationConfig to only include water level stations
			const waterStationConfig = {};
			WATER_STATIONS.forEach((stationId) => {
				if (stationConfig[stationId]) {
					waterStationConfig[stationId] = stationConfig[stationId];
				}
			});

			waterLevelTrendsChart = new TrendsChart({
				dataType: "waterlevel",
				chartId: "waterLevelTrendsChart",
				apiEndpoint: "/api/water-level-trends",
				periodsEndpoint: "/api/water-level-trends/periods",
				stationConfig: waterStationConfig,
			});
			await waterLevelTrendsChart.init();
			// Don't load data yet - will load on tab click
		}

		if (
			document.getElementById("temperatureTrendsChart") &&
			window.TrendsChart
		) {
			temperatureTrendsChart = new TrendsChart({
				dataType: "temperature",
				chartId: "temperatureTrendsChart",
				apiEndpoint: "/api/temperature-trends",
				periodsEndpoint: "/api/temperature-trends/periods",
				stationConfig,
			});
			await temperatureTrendsChart.init();
		}

		if (
			document.getElementById("humidityTrendsChart") &&
			window.TrendsChart
		) {
			humidityTrendsChart = new TrendsChart({
				dataType: "humidity",
				chartId: "humidityTrendsChart",
				apiEndpoint: "/api/humidity-trends",
				periodsEndpoint: "/api/humidity-trends/periods",
				stationConfig,
			});
			await humidityTrendsChart.init();
		}

		bindPrecipNavigation(precipPicker);
		bindEnvironmentalNavigation();
		bindWaterNavigation();
		bindDatePickerEvents(precipPicker);
		bindExportEvents(csvExporter, precipPicker);
		bindRetryEvents();
		bindTrendsEvents();
	}

	function bindTrendsEvents() {
		// Tab switching
		const tabs = document.querySelectorAll(".trends-tab");
		const rainfallPanel = document.getElementById("rainfallTrendsChart");
		const waterLevelPanel = document.getElementById("waterLevelTrendsChart");
		const temperaturePanel = document.getElementById("temperatureTrendsChart");
		const humidityPanel = document.getElementById("humidityTrendsChart");

		const getActiveTrendsChart = () => {
			if (activeTrendsTab === "rainfall") return trendsChart;
			if (activeTrendsTab === "waterlevel") return waterLevelTrendsChart;
			if (activeTrendsTab === "temperature") return temperatureTrendsChart;
			if (activeTrendsTab === "humidity") return humidityTrendsChart;
			return null;
		};

		const showPanel = (tabName) => {
			rainfallPanel?.classList.add("hidden");
			waterLevelPanel?.classList.add("hidden");
			temperaturePanel?.classList.add("hidden");
			humidityPanel?.classList.add("hidden");

			if (tabName === "rainfall") rainfallPanel?.classList.remove("hidden");
			if (tabName === "waterlevel")
				waterLevelPanel?.classList.remove("hidden");
			if (tabName === "temperature")
				temperaturePanel?.classList.remove("hidden");
			if (tabName === "humidity") humidityPanel?.classList.remove("hidden");
		};

		tabs.forEach((tab) => {
			tab.addEventListener("click", () => {
				const targetTab = tab.dataset.tab;
				if (targetTab === activeTrendsTab) return;

				// Update tab states
				tabs.forEach((t) => {
					t.classList.remove("trends-tab--active");
					t.setAttribute("aria-selected", "false");
				});
				tab.classList.add("trends-tab--active");
				tab.setAttribute("aria-selected", "true");

				const periodSelect = document.getElementById("trendsPeriodSelect");
				const monthSelect = document.getElementById("trendsMonthSelect");

				let period = null;
				let year = null;
				let month = null;

				if (periodSelect) {
					const val = periodSelect.value;
					if (val === "last12") {
						period = "last12";
					} else {
						year = parseInt(val, 10);
					}
				}
				if (monthSelect && monthSelect.value) {
					month = parseInt(monthSelect.value, 10);
				}

				showPanel(targetTab);
				activeTrendsTab = targetTab;

				requestAnimationFrame(() => {
					const activeChart = getActiveTrendsChart();
					if (activeChart) {
						activeChart.loadData(period, year, month);
					}
				});
			});
		});

		// Period select change - update the ACTIVE chart
		const periodSelect = document.getElementById("trendsPeriodSelect");
		const monthSelect = document.getElementById("trendsMonthSelect");

		periodSelect?.addEventListener("change", () => {
			const val = periodSelect.value;
			const isLast12 = val === "last12";
			let period = null;
			let year = null;

			if (isLast12) {
				period = "last12";
			} else {
				year = parseInt(val, 10);
			}

			// Update month dropdown based on selection type
			if (trendsChart) {
				trendsChart._populateMonthSelect(isLast12 ? "last12" : year, isLast12);
			}

			// Reset month selection
			if (monthSelect) {
				monthSelect.value = "";
			}

			// Reset pagination and load data for active chart
			const activeChart = getActiveTrendsChart();
			if (activeChart) {
				activeChart.currentHalf = 0;
				activeChart.currentMonth = null;
				activeChart.loadData(period, year, null);
			}
		});

		monthSelect?.addEventListener("change", () => {
			const val = monthSelect.value;
			const periodVal = periodSelect?.value;
			const isLast12 = periodVal === "last12";

			let month = null;
			let year = null;
			let period = null;

			if (val) {
				if (isLast12 && val.includes("-")) {
					// Format: "2026-1" for Last 12 months
					const parts = val.split("-");
					year = parseInt(parts[0], 10);
					month = parseInt(parts[1], 10);
				} else {
					// Simple month number for year view
					month = parseInt(val, 10);
					year = parseInt(periodVal, 10);
				}
			} else {
				// "All months" selected
				if (isLast12) {
					period = "last12";
				} else {
					year = parseInt(periodVal, 10);
				}
			}

			const activeChart = getActiveTrendsChart();
			if (activeChart) {
				activeChart.currentHalf = 0;
				activeChart.loadData(period, year, month);
			}
		});

		// Retry button
		document
			.querySelector('[data-action="retry-trends"]')
			?.addEventListener("click", () => {
				const activeChart = getActiveTrendsChart();
				if (activeChart) activeChart.retry();
			});

		// Nav buttons for mobile pagination
		document.getElementById("trendsPrevBtn")?.addEventListener("click", () => {
			const activeChart = getActiveTrendsChart();
			if (activeChart) activeChart._navigateHalf(-1);
		});

		document.getElementById("trendsNextBtn")?.addEventListener("click", () => {
			const activeChart = getActiveTrendsChart();
			if (activeChart) activeChart._navigateHalf(1);
		});
	}

	function bindPrecipNavigation(precipPicker) {
		document.getElementById("btn-prev-day")?.addEventListener("click", () => {
			navigatePrecipChart(-1, precipPicker);
		});
		document.getElementById("btn-next-day")?.addEventListener("click", () => {
			navigatePrecipChart(1, precipPicker);
		});
	}

	function bindWaterNavigation() {
		// Per-card nav arrows (mobile only)
		WATER_STATIONS.forEach((stationId) => {
			document
				.getElementById(`waterPrev-${stationId}`)
				?.addEventListener("click", () => {
					navigateWaterChart(stationId, -1);
				});
			document
				.getElementById(`waterNext-${stationId}`)
				?.addEventListener("click", () => {
					navigateWaterChart(stationId, 1);
				});
		});
	}

	function bindEnvironmentalNavigation() {
		document.getElementById("btn-prev-temp-day")?.addEventListener("click", () => {
			if (temperatureChart) temperatureChart.slidePrev();
		});
		document.getElementById("btn-next-temp-day")?.addEventListener("click", () => {
			if (temperatureChart) temperatureChart.slideNext();
		});

		document
			.getElementById("btn-prev-humidity-day")
			?.addEventListener("click", () => {
				if (humidityChart) humidityChart.slidePrev();
			});
		document
			.getElementById("btn-next-humidity-day")
			?.addEventListener("click", () => {
				if (humidityChart) humidityChart.slideNext();
			});
	}

	function bindDatePickerEvents(precipPicker) {
		precipPicker?.addEventListener("change", (e) => {
			if (e.target.value && precipChart) {
				precipChart.loadSpecificDate(e.target.value);
			}
		});

		// Consolidated water picker
		const waterPickerAll = document.getElementById("waterPickerAll");
		waterPickerAll?.addEventListener("change", (e) => {
			if (e.target.value) syncAllWaterCharts(e.target.value);
		});

		document.getElementById("tempDatePicker")?.addEventListener("change", (e) => {
			if (e.target.value && temperatureChart) {
				temperatureChart.loadSpecificDate(e.target.value);
			}
		});

		document
			.getElementById("humidityDatePicker")
			?.addEventListener("change", (e) => {
				if (e.target.value && humidityChart) {
					humidityChart.loadSpecificDate(e.target.value);
				}
			});
	}

	function bindExportEvents(csvExporter, precipPicker) {
		document.getElementById("btn-export-csv")?.addEventListener("click", () => {
			if (precipChart?.chartData) {
				csvExporter.exportPrecipitationData(
					precipChart.chartData,
					precipPicker?.value,
				);
			} else {
				alert("No precipitation data available to export");
			}
		});

		// Consolidated water level export
		document.getElementById("exportWaterAll")?.addEventListener("click", () => {
			const pickerAll = document.getElementById("waterPickerAll");
			for (const stationId of WATER_STATIONS) {
				const chart = waterCharts[stationId];
				if (chart?.chartData) {
					csvExporter.exportWaterLevelData(chart.chartData, pickerAll?.value);
					return;
				}
			}
			alert("No water level data available to export");
		});

		document
			.getElementById("btn-export-temp-csv")
			?.addEventListener("click", () => {
				if (temperatureChart?.chartData) {
					csvExporter.exportTemperatureData(
						temperatureChart.chartData,
						document.getElementById("tempDatePicker")?.value,
					);
				} else {
					alert("No temperature data available to export");
				}
			});

		document
			.getElementById("btn-export-humidity-csv")
			?.addEventListener("click", () => {
				if (humidityChart?.chartData) {
					csvExporter.exportHumidityData(
						humidityChart.chartData,
						document.getElementById("humidityDatePicker")?.value,
					);
				} else {
					alert("No humidity data available to export");
				}
			});
	}

	function bindRetryEvents() {
		document
			.querySelector("#chart-error .chart-error__btn")
			?.addEventListener("click", () => {
				if (precipChart) precipChart.retry();
			});

		WATER_STATIONS.forEach((stationId) => {
			const errorEl = document.getElementById(`waterError-${stationId}`);
			errorEl
				?.querySelector(".chart-error__btn")
				?.addEventListener("click", () => {
					if (waterCharts[stationId]) waterCharts[stationId].retry();
				});
		});

		document
			.querySelector("#temp-chart-error .chart-error__btn")
			?.addEventListener("click", () => {
				if (temperatureChart) temperatureChart.retry();
			});

		document
			.querySelector("#humidity-chart-error .chart-error__btn")
			?.addEventListener("click", () => {
				if (humidityChart) humidityChart.retry();
			});
	}

	function initTooltips() {
		document.querySelectorAll('[data-bs-toggle="tooltip"]').forEach((el) => {
			new bootstrap.Tooltip(el, {
				trigger: "hover focus",
				animation: true,
				delay: { show: 200, hide: 100 },
			});
		});
	}

	function startAutoRefresh() {
		setTimeout(() => {
			refreshWeatherData();
			setInterval(refreshWeatherData, AUTO_REFRESH_INTERVAL);
		}, INITIAL_REFRESH_DELAY);
	}

	async function init() {
		try {
			const stationConfig = await loadStationConfig();
			window._stationConfig = stationConfig;

			await initializeCharts(stationConfig);
			initTooltips();
			startAutoRefresh();

			if (window.location.hostname === "localhost") {
				window.debugCharts = {
					precipitation: precipChart,
					temperature: temperatureChart,
					humidity: humidityChart,
					waterLevel: waterCharts,
					trends: {
						rainfall: trendsChart,
						waterLevel: waterLevelTrendsChart,
						temperature: temperatureTrendsChart,
						humidity: humidityTrendsChart,
					},
					stationConfig,
					waterStations: WATER_STATIONS,
					refreshInterval: AUTO_REFRESH_INTERVAL,
				};
			}
		} catch (error) {
			console.error("[HOME] Initialization failed:", error);
		}
	}

	return {
		init,
		loadStationConfig,
		refreshWeatherData,
		getWaterStations: () => WATER_STATIONS,
	};
})();

window.configLoader = {
	load: HomeInit.loadStationConfig,
	getStationConfigObject: async () => {
		if (!window._stationConfig) {
			window._stationConfig = await HomeInit.loadStationConfig();
		}
		return window._stationConfig;
	},
};

document.addEventListener("DOMContentLoaded", HomeInit.init);
