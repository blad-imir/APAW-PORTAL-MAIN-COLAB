class CSVExporter {
	exportPrecipitationData(data, dateStr = null) {
		return this._export(data, dateStr, "precipitation");
	}

	exportWaterLevelData(data, dateStr = null) {
		return this._export(data, dateStr, "water_level");
	}

	_export(data, dateStr, type = "precipitation") {
		try {
			// Validate data
			if (!data || !data.stations) {
				throw new Error("Invalid data format");
			}

			const csvContent = this._generateCSV(data, type);

			const filename = this._generateFilename(dateStr, type);

			this._downloadCSV(csvContent, filename);

			console.log(`CSV export successful: ${filename}`);
			return true;
		} catch (error) {
			console.error("CSV export failed:", error);
			alert("Failed to export data. Please try again.");
			return false;
		}
	}

	_generateCSV(data, type) {
		const stations = data.stations;
		const stationIds = Object.keys(stations).sort();

		const headers = ["Time"];
		const unit = type === "precipitation" ? "(mm/hr)" : "(m)";

		stationIds.forEach((id) => {
			const stationName = stations[id].name || id;
			headers.push(`${stationName} ${unit}`);
		});

		const firstStation = stations[stationIds[0]];
		const dataPoints = firstStation.data || [];

		const rows = dataPoints.map((point, index) => {
			const row = [point.label]; 

			stationIds.forEach((id) => {
				const stationData = stations[id].data || [];
				const value = stationData[index]?.y ?? 0;
				row.push(value.toFixed(2));
			});

			return row;
		});
		const csvLines = [headers.join(","), ...rows.map((row) => row.join(","))];

		return csvLines.join("\n");
	}

	_generateFilename(dateStr = null, type = "precipitation") {
		const date = dateStr || this._formatDate(new Date());
		return `${type}_${date}.csv`;
	}

	_downloadCSV(csvContent, filename) {
		const BOM = "\uFEFF";
		const blob = new Blob([BOM + csvContent], {
			type: "text/csv;charset=utf-8;",
		});

		const link = document.createElement("a");
		const url = URL.createObjectURL(blob);

		link.setAttribute("href", url);
		link.setAttribute("download", filename);
		link.style.visibility = "hidden";

		// Trigger download
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);

		URL.revokeObjectURL(url);
	}

	_formatDate(date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, "0");
		const day = String(date.getDate()).padStart(2, "0");
		return `${year}-${month}-${day}`;
	}

	getVersion() {
		return "2.0.0 - Water Level Support";
	}
}

if (typeof window !== "undefined") {
	window.CSVExporter = CSVExporter;
}
