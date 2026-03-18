"""Weather Service - Handles API calls with caching and graceful fallback."""

import requests
import csv
import logging
import threading
from datetime import datetime, timedelta
from typing import Dict, List, Optional, Any

from cache_persistence import PersistentCache
from config import SiteConfig, UIColorSystem, AlertLevelConfig, WeatherThresholds
from utils.helpers import parse_weather_timestamp, get_timestamp_from_reading

logger = logging.getLogger(__name__)


class WeatherCache:
    
    def __init__(self, ttl_seconds: int = 60, stale_ttl_seconds: int = 300):
        self._data: Optional[List[Dict]] = None
        self._last_fetch: Optional[datetime] = None
        self._last_success: Optional[datetime] = None
        self._ttl = timedelta(seconds=ttl_seconds)
        self._stale_ttl = timedelta(seconds=stale_ttl_seconds)
        self._lock = threading.Lock()
        self._fetch_errors = 0
        self._max_errors_before_backoff = 3
        self._backoff_until: Optional[datetime] = None
    
    def get(self) -> tuple[Optional[List[Dict]], bool, Optional[datetime]]:
        with self._lock:
            if self._data is None:
                return None, False, None
            
            now = datetime.now()
            is_fresh = self._last_fetch and (now - self._last_fetch) < self._ttl
            
            return self._data, is_fresh, self._last_success
    
    def set(self, data: List[Dict], success: bool = True):
        with self._lock:
            now = datetime.now()
            self._data = data
            self._last_fetch = now
            
            if success and data:
                self._last_success = now
                self._fetch_errors = 0
                self._backoff_until = None
    
    def record_error(self):
        with self._lock:
            self._fetch_errors += 1
            if self._fetch_errors >= self._max_errors_before_backoff:
                # Max 60s backoff for disaster monitoring
                backoff_seconds = min(30 * (2 ** (self._fetch_errors - self._max_errors_before_backoff)), 60)
                self._backoff_until = datetime.now() + timedelta(seconds=backoff_seconds)
                logger.warning(f"API errors exceeded threshold. Backing off for {backoff_seconds}s")
    
    def reset_backoff(self):
        """Manually clear backoff state - use when API is confirmed working."""
        with self._lock:
            self._fetch_errors = 0
            self._backoff_until = None
            logger.info("Backoff state reset - will fetch on next request")
    
    def should_fetch(self) -> bool:
        with self._lock:
            now = datetime.now()
            
            if self._backoff_until and now < self._backoff_until:
                return False
            
            if self._last_fetch is None:
                return True
            
            return (now - self._last_fetch) >= self._ttl
    
    def get_stale_data(self) -> Optional[List[Dict]]:
        with self._lock:
            if self._data is None:
                return None
            
            now = datetime.now()
            if self._last_success and (now - self._last_success) < self._stale_ttl:
                return self._data
            
            return self._data
    
    def get_cache_status(self) -> Dict:
        with self._lock:
            now = datetime.now()
            age_seconds = (now - self._last_fetch).total_seconds() if self._last_fetch else None
            
            return {
                'has_data': self._data is not None,
                'data_count': len(self._data) if self._data else 0,
                'age_seconds': age_seconds,
                'last_success': self._last_success.isoformat() if self._last_success else None,
                'fetch_errors': self._fetch_errors,
                'in_backoff': self._backoff_until and now < self._backoff_until
            }


