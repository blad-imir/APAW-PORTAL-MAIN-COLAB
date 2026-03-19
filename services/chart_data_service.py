"""Chart Data Processing Service - Unified handler for precipitation and water level charts."""

import logging
from datetime import datetime, timedelta
from collections import defaultdict
from typing import Dict, List, Optional
from dataclasses import dataclass
from enum import Enum

from config import ChartConfig, WeatherThresholds
from utils.helpers import (
    parse_weather_timestamp,
    create_hourly_intervals,
    format_time_label,
    format_day_label,
    safe_float
)

logger = logging.getLogger(__name__)


class DataType(Enum):
    PRECIPITATION = 'precipitation'
    WATER_LEVEL = 'water_level'
    TEMPERATURE = 'temperature'
    HUMIDITY = 'humidity'


# Water level sensor validation range (centimeters)
MIN_VALID_WATER_LEVEL_CM = 0.0
MAX_VALID_WATER_LEVEL_CM = 1500.0

# Environmental sensor validation ranges
MIN_VALID_TEMPERATURE_C = -40.0
MAX_VALID_TEMPERATURE_C = 60.0
MIN_VALID_HUMIDITY_PERCENT = 0.0
MAX_VALID_HUMIDITY_PERCENT = 100.0


@dataclass
class ChartDataPoint:
    """Universal data point for both precipitation and water level charts."""
    label: str
    y: float
    level: str  # 'intensity' for rain, 'alert_level' for water
    day: str
    timestamp: str
    count: int
    show_label: bool


