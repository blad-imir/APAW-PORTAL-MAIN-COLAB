"""Flask application factory for weather monitoring system"""

from pathlib import Path

from flask import Flask, request
from extensions import cache
from routes.web_routes import web_bp
from routes.api_routes import api_bp
from services.weather_service import WeatherService
from services.metrics_service import MetricsService
from services.prediction_service import WeatherPredictionService
from services.visitor_counter_service import VisitorCounterService
from services.chart_data_service import (
    PrecipitationService, WaterLevelService, 
    TemperatureService, HumidityService,
    RainfallTrendsService, WaterLevelTrendsService,
    TemperatureTrendsService, HumidityTrendsService
)
from utils.helpers import format_datetime, format_datetime_full, format_weather_value
from utils.error_handlers import register_error_handlers
from config import (
    config,
    WeatherThresholds,
    UIColorSystem,
    ColorAPI,
    get_template_context
)


def create_app(config_name='development'):
    """
    Create and configure Flask application.
    
    Args:
        config_name: Configuration environment name
    
    Returns:
        Configured Flask application instance
    """
    flask_app = Flask(__name__)
    flask_app.config.from_object(config[config_name])
    
    flask_app.config['CACHE_TYPE'] = 'simple'
    flask_app.config['CACHE_DEFAULT_TIMEOUT'] = 60
    
    cache.init_app(flask_app)
    flask_app.cache = cache

    flask_app.jinja_env.filters['format_time'] = format_datetime
    flask_app.jinja_env.filters['format_datetime_full'] = format_datetime_full
    flask_app.jinja_env.filters['format_weather_value'] = format_weather_value

    flask_app.weather_service = WeatherService(
        api_url=flask_app.config['API_URL'],
        timeout=flask_app.config['API_TIMEOUT']
    )
    flask_app.metrics_service = MetricsService(sites=flask_app.config['SITES'])
    flask_app.precipitation_service = PrecipitationService(flask_app.metrics_service)
    flask_app.water_level_service = WaterLevelService(flask_app.metrics_service)
    flask_app.rainfall_trends_service = RainfallTrendsService(flask_app.metrics_service)
    flask_app.water_level_trends_service = WaterLevelTrendsService(flask_app.metrics_service)
    flask_app.temperature_service = TemperatureService(flask_app.metrics_service)
    flask_app.humidity_service = HumidityService(flask_app.metrics_service)
    flask_app.temperature_trends_service = TemperatureTrendsService(flask_app.metrics_service)
    flask_app.humidity_trends_service = HumidityTrendsService(flask_app.metrics_service)
    flask_app.prediction_service = WeatherPredictionService(lookback_steps=48)
    visitor_store = Path(flask_app.root_path) / 'cache' / 'visitor_counts.json'
    flask_app.visitor_counter = VisitorCounterService(str(visitor_store))

    @flask_app.before_request
    def track_ip_visitor():
        """Track page visitors by IP on web pages only."""
        endpoint = request.endpoint or ''
        if request.method != 'GET' or not endpoint.startswith('web.'):
            return

        forwarded = request.headers.get('X-Forwarded-For')
        client_ip = forwarded.split(',')[0].strip() if forwarded else request.remote_addr
        flask_app.visitor_counter.register_visit(client_ip)

    @flask_app.context_processor
    def inject_config():
        """Inject configuration into all templates"""
        forwarded = request.headers.get('X-Forwarded-For')
        client_ip = forwarded.split(',')[0].strip() if forwarded else request.remote_addr
        visitor_stats = flask_app.visitor_counter.get_summary(client_ip)

        return {
            'sites': flask_app.config['SITES'],
            'format_datetime': format_datetime,
            'format_datetime_full': format_datetime_full,
            'css_variables': ColorAPI.get_css_variables(),
            'visitor_total_unique': visitor_stats['total_unique_visitors'],
            'visitor_total_hits': visitor_stats['total_hits'],
            'visitor_current_ip_hits': visitor_stats['current_ip_visits'],
            'thresholds': {
                'water_level': {
                    'advisory': WeatherThresholds.WATER_ADVISORY,
                    'alert': WeatherThresholds.WATER_ALERT,
                    'warning': WeatherThresholds.WATER_WARNING,
                    'critical': WeatherThresholds.WATER_CRITICAL,
                },
                'rainfall': {
                    'light': WeatherThresholds.RAINFALL_LIGHT,
                    'moderate': WeatherThresholds.RAINFALL_MODERATE,
                    'heavy': WeatherThresholds.RAINFALL_HEAVY,
                }
            },
            'station_colors': UIColorSystem.STATION_COLORS,
            **get_template_context()
        }

    flask_app.register_blueprint(web_bp)
    flask_app.register_blueprint(api_bp, url_prefix='/api')
    
    register_error_handlers(flask_app)

    return flask_app


if __name__ == '__main__':
    main_app = create_app()
    main_app.run(debug=True, port=5000)