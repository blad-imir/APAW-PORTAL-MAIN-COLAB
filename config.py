import os


# =============================================================================
# FOUNDATION - Color System (everything else references this)
# =============================================================================

class UIColorSystem:

    # Brand Colors
    PRIMARY = '#409ac7'
    SECONDARY = '#64748b'
    
    # Text Colors
    TEXT_PRIMARY = '#1a202c'
    TEXT_SECONDARY = '#6c757d'
    TEXT_MUTED = '#9ca3af'
    
    # Background Colors
    WHITE = '#ffffff'
    BLACK = '#0c0c0d'
    LIGHT_BLACK = '#141516'
    BACKGROUND_LIGHT = '#f8fafc'
    BACKGROUND_DARK = '#1a202c'
    
    # Gray Scale
    LIGHTEST_GRAY = '#eaeaec'
    LIGHT_GRAY = '#92949f'
    DARK_GRAY = '#45474f'
    
    # Border Colors
    BORDER_LIGHT = '#e2e8f0'
    BORDER_MEDIUM = '#cbd5e0'
    
    # Semantic Colors
    SUCCESS = '#10b981'
    WARNING = '#f59e0b'
    ERROR = '#ef4444'
    INFO = '#3b82f6'
    
    # Alert Level Colors (water level alerts)
    PRIMARY_LIGHT = '#eff3f9'
    ALERT_NORMAL = PRIMARY
    ALERT_ADVISORY = '#0ea5e9'
    ALERT_ALERT = '#ffbe0b'
    ALERT_WARNING = '#fb8500'
    ALERT_CRITICAL = '#dc2626'
    
    # Flood Level Colors (distinct from general alerts for visual clarity)
    FLOOD_NORMAL = SUCCESS
    FLOOD_ADVISORY = '#0ea5e9'
    FLOOD_ALERT = '#eab308'
    FLOOD_WARNING = '#fb8500'
    FLOOD_CRITICAL = '#dc2626'
    
    # Station Colors (unique per station for chart differentiation)
    STATION_COLORS = {
        'St1': PRIMARY,
        'St2': '#8a60ec',
        'St3': '#ec4899',
        'St4': "#FABC2B",
        'St5': '#26E4EE',
    }


# =============================================================================
# CORE BUSINESS LOGIC - Thresholds (life-safety critical)
# =============================================================================

class WeatherThresholds:
    """
    Weather monitoring thresholds for flood warning system.
    
    RAINFALL thresholds: PAGASA Official Classification
    Source: https://www.pagasa.dost.gov.ph/information/weather-terminologies
    
    - No Rain: < 0.5 mm/hr (scattered drops, don't wet surface)
    - Light Rainfall: 0.5 - 2.5 mm/hr (puddles form slowly)
    - Moderate Rainfall: 2.5 - 7.5 mm/hr (puddles form rapidly)
    - Heavy Rainfall: > 7.5 mm/hr (falls in sheets, roaring on roofs)
    
    WATER LEVEL thresholds: Site-specific calibration for Balatan rivers
    """
    
    # PAGASA Rainfall Classification (mm/hr)
    RAINFALL_LIGHT = 0.5
    RAINFALL_MODERATE = 2.5
    RAINFALL_HEAVY = 7.5
    
    # Water Level Thresholds (cm) - calibrated for Balatan monitoring sites
    WATER_ADVISORY = 180.0
    WATER_ALERT = 250.0
    WATER_WARNING = 400.0
    WATER_CRITICAL = 600.0