class ChartDataService:
    """
    Unified service for processing time-series chart data.
    Handles both precipitation (mm/hr) and water level (cm) data.
    """

    def __init__(self, metrics_service):
        self.metrics_service = metrics_service

    def get_24hour_intervals_per_station(
        self,
        weather_data: List[Dict],
        sites: List[Dict],
        data_type: DataType,
        target_date: Optional[datetime] = None
    ) -> Dict[str, List[ChartDataPoint]]:
        """
        Process weather data into hourly intervals, separated by station.
        
        Args:
            weather_data: Raw weather readings from API
            sites: Station configuration list
            data_type: PRECIPITATION or WATER_LEVEL
            target_date: Specific date to display (defaults to latest data date)
        """
        display_date = self._determine_display_date(weather_data, target_date)
        
        start_time = display_date.replace(
            hour=ChartConfig.CHART_START_HOUR,
            minute=0, second=0, microsecond=0
        )
        end_time = display_date.replace(
            hour=ChartConfig.CHART_END_HOUR,
            minute=0, second=0, microsecond=0
        )

        logger.info(
            "Generating hourly %s data from %s to %s",
            data_type.value,
            start_time.strftime('%Y-%m-%d %I %p'),
            end_time.strftime('%Y-%m-%d %I %p')
        )

        intervals = create_hourly_intervals(
            start_time, end_time,
            ChartConfig.DATA_INTERVAL_HOURS
        )
        logger.info("Created %d hourly intervals", len(intervals))

        station_interval_data = self._group_readings_by_station_and_interval(
            weather_data, intervals, start_time, end_time, data_type
        )

        result = {}
        for site in sites:
            station_id = site['id']
            station_data = station_interval_data.get(station_id, {})
            formatted_data = self._format_interval_data(
                intervals, station_data, display_date, data_type
            )
            result[station_id] = formatted_data

        logger.info(
            "Generated %d hourly data points for %d stations",
            len(intervals), len(result)
        )
        return result

    def _determine_display_date(
        self,
        weather_data: List[Dict],
        target_date: Optional[datetime]
    ) -> datetime:
        """Determine the display date from target or latest data."""
        if target_date:
            logger.info("Getting hourly data for: %s", target_date.date())
            return target_date

        if not weather_data:
            logger.warning("No weather data available, using system date")
            return datetime.now()

        latest_timestamp = None
        for reading in weather_data:
            parsed = parse_weather_timestamp(
                reading.get('DateTime') or reading.get('DateTimeStamp')
            )
            if parsed and (latest_timestamp is None or parsed > latest_timestamp):
                latest_timestamp = parsed

        if latest_timestamp:
            logger.info("Using latest data timestamp: %s", latest_timestamp)
            return latest_timestamp

        logger.warning("No valid timestamps found, using system date")
        return datetime.now()

    def _group_readings_by_station_and_interval(
        self,
        weather_data: List[Dict],
        intervals: List[datetime],
        start_time: datetime,
        end_time: datetime,
        data_type: DataType
    ) -> Dict[str, Dict[datetime, List[float]]]:
        """Group weather readings by both station and hourly time interval."""
        station_data = defaultdict(lambda: defaultdict(list))
        field_map = {
            DataType.PRECIPITATION: 'HourlyRain',
            DataType.WATER_LEVEL: 'WaterLevel',
            DataType.TEMPERATURE: 'Temperature',
            DataType.HUMIDITY: 'Humidity'
        }
        field_name = field_map.get(data_type)

        if not field_name:
            logger.warning("Unsupported data type for hourly grouping: %s", data_type)
            return station_data

        for reading in weather_data:
            try:
                parsed_time = parse_weather_timestamp(
                    reading.get('DateTime') or reading.get('DateTimeStamp')
                )
                if not parsed_time:
                    continue

                if not (start_time <= parsed_time <= end_time + timedelta(hours=1)):
                    continue

                station_id = reading.get('StationID')
                value = safe_float(reading.get(field_name))

                if not station_id or value is None:
                    continue

                # Data-type specific validation
                if data_type == DataType.PRECIPITATION and value < 0:
                    continue
                if data_type == DataType.WATER_LEVEL:
                    if not (MIN_VALID_WATER_LEVEL_CM <= value <= MAX_VALID_WATER_LEVEL_CM):
                        continue
                if data_type == DataType.TEMPERATURE:
                    if not (MIN_VALID_TEMPERATURE_C <= value <= MAX_VALID_TEMPERATURE_C):
                        continue
                if data_type == DataType.HUMIDITY:
                    if not (MIN_VALID_HUMIDITY_PERCENT <= value <= MAX_VALID_HUMIDITY_PERCENT):
                        continue

                for interval_time in intervals:
                    next_interval = interval_time + timedelta(hours=1)
                    if interval_time <= parsed_time < next_interval:
                        station_data[station_id][interval_time].append(value)
                        break

            except (KeyError, AttributeError) as e:
                logger.warning("Error processing reading: %s", e)
                continue

        logger.info("Grouped data for %d stations into hourly intervals", len(station_data))
        return station_data

    def _format_interval_data(
        self,
        intervals: List[datetime],
        interval_data: Dict[datetime, List[float]],
        display_date: datetime,
        data_type: DataType
    ) -> List[ChartDataPoint]:
        """Format interval data with smart labeling."""
        result = []

        for interval_time in intervals:
            values = interval_data.get(interval_time, [])
            avg_value = sum(values) / len(values) if values else 0

            if data_type == DataType.PRECIPITATION:
                level = self.metrics_service.get_rainfall_level(avg_value)
                y_value = round(avg_value, 1)
            elif data_type == DataType.WATER_LEVEL:
                level = self.metrics_service.get_alert_level(avg_value)
                y_value = round(avg_value, 2)
            elif data_type == DataType.TEMPERATURE:
                level = 'normal'
                y_value = round(avg_value, 1)
            else:  # HUMIDITY
                level = 'normal'
                y_value = round(avg_value, 1)

            show_label = (interval_time.hour % ChartConfig.LABEL_INTERVAL_HOURS == 0)

            result.append(ChartDataPoint(
                label=format_time_label(interval_time),
                y=y_value,
                level=level,
                day=format_day_label(interval_time, display_date),
                timestamp=interval_time.isoformat(),
                count=len(values),
                show_label=show_label
            ))

        return result

    def get_available_date_range(self, weather_data: List[Dict]) -> Optional[Dict]:
        """Get the range of dates available in the weather data."""
        if not weather_data:
            return None

        valid_dates = []
        for reading in weather_data:
            parsed_time = parse_weather_timestamp(
                reading.get('DateTime') or reading.get('DateTimeStamp')
            )
            if parsed_time:
                valid_dates.append(parsed_time)

        if not valid_dates:
            logger.warning("No valid timestamps found in weather data")
            return None

        earliest = min(valid_dates)
        latest = max(valid_dates)

        logger.info("Date range available: %s to %s", earliest.date(), latest.date())

        return {
            'earliest': earliest,
            'latest': latest
        }

    def get_water_level_summary(self, data_points: List[ChartDataPoint]) -> Dict:
        """Calculate summary statistics for water level data."""
        if not data_points:
            return {
                'average_level': 0,
                'max_level': 0,
                'min_level': 0,
                'highest_alert_level': 'normal',
                'critical_intervals': 0,
                'warning_intervals': 0,
                'alert_intervals': 0,
                'total_intervals': 0
            }

        water_levels = [point.y for point in data_points]
        alert_counts = {'critical': 0, 'warning': 0, 'alert': 0, 'advisory': 0, 'normal': 0}

        for point in data_points:
            alert_counts[point.level] += 1

        highest_alert = 'normal'
        for level in ['critical', 'warning', 'alert', 'advisory']:
            if alert_counts[level] > 0:
                highest_alert = level
                break

        return {
            'average_level': round(sum(water_levels) / len(water_levels), 2),
            'max_level': max(water_levels),
            'min_level': min(water_levels),
            'highest_alert_level': highest_alert,
            'critical_intervals': alert_counts['critical'],
            'warning_intervals': alert_counts['warning'],
            'alert_intervals': alert_counts['alert'],
            'total_intervals': len(data_points)
        }


