"""Metrics Service - Dashboard metrics, alerts, and station status."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Union

from config import (
    WeatherThresholds, 
    AlertLevelConfig, 
    RainfallForecastConfig, 
    SiteConfig,
    DataFreshnessConfig
)
from utils.helpers import parse_weather_timestamp, safe_float


@dataclass
class RainfallForecast:
    level: str
    icon: str
    color: str
    count: int


@dataclass  
class AlertLevelInfo:
    level: str
    icon: str
    color: str
    description: str


@dataclass
class StationAlert:
    station_id: str
    station_name: str
    alert_level: str
    water_level: float
    is_online: bool
    last_update: Optional[datetime]


@dataclass
class DashboardMetrics:
    highest_alert_level: str
    highest_alert_count: int
    critical_count: int
    warning_count: int
    alert_count: int
    advisory_count: int
    attention_stations: List[str]
    online_sensors: int
    total_sensors: int
    water_level_stations: int
    offline_stations: List[str]
    rainfall_forecast: RainfallForecast
    alert_level_info: AlertLevelInfo
    station_alerts: List[StationAlert]


class MetricsService:
    
    def __init__(self, sites: Optional[List[Dict]] = None):
        self.sites = sites or SiteConfig.SITES
        self.total_sensors = len(SiteConfig.SITES)
        self.water_level_stations = len(SiteConfig.get_stations_with_water_level())
    
    def _to_float(self, value: Union[str, float, int, None]) -> Optional[float]:
        return safe_float(value)
    
    def _parse_timestamp(self, data: Dict) -> Optional[datetime]:
        return parse_weather_timestamp(
            data.get('DateTime') or data.get('DateTimeStamp') or data.get('Timestamp')
        )
    
    def _is_station_online(self, data: Dict) -> bool:
        if not data:
            return False
        
        timestamp = self._parse_timestamp(data)
        if not timestamp:
            return False
        
        now = datetime.now()
        if timestamp.tzinfo:
            timestamp = timestamp.replace(tzinfo=None)
        
        age_minutes = (now - timestamp).total_seconds() / 60
        return age_minutes <= DataFreshnessConfig.OFFLINE_THRESHOLD
    
    def _get_station_name(self, station_id: str) -> str:
        for site in self.sites:
            if site['id'] == station_id:
                return site['name']
        return station_id
    
    def get_alert_level(self, water_level: Union[str, float, int, None]) -> str:
        level = self._to_float(water_level)
        
        if level is None:
            return 'normal'
        
        if level >= WeatherThresholds.WATER_CRITICAL:
            return 'critical'
        elif level >= WeatherThresholds.WATER_WARNING:
            return 'warning'
        elif level >= WeatherThresholds.WATER_ALERT:
            return 'alert'
        elif level >= WeatherThresholds.WATER_ADVISORY:
            return 'advisory'
        return 'normal'
    
    def get_rainfall_level(self, rainfall: Union[str, float, int, None]) -> str:
        level = self._to_float(rainfall)
        
        if level is None:
            return 'no_data'
        
        if level >= WeatherThresholds.RAINFALL_HEAVY:
            return 'heavy'
        elif level >= WeatherThresholds.RAINFALL_MODERATE:
            return 'moderate'
        elif level >= WeatherThresholds.RAINFALL_LIGHT:
            return 'light'
        return 'none'
    
    def get_data_freshness_status(self, data: Dict) -> Dict:
        """Get data freshness status using DataFreshnessConfig thresholds."""
        if not data:
            return DataFreshnessConfig.STATUS_LEVELS['offline']
        
        timestamp = self._parse_timestamp(data)
        if not timestamp:
            return DataFreshnessConfig.STATUS_LEVELS['offline']
        
        now = datetime.now()
        if timestamp.tzinfo:
            timestamp = timestamp.replace(tzinfo=None)
        
        age_minutes = (now - timestamp).total_seconds() / 60
        return DataFreshnessConfig.get_status(age_minutes)

    def get_sensor_logs(self, weather_data: List[Dict], days: int = 14) -> Dict:
        """Build current and daily working/non-working sensor logs."""
        clamped_days = max(1, min(days, 30))
        today = datetime.now().date()
        window_dates = [today - timedelta(days=offset) for offset in range(clamped_days - 1, -1, -1)]
        active_by_day = {day: set() for day in window_dates}

        latest_by_station: Dict[str, datetime] = {}

        for reading in weather_data:
            station_id = reading.get('StationID')
            if not station_id:
                continue

            timestamp = self._parse_timestamp(reading)
            if not timestamp:
                continue
            if timestamp.tzinfo:
                timestamp = timestamp.replace(tzinfo=None)

            reading_day = timestamp.date()
            if reading_day in active_by_day:
                active_by_day[reading_day].add(station_id)

            latest = latest_by_station.get(station_id)
            if latest is None or timestamp > latest:
                latest_by_station[station_id] = timestamp

        station_statuses = []
        working_now = 0
        now = datetime.now()

        for site in self.sites:
            station_id = site['id']
            station_name = site['name']
            latest_ts = latest_by_station.get(station_id)

            if latest_ts:
                age_minutes = (now - latest_ts).total_seconds() / 60
                freshness = DataFreshnessConfig.get_status(age_minutes)
                minutes_since_update = round(age_minutes, 1)
            else:
                freshness = DataFreshnessConfig.STATUS_LEVELS['offline']
                minutes_since_update = None

            is_working = freshness['status'].lower() != 'offline'
            if is_working:
                working_now += 1

            station_statuses.append({
                'station_id': station_id,
                'station_name': station_name,
                'is_working': is_working,
                'status_label': freshness['status'],
                'last_update': latest_ts,
                'minutes_since_update': minutes_since_update,
            })

        daily_logs = []
        total_sensors = len(self.sites)

        for day in window_dates:
            active_ids = active_by_day.get(day, set())

            working_sensors = [
                site['name'] for site in self.sites if site['id'] in active_ids
            ]
            non_working_sensors = [
                site['name'] for site in self.sites if site['id'] not in active_ids
            ]

            daily_logs.append({
                'date': day.isoformat(),
                'day_label': day.strftime('%b %d, %Y'),
                'working_count': len(working_sensors),
                'non_working_count': len(non_working_sensors),
                'working_sensors': working_sensors,
                'non_working_sensors': non_working_sensors,
            })

        return {
            'days': clamped_days,
            'total_sensors': total_sensors,
            'current_working_count': working_now,
            'current_non_working_count': total_sensors - working_now,
            'station_statuses': station_statuses,
            'daily_logs': daily_logs,
        }
    
    def calculate_dashboard_metrics(self, station_data: Dict[str, Dict]) -> DashboardMetrics:
        alert_counts = {'critical': 0, 'warning': 0, 'alert': 0, 'advisory': 0, 'normal': 0}
        rainfall_counts = {'heavy': 0, 'moderate': 0, 'light': 0, 'none': 0, 'no_data': 0}
        attention_stations = []
        offline_stations = []
        station_alerts = []
        online_count = 0
        
        for station_id, data in station_data.items():
            station_name = self._get_station_name(station_id)
            has_water_level = SiteConfig.has_water_level_sensor(station_id)
            
            if not data:
                offline_stations.append(station_name)
                continue
            
            is_online = self._is_station_online(data)
            
            if is_online:
                online_count += 1
            else:
                offline_stations.append(station_name)
            
            water_level = self._to_float(data.get('WaterLevel'))
            alert_level = self.get_alert_level(water_level) if has_water_level else 'normal'
            
            if has_water_level:
                alert_counts[alert_level] += 1
            
            station_alert = StationAlert(
                station_id=station_id,
                station_name=station_name,
                alert_level=alert_level,
                water_level=water_level or 0.0,
                is_online=is_online,
                last_update=self._parse_timestamp(data)
            )
            station_alerts.append(station_alert)
            
            if has_water_level and alert_level in ['critical', 'warning', 'alert']:
                attention_stations.append(station_name)
            
            rainfall = self._to_float(data.get('HourlyRain'))
            rainfall_level = self.get_rainfall_level(rainfall)
            rainfall_counts[rainfall_level] += 1
        
        highest_alert_level = 'none'
        highest_alert_count = 0
        
        for level in ['critical', 'warning', 'alert', 'advisory']:
            if alert_counts[level] > 0: 
                highest_alert_level = level 
                highest_alert_count = alert_counts[level]
                break
        
        highest_rainfall_level = 'none'
        highest_rainfall_count = 0
        for level in ['heavy', 'moderate', 'light']:
            if rainfall_counts[level] > 0:
                highest_rainfall_level = level
                highest_rainfall_count = rainfall_counts[level]
                break
        
        rainfall_forecast = self._get_rainfall_forecast(highest_rainfall_level, highest_rainfall_count)
        alert_level_info = self._get_alert_level_info(highest_alert_level)
        
        return DashboardMetrics(
            highest_alert_level=highest_alert_level,
            highest_alert_count=highest_alert_count,
            critical_count=alert_counts['critical'],
            warning_count=alert_counts['warning'],
            alert_count=alert_counts['alert'],
            advisory_count=alert_counts['advisory'],
            attention_stations=attention_stations,
            online_sensors=online_count,
            total_sensors=self.total_sensors,
            water_level_stations=self.water_level_stations,
            offline_stations=offline_stations,
            rainfall_forecast=rainfall_forecast,
            alert_level_info=alert_level_info,
            station_alerts=station_alerts
        )

    def _get_rainfall_forecast(self, rainfall_level: str, count: int) -> RainfallForecast:
        config = RainfallForecastConfig.get_config(rainfall_level)
        
        return RainfallForecast(
            level=config['level'],
            icon=config['icon'],
            color=config['color'],
            count=count
        )
    
    def _get_alert_level_info(self, alert_level: str) -> AlertLevelInfo:
        config = AlertLevelConfig.get_config(alert_level)
        
        return AlertLevelInfo(
            level=config['level'],
            icon=config['icon'],
            color=config['color'],
            description=config['description']
        )
    
    def get_station_status(self, station_data: Dict) -> Dict:
        if not station_data:
            return {
                'alert_level': 'normal',
                'rainfall_level': 'no_data',
                'water_level': None,
                'rainfall': None,
                'is_online': False,
                'needs_attention': False,
                'freshness': DataFreshnessConfig.STATUS_LEVELS['offline']
            }
        
        water_level = self._to_float(station_data.get('WaterLevel'))
        rainfall = self._to_float(station_data.get('HourlyRain'))
        alert_level = self.get_alert_level(water_level)
        
        return {
            'alert_level': alert_level,
            'rainfall_level': self.get_rainfall_level(rainfall),
            'water_level': water_level,
            'rainfall': rainfall,
            'is_online': self._is_station_online(station_data),
            'needs_attention': alert_level in ['critical', 'warning', 'alert'],
            'freshness': self.get_data_freshness_status(station_data)
        }