class HeatIndexConfig:
    """
    PAGASA Heat Index Classification
    Source: https://www.pagasa.dost.gov.ph/information/heat-index
    
    Heat Index = "feels like" temperature accounting for humidity.
    Formula uses temperature (°C) and relative humidity (%).
    
    PAGASA Classification:
    - 27-32°C: Caution (fatigue possible with prolonged exposure)
    - 33-41°C: Extreme Caution (heat cramps/exhaustion possible)
    - 42-51°C: Danger (heat cramps/exhaustion likely, heat stroke possible)
    - °C: Extreme Danger (heat stroke highly likely)
    """
    
    # Thresholds where each category STARTS (°C)
    CAUTION = 27.0
    EXTREME_CAUTION = 33.0
    DANGER = 42.0
    EXTREME_DANGER = 52.0
    
    LEVELS = {
        'extreme_danger': {
            'level': 'Extreme Danger',
            'threshold': 52.0,
            'icon': 'fa-thermometer-full',
            'color': UIColorSystem.ALERT_CRITICAL,
            'description': '°C - Heat stroke highly likely',
            'css_class': 'heat-extreme-danger'
        },
        'danger': {
            'level': 'Danger',
            'threshold': 42.0,
            'icon': 'fa-thermometer-three-quarters',
            'color': UIColorSystem.ALERT_WARNING,
            'description': '42-51°C - Heat stroke possible',
            'css_class': 'heat-danger'
        },
        'extreme_caution': {
            'level': 'Extreme Caution',
            'threshold': 33.0,
            'icon': 'fa-thermometer-half',
            'color': UIColorSystem.ALERT_ALERT,
            'description': '33-41°C - Heat exhaustion possible',
            'css_class': 'heat-extreme-caution'
        },
        'caution': {
            'level': 'Caution',
            'threshold': 27.0,
            'icon': 'fa-thermometer-quarter',
            'color': UIColorSystem.ALERT_ADVISORY,
            'description': '27-32°C - Fatigue possible',
            'css_class': 'heat-caution'
        },
        'normal': {
            'level': 'Normal',
            'threshold': 0,
            'icon': 'fa-thermometer-empty',
            'color': UIColorSystem.ALERT_NORMAL,
            'description': '<27°C - Comfortable',
            'css_class': 'heat-normal'
        }
    }
    
    @classmethod
    def calculate_heat_index(cls, temp_c: float, humidity: float) -> float:
        """
        Calculate heat index using simplified Rothfusz regression.
        Only valid for temp °C and humidity 40%.
        Below these thresholds, heat index actual temperature.
        """
        if temp_c is None or humidity is None:
            return None
        if temp_c < 27 or humidity < 40:
            return temp_c
        
        # Rothfusz regression (converted to Celsius)
        t = temp_c * 9/5 + 32
        r = humidity
        
        hi = (-42.379 + 2.04901523*t + 10.14333127*r 
              - 0.22475541*t*r - 0.00683783*t*t 
              - 0.05481717*r*r + 0.00122874*t*t*r 
              + 0.00085282*t*r*r - 0.00000199*t*t*r*r)
        
        return round((hi - 32) * 5/9, 1)
    
    @classmethod
    def get_level(cls, heat_index: float) -> dict:
        """Get the heat index level config for a given value."""
        if heat_index is None:
            return cls.LEVELS['normal']
        if heat_index >= cls.EXTREME_DANGER:
            return cls.LEVELS['extreme_danger']
        elif heat_index >= cls.DANGER:
            return cls.LEVELS['danger']
        elif heat_index >= cls.EXTREME_CAUTION:
            return cls.LEVELS['extreme_caution']
        elif heat_index >= cls.CAUTION:
            return cls.LEVELS['caution']
        return cls.LEVELS['normal']
    
    @classmethod
    def get_js_config(cls) -> dict:
        """Export for JavaScript heat index display."""
        return {
            'thresholds': {
                'caution': cls.CAUTION,
                'extremeCaution': cls.EXTREME_CAUTION,
                'danger': cls.DANGER,
                'extremeDanger': cls.EXTREME_DANGER
            },
            'levels': cls.LEVELS
        }


class DataFreshnessConfig:
    """
    Thresholds for determining sensor/data status.
    Critical for showing accurate "ONLINE/OFFLINE" status to emergency responders.
    
    Mesh network sends data every 15 minutes under normal conditions.
    These thresholds account for network delays and retry cycles.
    """
    
    # Minutes since last data point
    FRESH_THRESHOLD = 20          # 20 min = fresh/online (buffer for 15-min cycle)
    STALE_THRESHOLD = 45          # 20-45 min = stale (show warning, data may be old)
    OFFLINE_THRESHOLD = 60        # >60 min = offline (sensor or network failure)
    
    # For display purposes
    STATUS_LEVELS = {
        'online': {
            'status': 'Online',
            'icon': 'fa-check-circle',
            'color': UIColorSystem.SUCCESS,
            'css_class': 'status-online'
        },
        'stale': {
            'status': 'Delayed',
            'icon': 'fa-clock',
            'color': UIColorSystem.WARNING,
            'css_class': 'status-stale'
        },
        'offline': {
            'status': 'Offline',
            'icon': 'fa-exclamation-circle',
            'color': UIColorSystem.ERROR,
            'css_class': 'status-offline'
        }
    }
    
    @classmethod
    def get_status(cls, minutes_since_update: float) -> dict:
        """Get status config based on data age in minutes."""
        if minutes_since_update is None:
            return cls.STATUS_LEVELS['offline']
        if minutes_since_update <= cls.FRESH_THRESHOLD:
            return cls.STATUS_LEVELS['online']
        elif minutes_since_update <= cls.STALE_THRESHOLD:
            return cls.STATUS_LEVELS['stale']
        return cls.STATUS_LEVELS['offline']
    
    @classmethod
    def get_js_config(cls) -> dict:
        return {
            'freshThreshold': cls.FRESH_THRESHOLD,
            'staleThreshold': cls.STALE_THRESHOLD,
            'offlineThreshold': cls.OFFLINE_THRESHOLD,
            'statusLevels': cls.STATUS_LEVELS
        }


# =============================================================================
# ALERT SYSTEM - Level definitions and classifications
# =============================================================================