# Backward-compatible wrapper classes for existing code
class PrecipitationService:
    """Wrapper for backward compatibility with existing routes."""

    def __init__(self, metrics_service):
        self._service = ChartDataService(metrics_service)

    def get_24hour_intervals_per_station(
        self,
        weather_data: List[Dict],
        sites: List[Dict],
        target_date: Optional[datetime] = None
    ) -> Dict[str, List[ChartDataPoint]]:
        return self._service.get_24hour_intervals_per_station(
            weather_data, sites, DataType.PRECIPITATION, target_date
        )

    def get_available_date_range(self, weather_data: List[Dict]) -> Optional[Dict]:
        return self._service.get_available_date_range(weather_data)


class WaterLevelService:
    """Wrapper for backward compatibility with existing routes."""

    def __init__(self, metrics_service):
        self._service = ChartDataService(metrics_service)

    def get_24hour_intervals_per_station(
        self,
        weather_data: List[Dict],
        sites: List[Dict],
        target_date: Optional[datetime] = None
    ) -> Dict[str, List[ChartDataPoint]]:
        return self._service.get_24hour_intervals_per_station(
            weather_data, sites, DataType.WATER_LEVEL, target_date
        )

    def get_available_date_range(self, weather_data: List[Dict]) -> Optional[Dict]:
        return self._service.get_available_date_range(weather_data)

    def get_summary_statistics(self, data_points: List[ChartDataPoint]) -> Dict:
        return self._service.get_water_level_summary(data_points)


class TemperatureService:
    """Wrapper for hourly temperature chart endpoints."""

    def __init__(self, metrics_service):
        self._service = ChartDataService(metrics_service)

    def get_24hour_intervals_per_station(
        self,
        weather_data: List[Dict],
        sites: List[Dict],
        target_date: Optional[datetime] = None
    ) -> Dict[str, List[ChartDataPoint]]:
        return self._service.get_24hour_intervals_per_station(
            weather_data, sites, DataType.TEMPERATURE, target_date
        )

    def get_available_date_range(self, weather_data: List[Dict]) -> Optional[Dict]:
        return self._service.get_available_date_range(weather_data)


class HumidityService:
    """Wrapper for hourly humidity chart endpoints."""

    def __init__(self, metrics_service):
        self._service = ChartDataService(metrics_service)

    def get_24hour_intervals_per_station(
        self,
        weather_data: List[Dict],
        sites: List[Dict],
        target_date: Optional[datetime] = None
    ) -> Dict[str, List[ChartDataPoint]]:
        return self._service.get_24hour_intervals_per_station(
            weather_data, sites, DataType.HUMIDITY, target_date
        )

    def get_available_date_range(self, weather_data: List[Dict]) -> Optional[Dict]:
        return self._service.get_available_date_range(weather_data)

# =============================================================================
# RAINFALL TRENDS - Yearly daily rainfall visualization
# =============================================================================

@dataclass
class DailyRainfallDataPoint:
    """Data point for daily rainfall trends chart."""
    label: str
    y: Optional[float]
    date: str
    month: int
    day: int
    count: int
    show_label: bool


