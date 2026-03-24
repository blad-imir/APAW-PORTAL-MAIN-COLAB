"""API routes for JSON endpoints with caching support."""

import logging
from datetime import datetime
from flask import Blueprint, request, current_app, make_response
from config import UIColorSystem, ChartConfig, get_api_config
from utils.helpers import (
    validate_and_get_date,
    create_api_error_response,
    create_api_success_response,
    parse_weather_timestamp,
    safe_float
)
from utils.error_handlers import handle_api_errors

api_bp = Blueprint('api', __name__)
logger = logging.getLogger(__name__)


@api_bp.route('/config/stations')
@handle_api_errors
def station_config():
    stations = [
        {
            'id': site['id'],
            'name': site['name'],
            'color': UIColorSystem.STATION_COLORS.get(site['id'], UIColorSystem.PRIMARY)
        }
        for site in current_app.config['SITES']
    ]

    return create_api_success_response({
        'stations': stations,
        'chart_config': ChartConfig.get_js_config(),
        'styling': ChartConfig.STYLING,
        'colors': {
            'station_colors': UIColorSystem.STATION_COLORS,
            'text_muted': UIColorSystem.TEXT_MUTED,
        }
    })


@api_bp.route('/config/complete')
@handle_api_errors
def complete_config():
    try:
        config_data = get_api_config()
        config_data['api_url'] = current_app.config['API_URL']
        config_data['api_timeout'] = current_app.config['API_TIMEOUT']
        config_data['debug_mode'] = current_app.debug
        config_data['generated_at'] = datetime.now().isoformat()
        
        return create_api_success_response(config_data)
        
    except Exception as e:
        logger.error("Failed to load complete config: %s", str(e), exc_info=True)
        return create_api_error_response(
            'Configuration service temporarily unavailable',
            503
        )


@api_bp.route('/health')
def health_check():
    """Health check endpoint with cache status."""
    try:
        cache_status = current_app.weather_service.get_cache_status()
        weather_data = current_app.weather_service.fetch_weather_data()
        
        data_count = cache_status.get('data_count', 0)
        total_stations = len(current_app.config['SITES'])
        
        all_offline = data_count == 0
        
        if not hasattr(current_app, '_all_offline_since'):
            current_app._all_offline_since = None
        
        if all_offline and current_app._all_offline_since is None:
            current_app._all_offline_since = datetime.now().isoformat()
        elif not all_offline:
            current_app._all_offline_since = None
        
        api_status = "healthy" if weather_data and data_count > 0 else "degraded"
        
        health_status = {
            "status": "healthy" if api_status == "healthy" else "degraded",
            "timestamp": datetime.now().isoformat(),
            "version": "1.0.0",
            "services": {
                "api": api_status,
                "weather_service": "healthy",
                "config": "healthy"
            },
            "cache": cache_status,
            "stations_count": total_stations,
            "stations_online": data_count,
            "all_offline": all_offline,
            "offline_since": current_app._all_offline_since
        }
        
        status_code = 200 if api_status == "healthy" else 503
        return create_api_success_response(health_status), status_code
        
    except Exception as e:
        logger.error("Health check failed: %s", str(e), exc_info=True)
        return create_api_error_response('System health check failed', 503)


@api_bp.route('/cache/reset', methods=['POST'])
@handle_api_errors
def reset_cache():
    """Reset backoff state and force fresh fetch."""
    try:
        current_app.weather_service.reset_backoff()
        weather_data = current_app.weather_service.fetch_weather_data(force_refresh=True)
        
        return create_api_success_response({
            'message': 'Cache reset successful',
            'data_fetched': len(weather_data) if weather_data else 0,
            'timestamp': datetime.now().isoformat()
        })
    except Exception as e:
        logger.error("Cache reset failed: %s", str(e))
        return create_api_error_response(f'Cache reset failed: {str(e)}', 500)


def _get_latest_per_station(weather_data):
    """
    Get only the most recent reading per station.
    Used by map and weather card - they only need current data, not history.
    """
    if not weather_data:
        return []
    
    latest = {}
    for reading in weather_data:
        station_id = reading.get('StationID')
        if not station_id:
            continue
        
        timestamp_str = reading.get('DateTime') or reading.get('DateTimeStamp') or reading.get('Timestamp')
        
        if station_id not in latest:
            latest[station_id] = reading
        else:
            try:
                current_ts = latest[station_id].get('DateTime') or latest[station_id].get('DateTimeStamp') or ''
                new_ts = timestamp_str or ''
                if new_ts > current_ts:
                    latest[station_id] = reading
            except Exception:
                pass
    
    return list(latest.values())