class AlertLevelConfig:
    """Alert level definitions for water level monitoring."""
    
    LEVELS = {
        'critical': {
            'level': 'Critical',
            'icon': 'fa-exclamation-triangle',
            'color': UIColorSystem.ALERT_CRITICAL,
            'description': 'Immediate evacuation required',
            'css_class': 'alert-critical'
        },
        'warning': {
            'level': 'Warning',
            'icon': 'fa-exclamation-circle',
            'color': UIColorSystem.ALERT_WARNING,
            'description': 'Prepare for evacuation',
            'css_class': 'alert-warning'
        },
        'alert': {
            'level': 'Alert',
            'icon': 'fa-bolt',
            'color': UIColorSystem.ALERT_ALERT,
            'description': 'Monitor situation closely',
            'css_class': 'alert-alert'
        },
        'advisory': {
            'level': 'Advisory',
            'icon': 'fa-info-circle',
            'color': UIColorSystem.ALERT_ADVISORY,
            'description': 'Stay informed',
            'css_class': 'alert-advisory'
        },
        'none': {
            'level': 'None',
            'icon': 'fa-check-circle',
            'color': UIColorSystem.PRIMARY,
            'description': 'No active alerts',
            'css_class': 'alert-none'
        },
        'normal': {
            'level': 'Normal',
            'icon': 'fa-check-circle',
            'color': UIColorSystem.ALERT_NORMAL,
            'description': 'All systems normal',
            'css_class': 'alert-normal'
        }
    }

    @classmethod
    def get_config(cls, alert_level: str) -> dict:
        return cls.LEVELS.get(alert_level, cls.LEVELS['none'])


class RainfallForecastConfig:
    """
    PAGASA Official Rainfall Classification
    Source: https://www.pagasa.dost.gov.ph/information/weather-terminologies
    """
    
    LEVELS = {
        'heavy': {
            'level': 'Heavy',
            'icon': 'fa-cloud-showers-heavy',
            'color': UIColorSystem.ALERT_CRITICAL,
            'description': '> 7.5 mm/hr - Falls in sheets, roaring on roofs'
        },
        'moderate': {
            'level': 'Moderate',
            'icon': 'fa-cloud-rain',
            'color': UIColorSystem.ALERT_WARNING,
            'description': '2.5 - 7.5 mm/hr - Puddles form rapidly'
        },
        'light': {
            'level': 'Light',
            'icon': 'fa-cloud-sun-rain',
            'color': UIColorSystem.ALERT_ADVISORY,
            'description': '0.5 - 2.5 mm/hr - Puddles form slowly'
        },
        'none': {
            'level': 'No Rain',
            'icon': 'fa-sun',
            'color': UIColorSystem.ALERT_NORMAL,
            'description': '< 0.5 mm/hr - Clear conditions'
        },
        'no_data': {
            'level': 'No Data',
            'icon': 'fa-question-circle',
            'color': UIColorSystem.TEXT_MUTED,
            'description': 'Weather data unavailable'
        }
    }

    @classmethod
    def get_config(cls, rainfall_level: str) -> dict:
        return cls.LEVELS.get(rainfall_level, cls.LEVELS['no_data'])
    
    @classmethod
    def get_level_for_value(cls, rainfall_mm: float) -> dict:
        """Get rainfall level config based on mm/hr value."""
        if rainfall_mm is None:
            return cls.LEVELS['no_data']
        if rainfall_mm >= WeatherThresholds.RAINFALL_HEAVY:
            return cls.LEVELS['heavy']
        elif rainfall_mm >= WeatherThresholds.RAINFALL_MODERATE:
            return cls.LEVELS['moderate']
        elif rainfall_mm >= WeatherThresholds.RAINFALL_LIGHT:
            return cls.LEVELS['light']
        return cls.LEVELS['none']


class WeatherIconConfig:
    """Weather icon configuration matching actual forecast-icons PNG files."""
    
    # Night hours: 6 PM (18:00) to 6 AM (06:00)
    NIGHT_START = 18
    NIGHT_END = 6
    
    @staticmethod
    def get_icon_for_condition(is_day: bool, rainfall: float) -> str:
        """
        Get weather icon filename based on time of day and rainfall.
        Uses PAGASA rainfall classification thresholds.
        """
        if rainfall is None:
            rainfall = 0
            
        if rainfall >= WeatherThresholds.RAINFALL_HEAVY:
            return 'day-heavy-rain.png' if is_day else 'night-heavy-rain.png'
        elif rainfall >= WeatherThresholds.RAINFALL_MODERATE:
            return 'day-moderate-rain.png' if is_day else 'night-moderate-rain.png'
        elif rainfall >= WeatherThresholds.RAINFALL_LIGHT:
            return 'light-rain.png' if is_day else 'night-light-rain.png'
        else:
            return 'sunny2.png' if is_day else 'night-clear.png'
    
    @classmethod
    def get_js_config(cls):
        """Get icon configuration for JavaScript."""
        return {
            'icons': {
                'day_clear': 'sunny2.png',
                'night_clear': 'night-clear.png',
                'day_light_rain': 'light-rain.png',
                'night_light_rain': 'night-light-rain.png',
                'day_moderate_rain': 'day-moderate-rain.png',
                'night_moderate_rain': 'night-moderate-rain.png',
                'day_heavy_rain': 'day-heavy-rain.png',
                'night_heavy_rain': 'night-heavy-rain.png'
            },
            'nightHours': {
                'start': cls.NIGHT_START,
                'end': cls.NIGHT_END
            }
        }