class RainfallTrendsService:
    """Service for rainfall trends data with period/year/month filtering."""

    MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    
    FULL_MONTH_NAMES = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ]

    def __init__(self, metrics_service):
        self.metrics_service = metrics_service

    def get_rainfall_data(
        self,
        weather_data: List[Dict],
        sites: List[Dict],
        period: str = None,
        year: int = None,
        month: int = None
    ) -> Dict:
        """
        Get rainfall data with flexible filtering.
        
        Args:
            period: 'last12' for last 12 months, or None for year-based
            year: Specific year (e.g., 2026)
            month: Specific month 1-12, or None for all months
        
        Returns:
            Dict with stations data, date_range info, and filter metadata
        """
        if not weather_data:
            return {'stations': {}, 'date_range': None}

        # Determine date range based on filters
        date_range = self._calculate_date_range(weather_data, period, year, month)
        if not date_range:
            return {'stations': {}, 'date_range': None}

        # Group all data by station and date
        station_daily_data = self._group_all_by_station_and_date(weather_data)

        # Format data for each station within the date range
        result = {}
        for site in sites:
            station_id = site['id']
            daily_data = station_daily_data.get(station_id, {})
            formatted_data = self._format_range_data(
                daily_data, 
                date_range['start'], 
                date_range['end']
            )
            result[station_id] = formatted_data

        return {
            'stations': result,
            'date_range': date_range,
            'period': period,
            'year': year,
            'month': month
        }

    def _calculate_date_range(
        self,
        weather_data: List[Dict],
        period: str,
        year: int,
        month: int
    ) -> Optional[Dict]:
        """Calculate the date range based on filters."""
        today = datetime.now()
        
        if period == 'last12':
            # Find earliest data date
            earliest = self._get_earliest_date(weather_data)
            if not earliest:
                return None
            
            # Last 12 months from today, but start from earliest data
            end_date = today
            start_12_months_ago = today - timedelta(days=365)
            
            # Use earliest data date if it's more recent than 12 months ago
            start_date = max(earliest, start_12_months_ago)
            
            return {
                'start': start_date,
                'end': end_date,
                'label': 'Last 12 months',
                'type': 'last12'
            }
        
        elif year:
            if month:
                # Specific month in a year
                start_date = datetime(year, month, 1)
                if month == 12:
                    end_date = datetime(year, 12, 31)
                else:
                    end_date = datetime(year, month + 1, 1) - timedelta(days=1)
                
                # Don't go beyond today
                if end_date > today:
                    end_date = today
                
                return {
                    'start': start_date,
                    'end': end_date,
                    'label': f'{self.FULL_MONTH_NAMES[month-1]} {year}',
                    'type': 'month'
                }
            else:
                # Full year - ALWAYS show Jan 1 to Dec 31
                start_date = datetime(year, 1, 1)
                end_date = datetime(year, 12, 31)
                
                return {
                    'start': start_date,
                    'end': end_date,
                    'label': str(year),
                    'type': 'year'
                }
        
        # Default to current year - also show full year
        current_year = today.year
        return {
            'start': datetime(current_year, 1, 1),
            'end': datetime(current_year, 12, 31),
            'label': str(current_year),
            'type': 'year'
        }

    def _get_earliest_date(self, weather_data: List[Dict]) -> Optional[datetime]:
        """Get the earliest date in the weather data."""
        earliest = None
        for reading in weather_data:
            timestamp = parse_weather_timestamp(
                reading.get('DateTime') or reading.get('DateTimeStamp')
            )
            if timestamp:
                if earliest is None or timestamp < earliest:
                    earliest = timestamp
        return earliest

    def _group_all_by_station_and_date(
        self,
        weather_data: List[Dict]
    ) -> Dict[str, Dict[str, List[float]]]:
        """Group DailyRain readings by station and date (no year filter)."""
        station_data = defaultdict(lambda: defaultdict(list))

        for reading in weather_data:
            try:
                timestamp = parse_weather_timestamp(
                    reading.get('DateTime') or reading.get('DateTimeStamp')
                )
                if not timestamp:
                    continue

                station_id = reading.get('StationID')
                daily_rain = safe_float(reading.get('DailyRain'))

                if not station_id:
                    continue

                date_key = timestamp.strftime('%Y-%m-%d')

                if daily_rain is not None and daily_rain >= 0:
                    station_data[station_id][date_key].append(daily_rain)

            except Exception as e:
                logger.warning("Error processing reading for trends: %s", e)
                continue

        return station_data

    def _format_range_data(
        self,
        daily_data: Dict[str, List[float]],
        start_date: datetime,
        end_date: datetime
    ) -> List[DailyRainfallDataPoint]:
        """Format daily data for a specific date range."""
        result = []
        current_date = start_date

        while current_date <= end_date:
            date_key = current_date.strftime('%Y-%m-%d')
            month = current_date.month
            day = current_date.day
            year = current_date.year

            rainfall_values = daily_data.get(date_key, [])

            if rainfall_values:
                daily_rainfall = max(rainfall_values)
                count = len(rainfall_values)
            else:
                daily_rainfall = None
                count = 0

            # Show label on 1st of each month
            if day == 1:
                label = f"{self.MONTH_NAMES[month - 1]} {year}"
                show_label = True
            else:
                label = f"{self.MONTH_NAMES[month - 1]} {day}, {year}"
                show_label = False

            result.append(DailyRainfallDataPoint(
                label=label,
                y=round(daily_rainfall, 1) if daily_rainfall is not None else None,
                date=date_key,
                month=month,
                day=day,
                count=count,
                show_label=show_label
            ))

            current_date += timedelta(days=1)

        return result

    def get_available_periods(self, weather_data: List[Dict]) -> Dict:
        """Get available period options based on data."""
        if not weather_data:
            return {'periods': [], 'years': [], 'months_by_year': {}}

        years = set()
        months_by_year = defaultdict(set)
        
        for reading in weather_data:
            timestamp = parse_weather_timestamp(
                reading.get('DateTime') or reading.get('DateTimeStamp')
            )
            if timestamp:
                years.add(timestamp.year)
                months_by_year[timestamp.year].add(timestamp.month)

        sorted_years = sorted(years, reverse=True)
        
        # Build periods list
        periods = [{'value': 'last12', 'label': 'Last 12 months'}]
        for year in sorted_years:
            periods.append({'value': str(year), 'label': str(year)})

        # Format months_by_year with month names
        formatted_months = {}
        for year, months in months_by_year.items():
            formatted_months[year] = [
                {'value': m, 'label': self.FULL_MONTH_NAMES[m-1]}
                for m in sorted(months)
            ]

        return {
            'periods': periods,
            'years': sorted_years,
            'months_by_year': formatted_months,
            'current_year': datetime.now().year
        }

    # Keep backward compatibility
    def get_yearly_rainfall_per_station(
        self,
        weather_data: List[Dict],
        sites: List[Dict],
        year: int
    ) -> Dict[str, List[DailyRainfallDataPoint]]:
        """Get daily rainfall data for an entire year, per station."""
        result = self.get_rainfall_data(weather_data, sites, year=year)
        return result.get('stations', {})

    def get_available_years(self, weather_data: List[Dict]) -> List[int]:
        """Get list of years that have data available."""
        periods = self.get_available_periods(weather_data)
        return periods.get('years', [])

    def get_yearly_statistics(
        self,
        data_points: List[DailyRainfallDataPoint]
    ) -> Dict:
        """Calculate statistics for data points."""
        valid_points = [p for p in data_points if p.y is not None]

        if not valid_points:
            return {
                'total_rainfall': 0,
                'average_daily': 0,
                'max_daily': 0,
                'rainy_days': 0,
                'days_with_data': 0
            }

        rainfall_values = [p.y for p in valid_points]
        rainy_days = sum(1 for p in valid_points if p.y > 0)

        return {
            'total_rainfall': round(sum(rainfall_values), 1),
            'average_daily': round(sum(rainfall_values) / len(rainfall_values), 2),
            'max_daily': max(rainfall_values),
            'rainy_days': rainy_days,
            'days_with_data': len(valid_points)
        }