@api_bp.route('/weather-data')
@handle_api_errors
def weather_data():
    """
    Get weather data with cache support.
    
    Query params:
        station_id: Filter by station
        refresh: Force cache refresh
        latest_only: Return only most recent reading per station (for map/weather card)
    """
    station_id = request.args.get('station_id')
    force_refresh = request.args.get('refresh', '').lower() == 'true'
    latest_only = request.args.get('latest_only', '').lower() == 'true'
    
    try:
        weather_data = current_app.weather_service.fetch_weather_data(force_refresh=force_refresh)
        cache_status = current_app.weather_service.get_cache_status()
        
        age_seconds = cache_status.get('age_seconds') or 0
        last_success = cache_status.get('last_success')
        is_stale = age_seconds > 300 if age_seconds else False
        has_any_data = cache_status.get('has_data', False)
        
        if not weather_data:
            if not has_any_data:
                logger.warning("No data available - system initializing")
                return create_api_error_response(
                    'System initializing. Waiting for first data from sensors...',
                    503,
                    extra_data={'reason': 'initializing', 'has_cache': False}
                )
            else:
                logger.error("API down and cache expired")
                return create_api_error_response(
                    'Weather sensors temporarily offline. Last data expired.',
                    503,
                    extra_data={'reason': 'expired', 'has_cache': False}
                )
        
        original_count = len(weather_data)
        
        if latest_only:
            weather_data = _get_latest_per_station(weather_data)
        
        if station_id:
            weather_data = [d for d in weather_data if d.get('StationID') == station_id]
        
        response_data = {
            'data': weather_data,
            'count': len(weather_data),
            'total_available': original_count,
            'station_id': station_id,
            'generated_at': datetime.now().isoformat(),
            'cache_status': {
                'is_cached': age_seconds > 5 if age_seconds else False,
                'is_stale': is_stale,
                'age_seconds': age_seconds,
                'age_minutes': round(age_seconds / 60, 1) if age_seconds else 0,
                'last_success': last_success,
                'warning': 'Data may be outdated' if is_stale else None
            }
        }
        
        response = make_response(create_api_success_response(response_data))
        response.headers['Cache-Control'] = 'public, max-age=30'
        return response
        
    except Exception as e:
        logger.error("Weather data fetch failed: %s", str(e), exc_info=True)
        return create_api_error_response(
            'Failed to fetch weather data',
            503,
            extra_data={'error': str(e)}
        )


@api_bp.route('/precipitation-data')
@handle_api_errors
def precipitation_data():
    target_date, error_response = validate_and_get_date(request)
    if error_response:
        return error_response

    station_id = request.args.get('station_id')

    weather_data = current_app.weather_service.fetch_weather_data()
    cache_status = current_app.weather_service.get_cache_status()
    
    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            logger.warning("Precipitation: Serving stale cached data")
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable. Please try again.',
                503,
                extra_data={'reason': 'no_data'}
            )

    per_station_data = current_app.precipitation_service.get_24hour_intervals_per_station(
        weather_data=weather_data,
        sites=current_app.config['SITES'],
        target_date=target_date
    )

    if station_id:
        per_station_data = {k: v for k, v in per_station_data.items() if k == station_id}

    stations_response = _format_chart_response(
        per_station_data,
        current_app.config['SITES'],
        level_key='intensity'
    )

    display_date = target_date or datetime.now()
    age_seconds = cache_status.get('age_seconds') or 0
    is_stale = age_seconds > 300 if age_seconds else False
    
    response_data = {
        'stations': stations_response,
        'unit': 'mm/hour',
        'interval': '1 hour',
        'date': display_date.strftime('%Y-%m-%d'),
        'date_display': display_date.strftime('%B %d, %Y'),
        'station_id': station_id,
        'generated_at': datetime.now().isoformat(),
        'cache_status': {
            'is_cached': age_seconds > 5 if age_seconds else False,
            'is_stale': is_stale,
            'age_seconds': age_seconds,
            'age_minutes': round(age_seconds / 60, 1) if age_seconds else 0,
            'warning': 'Data may be outdated' if is_stale else None
        }
    }
    
    response = make_response(create_api_success_response(response_data))
    response.headers['Cache-Control'] = 'public, max-age=30'
    return response


@api_bp.route('/precipitation-date-range')
@handle_api_errors
def precipitation_date_range():
    weather_data = current_app.weather_service.fetch_weather_data()
    
    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response('No weather data available', 503)

    date_range = current_app.precipitation_service.get_available_date_range(weather_data)
    if not date_range:
        return create_api_error_response('No valid timestamps in data', 503)

    total_days = (date_range['latest'] - date_range['earliest']).days + 1

    return create_api_success_response({
        'earliest_date': date_range['earliest'].strftime('%Y-%m-%d'),
        'latest_date': date_range['latest'].strftime('%Y-%m-%d'),
        'earliest_display': date_range['earliest'].strftime('%B %d, %Y'),
        'latest_display': date_range['latest'].strftime('%B %d, %Y'),
        'total_days': total_days
    })


