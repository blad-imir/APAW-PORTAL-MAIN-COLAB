import sys
import os
from datetime import datetime

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from services.metrics_service import MetricsService
from config import WeatherThresholds


def get_recent_timestamp():
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')


def test_critical_water_level():
    service = MetricsService()
    test_data = {
        'St1': {
            'WaterLevel': '1050.0',
            'HourlyRain': '0',
            'DateTime': get_recent_timestamp()
        }
    }
    metrics = service.calculate_dashboard_metrics(test_data)
    
    assert metrics.critical_count == 1
    assert metrics.warning_count == 0
    print(f"✓ Critical (>= {WeatherThresholds.WATER_CRITICAL}cm)")


def test_warning_water_level():
    service = MetricsService()
    test_data = {
        'St1': {
            'WaterLevel': '950.0',
            'HourlyRain': '0',
            'DateTime': get_recent_timestamp()
        }
    }
    metrics = service.calculate_dashboard_metrics(test_data)
    
    assert metrics.critical_count == 0
    assert metrics.warning_count == 1
    assert metrics.alert_count == 0
    print(f"✓ Warning (>= {WeatherThresholds.WATER_WARNING}cm)")


def test_alert_water_level():
    service = MetricsService()
    test_data = {
        'St1': {
            'WaterLevel': '850.0',
            'HourlyRain': '0',
            'DateTime': get_recent_timestamp()
        }
    }
    metrics = service.calculate_dashboard_metrics(test_data)
    
    assert metrics.critical_count == 0
    assert metrics.warning_count == 0
    assert metrics.alert_count == 1
    print(f"✓ Alert (>= {WeatherThresholds.WATER_ALERT}cm)")


def test_advisory_water_level():
    service = MetricsService()
    test_data = {
        'St1': {
            'WaterLevel': '750.0',
            'HourlyRain': '0',
            'DateTime': get_recent_timestamp()
        }
    }
    metrics = service.calculate_dashboard_metrics(test_data)
    
    assert metrics.critical_count == 0
    assert metrics.warning_count == 0
    assert metrics.alert_count == 0
    assert metrics.advisory_count == 1
    print(f"✓ Advisory (>= {WeatherThresholds.WATER_ADVISORY}cm)")


def test_normal_water_level():
    service = MetricsService()
    test_data = {
        'St1': {
            'WaterLevel': '650.0',
            'HourlyRain': '0',
            'DateTime': get_recent_timestamp()
        }
    }
    metrics = service.calculate_dashboard_metrics(test_data)
    
    assert metrics.critical_count == 0
    assert metrics.warning_count == 0
    assert metrics.alert_count == 0
    assert metrics.advisory_count == 0
    print("✓ Normal (< 700cm)")


def test_boundary_values():
    service = MetricsService()
    timestamp = get_recent_timestamp()
    
    test_data = {'St1': {'WaterLevel': '1000.0', 'HourlyRain': '0', 'DateTime': timestamp}}
    metrics = service.calculate_dashboard_metrics(test_data)
    assert metrics.critical_count == 1
    
    test_data = {'St1': {'WaterLevel': '900.0', 'HourlyRain': '0', 'DateTime': timestamp}}
    metrics = service.calculate_dashboard_metrics(test_data)
    assert metrics.warning_count == 1
    
    test_data = {'St1': {'WaterLevel': '800.0', 'HourlyRain': '0', 'DateTime': timestamp}}
    metrics = service.calculate_dashboard_metrics(test_data)
    assert metrics.alert_count == 1
    
    test_data = {'St1': {'WaterLevel': '700.0', 'HourlyRain': '0', 'DateTime': timestamp}}
    metrics = service.calculate_dashboard_metrics(test_data)
    assert metrics.advisory_count == 1
    
    print("✓ Boundary values")