@dataclass
class DailyWaterLevelDataPoint:
    """Data point for daily average water level trends."""
    date: str
    y: float  # Average water level in cm
    label: str
    count: int  # Number of readings used for average
    min_level: float = None
    max_level: float = None


class WaterLevelTrendsService:
    """Service for water level trends data with period/year/month filtering."""

    MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    
    FULL_MONTH_NAMES = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ]

    def __init__(self, metrics_service):
        self.metrics_service = metrics_service

    def get_water_level_data(
        self,
        weather_data: List[Dict],
        sites: List[Dict],
        period: str = None,
        year: int = None,
        month: int = None
    ) -> Dict:
        """
        Get water level data with flexible filtering.
        Returns daily AVERAGE water levels per station.
        """
        if not weather_data:
            return {'stations': {}, 'date_range': None}

        date_range = self._calculate_date_range(weather_data, period, year, month)
        if not date_range:
            return {'stations': {}, 'date_range': None}

        station_daily_data = self._group_all_by_station_and_date(weather_data)

        # Only include stations that have water level sensors
        water_level_stations = [s for s in sites if s.get('has_water_level', False)]
        
        result = {}
        for site in water_level_stations:
            station_id = site['id']
            daily_data = station_daily_data.get(station_id, {})
            formatted_data = self._format_range_data(
                daily_data, 
                date_range['start'], 
                date_range['end']
            )
            result[station_id] = {
                'name': site.get('name', station_id),
                'data': [
                    {
                        'date': dp.date,
                        'y': dp.y,
                        'label': dp.label,
                        'count': dp.count,
                        'min': dp.min_level,
                        'max': dp.max_level
                    } for dp in formatted_data
                ]
            }

        return {
            'stations': result,
            'date_range': {
                'start': date_range['start'].isoformat(),
                'end': date_range['end'].isoformat(),
                'label': date_range['label'],
                'type': date_range['type']
            },
            'period': period,
            'year': year,
            'month': month
        }

    def _calculate_date_range(
        self,
        weather_data: List[Dict],
        period: str,
        year: int,
        month: int
    ) -> Optional[Dict]:
        """Calculate the date range based on filters."""
        today = datetime.now()
        
        if period == 'last12':
            earliest = self._get_earliest_date(weather_data)
            if not earliest:
                return None
            
            end_date = today
            start_12_months_ago = today - timedelta(days=365)
            start_date = max(earliest, start_12_months_ago)
            
            return {
                'start': start_date,
                'end': end_date,
                'label': 'Last 12 months',
                'type': 'last12'
            }
        
        elif year:
            if month:
                start_date = datetime(year, month, 1)
                if month == 12:
                    end_date = datetime(year, 12, 31)
                else:
                    end_date = datetime(year, month + 1, 1) - timedelta(days=1)
                
                if end_date > today:
                    end_date = today
                
                return {
                    'start': start_date,
                    'end': end_date,
                    'label': f'{self.FULL_MONTH_NAMES[month-1]} {year}',
                    'type': 'month'
                }
            else:
                start_date = datetime(year, 1, 1)
                end_date = datetime(year, 12, 31)
                
                return {
                    'start': start_date,
                    'end': end_date,
                    'label': str(year),
                    'type': 'year'
                }
        
        current_year = today.year
        return {
            'start': datetime(current_year, 1, 1),
            'end': datetime(current_year, 12, 31),
            'label': str(current_year),
            'type': 'year'
        }

    def _get_earliest_date(self, weather_data: List[Dict]) -> Optional[datetime]:
        """Get the earliest date in the weather data."""
        earliest = None
        for reading in weather_data:
            timestamp = parse_weather_timestamp(
                reading.get('DateTime') or reading.get('DateTimeStamp')
            )
            if timestamp:
                if earliest is None or timestamp < earliest:
                    earliest = timestamp
        return earliest

    def _group_all_by_station_and_date(
        self,
        weather_data: List[Dict]
    ) -> Dict[str, Dict[str, List[float]]]:
        """Group WaterLevel readings by station and date."""
        station_data = defaultdict(lambda: defaultdict(list))

        for reading in weather_data:
            try:
                timestamp = parse_weather_timestamp(
                    reading.get('DateTime') or reading.get('DateTimeStamp')
                )
                if not timestamp:
                    continue

                station_id = reading.get('StationID')
                water_level = safe_float(reading.get('WaterLevel'))

                if not station_id:
                    continue

                date_key = timestamp.strftime('%Y-%m-%d')

                # Validate water level range
                if water_level is not None and MIN_VALID_WATER_LEVEL_CM <= water_level <= MAX_VALID_WATER_LEVEL_CM:
                    station_data[station_id][date_key].append(water_level)

            except Exception as e:
                logger.warning("Error processing water level reading: %s", e)
                continue

        return station_data

    def _format_range_data(
        self,
        daily_data: Dict[str, List[float]],
        start_date: datetime,
        end_date: datetime
    ) -> List[DailyWaterLevelDataPoint]:
        """Format daily average water level data for a specific date range."""
        result = []
        current_date = start_date

        while current_date <= end_date:
            date_key = current_date.strftime('%Y-%m-%d')
            month = current_date.month
            day = current_date.day

            water_level_values = daily_data.get(date_key, [])

            if water_level_values:
                # Calculate daily AVERAGE (not max like rainfall)
                avg_level = sum(water_level_values) / len(water_level_values)
                count = len(water_level_values)
                min_level = min(water_level_values)
                max_level = max(water_level_values)
            else:
                avg_level = None
                count = 0
                min_level = None
                max_level = None

            result.append(DailyWaterLevelDataPoint(
                date=date_key,
                y=round(avg_level, 1) if avg_level is not None else None,
                label=f'{self.MONTH_NAMES[month-1]} {day}',
                count=count,
                min_level=round(min_level, 1) if min_level is not None else None,
                max_level=round(max_level, 1) if max_level is not None else None
            ))

            current_date += timedelta(days=1)

        return result

    def get_available_periods(self, weather_data: List[Dict]) -> Dict:
        """Get available periods/years for water level data."""
        years_with_data = set()
        months_by_year = defaultdict(set)
        
        for reading in weather_data:
            # Only count readings that have water level data
            water_level = safe_float(reading.get('WaterLevel'))
            if water_level is None:
                continue
                
            timestamp = parse_weather_timestamp(
                reading.get('DateTime') or reading.get('DateTimeStamp')
            )
            if timestamp:
                years_with_data.add(timestamp.year)
                months_by_year[timestamp.year].add(timestamp.month)

        sorted_years = sorted(years_with_data, reverse=True)
        
        periods = [{'value': 'last12', 'label': 'Last 12 months'}]
        for year in sorted_years:
            periods.append({'value': str(year), 'label': str(year)})

        formatted_months = {}
        for year, months in months_by_year.items():
            formatted_months[year] = [
                {'value': m, 'label': self.FULL_MONTH_NAMES[m-1]}
                for m in sorted(months)
            ]

        return {
            'periods': periods,
            'years': sorted_years,
            'months_by_year': formatted_months,
            'current_year': datetime.now().year
        }