@api_bp.route('/water-level-data')
@handle_api_errors
def water_level_data():
    target_date, error_response = validate_and_get_date(request)
    if error_response:
        return error_response

    station_id = request.args.get('station_id')

    weather_data = current_app.weather_service.fetch_weather_data()
    cache_status = current_app.weather_service.get_cache_status()
    
    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            logger.warning("Water level: Serving stale cached data")
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable. Please try again.',
                503,
                extra_data={'reason': 'no_data'}
            )

    per_station_data = current_app.water_level_service.get_24hour_intervals_per_station(
        weather_data=weather_data,
        sites=current_app.config['SITES'],
        target_date=target_date
    )

    if station_id:
        per_station_data = {k: v for k, v in per_station_data.items() if k == station_id}

    stations_response = _format_water_level_response(
        per_station_data,
        current_app.config['SITES'],
        current_app.water_level_service
    )

    display_date = target_date or datetime.now()
    age_seconds = cache_status.get('age_seconds') or 0
    is_stale = age_seconds > 300 if age_seconds else False
    
    response_data = {
        'stations': stations_response,
        'unit': 'centimeters',
        'interval': '1 hour',
        'date': display_date.strftime('%Y-%m-%d'),
        'date_display': display_date.strftime('%B %d, %Y'),
        'station_id': station_id,
        'generated_at': datetime.now().isoformat(),
        'cache_status': {
            'is_cached': age_seconds > 5 if age_seconds else False,
            'is_stale': is_stale,
            'age_seconds': age_seconds,
            'age_minutes': round(age_seconds / 60, 1) if age_seconds else 0,
            'warning': 'Data may be outdated' if is_stale else None
        }
    }
    
    response = make_response(create_api_success_response(response_data))
    response.headers['Cache-Control'] = 'public, max-age=30'
    return response


@api_bp.route('/water-level-date-range')
@handle_api_errors
def water_level_date_range():
    weather_data = current_app.weather_service.fetch_weather_data()
    if not weather_data:
        return create_api_error_response('No weather data available', 503)

    date_range = current_app.water_level_service.get_available_date_range(weather_data)
    if not date_range:
        return create_api_error_response('No valid timestamps in data', 503)

    total_days = (date_range['latest'] - date_range['earliest']).days + 1

    return create_api_success_response({
        'earliest_date': date_range['earliest'].strftime('%Y-%m-%d'),
        'latest_date': date_range['latest'].strftime('%Y-%m-%d'),
        'earliest_display': date_range['earliest'].strftime('%B %d, %Y'),
        'latest_display': date_range['latest'].strftime('%B %d, %Y'),
        'total_days': total_days
    })


@api_bp.route('/temperature-date-range')
@handle_api_errors
def temperature_date_range():
    weather_data = current_app.weather_service.fetch_weather_data()
    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response('No weather data available', 503)

    date_range = current_app.temperature_service.get_available_date_range(weather_data)
    if not date_range:
        return create_api_error_response('No valid timestamps in data', 503)

    total_days = (date_range['latest'] - date_range['earliest']).days + 1

    return create_api_success_response({
        'earliest_date': date_range['earliest'].strftime('%Y-%m-%d'),
        'latest_date': date_range['latest'].strftime('%Y-%m-%d'),
        'earliest_display': date_range['earliest'].strftime('%B %d, %Y'),
        'latest_display': date_range['latest'].strftime('%B %d, %Y'),
        'total_days': total_days
    })


@api_bp.route('/humidity-date-range')
@handle_api_errors
def humidity_date_range():
    weather_data = current_app.weather_service.fetch_weather_data()
    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response('No weather data available', 503)

    date_range = current_app.humidity_service.get_available_date_range(weather_data)
    if not date_range:
        return create_api_error_response('No valid timestamps in data', 503)

    total_days = (date_range['latest'] - date_range['earliest']).days + 1

    return create_api_success_response({
        'earliest_date': date_range['earliest'].strftime('%Y-%m-%d'),
        'latest_date': date_range['latest'].strftime('%Y-%m-%d'),
        'earliest_display': date_range['earliest'].strftime('%B %d, %Y'),
        'latest_display': date_range['latest'].strftime('%B %d, %Y'),
        'total_days': total_days
    })


@api_bp.route('/cache-status')
@handle_api_errors
def cache_status():
    try:
        memory_status = current_app.weather_service.get_cache_status()
        persistent_status = current_app.weather_service.get_persistent_cache_info()
        
        return create_api_success_response({
            'memory_cache': memory_status,
            'persistent_cache': persistent_status
        })
    except Exception as e:
        return create_api_error_response(str(e), 500)


