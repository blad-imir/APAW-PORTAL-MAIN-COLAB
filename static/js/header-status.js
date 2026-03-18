class HeaderStatusBadge {
	constructor() {
		this.badge = document.getElementById("systemStatusBadge");
		this.statusText = this.badge?.querySelector(".status-text");
		this.isOnline = navigator.onLine;
		this.checkInterval = null;

		if (this.badge) {
			this.init();
		}
	}

	init() {
		window.addEventListener("online", () => this.handleOnline());
		window.addEventListener("offline", () => this.handleOffline());

		this.checkStatus();
		this.checkInterval = setInterval(() => this.checkStatus(), 60000);

		if (this.badge) {
			this.badge.addEventListener("click", () => this.showDetails());
		}
	}

	checkStatus() {
		if (!navigator.onLine) {
			this.showBadge("No Internet Connection");
		} else {
			this.hideBadge();
		}
	}

	showBadge(message) {
		if (!this.badge) return;

		if (this.statusText) {
			this.statusText.textContent = message;
		}

		// Use Bootstrap's d-flex instead of custom display
		this.badge.classList.remove("d-none");
		this.badge.classList.add("d-flex");
	}

	hideBadge() {
		if (!this.badge) return;

		// Use Bootstrap's d-none
		this.badge.classList.add("d-none");
		this.badge.classList.remove("d-flex");
	}

	handleOnline() {
		console.log("[STATUS] Internet connection restored");
		this.isOnline = true;
		this.hideBadge();
	}

	handleOffline() {
		console.log("[STATUS] Internet connection lost");
		this.isOnline = false;
		this.showBadge("No Internet Connection");
	}

	showDetails() {
		alert(
			"🔴 No Internet Connection\n\n" +
				"Your computer or network has lost internet connectivity.\n\n" +
				"The portal is displaying cached data from the last successful update.\n\n" +
				"Please check your WiFi or network connection."
		);
	}

	destroy() {
		if (this.checkInterval) {
			clearInterval(this.checkInterval);
		}
	}
}

document.addEventListener("DOMContentLoaded", () => {
	window.headerStatusBadge = new HeaderStatusBadge();
});