# =============================================================================
# STATION DATA - Site definitions and metadata
# =============================================================================

class SiteConfig:
    """
    Weather station locations and metadata.
    Single source of truth for all station configuration.
    
    Used by:
    - map.js (via window.APP_CONFIG.stations)
    - Charts (via Flask template context)
    - API routes (site filtering)
    """
    
    # Map default center point (Balatan, Camarines Sur)
    # Center moved south so MDRRMO (southernmost) is visible above legend bar
    MAP_CENTER = {'lat': 13.332, 'lng': 123.250}
    MAP_ZOOM = 13
    
    # Stations without specific sensors (for conditional UI display)
    STATIONS_WITHOUT_WATER_LEVEL = ['St4']
    STATIONS_WITHOUT_WIND_SENSOR = ['St1', 'St2', 'St3']
   
    # TEMPORARY WATER LEVEL THRESHOLDS - PLACEHOLDER VALUES
   
    WATER_LEVEL_THRESHOLDS = {
        'St1': {  # Binudegahan River - [PLACEHOLDER - awaiting MDRRMO calibration]
            'advisory': 150.0,
            'alert': 200.0,
            'warning': 300.0,
            'critical': 400.0
        },
        'St2': {  # Mang-it Creek - [PLACEHOLDER - awaiting MDRRMO calibration]
            'advisory': 120.0,
            'alert': 180.0,
            'warning': 250.0,
            'critical': 350.0
        },
        'St3': {  # Laganac River - [PLACEHOLDER - awaiting MDRRMO calibration]
            'advisory': 180.0,
            'alert': 250.0,
            'warning': 350.0,
            'critical': 450.0
        },
        'St5': {  # Luluasan Stream - [PLACEHOLDER - awaiting MDRRMO calibration]
            'advisory': 100.0,
            'alert': 150.0,
            'warning': 220.0,
            'critical': 300.0
        }
    }
    
    SITES = [
        {
            'id': 'St1',
            'name': 'Binudegahan Station',
            'label': 'Binudegahan',
            'label_direction': 'right',
            'location': {'lat': 13.3483, 'lng': 123.2609},
            'elevation': 14.7,
            'color': UIColorSystem.STATION_COLORS['St1'],
            'station_ids': ['St1'],
            'active': True,
            'has_water_level': True,
            'has_wind_sensor': False
        },
        {
            'id': 'St2',
            'name': 'Mang-it Station',
            'label': 'Mang-it',
            'label_direction': 'left',
            'location': {'lat': 13.3464, 'lng': 123.2517},
            'elevation': 10.5,
            'color': UIColorSystem.STATION_COLORS['St2'],
            'station_ids': ['St2'],
            'active': True,
            'has_water_level': True,
            'has_wind_sensor': False
        },
        {
            'id': 'St3',
            'name': 'Laganac Station',
            'label': 'Laganac',
            'label_direction': 'right',
            'location': {'lat': 13.3296, 'lng': 123.2481},
            'elevation': 18.1,
            'color': UIColorSystem.STATION_COLORS['St3'],
            'station_ids': ['St3'],
            'active': True,
            'has_water_level': True,
            'has_wind_sensor': False
        },
        {
            'id': 'St4',
            'name': 'MDRRMO Station',
            'label': 'MDRRMO Weather Station',
            'label_direction': 'right',
            'location': {'lat': 13.31639, 'lng': 123.24003},
            'elevation': 15.2,
            'color': UIColorSystem.STATION_COLORS['St4'],
            'station_ids': ['St4'],
            'active': True,
            'has_water_level': False,
            'has_wind_sensor': True
        },
        {
            'id': 'St5',
            'name': 'Luluasan Station',
            'label': 'Luluasan',
            'label_direction': 'left',
            'location': {'lat': 13.3235, 'lng': 123.2344},
            'elevation': 12.8,
            'color': UIColorSystem.STATION_COLORS['St5'],
            'station_ids': ['St5'],
            'active': True,
            'has_water_level': True,
            'has_wind_sensor': True
        }
    ]
    
    @classmethod
    def get_site_by_id(cls, site_id: str) -> dict:
        return next((s for s in cls.SITES if s['id'] == site_id), None)
    
    @classmethod
    def get_active_sites(cls) -> list:
        return [s for s in cls.SITES if s.get('active', True)]
    
    @classmethod
    def get_site_ids(cls) -> list:
        return [s['id'] for s in cls.SITES]
    
    @classmethod
    def has_water_level_sensor(cls, station_id: str) -> bool:
        """Check if a station has a water level sensor."""
        return station_id not in cls.STATIONS_WITHOUT_WATER_LEVEL
    
    @classmethod
    def has_wind_sensor(cls, station_id: str) -> bool:
        """Check if a station has a wind sensor."""
        return station_id not in cls.STATIONS_WITHOUT_WIND_SENSOR
    
    @classmethod
    def get_stations_with_water_level(cls) -> list:
        """Get list of stations that have water level sensors."""
        return [s for s in cls.SITES if s.get('has_water_level', False)]
    
    @classmethod
    def get_stations_with_wind_sensor(cls) -> list:
        """Get list of stations that have wind sensors."""
        return [s for s in cls.SITES if s.get('has_wind_sensor', False)]
    
    @classmethod
    def get_water_level_thresholds(cls, station_id: str = None) -> dict:
        """Get water level thresholds. If station_id provided, returns that station's thresholds."""
        if station_id:
            return cls.WATER_LEVEL_THRESHOLDS.get(station_id, cls.WATER_LEVEL_THRESHOLDS['St1'])
        return cls.WATER_LEVEL_THRESHOLDS