@api_bp.route('/weather-predictions')
@handle_api_errors
def weather_predictions():
    """Get CGAN-LSTM inspired hourly, daily, and weekly predictions per station."""
    station_id = request.args.get('station_id')
    horizon = request.args.get('horizon')

    valid_horizons = {'hourly', 'daily', 'weekly'}
    if horizon and horizon not in valid_horizons:
        return create_api_error_response(
            'Invalid horizon. Use hourly, daily, or weekly.',
            400
        )

    weather_data = current_app.weather_service.fetch_weather_data()
    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable',
                503,
                extra_data={'reason': 'no_data'}
            )

    predictions = current_app.prediction_service.generate_predictions(
        weather_data=weather_data,
        sites=current_app.config['SITES'],
        hourly_steps=24,
        daily_steps=7,
        weekly_steps=4,
    )

    if horizon:
        predictions['horizons'] = {
            horizon: predictions['horizons'].get(horizon, {})
        }

    if station_id:
        for horizon_key, horizon_data in predictions['horizons'].items():
            stations = horizon_data.get('stations', {})
            if station_id in stations:
                horizon_data['stations'] = {station_id: stations[station_id]}
            else:
                horizon_data['stations'] = {}

    predictions['filters'] = {
        'station_id': station_id,
        'horizon': horizon,
    }

    return create_api_success_response(predictions)


def _format_chart_response(per_station_data, sites, level_key='level'):
    """
    Convert ChartDataPoint objects to JSON-serializable dicts.
    
    Args:
        per_station_data: Dict of station_id -> List[ChartDataPoint]
        sites: Station configuration list
        level_key: Key name for the level field in response ('intensity' or 'alert_level')
    """
    stations_response = {}
    
    for station_id, data_points in per_station_data.items():
        site = next((s for s in sites if s['id'] == station_id), None)
        if not site:
            continue

        data_list = [
            {
                'label': point.label,
                'y': point.y,
                level_key: point.level,
                'day': point.day,
                'timestamp': point.timestamp,
                'count': point.count,
                'show_label': point.show_label
            }
            for point in data_points
        ]

        stations_response[station_id] = {
            'name': site['name'],
            'data': data_list
        }

    return stations_response


def _format_water_level_response(per_station_data, sites, service):
    """Convert water level ChartDataPoint objects to JSON-serializable dicts with statistics."""
    stations_response = {}
    
    for station_id, data_points in per_station_data.items():
        site = next((s for s in sites if s['id'] == station_id), None)
        if not site:
            continue

        data_list = [
            {
                'label': point.label,
                'y': point.y,
                'alert_level': point.level,
                'day': point.day,
                'timestamp': point.timestamp,
                'count': point.count,
                'show_label': point.show_label
            }
            for point in data_points
        ]

        stats = service.get_summary_statistics(data_points)

        stations_response[station_id] = {
            'name': site['name'],
            'data': data_list,
            'statistics': stats
        }

    return stations_response

# =============================================================================
# RAINFALL TRENDS ENDPOINTS
# =============================================================================

@api_bp.route('/rainfall-trends')
@handle_api_errors
def rainfall_trends():
    """
    Get rainfall trends data with flexible filtering.
    
    Query params:
        period: 'last12' for last 12 months
        year: Specific year (e.g., 2026)
        month: Specific month 1-12 (requires year)
    """
    period = request.args.get('period')
    year_param = request.args.get('year')
    month_param = request.args.get('month')

    year = None
    month = None

    if year_param:
        try:
            year = int(year_param)
        except ValueError:
            return create_api_error_response('Invalid year format', 400)

    if month_param:
        try:
            month = int(month_param)
            if month < 1 or month > 12:
                return create_api_error_response('Month must be 1-12', 400)
        except ValueError:
            return create_api_error_response('Invalid month format', 400)

    weather_data = current_app.weather_service.fetch_weather_data()

    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable',
                503
            )

    result = current_app.rainfall_trends_service.get_rainfall_data(
        weather_data=weather_data,
        sites=current_app.config['SITES'],
        period=period,
        year=year,
        month=month
    )

    stations_response = _format_rainfall_trends_response(
        result.get('stations', {}),
        current_app.config['SITES'],
        current_app.rainfall_trends_service
    )

    date_range = result.get('date_range')
    
    return create_api_success_response({
        'stations': stations_response,
        'date_range': {
            'start': date_range['start'].isoformat() if date_range else None,
            'end': date_range['end'].isoformat() if date_range else None,
            'label': date_range['label'] if date_range else None,
            'type': date_range['type'] if date_range else None,
        } if date_range else None,
        'filters': {
            'period': period,
            'year': year,
            'month': month
        },
        'unit': 'mm/day',
        'generated_at': datetime.now().isoformat()
    })


