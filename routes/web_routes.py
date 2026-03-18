"""Web routes for page rendering."""

from flask import Blueprint, render_template, current_app
from config import MetricCardConfig, WeatherCardConfig
from utils.error_handlers import handle_service_errors
from extensions import cache

web_bp = Blueprint('web', __name__)


@web_bp.route('/')
@cache.cached(timeout=60)
@handle_service_errors
def home():
    """Render home dashboard with weather metrics and alerts."""
    weather_data = current_app.weather_service.fetch_weather_data()
    stations = current_app.weather_service.get_latest_per_station(weather_data)
    
    # Get weather card display station from config
    display_station_id = WeatherCardConfig.DISPLAY_STATION_ID
    latest = stations.get(display_station_id)
    
    if not latest:
        latest = current_app.weather_service.get_latest_reading(weather_data)
        current_app.logger.warning(f"No {display_station_id} data found, using fallback station")
    
    weather_alert = current_app.weather_service.generate_weather_alert(latest)
    
    metrics = current_app.metrics_service.calculate_dashboard_metrics(stations)
    
    weather_minimal = [
        {
            'StationID': r.get('StationID'),
            'DateTime': r.get('DateTime') or r.get('DateTimeStamp') or r.get('Timestamp'),
            'Temperature': r.get('Temperature'),
            'Humidity': r.get('Humidity'),
            'HourlyRain': r.get('HourlyRain'),
            'WaterLevel': r.get('WaterLevel'),
            'WindSpeed': r.get('WindSpeed'),
            'WindDirection': r.get('WindDirection')
        }
        for r in weather_data[:500]
    ]

    return render_template('home.html',
        weather=weather_minimal,
        latest=latest,
        weather_alert=weather_alert,
        metrics=metrics,
        card_config=MetricCardConfig.CARDS,
        weather_card_station_name=WeatherCardConfig.get_display_station_name()
    )


@web_bp.route('/sites/<site_id>')
@cache.cached(timeout=60, query_string=True)
@handle_service_errors  
def site_detail(site_id):
    """Render detailed view for a specific monitoring site."""
    site = next((s for s in current_app.config['SITES'] if s['id'] == site_id), None)
    if not site:
        return render_template('errors/404.html'), 404

    weather_data = current_app.weather_service.fetch_weather_data()
    site_weather = current_app.weather_service.filter_by_station(weather_data, site_id)
    
    if site_id == 'St1':
        latest = current_app.weather_service.get_mdrrmo_latest_reading(weather_data)
    else:
        latest = current_app.weather_service.get_latest_reading(site_weather)
    
    all_stations_latest = current_app.weather_service.get_latest_per_station(weather_data)
    
    weather_alert = current_app.weather_service.generate_weather_alert(latest)

    return render_template('sites/site_detail.html',
        site=site,
        latest=latest,
        weather_alert=weather_alert,
        weather=site_weather[:24],
        current_site_id=site_id,
        all_stations_latest=all_stations_latest
    )


@web_bp.route('/precipitation')
@handle_service_errors
def precipitation():
    """Render precipitation analysis page."""
    return render_template('precipitation.html')


@web_bp.route('/water-level')
@handle_service_errors
def water_level():
    """Render water level monitoring page."""
    return render_template('water_level.html')


@web_bp.route('/about')
def about():
    """Render about page."""
    return render_template('about.html')


@web_bp.route('/contact')
def contact():
    """Render contact page."""
    return render_template('contact.html')


@web_bp.route('/flood-alert-simulation')
def test_home():
    """
    Render the home.html with mock data + test controls.
    Use this to test alerts, banners, map colors
    """
    from config import (
        WeatherThresholds, MetricCardConfig, UIColorSystem,
        AlertLevelConfig, RainfallForecastConfig, WeatherIconConfig,
        WeatherCardConfig, SiteConfig
    )
    from datetime import datetime
    from services.metrics_service import (
        DashboardMetrics, RainfallForecast, AlertLevelInfo, StationAlert
    )
    
    now = datetime.now().isoformat()
    display_station_id = WeatherCardConfig.DISPLAY_STATION_ID
    display_station = WeatherCardConfig.get_display_station()
    
    # Mock weather data for all 5 stations (initial values)
    mock_weather = []
    for station_id in ['St1', 'St2', 'St3', 'St4', 'St5']:
        # Check if station has water level sensor
        has_water = SiteConfig.has_water_level_sensor(station_id)
        mock_weather.append({
            'StationID': station_id,
            'DateTime': now,
            'Temperature': 28.5,
            'Humidity': 75.0,
            'HourlyRain': 2.5,
            'WaterLevel': 500 if has_water else None,
            'WindSpeed': 5.2,
            'WindDirection': 'S',
            'WindDegree': 180
        })
    
    # Mock latest reading from configured display station
    mock_latest = {
        'StationID': display_station_id,
        'DateTime': now,
        'Temperature': 28.5,
        'Humidity': 75.0,
        'HourlyRain': 2.5,
        'WaterLevel': 500 if display_station and display_station.get('has_water_level') else None,
        'WindSpeed': 5.2,
        'WindDirection': 'S',
        'WindDegree': 180
    }
    
    # Initial metrics (will be updated by JavaScript)
    mock_metrics = DashboardMetrics(
        highest_alert_level='normal',
        highest_alert_count=0,
        critical_count=0,
        warning_count=0,
        alert_count=0,
        advisory_count=0,
        attention_stations=[],
        online_sensors=5,
        total_sensors=5,
        water_level_stations=4,
        offline_stations=[],
        rainfall_forecast=RainfallForecast(
            level='Clear', 
            icon='fa-sun', 
            color=UIColorSystem.ALERT_NORMAL, 
            count=0
        ),
        alert_level_info=AlertLevelInfo(
            level='Normal', 
            icon='fa-check-circle', 
            color=UIColorSystem.ALERT_NORMAL, 
            description='All systems normal'
        ),
        station_alerts=[]
    )
    
    # Thresholds for test controls
    test_thresholds = {
        'water_level': {
            'advisory': WeatherThresholds.WATER_ADVISORY,
            'alert': WeatherThresholds.WATER_ALERT,
            'warning': WeatherThresholds.WATER_WARNING,
            'critical': WeatherThresholds.WATER_CRITICAL
        },
        'rainfall': {
            'light': WeatherThresholds.RAINFALL_LIGHT,
            'moderate': WeatherThresholds.RAINFALL_MODERATE,
            'heavy': WeatherThresholds.RAINFALL_HEAVY
        }
    }
    
    # UI Configs for JavaScript - from config.py (single source of truth)
    test_ui_config = {
        'colors': {
            'normal': UIColorSystem.ALERT_NORMAL,
            'advisory': UIColorSystem.ALERT_ADVISORY,
            'alert': UIColorSystem.ALERT_ALERT,
            'warning': UIColorSystem.ALERT_WARNING,
            'critical': UIColorSystem.ALERT_CRITICAL
        },
        'alert_levels': AlertLevelConfig.LEVELS,
        'rainfall_levels': RainfallForecastConfig.LEVELS
    }
    
    return render_template('home.html',
        weather=mock_weather,
        latest=mock_latest,
        weather_alert=None,
        metrics=mock_metrics,
        card_config=MetricCardConfig.CARDS,
        weather_card_station_name=WeatherCardConfig.get_display_station_name(),
        test_mode=True,
        test_thresholds=test_thresholds,
        test_ui_config=test_ui_config,
        weather_icon_config=WeatherIconConfig.get_js_config()
    )