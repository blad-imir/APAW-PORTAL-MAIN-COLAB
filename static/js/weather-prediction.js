(function () {
    const state = {
        stationId: null,
        metric: "Temperature",
        horizon: "hourly",
        stations: [],
        stationStatuses: {},
        chart: null,
        latestPayload: null,
        chartWindowStart: 0,
        currentSeries: {
            historical: [],
            prediction: [],
        },
    };

    const el = {
        station: document.getElementById("predictionStation"),
        metric: document.getElementById("predictionMetric"),
        horizonTabs: document.getElementById("horizonTabs"),
        refreshBtn: document.getElementById("refreshPrediction"),
        loading: document.getElementById("predictionLoading"),
        error: document.getElementById("predictionError"),
        tableBody: document.getElementById("predictionTableBody"),
        statStation: document.getElementById("statStation"),
        statPoints: document.getElementById("statPoints"),
        statConfidence: document.getElementById("statConfidence"),
        statGeneratedAt: document.getElementById("statGeneratedAt"),
        modelName: document.getElementById("modelName"),
        offlineBanner: document.getElementById("predictionOfflineBanner"),
        navLeft: document.getElementById("predictionNavLeft"),
        navRight: document.getElementById("predictionNavRight"),
    };

    const metricNames = {
        Temperature: "Temperature (deg C)",
        Humidity: "Humidity (%)",
        HourlyRain: "Rainfall (mm/hr)",
        WaterLevel: "Water Level (cm)",
    };

    async function init() {
        const stations = (window.APP_CONFIG && window.APP_CONFIG.stations) || [];
        state.stations = stations;

        if (!el.station || stations.length === 0) {
            return;
        }

        renderStationOptions();

        state.stationId = stations[0].id;
        el.station.value = state.stationId;

        await preloadStationStatuses();
        renderStationOptions();
        el.station.value = state.stationId;

        bindEvents();
        loadPrediction();
    }

    function renderStationOptions() {
        if (!el.station) {
            return;
        }

        el.station.innerHTML = state.stations
            .map((station) => {
                const status = state.stationStatuses[station.id] || {};
                const suffix = status.is_offline ? " - OFFLINE" : "";
                return `<option value="${station.id}">${station.name}${suffix}</option>`;
            })
            .join("");
    }

    async function preloadStationStatuses() {
        try {
            const response = await fetch("/api/weather-predictions?horizon=hourly");
            const payload = await response.json();

            if (!response.ok || !payload.success) {
                return;
            }

            const horizonData = payload.horizons && payload.horizons.hourly;
            const stations = (horizonData && horizonData.stations) || {};

            Object.keys(stations).forEach((stationId) => {
                state.stationStatuses[stationId] = stations[stationId].status || {};
            });
        } catch (error) {
            // Keep default labels if status preload fails.
        }
    }

    function bindEvents() {
        el.station.addEventListener("change", function (event) {
            state.stationId = event.target.value;
            enforceMetricAvailability();
            loadPrediction();
        });

        el.metric.addEventListener("change", function (event) {
            state.metric = event.target.value;
            loadPrediction();
        });

        el.horizonTabs.addEventListener("click", function (event) {
            const button = event.target.closest(".horizon-tab");
            if (!button) return;

            state.horizon = button.dataset.horizon;
            document.querySelectorAll(".horizon-tab").forEach((tab) => {
                tab.classList.toggle("active", tab === button);
            });
            loadPrediction();
        });

        el.refreshBtn.addEventListener("click", function () {
            loadPrediction();
        });

        if (el.navLeft) {
            el.navLeft.addEventListener("click", function () {
                const size = getChartWindowSize();
                state.chartWindowStart = Math.max(0, state.chartWindowStart - size);
                drawChart();
            });
        }

        if (el.navRight) {
            el.navRight.addEventListener("click", function () {
                const size = getChartWindowSize();
                const maxStart = Math.max(0, getCombinedSeries().length - size);
                state.chartWindowStart = Math.min(maxStart, state.chartWindowStart + size);
                drawChart();
            });
        }
    }

    function enforceMetricAvailability() {
        const selectedStation = state.stations.find((station) => station.id === state.stationId);
        const noWater = selectedStation && selectedStation.has_water_level === false;
        const waterOption = el.metric.querySelector('option[value="WaterLevel"]');

        if (waterOption) {
            waterOption.disabled = !!noWater;
        }

        if (noWater && state.metric === "WaterLevel") {
            state.metric = "Temperature";
            el.metric.value = state.metric;
        }
    }

    async function loadPrediction() {
        if (!state.stationId) return;

        setLoading(true);
        clearError();

        try {
            const url = `/api/weather-predictions?horizon=${encodeURIComponent(state.horizon)}&station_id=${encodeURIComponent(state.stationId)}`;
            const response = await fetch(url);
            const payload = await response.json();

            if (!response.ok || !payload.success) {
                throw new Error(payload.error || `HTTP ${response.status}`);
            }

            state.latestPayload = payload;
            render(payload);
        } catch (error) {
            showError(error.message || "Failed to load predictions");
            renderEmpty();
        } finally {
            setLoading(false);
        }
    }

    function render(payload) {
        if (el.modelName && payload.model && payload.model.name) {
            el.modelName.textContent = payload.model.name;
        }

        const horizonData = payload.horizons && payload.horizons[state.horizon];
        if (!horizonData || !horizonData.stations || !horizonData.stations[state.stationId]) {
            renderEmpty();
            return;
        }

        const stationData = horizonData.stations[state.stationId];
        const metricData = stationData.metrics[state.metric];

        if (!metricData || !Array.isArray(metricData.points) || metricData.points.length === 0) {
            renderEmpty();
            return;
        }

        updateStats(payload, stationData, metricData);
        const historicalPoints = Array.isArray(metricData.historical_points)
            ? metricData.historical_points
            : [];

        state.currentSeries.historical = historicalPoints;
        state.currentSeries.prediction = metricData.points;
        state.chartWindowStart = 0;

        renderChart(stationData.station_name);
        renderTable(historicalPoints, metricData.points);
    }

    function updateStats(payload, stationData, metricData) {
        const generatedAt = payload.generated_at
            ? new Date(payload.generated_at).toLocaleString()
            : "--";

        const status = stationData.status || {};
        const isOffline = Boolean(status.is_offline);
        const stationLabel = stationData.station_name || state.stationId;

        state.stationStatuses[state.stationId] = status;
        renderStationOptions();
        el.station.value = state.stationId;

        el.statStation.textContent = isOffline ? `${stationLabel} (OFFLINE)` : stationLabel;
        el.statPoints.textContent = String(metricData.points.length);
        el.statConfidence.textContent = `${Math.round((metricData.confidence || 0) * 100)}%`;
        el.statGeneratedAt.textContent = generatedAt;

        updateOfflinePrompt(status);
    }

    function updateOfflinePrompt(status) {
        if (!el.offlineBanner) {
            return;
        }

        const isOffline = Boolean(status && status.is_offline);
        if (!isOffline) {
            el.offlineBanner.classList.add("d-none");
            return;
        }

        const ageText =
            status.minutes_since_update !== null && status.minutes_since_update !== undefined
                ? ` Last update was ${status.minutes_since_update} minutes ago.`
                : "";

        el.offlineBanner.textContent = `OFFLINE: This station is currently offline.${ageText}`;
        el.offlineBanner.classList.remove("d-none");
    }

    function renderChart(stationName) {
        state.currentStationName = stationName;
        drawChart();
    }

    function drawChart() {
        const historicalPoints = state.currentSeries.historical || [];
        const predictionPoints = state.currentSeries.prediction || [];
        const windowSize = getChartWindowSize();

        const historicalLabeled = historicalPoints.map((point) => ({
            ...point,
            seriesType: "historical",
        }));
        const predictionLabeled = predictionPoints.map((point) => ({
            ...point,
            seriesType: "prediction",
        }));

        const combined = historicalLabeled.concat(predictionLabeled).sort((a, b) => {
            return new Date(a.timestamp) - new Date(b.timestamp);
        });

        const maxStart = Math.max(0, combined.length - windowSize);
        if (state.chartWindowStart > maxStart) {
            state.chartWindowStart = maxStart;
        }

        const windowed = combined.slice(state.chartWindowStart, state.chartWindowStart + windowSize);

        let historicalDataPoints = windowed
            .filter((point) => point.seriesType === "historical")
            .map((point) => ({
                x: new Date(point.timestamp),
                y: Number(point.value),
            }));

        let predictionDataPoints = windowed
            .filter((point) => point.seriesType === "prediction")
            .map((point) => ({
                x: new Date(point.timestamp),
                y: Number(point.value),
            }));

        const connectorDataPoints =
            historicalDataPoints.length > 0 && predictionDataPoints.length > 0
                ? [
                      {
                          x: historicalDataPoints[historicalDataPoints.length - 1].x,
                          y: historicalDataPoints[historicalDataPoints.length - 1].y,
                      },
                      {
                          x: predictionDataPoints[0].x,
                          y: predictionDataPoints[0].y,
                      },
                  ]
                : [];

        const title = `${state.currentStationName || state.stationId} - ${metricNames[state.metric]} (${capitalize(state.horizon)})`;

        const options = {
            animationEnabled: true,
            theme: "light2",
            backgroundColor: "#ffffff",
            title: {
                text: title,
                fontSize: 18,
            },
            axisX: {
                valueFormatString: state.horizon === "hourly" ? "MMM DD, hh TT" : "MMM DD",
                labelAngle: -35,
            },
            axisY: {
                includeZero: state.metric === "HourlyRain" || state.metric === "WaterLevel",
                title: metricNames[state.metric],
            },
            toolTip: {
                shared: true,
            },
            data: [
                {
                    type: "splineArea",
                    name: "Past Data",
                    showInLegend: true,
                    markerSize: 5,
                    color: "#1d4ed8",
                    fillOpacity: 0.14,
                    dataPoints: historicalDataPoints,
                },
                {
                    type: "line",
                    name: "Transition",
                    showInLegend: false,
                    markerSize: 0,
                    lineDashType: "dash",
                    color: "#64748b",
                    dataPoints: connectorDataPoints,
                },
                {
                    type: "splineArea",
                    name: "Prediction",
                    showInLegend: true,
                    markerSize: 5,
                    color: "#16a34a",
                    fillOpacity: 0.2,
                    dataPoints: predictionDataPoints,
                },
            ],
        };

        if (state.chart) {
            state.chart.options = options;
            state.chart.render();
            updateNavButtons(combined.length, windowSize);
            return;
        }

        state.chart = new CanvasJS.Chart("predictionChart", options);
        state.chart.render();
        updateNavButtons(combined.length, windowSize);
    }

    function getChartWindowSize() {
        if (state.horizon === "hourly") {
            return 12;
        }
        if (state.horizon === "daily") {
            return 7;
        }
        return 7;
    }

    function getCombinedSeries() {
        const historicalPoints = state.currentSeries.historical || [];
        const predictionPoints = state.currentSeries.prediction || [];
        return historicalPoints.concat(predictionPoints);
    }

    function updateNavButtons(totalPoints, windowSize) {
        if (!el.navLeft || !el.navRight) {
            return;
        }

        const maxStart = Math.max(0, totalPoints - windowSize);
        el.navLeft.disabled = state.chartWindowStart <= 0;
        el.navRight.disabled = state.chartWindowStart >= maxStart;
    }

    function renderTable(historicalPoints, predictionPoints) {
        const rows = [];

        historicalPoints.forEach((point) => {
            const dateText = new Date(point.timestamp).toLocaleString();
            rows.push(`
                <tr>
                    <td>${dateText} (Past)</td>
                    <td>${Number(point.value).toFixed(2)}</td>
                </tr>
            `);
        });

        predictionPoints.forEach((point) => {
            const dateText = new Date(point.timestamp).toLocaleString();
            rows.push(`
                <tr>
                    <td>${dateText} (Prediction)</td>
                    <td>${Number(point.value).toFixed(2)}</td>
                </tr>
            `);
        });

        el.tableBody.innerHTML = rows.join("");
    }

    function renderEmpty() {
        if (state.chart) {
            state.chart.destroy();
            state.chart = null;
        }
        state.currentSeries.historical = [];
        state.currentSeries.prediction = [];
        state.chartWindowStart = 0;
        el.tableBody.innerHTML = `
            <tr>
                <td colspan="2" class="text-center text-muted py-4">No prediction data available.</td>
            </tr>
        `;
        el.statPoints.textContent = "0";
        el.statConfidence.textContent = "--";
        if (el.offlineBanner) {
            el.offlineBanner.classList.add("d-none");
        }
        updateNavButtons(0, getChartWindowSize());
    }

    function setLoading(isLoading) {
        if (!el.loading) return;
        el.loading.classList.toggle("active", isLoading);
    }

    function showError(message) {
        if (!el.error) return;
        el.error.classList.remove("d-none");
        el.error.textContent = message;
    }

    function clearError() {
        if (!el.error) return;
        el.error.classList.add("d-none");
        el.error.textContent = "";
    }

    function capitalize(value) {
        if (!value) return "";
        return value.charAt(0).toUpperCase() + value.slice(1);
    }

    document.addEventListener("DOMContentLoaded", init);
})();