@api_bp.route('/rainfall-trends/periods')
@handle_api_errors
def rainfall_trends_periods():
    """Get available period/year/month options for filtering."""
    weather_data = current_app.weather_service.fetch_weather_data()

    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable',
                503
            )

    periods_data = current_app.rainfall_trends_service.get_available_periods(weather_data)

    return create_api_success_response(periods_data)


@api_bp.route('/rainfall-trends/years')
@handle_api_errors
def rainfall_trends_years():
    """Get list of years with available rainfall data (backward compatible)."""
    weather_data = current_app.weather_service.fetch_weather_data()

    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable',
                503
            )

    years = current_app.rainfall_trends_service.get_available_years(weather_data)

    return create_api_success_response({
        'years': years,
        'current_year': datetime.now().year
    })


def _format_rainfall_trends_response(per_station_data, sites, service):
    """Convert rainfall trends dataclass objects to JSON-serializable dicts."""
    stations_response = {}

    for station_id, data_points in per_station_data.items():
        site = next((s for s in sites if s['id'] == station_id), None)
        if not site:
            continue

        data_list = [
            {
                'label': point.label,
                'y': point.y,
                'date': point.date,
                'month': point.month,
                'day': point.day,
                'count': point.count,
                'show_label': point.show_label
            }
            for point in data_points
        ]

        stats = service.get_yearly_statistics(data_points)

        stations_response[station_id] = {
            'name': site['name'],
            'data': data_list,
            'statistics': stats
        }

    return stations_response


# =============================================================================
# WATER LEVEL TRENDS API
# =============================================================================

@api_bp.route('/water-level-trends')
@handle_api_errors
def water_level_trends():
    """
    Get water level trends data with flexible filtering.
    Returns daily AVERAGE water levels per station.
    
    Query params:
        period: 'last12' for last 12 months
        year: Specific year (e.g., 2026)
        month: Specific month 1-12 (requires year)
    """
    period = request.args.get('period')
    year_param = request.args.get('year')
    month_param = request.args.get('month')

    year = None
    month = None

    if year_param:
        try:
            year = int(year_param)
        except ValueError:
            return create_api_error_response('Invalid year format', 400)

    if month_param:
        try:
            month = int(month_param)
            if month < 1 or month > 12:
                return create_api_error_response('Month must be 1-12', 400)
        except ValueError:
            return create_api_error_response('Invalid month format', 400)

    weather_data = current_app.weather_service.fetch_weather_data()

    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable',
                503
            )

    # Get water level stations only
    water_level_sites = [
        site for site in current_app.config['SITES'] 
        if site.get('has_water_level', False)
    ]

    result = current_app.water_level_trends_service.get_water_level_data(
        weather_data=weather_data,
        sites=water_level_sites,
        period=period,
        year=year,
        month=month
    )

    return create_api_success_response({
        'stations': result.get('stations', {}),
        'date_range': result.get('date_range'),
        'filters': {
            'period': period,
            'year': year,
            'month': month
        },
        'unit': 'cm',
        'generated_at': datetime.now().isoformat()
    })


@api_bp.route('/water-level-trends/periods')
@handle_api_errors
def water_level_trends_periods():
    """Get available period/year/month options for water level filtering."""
    weather_data = current_app.weather_service.fetch_weather_data()

    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable',
                503
            )

    periods_data = current_app.water_level_trends_service.get_available_periods(weather_data)

    return create_api_success_response(periods_data)


# =============================================================================
# TEMPERATURE DATA API (Hourly Monitoring & Daily Trends)
# =============================================================================

@api_bp.route('/temperature-data')
@handle_api_errors
def temperature_data():
    """Get hourly temperature data for all stations."""
    target_date, error_response = validate_and_get_date(request)
    if error_response:
        return error_response

    station_id = request.args.get('station_id')
    weather_data = current_app.weather_service.fetch_weather_data()
    cache_status = current_app.weather_service.get_cache_status()
    
    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable. Please try again.',
                503,
                extra_data={'reason': 'no_data'}
            )

    per_station_data = current_app.temperature_service.get_24hour_intervals_per_station(
        weather_data=weather_data,
        sites=current_app.config['SITES'],
        target_date=target_date
    )

    if station_id:
        per_station_data = {k: v for k, v in per_station_data.items() if k == station_id}

    stations_response = _format_chart_response(
        per_station_data,
        current_app.config['SITES'],
        level_key='level'
    )

    display_date = target_date or datetime.now()
    age_seconds = cache_status.get('age_seconds') or 0
    is_stale = age_seconds > 300 if age_seconds else False
    
    response_data = {
        'stations': stations_response,
        'unit': '°C',
        'interval': '1 hour',
        'date': display_date.strftime('%Y-%m-%d'),
        'date_display': display_date.strftime('%B %d, %Y'),
        'station_id': station_id,
        'generated_at': datetime.now().isoformat(),
        'cache_status': {
            'is_cached': age_seconds > 5 if age_seconds else False,
            'is_stale': is_stale,
            'age_seconds': age_seconds,
            'age_minutes': round(age_seconds / 60, 1) if age_seconds else 0,
            'warning': 'Data may be outdated' if is_stale else None
        }
    }
    
    response = make_response(create_api_success_response(response_data))
    response.headers['Cache-Control'] = 'public, max-age=30'
    return response