class MapConfig:
    """
    Interactive map configuration for Leaflet-based station map.
    Centralizes ALL map behavior settings - ZERO hardcoding in JavaScript/CSS.
    """
    
    # API Configuration
    API_ENDPOINT = '/api/weather-data'
    API_TIMEOUT_MS = 10000
    REFRESH_INTERVAL_MS = 60000
    
    # Online/Offline Detection
    ONLINE_THRESHOLD_MINUTES = 60
    
    # Map Tile Configuration (OpenStreetMap)
    MAP_TILES = {
        'url': 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
        'attribution': '&copy; OpenStreetMap contributors',
        'maxZoom': 19,
        'minZoom': 10
    }
    
    # Responsive Breakpoint
    MOBILE_BREAKPOINT = 768
    
    # Station Label Configuration
    # Labels positioned via CSS transform - no geo offset needed
    # label_direction in SITES config determines left/right placement
    LABEL_CONFIG = {
        'enabled': True,
    }
    
    # Popup Dimensions
    POPUP_DIMENSIONS = {
        'mobile': {
            'maxWidth': 300,
            'minWidth': 200,
            'maxHeight': 380,
        },
        'desktop': {
            'maxWidth': 320,
            'minWidth': 240,
            'maxHeight': 450,
        }
    }
    
    # Popup Auto-Pan Padding [horizontal, vertical]
    POPUP_AUTO_PAN_PADDING = {
        'mobile': [60, 100],
        'desktop': [80, 80]
    }
    
    # Popup Behavior - Centering and Animation
    POPUP_BEHAVIOR = {
        'className': 'station-popup-wrapper',
        'closeButton': True,
        'autoPan': True,
        'autoPanPadding': [50, 50],
        'keepInView': True,
        'centerOnOpen': True,
        'resetOnClose': True,
        # Y-offset to push map down so popup is fully visible
        # Higher value = popup appears lower on screen
        'centerOffset': {
            'mobile': 130,    # Reduced - popup more centered on mobile
            'desktop': 140,   # Slightly reduced for desktop too
        }
    }
    
    # Data Age Thresholds (minutes) - MUST match DataFreshnessConfig
    DATA_AGE = {
        'fresh': DataFreshnessConfig.FRESH_THRESHOLD,
        'normal': DataFreshnessConfig.STALE_THRESHOLD,
        'stale': DataFreshnessConfig.OFFLINE_THRESHOLD
    }
    
    # Marker Opacity for different states
    MARKER_OPACITY = {
        'online': 1.0,
        'offline': 0.5,
        'loading': 0.4
    }
    
    @classmethod
    def get_js_config(cls) -> dict:
        """Export for JavaScript map.js consumption via window.APP_CONFIG.mapConfig"""
        return {
            'apiEndpoint': cls.API_ENDPOINT,
            'apiTimeout': cls.API_TIMEOUT_MS,
            'refreshInterval': cls.REFRESH_INTERVAL_MS,
            'onlineThresholdMinutes': cls.ONLINE_THRESHOLD_MINUTES,
            'mobileBreakpoint': cls.MOBILE_BREAKPOINT,
            'mapTiles': cls.MAP_TILES,
            'labelConfig': cls.LABEL_CONFIG,
            'popupDimensions': cls.POPUP_DIMENSIONS,
            'popupAutoPanPadding': cls.POPUP_AUTO_PAN_PADDING,
            'popupBehavior': cls.POPUP_BEHAVIOR,
            'dataAge': cls.DATA_AGE,
            'markerOpacity': cls.MARKER_OPACITY
        }


# =============================================================================
# EXTERNAL DEPENDENCIES - API Configuration
# =============================================================================

class APIConfig:
    """External API configuration for weather data endpoints."""
    
    BASE_URL = 'https://apaw.cspc.edu.ph/apawbalatanapi/APIv1/Weather'
    TIMEOUT = 8
    RETRY_ATTEMPTS = 3
    
    # Cache duration matches mesh network update interval
    CACHE_DURATION = 900

    ENDPOINTS = {
        'weather': '/api/weather-data',
        'precipitation': '/api/precipitation-data',
        'water_level': '/api/water-level-data',
        'stations': '/api/config/stations',
        'complete_config': '/api/config/complete',
        'css_variables': '/api/css-variables'
    }


# =============================================================================
# UI CONFIGURATION - Charts, Cards, Display
# =============================================================================