@dataclass
class DailyEnvironmentalDataPoint:
    """Data point for daily temperature/humidity trends with min/max/avg."""
    date: str
    y: float  # Daily average
    label: str
    count: int
    min_value: float = None
    max_value: float = None
    avg_value: float = None


class BaseEnvironmentalTrendsService:
    """Shared daily trends processor for temperature and humidity."""

    MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                   'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

    FULL_MONTH_NAMES = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ]

    field_name = None
    value_name = 'value'
    min_valid = None
    max_valid = None

    def __init__(self, metrics_service):
        self.metrics_service = metrics_service

    def get_environmental_data(
        self,
        weather_data: List[Dict],
        sites: List[Dict],
        period: str = None,
        year: int = None,
        month: int = None
    ) -> Dict:
        if not weather_data:
            return {'stations': {}, 'date_range': None}

        date_range = self._calculate_date_range(weather_data, period, year, month)
        if not date_range:
            return {'stations': {}, 'date_range': None}

        station_daily_data = self._group_all_by_station_and_date(weather_data)

        result = {}
        for site in sites:
            station_id = site['id']
            daily_data = station_daily_data.get(station_id, {})
            formatted_data = self._format_range_data(
                daily_data,
                date_range['start'],
                date_range['end']
            )
            result[station_id] = {
                'name': site.get('name', station_id),
                'data': [
                    {
                        'date': dp.date,
                        'y': dp.y,
                        'avg': dp.avg_value,
                        'label': dp.label,
                        'count': dp.count,
                        'min': dp.min_value,
                        'max': dp.max_value
                    } for dp in formatted_data
                ]
            }

        return {
            'stations': result,
            'date_range': {
                'start': date_range['start'].isoformat(),
                'end': date_range['end'].isoformat(),
                'label': date_range['label'],
                'type': date_range['type']
            },
            'period': period,
            'year': year,
            'month': month
        }

    def _calculate_date_range(
        self,
        weather_data: List[Dict],
        period: str,
        year: int,
        month: int
    ) -> Optional[Dict]:
        today = datetime.now()

        if period == 'last12':
            earliest = self._get_earliest_date(weather_data)
            if not earliest:
                return None

            end_date = today
            start_12_months_ago = today - timedelta(days=365)
            start_date = max(earliest, start_12_months_ago)

            return {
                'start': start_date,
                'end': end_date,
                'label': 'Last 12 months',
                'type': 'last12'
            }

        elif year:
            if month:
                start_date = datetime(year, month, 1)
                if month == 12:
                    end_date = datetime(year, 12, 31)
                else:
                    end_date = datetime(year, month + 1, 1) - timedelta(days=1)

                if end_date > today:
                    end_date = today

                return {
                    'start': start_date,
                    'end': end_date,
                    'label': f'{self.FULL_MONTH_NAMES[month-1]} {year}',
                    'type': 'month'
                }

            return {
                'start': datetime(year, 1, 1),
                'end': datetime(year, 12, 31),
                'label': str(year),
                'type': 'year'
            }

        current_year = today.year
        return {
            'start': datetime(current_year, 1, 1),
            'end': datetime(current_year, 12, 31),
            'label': str(current_year),
            'type': 'year'
        }

    def _get_earliest_date(self, weather_data: List[Dict]) -> Optional[datetime]:
        earliest = None
        for reading in weather_data:
            timestamp = parse_weather_timestamp(
                reading.get('DateTime') or reading.get('DateTimeStamp')
            )
            if timestamp and (earliest is None or timestamp < earliest):
                earliest = timestamp
        return earliest

    def _group_all_by_station_and_date(
        self,
        weather_data: List[Dict]
    ) -> Dict[str, Dict[str, List[float]]]:
        station_data = defaultdict(lambda: defaultdict(list))

        for reading in weather_data:
            try:
                timestamp = parse_weather_timestamp(
                    reading.get('DateTime') or reading.get('DateTimeStamp')
                )
                if not timestamp:
                    continue

                station_id = reading.get('StationID')
                value = safe_float(reading.get(self.field_name))

                if not station_id or value is None:
                    continue

                if self.min_valid is not None and value < self.min_valid:
                    continue
                if self.max_valid is not None and value > self.max_valid:
                    continue

                date_key = timestamp.strftime('%Y-%m-%d')
                station_data[station_id][date_key].append(value)

            except Exception as e:
                logger.warning("Error processing %s reading: %s", self.value_name, e)
                continue

        return station_data

    def _format_range_data(
        self,
        daily_data: Dict[str, List[float]],
        start_date: datetime,
        end_date: datetime
    ) -> List[DailyEnvironmentalDataPoint]:
        result = []
        current_date = start_date

        while current_date <= end_date:
            date_key = current_date.strftime('%Y-%m-%d')
            month = current_date.month
            day = current_date.day

            values = daily_data.get(date_key, [])

            if values:
                avg_value = sum(values) / len(values)
                min_value = min(values)
                max_value = max(values)
                count = len(values)
            else:
                avg_value = None
                min_value = None
                max_value = None
                count = 0

            result.append(DailyEnvironmentalDataPoint(
                date=date_key,
                y=round(avg_value, 1) if avg_value is not None else None,
                label=f'{self.MONTH_NAMES[month-1]} {day}',
                count=count,
                min_value=round(min_value, 1) if min_value is not None else None,
                max_value=round(max_value, 1) if max_value is not None else None,
                avg_value=round(avg_value, 1) if avg_value is not None else None
            ))

            current_date += timedelta(days=1)

        return result

    def get_available_periods(self, weather_data: List[Dict]) -> Dict:
        years_with_data = set()
        months_by_year = defaultdict(set)

        for reading in weather_data:
            value = safe_float(reading.get(self.field_name))
            if value is None:
                continue

            if self.min_valid is not None and value < self.min_valid:
                continue
            if self.max_valid is not None and value > self.max_valid:
                continue

            timestamp = parse_weather_timestamp(
                reading.get('DateTime') or reading.get('DateTimeStamp')
            )
            if timestamp:
                years_with_data.add(timestamp.year)
                months_by_year[timestamp.year].add(timestamp.month)

        sorted_years = sorted(years_with_data, reverse=True)

        periods = [{'value': 'last12', 'label': 'Last 12 months'}]
        for year in sorted_years:
            periods.append({'value': str(year), 'label': str(year)})

        formatted_months = {}
        for year, months in months_by_year.items():
            formatted_months[year] = [
                {'value': m, 'label': self.FULL_MONTH_NAMES[m-1]}
                for m in sorted(months)
            ]

        return {
            'periods': periods,
            'years': sorted_years,
            'months_by_year': formatted_months,
            'current_year': datetime.now().year
        }


class TemperatureTrendsService(BaseEnvironmentalTrendsService):
    field_name = 'Temperature'
    value_name = 'temperature'
    min_valid = MIN_VALID_TEMPERATURE_C
    max_valid = MAX_VALID_TEMPERATURE_C

    def get_temperature_data(
        self,
        weather_data: List[Dict],
        sites: List[Dict],
        period: str = None,
        year: int = None,
        month: int = None
    ) -> Dict:
        return self.get_environmental_data(weather_data, sites, period, year, month)


class HumidityTrendsService(BaseEnvironmentalTrendsService):
    field_name = 'Humidity'
    value_name = 'humidity'
    min_valid = MIN_VALID_HUMIDITY_PERCENT
    max_valid = MAX_VALID_HUMIDITY_PERCENT

    def get_humidity_data(
        self,
        weather_data: List[Dict],
        sites: List[Dict],
        period: str = None,
        year: int = None,
        month: int = None
    ) -> Dict:
        return self.get_environmental_data(weather_data, sites, period, year, month)