@api_bp.route('/humidity-data')
@handle_api_errors
def humidity_data():
    """Get hourly humidity data for all stations."""
    target_date, error_response = validate_and_get_date(request)
    if error_response:
        return error_response

    station_id = request.args.get('station_id')
    weather_data = current_app.weather_service.fetch_weather_data()
    cache_status = current_app.weather_service.get_cache_status()
    
    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable. Please try again.',
                503,
                extra_data={'reason': 'no_data'}
            )

    per_station_data = current_app.humidity_service.get_24hour_intervals_per_station(
        weather_data=weather_data,
        sites=current_app.config['SITES'],
        target_date=target_date
    )

    if station_id:
        per_station_data = {k: v for k, v in per_station_data.items() if k == station_id}

    stations_response = _format_chart_response(
        per_station_data,
        current_app.config['SITES'],
        level_key='level'
    )

    display_date = target_date or datetime.now()
    age_seconds = cache_status.get('age_seconds') or 0
    is_stale = age_seconds > 300 if age_seconds else False
    
    response_data = {
        'stations': stations_response,
        'unit': '%',
        'interval': '1 hour',
        'date': display_date.strftime('%Y-%m-%d'),
        'date_display': display_date.strftime('%B %d, %Y'),
        'station_id': station_id,
        'generated_at': datetime.now().isoformat(),
        'cache_status': {
            'is_cached': age_seconds > 5 if age_seconds else False,
            'is_stale': is_stale,
            'age_seconds': age_seconds,
            'age_minutes': round(age_seconds / 60, 1) if age_seconds else 0,
            'warning': 'Data may be outdated' if is_stale else None
        }
    }
    
    response = make_response(create_api_success_response(response_data))
    response.headers['Cache-Control'] = 'public, max-age=30'
    return response


@api_bp.route('/temperature-trends')
@handle_api_errors
def temperature_trends():
    """Get daily temperature trends data with flexible filtering."""
    period = request.args.get('period')
    year_param = request.args.get('year')
    month_param = request.args.get('month')

    year = None
    month = None

    if year_param:
        try:
            year = int(year_param)
        except ValueError:
            return create_api_error_response('Invalid year format', 400)

    if month_param:
        try:
            month = int(month_param)
            if month < 1 or month > 12:
                return create_api_error_response('Month must be 1-12', 400)
        except ValueError:
            return create_api_error_response('Invalid month format', 400)

    weather_data = current_app.weather_service.fetch_weather_data()

    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable',
                503
            )

    result = current_app.temperature_trends_service.get_temperature_data(
        weather_data=weather_data,
        sites=current_app.config['SITES'],
        period=period,
        year=year,
        month=month
    )

    return create_api_success_response({
        'stations': result.get('stations', {}),
        'date_range': result.get('date_range'),
        'filters': {
            'period': period,
            'year': year,
            'month': month
        },
        'unit': '°C',
        'generated_at': datetime.now().isoformat()
    })


@api_bp.route('/temperature-trends/periods')
@handle_api_errors
def temperature_trends_periods():
    """Get available period/year/month options for temperature filtering."""
    weather_data = current_app.weather_service.fetch_weather_data()

    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable',
                503
            )

    periods_data = current_app.temperature_trends_service.get_available_periods(weather_data)

    return create_api_success_response(periods_data)


@api_bp.route('/humidity-trends')
@handle_api_errors
def humidity_trends():
    """Get daily humidity trends data with flexible filtering."""
    period = request.args.get('period')
    year_param = request.args.get('year')
    month_param = request.args.get('month')

    year = None
    month = None

    if year_param:
        try:
            year = int(year_param)
        except ValueError:
            return create_api_error_response('Invalid year format', 400)

    if month_param:
        try:
            month = int(month_param)
            if month < 1 or month > 12:
                return create_api_error_response('Month must be 1-12', 400)
        except ValueError:
            return create_api_error_response('Invalid month format', 400)

    weather_data = current_app.weather_service.fetch_weather_data()

    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable',
                503
            )

    result = current_app.humidity_trends_service.get_humidity_data(
        weather_data=weather_data,
        sites=current_app.config['SITES'],
        period=period,
        year=year,
        month=month
    )

    return create_api_success_response({
        'stations': result.get('stations', {}),
        'date_range': result.get('date_range'),
        'filters': {
            'period': period,
            'year': year,
            'month': month
        },
        'unit': '%',
        'generated_at': datetime.now().isoformat()
    })