class ChartConfig:
    """CanvasJS chart configuration for weather data visualization."""
    
    CHART_START_HOUR = 0
    CHART_END_HOUR = 23
    DATA_INTERVAL_HOURS = 1
    LABEL_INTERVAL_HOURS = 2
    
    BREAKPOINTS = {
        'mobile_sm': 480,
        'mobile': 768,
        'tablet': 1024,
    }
    
    RESPONSIVE = {
        'mobile_sm': {
            'height': 230,
            'fontSize': 10,
            'iconSize': 20,
            'lineThickness': 2,
            'markerSize': 4
        },
        'mobile': {
            'height': 280,
            'fontSize': 11,
            'iconSize': 28,
            'lineThickness': 2.5,
            'markerSize': 5
        },
        'tablet': {
            'height': 320,
            'fontSize': 12,
            'iconSize': 32,
            'lineThickness': 3,
            'markerSize': 6
        },
        'desktop': {
            'height': 340,
            'fontSize': 12,
            'iconSize': 36,
            'lineThickness': 3,
            'markerSize': 6
        }
    }

    STYLING = {
        'labelFontColor': '#64748b',
        'lineColor': '#e2e8f0',
        'tickColor': '#e2e8f0',
        'gridColor': '#f1f5f9',
        'backgroundColor': '#ffffff',
        'titleFontColor': '#1a202c',
        'legendFontColor': '#475569',
    }
    
    ANIMATION_DURATION = 400
    TOOLTIP_DELAY = 100
    RESIZE_DEBOUNCE_MS = 230
    
    RETRY_MAX_ATTEMPTS = 3
    RETRY_DELAYS = [1000, 2000, 5000]
    
    # Mesh network limitation: 15-minute intervals prevent bottlenecking
    REFRESH_INTERVAL_MS = 900000
    
    # Weather data auto-refresh for map/weather cards (2 minutes)
    DATA_REFRESH_INTERVAL_MS = 120000
    INITIAL_REFRESH_DELAY_MS = 10000
    
    ICON_INTERVAL = 2
    ICON_SIZE = 36
    LABEL_INTERVAL = 2

    ARROW_SIZES = {
        'desktop': 40,
        'tablet': 32,
        'mobile': 28
    }
    
    @classmethod
    def get_js_config(cls):
        """Export complete chart config for JavaScript."""
        return {
            'breakpoints': cls.BREAKPOINTS,
            'responsive': cls.RESPONSIVE,
            'styling': cls.STYLING,
            'animation': {
                'duration': cls.ANIMATION_DURATION,
                'tooltipDelay': cls.TOOLTIP_DELAY,
                'resizeDebounce': cls.RESIZE_DEBOUNCE_MS
            },
            'retry': {
                'maxAttempts': cls.RETRY_MAX_ATTEMPTS,
                'delays': cls.RETRY_DELAYS
            },
            'refresh': {
                'chartInterval': cls.REFRESH_INTERVAL_MS,
                'dataInterval': cls.DATA_REFRESH_INTERVAL_MS,
                'initialDelay': cls.INITIAL_REFRESH_DELAY_MS
            },
            'icons': {
                'interval': cls.ICON_INTERVAL
            },
            'labelInterval': cls.LABEL_INTERVAL,
            'arrowSizes': cls.ARROW_SIZES
        }


class AlertConfig:
    """Configuration for alert banners and notifications."""
    
    # Banner display labels
    BANNER_LABELS = {
        'critical': 'Critical Flood',
        'warning': 'Flood Warning',
        'alert': 'Flood Alert',
        'advisory': 'Flood Advisory',
        'normal': 'Normal',
        'none': 'No Alert'
    }
    
    # Font Awesome icons for each alert level
    BANNER_ICONS = {
        'critical': 'fa-exclamation-triangle',
        'warning': 'fa-exclamation-circle',
        'alert': 'fa-bolt',
        'advisory': 'fa-info-circle',
        'normal': 'fa-check-circle',
        'none': 'fa-check-circle'
    }
    
    # Metric card icon configurations
    METRIC_ICONS = {
        'critical': {'cls': 'fa-exclamation-triangle', 'color': 'text-danger'},
        'warning': {'cls': 'fa-exclamation-circle', 'color': 'text-warning'},
        'alert': {'cls': 'fa-bolt', 'color': 'text-warning'},
        'advisory': {'cls': 'fa-info-circle', 'color': 'text-info'},
        'normal': {'cls': 'fa-check-circle', 'color': 'text-success'},
        'none': {'cls': 'fa-check-circle', 'color': 'text-primary'}
    }
    
    # Offline threshold for data freshness (uses DataFreshnessConfig)
    @classmethod
    def get_offline_threshold_ms(cls):
        return DataFreshnessConfig.OFFLINE_THRESHOLD * 60 * 1000
    
    @classmethod
    def get_js_config(cls):
        """Export for JavaScript consumption via window.APP_CONFIG.alertConfig"""
        return {
            'bannerLabels': cls.BANNER_LABELS,
            'bannerIcons': cls.BANNER_ICONS,
            'metricIcons': cls.METRIC_ICONS,
            'offlineThresholdMs': cls.get_offline_threshold_ms()
        }


