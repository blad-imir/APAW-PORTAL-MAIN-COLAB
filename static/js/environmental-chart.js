class EnvironmentalChart {
	constructor(config) {
		this.chartId = config.chartId;
		this.apiEndpoint = config.apiEndpoint;
		this.dateRangeEndpoint = config.dateRangeEndpoint;
		this.unit = config.unit || "";
		this.yAxisTitle = config.yAxisTitle || "Value";
		this.loadingId = config.loadingId;
		this.errorId = config.errorId;
		this.datePickerId = config.datePickerId;
		this.prevBtnId = config.prevBtnId;
		this.nextBtnId = config.nextBtnId;
		this.dateBadgeId = config.dateBadgeId || null;
		this.autoLoad = config.autoLoad !== false;
		this.onDataLoaded = config.onDataLoaded || null;

		if (!config.stationConfig || Object.keys(config.stationConfig).length === 0) {
			throw new Error("[ENV_CHART] stationConfig is required");
		}
		this.stationConfig = config.stationConfig;

		this.chart = null;
		this.chartData = null;
		this.dateRange = null;
		this.elements = {};
		this._resizeTimer = null;
		this._resizeHandler = null;
	}

	_isMobile() {
		return window.innerWidth < 768;
	}

	_getResponsiveDimensions() {
		const width = window.innerWidth;
		if (width < 480) {
			return { height: 230, fontSize: 10, lineThickness: 2, markerSize: 4 };
		}
		if (width < 768) {
			return { height: 280, fontSize: 11, lineThickness: 2.5, markerSize: 5 };
		}
		if (width < 1024) {
			return { height: 320, fontSize: 12, lineThickness: 3, markerSize: 6 };
		}
		return { height: 340, fontSize: 12, lineThickness: 3, markerSize: 6 };
	}

	async init() {
		this._cacheElements();

		if (!this.elements.chartContainer) {
			console.error(`[${this.chartId}] Chart container not found`);
			return;
		}

		const container = this.elements.chartContainer;
		if (window.getComputedStyle(container).position === "static") {
			container.style.position = "relative";
		}

		this._setupResizeHandler();
		await this._loadDateRange();

		if (this.autoLoad) {
			await this.loadLatestData();
		}
	}

	_cacheElements() {
		this.elements = {
			chartContainer: document.getElementById(this.chartId),
			loading: this.loadingId ? document.getElementById(this.loadingId) : null,
			error: this.errorId ? document.getElementById(this.errorId) : null,
			errorMessage: this.errorId
				? document.querySelector(`#${this.errorId} .chart-error__message`)
				: null,
			dateBadge: this.dateBadgeId ? document.getElementById(this.dateBadgeId) : null,
			datePicker: this.datePickerId ? document.getElementById(this.datePickerId) : null,
		};
	}

	_setupResizeHandler() {
		this._resizeHandler = () => {
			if (this._resizeTimer) clearTimeout(this._resizeTimer);
			this._resizeTimer = setTimeout(() => {
				if (!this.chart) return;
				const dims = this._getResponsiveDimensions();
				this.chart.options.height = dims.height;
				this.chart.options.axisX.labelFontSize = dims.fontSize;
				this.chart.options.axisY.labelFontSize = dims.fontSize;
				this.chart.options.axisX.titleFontSize = dims.fontSize + 2;
				this.chart.options.axisY.titleFontSize = dims.fontSize + 2;
				if (this.chart.options.legend) {
					this.chart.options.legend.fontSize = this._isMobile()
						? dims.fontSize
						: dims.fontSize + 4;
				}
				if (this.chart.options.data) {
					this.chart.options.data.forEach((series) => {
						series.lineThickness = dims.lineThickness;
						series.markerSize = dims.markerSize;
					});
				}
				this.chart.render();
			}, 230);
		};
		window.addEventListener("resize", this._resizeHandler);
	}

	async _loadDateRange() {
		if (!this.dateRangeEndpoint) return;

		try {
			const response = await fetch(this.dateRangeEndpoint);
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
			console.warn(`[${this.chartId}] Date range load failed:`, error);
		}
	}

	async loadLatestData() {
		return this._loadData();
	}

	async loadSpecificDate(dateString) {
		return this._loadData(dateString);
	}

	async _loadData(dateString = null) {
		this._showLoading();
		this._hideError();

		try {
			const apiUrl = dateString
				? `${this.apiEndpoint}?date=${dateString}`
				: this.apiEndpoint;
			const response = await fetch(apiUrl);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);

			const data = await response.json();
			if (!data.success) {
				throw new Error(data.error || "Failed to load data");
			}

			this.chartData = data;

			if (this.elements.dateBadge && data.date_display) {
				this.elements.dateBadge.textContent = data.date_display;
			}

			if (this.elements.datePicker && data.date) {
				this.elements.datePicker.value = data.date;
			}

			this._renderChart(data);
			this._updateNavigationButtons();

			if (typeof this.onDataLoaded === "function") {
				this.onDataLoaded(data);
			}

			return data;
		} catch (error) {
			console.error(`[${this.chartId}] Data load error:`, error);
			this._showError(error.message || "Failed to load data");
			return null;
		} finally {
			this._hideLoading();
		}
	}

	_renderChart(apiData) {
		const dims = this._getResponsiveDimensions();
		const isMobile = this._isMobile();
		const series = [];

		for (const stationId in apiData.stations) {
			const stationData = apiData.stations[stationId];
			const config = this.stationConfig[stationId];
			if (!config) continue;

			series.push({
				type: "spline",
				name: isMobile ? config.name.replace(" Station", "") : config.name,
				showInLegend: true,
				visible: true,
				color: config.color,
				stationId,
				dataPoints: (stationData.data || []).map((point) => ({
					label: point.label,
					y: point.y,
					timestamp: point.timestamp,
				})),
			});
		}

		if (this.chart) {
			this.chart.destroy();
		}

		const axisYOptions = {
			title: this.yAxisTitle,
			titleFontSize: dims.fontSize,
			labelFontSize: dims.fontSize,
			labelFontColor: "#64748b",
			lineColor: "#e2e8f0",
			tickColor: "#e2e8f0",
			gridColor: "#f1f5f9",
			gridThickness: 1,
			suffix: this.unit ? ` ${this.unit}` : "",
		};

		if (this.yAxisTitle.toLowerCase().indexOf("temperature") === -1) {
			axisYOptions.minimum = 0;
		}

		this.chart = new CanvasJS.Chart(this.chartId, {
			animationEnabled: true,
			animationDuration: 400,
			theme: "light1",
			height: dims.height,
			title: { text: "", fontSize: 0, margin: 30 },
			axisX: {
				title: "Time of Day",
				titleFontSize: dims.fontSize + 2,
				labelFontSize: dims.fontSize,
				labelFontColor: "#64748b",
				lineColor: "#e2e8f0",
				tickColor: "#e2e8f0",
				interval: 2,
				margin: 0,
			},
			axisY: axisYOptions,
			toolTip: {
				shared: true,
				contentFormatter: (e) => this._formatTooltip(e),
				borderThickness: 0,
				borderColor: "transparent",
				cornerRadius: 12,
				backgroundColor: "transparent",
				animationEnabled: false,
			},
			legend: {
				cursor: "pointer",
				itemclick: (e) => {
					e.dataSeries.visible =
						typeof e.dataSeries.visible === "undefined"
							? false
							: !e.dataSeries.visible;
					e.chart.render();
				},
				fontSize: isMobile ? dims.fontSize : dims.fontSize + 4,
				fontWeight: 500,
				fontColor: "#475569",
				horizontalAlign: "center",
				verticalAlign: "bottom",
				dockInsidePlotArea: false,
				markerType: "circle",
				markerMargin: isMobile ? 4 : 8,
				itemSpacing: isMobile ? 8 : 15,
			},
			data: series.map((item) => ({
				...item,
				lineThickness: dims.lineThickness,
				markerSize: dims.markerSize,
			})),
		});

		this.chart.render();
	}

	_formatTooltip(e) {
		if (!e.entries || e.entries.length === 0) return "";

		const first = e.entries[0];
		const timeLabel = first?.dataPoint?.label || "";
		let html = `<div class="prec-tooltip" style="width: 220px;">`;
		html += `<div class="prec-tooltip__header">${timeLabel}</div>`;
		html += `<div class="prec-tooltip__body">`;

		e.entries.forEach((entry) => {
			const stationName = entry.dataSeries.name;
			const color = entry.dataSeries.color || "#64748b";
			const value = entry.dataPoint.y;
			const valueText =
				value === null || value === undefined
					? "Offline"
					: `${Number(value).toFixed(1)} ${this.unit}`;

			html += `
				<div class="prec-tooltip__station">
					<div class="prec-tooltip__station-left">
						<span class="prec-tooltip__dot" style="background: ${color};"></span>
						<span class="prec-tooltip__station-name">${stationName}:</span>
					</div>
					<span class="prec-tooltip__value" style="color: ${color};">${valueText}</span>
				</div>
			`;
		});

		html += `</div></div>`;
		return html;
	}

	async slidePrev() {
		if (!this.chartData?.date || !this.dateRange) return;
		const date = new Date(this.chartData.date);
		date.setDate(date.getDate() - 1);
		const prevDate = this._formatDate(date);
		if (prevDate < this.dateRange.earliest) return;
		await this.loadSpecificDate(prevDate);
	}

	async slideNext() {
		if (!this.chartData?.date || !this.dateRange) return;
		const date = new Date(this.chartData.date);
		date.setDate(date.getDate() + 1);
		const nextDate = this._formatDate(date);
		if (nextDate > this.dateRange.latest) return;
		await this.loadSpecificDate(nextDate);
	}

	retry() {
		this._hideError();
		if (this.chartData?.date) {
			this.loadSpecificDate(this.chartData.date);
		} else {
			this.loadLatestData();
		}
	}

	_updateNavigationButtons() {
		const prevBtn = this.prevBtnId ? document.getElementById(this.prevBtnId) : null;
		const nextBtn = this.nextBtnId ? document.getElementById(this.nextBtnId) : null;
		if (!prevBtn || !nextBtn || !this.dateRange || !this.chartData?.date) return;

		prevBtn.disabled = this.chartData.date <= this.dateRange.earliest;
		nextBtn.disabled = this.chartData.date >= this.dateRange.latest;
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
		if (this.elements.errorMessage) {
			this.elements.errorMessage.textContent = message;
		}
		if (this.elements.error) {
			this.elements.error.classList.add("show");
		}
	}

	_hideError() {
		if (this.elements.error) {
			this.elements.error.classList.remove("show");
		}
	}

	_formatDate(date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}
}

if (typeof window !== "undefined") {
	window.EnvironmentalChart = EnvironmentalChart;
}