@api_bp.route('/humidity-trends/periods')
@handle_api_errors
def humidity_trends_periods():
    """Get available period/year/month options for humidity filtering."""
    weather_data = current_app.weather_service.fetch_weather_data()

    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable',
                503
            )

    periods_data = current_app.humidity_trends_service.get_available_periods(weather_data)

    return create_api_success_response(periods_data)


# =============================================================================
# ALERT HISTORY API (Notification Bell)
# =============================================================================

@api_bp.route('/alert-history')
@handle_api_errors
def alert_history():
    """
    Get historical threshold breaches for notification bell.
    Returns water level, rainfall, and heat index alerts from last N days.
    Uses per-station thresholds from SiteConfig.WATER_LEVEL_THRESHOLDS.
    
    Optimized: Pre-filters data to only process recent readings instead of
    looping through entire dataset (which could be 2+ months of data).
    """
    from datetime import timedelta
    from config import WeatherThresholds, SiteConfig, HeatIndexConfig
    
    days = request.args.get('days', 10, type=int)
    days = min(max(days, 1), 30)  # Clamp between 1-30 days
    
    weather_data = current_app.weather_service.fetch_weather_data()
    
    if not weather_data:
        stale_data = current_app.weather_service._cache.get_stale_data()
        if stale_data:
            weather_data = stale_data
        else:
            return create_api_error_response(
                'Weather data temporarily unavailable',
                503
            )
    
    sites_map = {s['id']: s['name'] for s in current_app.config['SITES']}
    valid_station_ids = set(sites_map.keys())
    
    water_level_stations = [
        s['id'] for s in current_app.config['SITES'] 
        if s.get('has_water_level', False)
    ]
    
    station_thresholds = SiteConfig.WATER_LEVEL_THRESHOLDS
    cutoff_date = datetime.now() - timedelta(days=days)
    
    # OPTIMIZATION: Pre-filter to only recent readings from valid stations
    def parse_and_filter(reading):
        """Returns (reading, timestamp) if valid and recent, else None."""
        station_id = reading.get('StationID')
        if station_id not in valid_station_ids:
            return None
        
        timestamp = parse_weather_timestamp(
            reading.get('DateTime') or reading.get('DateTimeStamp')
        )
        if not timestamp or timestamp < cutoff_date:
            return None
        
        return (reading, timestamp)
    
    # Filter once, process filtered data
    recent_readings = []
    for reading in weather_data:
        result = parse_and_filter(reading)
        if result:
            recent_readings.append(result)
    
    logger.debug(f"Alert history: Filtered {len(recent_readings)} recent readings from {len(weather_data)} total")
    
    notifications = []
    seen_alerts = set()
    
    # Process only pre-filtered recent readings (timestamp already parsed)
    for reading, timestamp in recent_readings:
        station_id = reading.get('StationID')
        station_name = sites_map.get(station_id, station_id)
        
        # Unique key: station + hour (to avoid duplicate alerts per hour)
        hour_key = timestamp.strftime('%Y-%m-%d-%H')
        
        # Check water level thresholds (only for stations with sensors)
        if station_id in water_level_stations:
            water_level = safe_float(reading.get('WaterLevel'))
            if water_level is not None:
                alert_key = f"water_{station_id}_{hour_key}"
                
                if alert_key not in seen_alerts:
                    # Get per-station thresholds (fall back to global if not defined)
                    thresholds = station_thresholds.get(station_id, {})
                    critical = thresholds.get('critical', WeatherThresholds.WATER_CRITICAL)
                    warning = thresholds.get('warning', WeatherThresholds.WATER_WARNING)
                    alert = thresholds.get('alert', WeatherThresholds.WATER_ALERT)
                    advisory = thresholds.get('advisory', WeatherThresholds.WATER_ADVISORY)
                    
                    alert_type = None
                    if water_level >= critical:
                        alert_type = 'critical'
                    elif water_level >= warning:
                        alert_type = 'warning'
                    elif water_level >= alert:
                        alert_type = 'alert'
                    elif water_level >= advisory:
                        alert_type = 'advisory'
                    
                    if alert_type:
                        seen_alerts.add(alert_key)
                        notifications.append({
                            'id': alert_key,
                            'type': 'water_level',
                            'level': alert_type,
                            'station_id': station_id,
                            'station_name': station_name,
                            'value': water_level,
                            'unit': 'cm',
                            'timestamp': timestamp.isoformat(),
                            'message': _format_water_alert_message(alert_type, station_name, water_level, timestamp)
                        })
        
        # Check rainfall thresholds (all stations)
        rainfall = safe_float(reading.get('HourlyRain'))
        if rainfall is not None and rainfall >= WeatherThresholds.RAINFALL_MODERATE:
            rain_key = f"rain_{station_id}_{hour_key}"
            
            if rain_key not in seen_alerts:
                rain_level = 'heavy' if rainfall >= WeatherThresholds.RAINFALL_HEAVY else 'moderate'
                seen_alerts.add(rain_key)
                notifications.append({
                    'id': rain_key,
                    'type': 'rainfall',
                    'level': rain_level,
                    'station_id': station_id,
                    'station_name': station_name,
                    'value': round(rainfall, 2),
                    'unit': 'mm/hr',
                    'timestamp': timestamp.isoformat(),
                    'message': _format_rainfall_message(rain_level, station_name, rainfall, timestamp)
                })

        # Check heat index thresholds (all stations with valid temperature + humidity)
        temperature = safe_float(reading.get('Temperature'))
        humidity = safe_float(reading.get('Humidity'))
        if temperature is not None and humidity is not None:
            heat_index = HeatIndexConfig.calculate_heat_index(temperature, humidity)
            heat_level = 'normal'
            if heat_index is not None:
                if heat_index >= HeatIndexConfig.EXTREME_DANGER:
                    heat_level = 'extreme_danger'
                elif heat_index >= HeatIndexConfig.DANGER:
                    heat_level = 'danger'
                elif heat_index >= HeatIndexConfig.EXTREME_CAUTION:
                    heat_level = 'extreme_caution'
                elif heat_index >= HeatIndexConfig.CAUTION:
                    heat_level = 'caution'

            # Heat alerts start at PAGASA caution threshold (>= 27C heat index)
            if heat_level != 'normal' and heat_index is not None:
                heat_key = f"temp_{station_id}_{hour_key}"

                if heat_key not in seen_alerts:
                    seen_alerts.add(heat_key)
                    notifications.append({
                        'id': heat_key,
                        'type': 'temperature',
                        'level': heat_level,
                        'station_id': station_id,
                        'station_name': station_name,
                        'value': round(heat_index, 1),
                        'unit': '°C',
                        'timestamp': timestamp.isoformat(),
                        'message': _format_temperature_message(
                            heat_level,
                            station_name,
                            heat_index,
                            timestamp
                        )
                    })
    
    # Sort by timestamp descending (newest first)
    notifications.sort(key=lambda x: x['timestamp'], reverse=True)
    
    # Limit to reasonable count
    max_notifications = request.args.get('limit', 50, type=int)
    notifications = notifications[:max_notifications]
    
    return create_api_success_response({
        'notifications': notifications,
        'count': len(notifications),
        'days': days,
        'generated_at': datetime.now().isoformat()
    })