class MetricCardConfig:
    """Configuration for dashboard metric cards."""
    
    CARDS = {
        'avg_water_level': {
            'title': 'Average Water Level',
            'description': 'Mean water level across all active monitoring stations',
            'show_unit': True,
            'unit': 'cm',
            'icon': 'fas fa-water'
        },
        'highest_alert': {
            'title': 'Highest Alert Level',
            'description': 'Current maximum alert level across all stations',
            'show_count': True
        },
        'rainfall_forecast': {
            'title': 'Rainfall Forecast',
            'description': 'Current rainfall intensity prediction',
            'show_icon': True,
            'show_color': True
        },
        'attention_stations': {
            'title': 'Stations Requiring Attention',
            'description': 'Number of stations with active alerts',
            'show_fraction': True,
            'icon': 'fas fa-exclamation-triangle'
        },
        'online_sensors': {
            'title': 'Weather Stations Online',
            'description': 'Number of sensors currently reporting data',
            'show_fraction': True,
            'icons': {
                'all_online': 'fas fa-check-circle text-success',
                'some_offline': 'fas fa-exclamation-triangle text-warning',
                'many_offline': 'fas fa-exclamation-circle text-danger'
            }
        },
        'heat_index': {
            'title': 'Heat Index',
            'description': 'Current "feels like" temperature accounting for humidity',
            'show_unit': True,
            'unit': '°C',
            'icon': 'fas fa-thermometer-half'
        }
    }

    @classmethod
    def get_card_config(cls, card_name: str) -> dict:
        return cls.CARDS.get(card_name, {})

    @classmethod
    def get_all_cards(cls) -> dict:
        return cls.CARDS


class WeatherCardConfig:
    """
    Configuration for the home page weather card display.
    Change DISPLAY_STATION_ID to switch which station's data is shown.
    """
    DISPLAY_STATION_ID = 'St5'
    
    @classmethod
    def get_display_station(cls) -> dict:
        """Get full station info for the display station."""
        return SiteConfig.get_site_by_id(cls.DISPLAY_STATION_ID)
    
    @classmethod
    def get_display_station_name(cls) -> str:
        """Get the display name for the weather card header."""
        station = cls.get_display_station()
        if station:
            return f"{station['id']} - {station['name']}"
        return cls.DISPLAY_STATION_ID
    
    @classmethod
    def get_js_config(cls) -> dict:
        """Get config for JavaScript (weather-card-realtime.js)."""
        station = cls.get_display_station()
        return {
            'stationId': cls.DISPLAY_STATION_ID,
            'stationIds': station.get('station_ids', [cls.DISPLAY_STATION_ID]) if station else [cls.DISPLAY_STATION_ID],
            'stationName': cls.get_display_station_name(),
            'hasWaterLevel': station.get('has_water_level', False) if station else False
        }


# =============================================================================
# FLASK CONFIGURATION - App settings
# =============================================================================

class Config:
    """Base Flask configuration."""
    
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'
    API_URL = APIConfig.BASE_URL
    API_TIMEOUT = APIConfig.TIMEOUT
    SITES = SiteConfig.SITES
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024


class DevelopmentConfig(Config):
    DEBUG = True
    TESTING = False


class ProductionConfig(Config):
    DEBUG = False
    TESTING = False
    SECRET_KEY = os.environ.get('SECRET_KEY') or os.urandom(32).hex()


class TestingConfig(Config):
    DEBUG = True
    TESTING = True
    API_TIMEOUT = 5


config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}


# =============================================================================
# EXPORT UTILITIES - Consolidated config exports
# =============================================================================

class ColorAPI:
    """Export utilities for colors - CSS variables and JavaScript config."""
    
    @staticmethod
    def get_css_variables():
        """Generate CSS custom properties from UIColorSystem."""
        return {
            '--color-primary': UIColorSystem.PRIMARY,
            '--color-secondary': UIColorSystem.SECONDARY,
            '--color-white': UIColorSystem.WHITE,
            '--color-black': UIColorSystem.BLACK,
            '--color-light-black': UIColorSystem.LIGHT_BLACK,
            '--color-lightest-gray': UIColorSystem.LIGHTEST_GRAY,
            '--color-light-gray': UIColorSystem.LIGHT_GRAY,
            '--color-dark-gray': UIColorSystem.DARK_GRAY,
            '--color-text-primary': UIColorSystem.TEXT_PRIMARY,
            '--color-text-secondary': UIColorSystem.TEXT_SECONDARY,
            '--color-text-muted': UIColorSystem.TEXT_MUTED,
            '--color-background-light': UIColorSystem.BACKGROUND_LIGHT,
            '--color-border-light': UIColorSystem.BORDER_LIGHT,
            '--color-border-medium': UIColorSystem.BORDER_MEDIUM,
            '--color-primary-light': UIColorSystem.PRIMARY_LIGHT,
            '--alert-none': UIColorSystem.PRIMARY,
            '--alert-normal': UIColorSystem.ALERT_NORMAL,
            '--alert-advisory': UIColorSystem.ALERT_ADVISORY,
            '--alert-alert': UIColorSystem.ALERT_ALERT,
            '--alert-warning': UIColorSystem.ALERT_WARNING,
            '--alert-critical': UIColorSystem.ALERT_CRITICAL,
            '--flood-normal': UIColorSystem.FLOOD_NORMAL,
            '--flood-advisory': UIColorSystem.FLOOD_ADVISORY,
            '--flood-alert': UIColorSystem.FLOOD_ALERT,
            '--flood-warning': UIColorSystem.FLOOD_WARNING,
            '--flood-critical': UIColorSystem.FLOOD_CRITICAL,
            '--color-success': UIColorSystem.SUCCESS,
            '--color-info': UIColorSystem.INFO,
            '--color-warning': UIColorSystem.WARNING,
            '--color-error': UIColorSystem.ERROR,
            '--station-st1': UIColorSystem.STATION_COLORS['St1'],
            '--station-st2': UIColorSystem.STATION_COLORS['St2'],
            '--station-st3': UIColorSystem.STATION_COLORS['St3'],
            '--station-st4': UIColorSystem.STATION_COLORS['St4'],
            '--station-st5': UIColorSystem.STATION_COLORS['St5'],
        }