class WeatherService:
    
    _cache = WeatherCache(ttl_seconds=60, stale_ttl_seconds=300)
    
    # Memory protection: limit records to prevent MemoryError
    MAX_RECORDS_TOTAL = 15000
    MAX_RECORDS_PER_STATION = 3000
    
    def __init__(self, api_url: str, timeout: int = 10):
        self.api_url = api_url
        self.timeout = timeout
        self.persistent_cache = PersistentCache()
        
        # Build station ID map from config (supports legacy ID mapping if needed)
        self._station_id_map = self._build_station_id_map()
        
        persisted_data = self.persistent_cache.load()
        if persisted_data:
            logger.info(f"Restored {len(persisted_data)} records from persistent cache")
            self._cache.set(persisted_data, success=False)
        
        logger.info(f"WeatherService initialized with API: {api_url}")
    
    def _build_station_id_map(self) -> Dict[str, List[str]]:
        """Build station ID mapping from config."""
        return {
            site['id']: site.get('station_ids', [site['id']])
            for site in SiteConfig.SITES
        }
    
    def _get_api_to_canonical_map(self) -> Dict[str, str]:
        """Build reverse map: API station ID -> canonical station ID."""
        api_to_canonical = {}
        for canonical_id, possible_ids in self._station_id_map.items():
            for api_id in possible_ids:
                api_to_canonical[api_id] = canonical_id
        return api_to_canonical
    
    def _sanitize_reading(self, reading: Dict[str, Any]) -> Dict[str, Any]:
        float_fields = [
            'WaterLevel', 'HourlyRain', 'WindSpeed', 'Temperature', 
            'Humidity', 'Pressure', 'HeatIndex', 'DailyRain'
        ]
        critical_fields = ['WaterLevel', 'HourlyRain']
        
        for field in float_fields:
            if field in reading and reading[field] is not None:
                try:
                    reading[field] = float(reading[field])
                except (ValueError, TypeError):
                    if field in critical_fields:
                        reading[field] = None
                    else:
                        reading[field] = 0.0
        
        if 'WindDirection' in reading:
            wind_dir = reading['WindDirection']
            if wind_dir is not None:
                reading['WindDirection'] = str(wind_dir).strip().upper()
        
        return reading
    
    def _fetch_from_api(self) -> Optional[List[Dict[str, Any]]]:
        """Fetch weather data with memory-efficient streaming."""
        try:
            logger.debug(f"Fetching weather data from {self.api_url}")
            
            response = requests.get(
                self.api_url, 
                timeout=self.timeout,
                stream=True  # Critical: enables streaming
            )
            response.raise_for_status()
            response.encoding = 'utf-8'
            
            # Process CSV line by line to avoid loading entire file into memory
            data_by_station = {}  # {station_id: [readings]}
            total_records = 0
            skipped_count = 0
            
            # Use iter_lines for memory-efficient line-by-line processing
            lines_iterator = response.iter_lines(decode_unicode=True)
            
            # Get header line
            try:
                header_line = next(lines_iterator)
                if not header_line:
                    logger.error("Empty CSV response")
                    return None
                headers = next(csv.reader([header_line]))
            except StopIteration:
                logger.error("CSV has no header")
                return None
            
            # Process data lines
            for line in lines_iterator:
                if not line or not line.strip():
                    continue
                    
                # Hard cap to prevent memory issues
                if total_records >= self.MAX_RECORDS_TOTAL:
                    logger.info(f"Reached max records limit ({self.MAX_RECORDS_TOTAL})")
                    break
                
                try:
                    # Parse single CSV row
                    row_values = next(csv.reader([line]))
                    if len(row_values) != len(headers):
                        skipped_count += 1
                        continue
                    
                    row = dict(zip(headers, row_values))
                    station_id = row.get('StationID', '')
                    
                    if not station_id:
                        skipped_count += 1
                        continue
                    
                    # Initialize station list if needed
                    if station_id not in data_by_station:
                        data_by_station[station_id] = []
                    
                    # Only keep recent records per station
                    if len(data_by_station[station_id]) < self.MAX_RECORDS_PER_STATION:
                        data_by_station[station_id].append(row)
                        total_records += 1
                        
                except Exception as e:
                    skipped_count += 1
                    continue
            
            # Close the response to free memory
            response.close()
            
            if not data_by_station:
                logger.error("CSV parsed but no valid data rows")
                return None
            
            # Flatten and sanitize
            data = []
            for station_readings in data_by_station.values():
                for reading in station_readings:
                    data.append(self._sanitize_reading(reading))
            
            logger.info(f"Fetched {len(data)} readings from {len(data_by_station)} stations (skipped {skipped_count} malformed rows)")
            return data
            
        except requests.exceptions.Timeout:
            logger.warning(f"API request timed out after {self.timeout}s")
            return None
        except requests.exceptions.RequestException as e:
            logger.warning(f"API request failed: {str(e)}")
            return None
        except csv.Error as e:
            logger.warning(f"Invalid CSV response: {str(e)}")
            return None
        except MemoryError:
            logger.error("MemoryError while fetching data - API response too large")
            return None
        except Exception as e:
            logger.error(f"Unexpected error: {str(e)}", exc_info=True)
            return None
    
    def fetch_weather_data(self, force_refresh: bool = False) -> List[Dict[str, Any]]:
        cached_data, is_fresh, last_success = self._cache.get()
        
        if is_fresh and not force_refresh:
            logger.debug("Returning fresh cached data")
            return cached_data
        
        if not self._cache.should_fetch() and not force_refresh:
            if cached_data:
                logger.debug("In backoff period, returning cached data")
                return cached_data
        
        fresh_data = self._fetch_from_api()
        
        if fresh_data:
            self._cache.set(fresh_data, success=True)
            self.persistent_cache.save(fresh_data)
            return fresh_data
        
        self._cache.record_error()
        
        stale_data = self._cache.get_stale_data()
        if stale_data:
            logger.info("API failed, returning stale cached data")
            return stale_data
        
        logger.error("No cached data available and API failed")
        return []
    
    def get_cache_status(self) -> Dict:
        return self._cache.get_cache_status()
    
    def reset_backoff(self):
        """Reset backoff state - call when API is confirmed working."""
        self._cache.reset_backoff()
    
    def get_persistent_cache_info(self) -> Dict:
        return self.persistent_cache.get_info()
    
    def get_latest_per_station(self, weather_data: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
        """Get the most recent reading for each station."""
        if not weather_data:
            return {}
        
        stations = {}
        api_to_canonical = self._get_api_to_canonical_map()
        
        # Single pass through data - only keep latest per station
        for reading in weather_data:
            api_station_id = reading.get('StationID')
            if not api_station_id or api_station_id not in api_to_canonical:
                continue
            
            canonical_id = api_to_canonical[api_station_id]
            timestamp = get_timestamp_from_reading(reading)
            
            if canonical_id not in stations:
                stations[canonical_id] = reading
            else:
                existing_ts = get_timestamp_from_reading(stations[canonical_id])
                if timestamp and existing_ts and timestamp > existing_ts:
                    stations[canonical_id] = reading
        
        return stations
    
    def filter_by_station(self, weather_data: List[Dict], station_id: str) -> List[Dict]:
        filtered = [r for r in weather_data if r.get('StationID') == station_id]
        
        try:
            sorted_data = sorted(
                filtered,
                key=lambda x: parse_weather_timestamp(
                    x.get('Timestamp') or x.get('DateTimeStamp') or x.get('DateTime')
                ) or datetime.min,
                reverse=True
            )
            return sorted_data
        except (KeyError, ValueError, AttributeError):
            return filtered
    
    def get_latest_reading(self, weather_data: List[Dict]) -> Optional[Dict]:
        if not weather_data:
            return None
        
        try:
            latest = max(
                weather_data,
                key=lambda x: parse_weather_timestamp(
                    x.get('Timestamp') or x.get('DateTimeStamp') or x.get('DateTime')
                ) or datetime.min
            )
            return latest
        except (ValueError, AttributeError):
            return weather_data[0] if weather_data else None
    
    def get_mdrrmo_latest_reading(self, weather_data: List[Dict]) -> Optional[Dict]:
        """Get latest reading from MDRRMO station (St4)."""
        mdrrmo_data = self.filter_by_station(weather_data, 'St4')
        return self.get_latest_reading(mdrrmo_data) if mdrrmo_data else None
    
    def get_24hour_average(self, weather_data: List[Dict]) -> Dict[str, Optional[float]]:
        if not weather_data:
            return {
                'avg_temperature': None,
                'avg_humidity': None,
                'avg_pressure': None,
                'avg_wind_speed': None,
                'total_rainfall': None
            }
        
        temps, humidity, pressure, wind_speed, rainfall = [], [], [], [], []
        
        for reading in weather_data[:24]:
            if reading.get('Temperature') is not None:
                temps.append(reading['Temperature'])
            if reading.get('Humidity') is not None:
                humidity.append(reading['Humidity'])
            if reading.get('Pressure') is not None:
                pressure.append(reading['Pressure'])
            if reading.get('WindSpeed') is not None:
                wind_speed.append(reading['WindSpeed'])
            if reading.get('HourlyRain') is not None:
                rainfall.append(reading['HourlyRain'])
        
        return {
            'avg_temperature': sum(temps) / len(temps) if temps else None,
            'avg_humidity': sum(humidity) / len(humidity) if humidity else None,
            'avg_pressure': sum(pressure) / len(pressure) if pressure else None,
            'avg_wind_speed': sum(wind_speed) / len(wind_speed) if wind_speed else None,
            'total_rainfall': sum(rainfall) if rainfall else None
        }

    def generate_weather_alert(self, latest_reading: Optional[Dict[str, Any]]) -> Dict[str, str]:
        if not latest_reading:
            return {
                'level': 'no-data',
                'message': 'Connecting to weather sensors...',
                'color': UIColorSystem.ALERT_NORMAL
            }
        
        try:
            rainfall = float(latest_reading.get('HourlyRain') or 0)
            water_level = float(latest_reading.get('WaterLevel') or 0)
        except (ValueError, TypeError):
            rainfall, water_level = 0.0, 0.0
        
        if water_level >= WeatherThresholds.WATER_CRITICAL:
            config = AlertLevelConfig.get_config('critical')
            return {
                'level': 'critical',
                'message': f'CRITICAL: Water level at {water_level:.1f}cm - Immediate evacuation required',
                'color': config['color']
            }
        elif water_level >= WeatherThresholds.WATER_WARNING:
            config = AlertLevelConfig.get_config('warning')
            return {
                'level': 'warning',
                'message': f'WARNING: Water level at {water_level:.1f}cm - Prepare for evacuation',
                'color': config['color']
            }
        elif water_level >= WeatherThresholds.WATER_ALERT:
            config = AlertLevelConfig.get_config('alert')
            return {
                'level': 'alert',
                'message': f'ALERT: Water level at {water_level:.1f}cm - Monitor closely',
                'color': config['color']
            }
        elif water_level >= WeatherThresholds.WATER_ADVISORY:
            config = AlertLevelConfig.get_config('advisory')
            return {
                'level': 'advisory',
                'message': f'ADVISORY: Water level at {water_level:.1f}cm - Stay informed',
                'color': config['color']
            }
        
        if rainfall >= WeatherThresholds.RAINFALL_HEAVY:
            config = AlertLevelConfig.get_config('warning')
            return {
                'level': 'warning',
                'message': f'Heavy rainfall detected: {rainfall:.1f}mm/hr - Monitor water levels',
                'color': config['color']
            }
        elif rainfall >= WeatherThresholds.RAINFALL_MODERATE:
            config = AlertLevelConfig.get_config('advisory')
            return {
                'level': 'advisory',
                'message': f'Moderate rainfall: {rainfall:.1f}mm/hr - Stay alert',
                'color': config['color']
            }
        
        config = AlertLevelConfig.get_config('normal')
        return {
            'level': 'normal',
            'message': 'Weather conditions normal - All systems operational',
            'color': config['color']
        }