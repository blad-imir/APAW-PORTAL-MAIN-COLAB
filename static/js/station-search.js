/**
 * Station Search
 * Enables searching station names/IDs and redirecting to site detail pages.
 */
(function () {
	"use strict";

	const searchInputs = document.querySelectorAll(
		'.search-block input[type="search"][name="search"]'
	);
	if (!searchInputs.length) return;

	const stations = Array.isArray(window.APP_CONFIG?.stations)
		? window.APP_CONFIG.stations
		: [];
	if (!stations.length) return;

	const stationIndex = stations
		.filter((station) => station?.id)
		.map((station) => {
			const id = String(station.id);
			const name = String(station.name || station.label || id);
			const label = `${id} - ${name}`;
			return {
				id,
				name,
				label,
				keys: [id, name, label],
			};
		});

	if (!stationIndex.length) return;

	function normalize(value) {
		return String(value || "")
			.toLowerCase()
			.replace(/station/gi, "")
			.replace(/[^a-z0-9]/g, "");
	}

	function findStation(query) {
		const normalizedQuery = normalize(query);
		if (!normalizedQuery) return null;

		const exact = stationIndex.find((station) =>
			station.keys.some((key) => normalize(key) === normalizedQuery)
		);
		if (exact) return exact;

		const startsWith = stationIndex.find((station) =>
			station.keys.some((key) => normalize(key).startsWith(normalizedQuery))
		);
		if (startsWith) return startsWith;

		return stationIndex.find((station) =>
			station.keys.some((key) => normalize(key).includes(normalizedQuery))
		);
	}

	function redirectToStation(stationId) {
		window.location.href = `/sites/${encodeURIComponent(stationId)}`;
	}

	function attachDatalist(input, idx) {
		const listId = `stationSearchOptions-${idx}`;
		let list = document.getElementById(listId);

		if (!list) {
			list = document.createElement("datalist");
			list.id = listId;
			stationIndex.forEach((station) => {
				const option = document.createElement("option");
				option.value = station.label;
				list.appendChild(option);
			});
			document.body.appendChild(list);
		}

		input.setAttribute("list", listId);
	}

	searchInputs.forEach((input, idx) => {
		const form = input.closest("form");
		if (!form) return;

		attachDatalist(input, idx);

		form.addEventListener("submit", (event) => {
			const station = findStation(input.value);
			if (!station) return;
			event.preventDefault();
			redirectToStation(station.id);
		});

		input.addEventListener("change", () => {
			const station = findStation(input.value);
			if (!station) return;
			if (normalize(input.value) !== normalize(station.label)) return;
			redirectToStation(station.id);
		});
	});
})();