def get_template_context():
    """
    Master export for Jinja2 templates.
    This is the ONLY function templates should use to access config.
    """
    return {
        # Color system
        'ui_colors': UIColorSystem,
        'station_colors': UIColorSystem.STATION_COLORS,
        'css_variables': ColorAPI.get_css_variables(),
        
        # Alert colors (flattened for easy template access)
        'alert_colors': {
            'none': UIColorSystem.PRIMARY,
            'normal': UIColorSystem.ALERT_NORMAL,
            'advisory': UIColorSystem.ALERT_ADVISORY,
            'alert': UIColorSystem.ALERT_ALERT,
            'warning': UIColorSystem.ALERT_WARNING,
            'critical': UIColorSystem.ALERT_CRITICAL
        },
        'flood_colors': {
            'normal': UIColorSystem.FLOOD_NORMAL,
            'advisory': UIColorSystem.FLOOD_ADVISORY,
            'alert': UIColorSystem.FLOOD_ALERT,
            'warning': UIColorSystem.FLOOD_WARNING,
            'critical': UIColorSystem.FLOOD_CRITICAL
        },
        
        # Thresholds
        'thresholds': {
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
        },
        
        # Per-station water level thresholds for individual charts
        'water_level_thresholds': SiteConfig.WATER_LEVEL_THRESHOLDS,
        
        # Alert/status level configs
        'alert_levels': AlertLevelConfig.LEVELS,
        'rainfall_levels': RainfallForecastConfig.LEVELS,
        
        # Station data
        'sites': SiteConfig.SITES,
        'map_config': {
            'center': SiteConfig.MAP_CENTER,
            'zoom': SiteConfig.MAP_ZOOM
        },
        
        'map_config_full': MapConfig.get_js_config(),
        # JavaScript configs (for window.APP_CONFIG)
        'weather_icon_config': WeatherIconConfig.get_js_config(),
        'weather_card_config': WeatherCardConfig.get_js_config(),
        'heat_index_config': HeatIndexConfig.get_js_config(),
        'data_freshness_config': DataFreshnessConfig.get_js_config(),
        
        # Chart config
        'chart_config': ChartConfig.get_js_config(),
        
        # Alert banner/notification config
        'alert_config': AlertConfig.get_js_config()
    }


def get_api_config():
    """Export for API routes that need config data."""
    return {
        'colors': {
            'primary': UIColorSystem.PRIMARY,
            'secondary': UIColorSystem.SECONDARY,
            'station_colors': UIColorSystem.STATION_COLORS,
            'alert_colors': {
                'none': UIColorSystem.PRIMARY,
                'normal': UIColorSystem.ALERT_NORMAL,
                'advisory': UIColorSystem.ALERT_ADVISORY,
                'alert': UIColorSystem.ALERT_ALERT,
                'warning': UIColorSystem.ALERT_WARNING,
                'critical': UIColorSystem.ALERT_CRITICAL
            }
        },
        'thresholds': {
            'rainfall': {
                'light': WeatherThresholds.RAINFALL_LIGHT,
                'moderate': WeatherThresholds.RAINFALL_MODERATE,
                'heavy': WeatherThresholds.RAINFALL_HEAVY
            },
            'water_level': {
                'advisory': WeatherThresholds.WATER_ADVISORY,
                'alert': WeatherThresholds.WATER_ALERT,
                'warning': WeatherThresholds.WATER_WARNING,
                'critical': WeatherThresholds.WATER_CRITICAL
            },
            'heat_index': {
                'caution': HeatIndexConfig.CAUTION,
                'extreme_caution': HeatIndexConfig.EXTREME_CAUTION,
                'danger': HeatIndexConfig.DANGER,
                'extreme_danger': HeatIndexConfig.EXTREME_DANGER
            }
        },
        'sites': SiteConfig.SITES,
        'endpoints': APIConfig.ENDPOINTS
    }