(function () {
	"use strict";

	var SESSION_KEY = "apaw_visitor_session_id";
	var ACTIVE_COUNT_SELECTOR = "#activeVisitorsCount";
	var HEARTBEAT_INTERVAL_MS = 30000;
	var sessionId = null;
	var heartbeatTimer = null;

	function getSessionId() {
		try {
			sessionId = window.sessionStorage.getItem(SESSION_KEY);
			if (!sessionId) {
				sessionId = (window.crypto && window.crypto.randomUUID)
					? window.crypto.randomUUID()
					: "sess-" + Date.now() + "-" + Math.random().toString(16).slice(2);
				window.sessionStorage.setItem(SESSION_KEY, sessionId);
			}
		} catch (error) {
			sessionId = sessionId || ("sess-" + Date.now() + "-" + Math.random().toString(16).slice(2));
		}

		return sessionId;
	}

	function getPayload() {
		return {
			session_id: getSessionId(),
			page: window.location.pathname,
			referrer: document.referrer || null,
		};
	}

	function updateCount(activeUsers) {
		var element = document.querySelector(ACTIVE_COUNT_SELECTOR);
		if (element && typeof activeUsers !== "undefined" && activeUsers !== null) {
			element.textContent = String(activeUsers);
		}
	}

	function requestJson(url, method, body) {
		return fetch(url, {
			method: method,
			headers: {
				"Content-Type": "application/json",
			},
			body: body ? JSON.stringify(body) : undefined,
			credentials: "same-origin",
		})
			.then(function (response) {
				return response.json().catch(function () {
					return {};
				});
			})
			.catch(function () {
				return {};
			});
	}

	function syncActiveUser(endpoint) {
		return requestJson(endpoint, "POST", getPayload()).then(function (payload) {
			var data = payload && payload.data ? payload.data : payload;
			if (data && typeof data.current_users !== "undefined") {
				updateCount(data.current_users);
			}
			return payload;
		});
	}

	function startHeartbeat() {
		if (heartbeatTimer) {
			window.clearInterval(heartbeatTimer);
		}
		heartbeatTimer = window.setInterval(function () {
			syncActiveUser("/api/visitors/heartbeat");
		}, HEARTBEAT_INTERVAL_MS);
	}

	function registerLeave() {
		var payload = JSON.stringify(getPayload());
		try {
			var blob = new Blob([payload], { type: "application/json" });
			navigator.sendBeacon("/api/visitors/leave", blob);
		} catch (error) {
			requestJson("/api/visitors/leave", "POST", getPayload());
		}
	}

	document.addEventListener("DOMContentLoaded", function () {
		syncActiveUser("/api/visitors/enter").finally(function () {
			startHeartbeat();
		});
	});

	window.addEventListener("pagehide", function () {
		registerLeave();
	});

	window.addEventListener("beforeunload", function () {
		registerLeave();
	});
})();