def _format_water_alert_message(level, station_name, value, timestamp):
    """Format water level alert message with time."""
    time_str = timestamp.strftime('%I:%M %p').lstrip('0')  
    
    messages = {
        'critical': f"CRITICAL: Water level at {station_name} reached {value:.0f}cm at {time_str} - Immediate action required",
        'warning': f"Flood Warning: Water level at {station_name} reached {value:.0f}cm at {time_str}",
        'alert': f"Flood Alert: Water level at {station_name} reached {value:.0f}cm at {time_str}",
        'advisory': f"Advisory: Water level at {station_name} reached {value:.0f}cm at {time_str}"
    }
    return messages.get(level, f"Alert: {station_name} at {value:.0f}cm")


def _format_rainfall_message(level, station_name, value, timestamp):
    """Format rainfall alert message with time."""
    time_str = timestamp.strftime('%I:%M %p').lstrip('0') 
    
    messages = {
        'heavy': f"Heavy Rainfall: {station_name} recorded {value:.1f}mm/hr at {time_str} - Possible flash floods",
        'moderate': f"Moderate Rainfall: {station_name} recorded {value:.1f}mm/hr at {time_str}"
    }
    return messages.get(level, f"Rainfall: {station_name} - {value:.1f}mm/hr")


def _format_temperature_message(level, station_name, value, timestamp):
    """Format heat index alert message with practical safety suggestions."""
    time_str = timestamp.strftime('%I:%M %p').lstrip('0')

    messages = {
        'extreme_danger': (
            f"Extreme Danger Heat Index: {station_name} reached {value:.1f}°C at {time_str} - "
            "Avoid outdoor activity and seek cooler shelter immediately"
        ),
        'danger': (
            f"Danger Heat Index: {station_name} reached {value:.1f}°C at {time_str} - "
            "Limit outdoor exposure, hydrate, and watch for heat stress"
        ),
        'extreme_caution': (
            f"Extreme Caution Heat Index: {station_name} reached {value:.1f}°C at {time_str} - "
            "Take frequent shade breaks and drink water"
        ),
        'caution': (
            f"Caution Heat Index: {station_name} reached {value:.1f}°C at {time_str} - "
            "Stay hydrated and reduce strenuous outdoor activity"
        )
    }
    return messages.get(level, f"Heat Index: {station_name} - {value:.1f}°C")