/**
 * Page Load Orchestrator
 * Coordinates loading of all critical components before hiding preloader.
 * Ensures users see a complete dashboard, not a partially loaded one.
 *
 * For disaster monitoring: waits for MAP to fully load with station status
 */

const PageLoader = (function () {
	"use strict";

	// Increased timeouts for slow network/API conditions
	const LOAD_TIMEOUT = 60000; // 60 seconds max wait before forcing hide
	const COMPONENT_TIMEOUT = 45000; // 45 seconds for individual components

	const state = {
		components: new Map(),
		isComplete: false,
		startTime: null,
	};

	/**
	 * Register a component that must load before page is ready
	 * NO auto-timeout - only completes when component explicitly calls markReady()
	 * Use this for critical components like the map
	 */
	function register(name) {
		if (state.isComplete) {
			console.warn(
				`[PageLoader] Cannot register "${name}" - page already complete`
			);
			return () => {};
		}

		const componentState = {
			ready: false,
			startTime: Date.now(),
		};

		state.components.set(name, componentState);
		console.log(`[PageLoader] Registered: ${name}`);

		return function markReady() {
			if (componentState.ready) return;

			componentState.ready = true;
			const loadTime = Date.now() - componentState.startTime;
			console.log(`[PageLoader] Ready: ${name} (${loadTime}ms)`);

			checkAllReady();
		};
	}

	/**
	 * Check if all registered components are ready
	 */
	function checkAllReady() {
		if (state.isComplete) return;

		const allReady = Array.from(state.components.values()).every(
			(c) => c.ready
		);

		if (allReady) {
			completeLoading("All components ready");
		}
	}

	/**
	 * Hide preloader and mark page as complete
	 */
	function completeLoading(reason) {
		if (state.isComplete) return;

		state.isComplete = true;
		const totalTime = Date.now() - state.startTime;

		console.log(`[PageLoader] Complete: ${reason} (${totalTime}ms)`);
		logStatus();

		hidePreloader();
	}

	/**
	 * Fade out preloader element
	 */
	function hidePreloader() {
		const preloader = document.getElementById("preloader");
		if (!preloader) return;

		preloader.style.transition = "opacity 0.4s ease-out";
		preloader.style.opacity = "0";

		setTimeout(() => {
			preloader.style.display = "none";
		}, 400);
	}

	/**
	 * Log final status of all components
	 */
	function logStatus() {
		const status = {};
		state.components.forEach((component, name) => {
			status[name] = component.ready ? "✓" : "✗";
		});
		console.table(status);
	}

	/**
	 * Initialize the loader and start global timeout
	 */
	function init() {
		state.startTime = Date.now();

		// Short delay to allow components to register, then check if page is "simple"
		setTimeout(() => {
			if (!state.isComplete && state.components.size === 0) {
				console.log("[PageLoader] No components registered - simple page");
				completeLoading("No components");
			}
		}, 100);

		// Safety timeout - don't block user forever
		setTimeout(() => {
			if (!state.isComplete) {
				const pending = Array.from(state.components.entries())
					.filter(([_, c]) => !c.ready)
					.map(([name]) => name);

				console.warn(
					`[PageLoader] Timeout after 60s - pending: ${pending.join(", ")}`
				);
				completeLoading("Timeout");
			}
		}, LOAD_TIMEOUT);
	}

	/**
	 * Register component with auto-timeout fallback
	 * Use for less critical components (charts) that shouldn't block forever
	 */
	function registerWithTimeout(name, timeout = COMPONENT_TIMEOUT) {
		const markReady = register(name);

		setTimeout(() => {
			const component = state.components.get(name);
			if (component && !component.ready) {
				console.warn(`[PageLoader] Component timeout: ${name} (${timeout}ms)`);
				markReady();
			}
		}, timeout);

		return markReady;
	}

	return {
		init,
		register,
		registerWithTimeout,
		complete: completeLoading,
		isComplete: () => state.isComplete,
	};
})();

window.PageLoader = PageLoader;

// Auto-initialize on DOM ready
document.addEventListener("DOMContentLoaded", PageLoader.init);
