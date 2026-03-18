/*---------------------------------------------"
// Template Name: WeatherForecast
// Description:  WeatherForecast Html Template
// Version: 1.0.0

--------------------------------------------*/
(function (window, document, $, undefined) {
	"use strict";

	var MyScroll = "";
	var Init = {
		i: function (e) {
			Init.s();
			Init.methods();
		},
		s: function (e) {
			(this._window = $(window)),
				(this._document = $(document)),
				(this._body = $("body")),
				(this._html = $("html"));
		},
		methods: function (e) {
			Init.w();
			Init.preloader();
			Init.BackToTop();
			Init.cusBtn();
			Init.searchToggle();
			Init.uiHeader();
			Init.slick();
			Init.countdownInit(".countdown", "2026/04/21");
			Init.chart();
			Init.toggles();
			Init.contactForm();
			Init.magnifying();
		},

		w: function (e) {
			this._window.on("load", Init.l).on("scroll", Init.res);
		},

		// =================
		// Preloader
		// =================
		preloader: function () {
			// Initialize PageLoader if available (loaded before app.js)
			if (window.PageLoader) {
				window.PageLoader.init();
				console.log("[PRELOADER] Using PageLoader for coordinated loading");
			} else {
				// Fallback: simple timeout-based preloader hide
				console.warn("[PRELOADER] PageLoader not found, using fallback");
				setTimeout(function () {
					$("#preloader").fadeOut("slow");
				}, 3000);
			}
		},

		// =======================
		//  Button Style
		// =======================
		cusBtn: function () {
			$(".cus-btn")
				.on("mouseenter", function (e) {
					var parentOffset = $(this).offset(),
						relX = e.pageX - parentOffset.left,
						relY = e.pageY - parentOffset.top;
					$(this).find("span").css({ top: relY, left: relX });
				})
				.on("mouseout", function (e) {
					var parentOffset = $(this).offset(),
						relX = e.pageX - parentOffset.left,
						relY = e.pageY - parentOffset.top;
					$(this).find("span").css({ top: relY, left: relX });
				});
		},

		// =================
		// Bak to top
		// =================
		BackToTop: function () {
			let scrollTop = $(".scroll-top path");
			if (scrollTop.length) {
				var e = document.querySelector(".scroll-top path"),
					t = e.getTotalLength();
				(e.style.transition = e.style.WebkitTransition = "none"),
					(e.style.strokeDasharray = t + " " + t),
					(e.style.strokeDashoffset = t),
					e.getBoundingClientRect(),
					(e.style.transition = e.style.WebkitTransition =
						"stroke-dashoffset 10ms linear");
				var o = function () {
					var o = $(window).scrollTop(),
						r = $(document).height() - $(window).height(),
						i = t - (o * t) / r;
					e.style.strokeDashoffset = i;
				};
				o(), $(window).scroll(o);
				var back = $(".scroll-top"),
					body = $("body, html");
				$(window).on("scroll", function () {
					if ($(window).scrollTop() > $(window).height()) {
						back.addClass("scroll-top--active");
					} else {
						back.removeClass("scroll-top--active");
					}
				});
			}
		},

		// =======================
		//  UI Header
		// =======================
		uiHeader: function () {
			function dynamicCurrentMenuClass(selector) {
				let FileName = window.location.href.split("/").reverse()[0];

				selector.find("li").each(function () {
					let anchor = $(this).find("a");
					if ($(anchor).attr("href") == FileName) {
						$(this).addClass("current");
					}
				});
				selector.children("li").each(function () {
					if ($(this).find(".current").length) {
						$(this).addClass("current");
					}
				});
				if ("" == FileName) {
					selector.find("li").eq(0).addClass("current");
				}
			}

			if ($(".main-menu__list").length) {
				let mainNavUL = $(".main-menu__list");
				dynamicCurrentMenuClass(mainNavUL);
			}

			if ($(".main-menu__nav").length && $(".sidebar-nav__container").length) {
				let navContent = document.querySelector(".main-menu__nav").innerHTML;
				let mobileNavContainer = document.querySelector(
					".sidebar-nav__container"
				);
				mobileNavContainer.innerHTML = navContent;
			}
			if ($(".sticky-header__content").length) {
				let navContent = document.querySelector(".main-menu").innerHTML;
				let mobileNavContainer = document.querySelector(
					".sticky-header__content"
				);
				mobileNavContainer.innerHTML = navContent;
			}

			if ($(".sidebar-nav__container .main-menu__list").length) {
				let dropdownAnchor = $(
					".sidebar-nav__container .main-menu__list .dropdown > a"
				);
				dropdownAnchor.each(function () {
					let self = $(this);
					let toggleBtn = document.createElement("BUTTON");
					toggleBtn.setAttribute("aria-label", "dropdown toggler");
					toggleBtn.innerHTML = "<i class='fa fa-angle-down'></i>";
					self.append(function () {
						return toggleBtn;
					});
					self.find("button").on("click", function (e) {
						e.preventDefault();
						let self = $(this);
						self.toggleClass("expanded");
						self.parent().toggleClass("expanded");
						self.parent().parent().children("ul").slideToggle();
					});
				});
			}

			if ($(".sidebar-nav__toggler").length) {
				$(".sidebar-nav__toggler").on("click", function (e) {
					e.preventDefault();
					$(".sidebar-nav__wrapper").toggleClass("expanded");
					$("body").toggleClass("locked");
				});
			}

			$(window).on("scroll", function () {
				if ($(".stricked-menu").length) {
					var headerScrollPos = 130;
					var stricky = $(".stricked-menu");
					if ($(window).scrollTop() > headerScrollPos) {
						stricky.addClass("stricky-fixed");
					} else if ($(this).scrollTop() <= headerScrollPos) {
						stricky.removeClass("stricky-fixed");
					}
				}
			});
		},

		// =======================
		//  Contact Form
		// =======================
		contactForm: function () {
			$(".contact-form").on("submit", function (e) {
				e.preventDefault();
				if ($(".contact-form")) {
					var _self = $(this);
					_self
						.closest("div")
						.find('button[type="submit"]')
						.attr("disabled", "disabled");
					var data = $(this).serialize();
					$.ajax({
						url: "./assets/mail/contact.php",
						type: "post",
						dataType: "json",
						data: data,
						success: function (data) {
							$(".contact-form").trigger("reset");
							_self.find('button[type="submit"]').removeAttr("disabled");
							if (data.success) {
								document.getElementById("message").innerHTML =
									"<h5 class='color-primary'>Email Sent Successfully</h5>";
							} else {
								document.getElementById("message").innerHTML =
									"<h5 class='text-danger'>There is an error</h5>";
							}
							$("#message").show("slow");
							$("#message").slideDown("slow");
							setTimeout(function () {
								$("#message").slideUp("hide");
								$("#message").hide("slow");
							}, 3000);
						},
					});
				} else {
					return false;
				}
			});
		},

		// =======================
		//  Slick Slider
		// =======================
		slick: function () {
			if ($(".weekly-forecast-carousel").length) {
				$(".weekly-forecast-carousel").slick({
					slidesToShow: 3,
					slidesToScroll: 1,
					infinite: true,
					autoplay: true,
					dots: false,
					arrows: true,
					lazyLoad: "progressive",
					autoplaySpeed: 4000,
					speed: 2000,
					responsive: [
						{
							breakpoint: 1399,
							settings: {
								slidesToShow: 3,
							},
						},
						{
							breakpoint: 991,
							settings: {
								slidesToShow: 3,
							},
						},
						{
							breakpoint: 575,
							settings: {
								slidesToShow: 2,
							},
						},
					],
				});
			}
		},

		// =======================
		//  Search Function
		// =======================
		searchToggle: function () {
			if ($(".search-toggler").length) {
				$(".search-toggler").on("click", function (e) {
					e.preventDefault();
					$(".search-popup").toggleClass("active");
					$(".sidebar-nav__wrapper").removeClass("expanded");
					$("body").toggleClass("locked");
				});
			}
		},
		// =======================
		//  Coming Soon Countdown
		// =======================
		countdownInit: function (countdownSelector, countdownTime) {
			var eventCounter = $(countdownSelector);
			if (eventCounter.length) {
				eventCounter.countdown(countdownTime, function (e) {
					$(this).html(
						e.strftime(
							"<li><h2>%D</h2><h6>Days</h6></li>\
              <li><h2>%H</h2><h6>Hrs</h6></li>\
              <li><h2>%M</h2><h6>Min</h6></li>\
              <li><h2>%S</h2><h6>Sec</h6></li>"
						)
					);
				});
			}
		},
		// =======================
		//  Mini Cart
		// =======================
		chart: function () {
			if ($("#chartContainer").length) {
				var allDataPoints = [
					{ label: "02 am", y: [15, 26], name: "rainy" },
					{ label: "03 am", y: [15, 27], name: "rainy" },
					{ label: "04 am", y: [13, 27], name: "sunny" },
					{ label: "05 am", y: [14, 27], name: "sunny" },
					{ label: "06 am", y: [15, 26], name: "cloudy" },
					{ label: "07 am", y: [17, 26], name: "sunny" },
					{ label: "08 am", y: [16, 27], name: "rainy" },
					{ label: "09 am", y: [15, 26], name: "cloudy" },
					{ label: "10 am", y: [17, 26], name: "sunny" },
					{ label: "11 am", y: [16, 27], name: "rainy" },
					{ label: "12 pm", y: [13, 27], name: "sunny" },
					{ label: "01 pm", y: [14, 27], name: "sunny" },
					{ label: "02 pm", y: [15, 26], name: "cloudy" },
				];

				var mediumDataPoints = allDataPoints.slice(0, 10); // First 10 data points for medium screens
				var smallDataPoints = allDataPoints.slice(0, 7); // First 7 data points for small screens

				var chart = new CanvasJS.Chart("chartContainer", {
					theme: "light2",
					axisY: {
						suffix: " Â°C",
						maximum: 40,
						gridThickness: 0,
					},
					toolTip: {
						shared: true,
						content:
							"{name} </br> <strong>Temperature: </strong> </br> Min: {y[0]} Â°C, Max: {y[1]} Â°C",
					},
					data: [
						{
							type: "rangeSplineArea",
							fillOpacity: 0.1,
							color: "#91AAB1",
							indexLabelFormatter: formatter,
							dataPoints: getDataPoints(),
						},
					],
				});
				chart.render();

				var images = [];

				addImages(chart);

				function getDataPoints() {
					if (window.innerWidth <= 575) {
						return smallDataPoints;
					} else if (window.innerWidth <= 992) {
						return mediumDataPoints;
					} else {
						return allDataPoints;
					}
				}

				function addImages(chart) {
					for (var i = 0; i < chart.data[0].dataPoints.length; i++) {
						var dpsName = chart.data[0].dataPoints[i].name;
						if (dpsName == "cloudy") {
							images.push(
								$("<img>").attr(
									"src",
									"https://canvasjs.com/wp-content/uploads/images/gallery/gallery-overview/cloudy.png"
								)
							);
						} else if (dpsName == "rainy") {
							images.push(
								$("<img>").attr(
									"src",
									"https://canvasjs.com/wp-content/uploads/images/gallery/gallery-overview/rainy.png"
								)
							);
						} else if (dpsName == "sunny") {
							images.push(
								$("<img>").attr(
									"src",
									"https://canvasjs.com/wp-content/uploads/images/gallery/gallery-overview/sunny.png"
								)
							);
						}

						images[i]
							.attr("class", dpsName)
							.appendTo($("#chartContainer>.canvasjs-chart-container"));
						positionImage(images[i], i);
					}
				}

				function positionImage(image, index) {
					var imageCenter = chart.axisX[0].convertValueToPixel(
						chart.data[0].dataPoints[index].x
					);
					var imageTop = chart.axisY[0].convertValueToPixel(
						chart.axisY[0].maximum
					);

					var imageSize = window.innerWidth <= 575 ? "25px" : "40px";
					var imageLeftOffset = window.innerWidth <= 575 ? 12.5 : 20;

					image.width(imageSize).css({
						left: imageCenter - imageLeftOffset + "px",
						position: "absolute",
						top: imageTop + "px",
					});
				}

				$(window).resize(function () {
					var cloudyCounter = 0,
						rainyCounter = 0,
						sunnyCounter = 0;
					var imageCenter = 0;
					for (var i = 0; i < chart.data[0].dataPoints.length; i++) {
						imageCenter =
							chart.axisX[0].convertValueToPixel(
								chart.data[0].dataPoints[i].x
							) - 20;
						if (chart.data[0].dataPoints[i].name == "cloudy") {
							$(".cloudy").eq(cloudyCounter++).css({ left: imageCenter });
						} else if (chart.data[0].dataPoints[i].name == "rainy") {
							$(".rainy").eq(rainyCounter++).css({ left: imageCenter });
						} else if (chart.data[0].dataPoints[i].name == "sunny") {
							$(".sunny").eq(sunnyCounter++).css({ left: imageCenter });
						}
					}
					updateChartData();
				});

				function updateChartData() {
					chart.options.data[0].dataPoints = getDataPoints();
					chart.render();
					$(".cloudy, .rainy, .sunny").remove();
					images = [];
					addImages(chart);
				}

				function formatter(e) {
					if (e.index === 0 && e.dataPoint.x === 0) {
						return " Min " + e.dataPoint.y[e.index] + "Â°";
					} else if (e.index == 1 && e.dataPoint.x === 0) {
						return " Max " + e.dataPoint.y[e.index] + "Â°";
					} else {
						return e.dataPoint.y[e.index] + "Â°";
					}
				}
			}
		},
		// =======================
		//  Toggles
		// =======================
		toggles: function () {
			if ($(".sidebar-widget").length) {
				$(".widget-title-row").on("click", function (e) {
					$(this).find("i").toggleClass("fa-horizontal-rule fa-plus", "slow");
					// $(this).find('i').toggleClass('fa-light fa-regular', 'slow');
					$(this)
						.parents(".sidebar-widget")
						.find(".widget-content-block")
						.animate({ height: "toggle" }, "slow");
				});
			}
		},

		// =======================
		// Magnifying Popup
		// =======================
		magnifying: function () {
			if ($(".video-popup").length) {
				$(".video-popup").magnificPopup({
					disableOn: 700,
					type: "iframe",
					mainClass: "mfp-fade",
					removalDelay: 160,
					preloader: false,
					fixedContentPos: false,
				});
			}
		},
	};

	Init.i();
})(window, document, jQuery);