def test_multiple_stations():
    service = MetricsService()
    timestamp = get_recent_timestamp()
    
    test_data = {
        'St1': {'WaterLevel': '1050.0', 'HourlyRain': '0', 'DateTime': timestamp},
        'St2': {'WaterLevel': '950.0', 'HourlyRain': '0', 'DateTime': timestamp},
        'St3': {'WaterLevel': '850.0', 'HourlyRain': '0', 'DateTime': timestamp},
        'St4': {'WaterLevel': '750.0', 'HourlyRain': '0', 'DateTime': timestamp},
        'St5': {'WaterLevel': '650.0', 'HourlyRain': '0', 'DateTime': timestamp},
    }
    
    metrics = service.calculate_dashboard_metrics(test_data)
    
    assert metrics.critical_count == 1
    assert metrics.warning_count == 1
    assert metrics.alert_count == 1
    assert metrics.advisory_count == 1
    assert metrics.online_sensors == 5
    print("✓ Multiple stations")


def test_rainfall_triggers():
    service = MetricsService()
    
    test_data = {
        'St1': {
            'WaterLevel': '650.0',
            'HourlyRain': '35.0',
            'DateTime': get_recent_timestamp()
        }
    }
    metrics = service.calculate_dashboard_metrics(test_data)
    assert metrics.rainfall_forecast.level == 'Heavy Rain'
    
    print(f"✓ Rainfall (Heavy >= {WeatherThresholds.RAINFALL_HEAVY}mm/h)")


def test_empty_data():
    service = MetricsService()
    metrics = service.calculate_dashboard_metrics({})
    
    assert metrics.critical_count == 0
    assert metrics.online_sensors == 0
    print("✓ Empty data")


def test_emergency_scenario():
    service = MetricsService()
    timestamp = get_recent_timestamp()
    
    test_data = {
        'St1': {'WaterLevel': '1020.0', 'HourlyRain': '35.0', 'DateTime': timestamp},
        'St2': {'WaterLevel': '880.0', 'HourlyRain': '32.0', 'DateTime': timestamp},
        'St3': {'WaterLevel': '720.0', 'HourlyRain': '30.0', 'DateTime': timestamp},
    }
    
    metrics = service.calculate_dashboard_metrics(test_data)
    
    assert metrics.highest_alert_level == 'critical'
    assert metrics.critical_count == 1
    assert metrics.alert_count == 1
    assert len(metrics.attention_stations) == 2
    assert metrics.rainfall_forecast.level == 'Heavy Rain'
    
    print("✓ Emergency scenario")


def test_real_api_format():
    service = MetricsService()
    
    # Test with exact API structure from St4
    test_data = {
        'St4': {
            'ID': '97507',
            'DateTime': get_recent_timestamp(),
            'StationID': 'St4',
            'Temperature': '26.45',
            'Humidity': '88.7',
            'WindDirection': 'S',
            'WindDegree': '180',
            'WindSpeed': '0.07',
            'HourlyRain': '0.27',
            'DailyRain': '0',
            'WaterLevel': '850.0',
            'SensorTime': '16:51:39'
        }
    }
    
    metrics = service.calculate_dashboard_metrics(test_data)
    
    assert metrics.alert_count == 1
    assert metrics.online_sensors == 1
    print("✓ Real API format")


def run_all_tests():
    print("\n" + "="*60)
    print("METRICS SERVICE TESTS")
    print("="*60)
    print(f"Thresholds: {WeatherThresholds.WATER_CRITICAL}, {WeatherThresholds.WATER_WARNING}, {WeatherThresholds.WATER_ALERT}, {WeatherThresholds.WATER_ADVISORY} cm")
    print("="*60 + "\n")
    
    tests = [
        test_critical_water_level,
        test_warning_water_level,
        test_alert_water_level,
        test_advisory_water_level,
        test_normal_water_level,
        test_boundary_values,
        test_multiple_stations,
        test_rainfall_triggers,
        test_empty_data,
        test_emergency_scenario,
        test_real_api_format,
    ]
    
    passed = 0
    failed = 0
    
    for test_func in tests:
        try:
            test_func()
            passed += 1
        except AssertionError as e:
            print(f"✗ {test_func.__name__} - {e}")
            failed += 1
        except Exception as e:
            print(f"✗ {test_func.__name__} - ERROR: {e}")
            failed += 1
    
    print("\n" + "="*60)
    print(f"RESULTS: {passed} passed, {failed} failed")
    print("="*60 + "\n")
    
    if failed == 0:
        print("🎉 All tests passed!\n")
    else:
        print("⚠️  Fix failing tests before deploying!\n")
    
    return failed == 0


if __name__ == '__main__':
    success = run_all_tests()
    sys.exit(0 if success else 1)