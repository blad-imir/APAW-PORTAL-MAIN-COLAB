"""Utility helpers for data formatting, parsing, and API validation."""

from datetime import datetime, timedelta
from typing import Union, Optional, Dict, Any, List, Tuple
from flask import jsonify


# =============================================================================
# TIMESTAMP PARSING - Core functions for weather data processing
# =============================================================================

def parse_weather_timestamp(timestamp_str: Union[str, datetime, None]) -> Optional[datetime]:
    """
    Parse timestamp strings from weather API.
    Handles multiple formats: ISO, datetime strings, with/without timezone.
    """
    if not timestamp_str:
        return None
    
    if isinstance(timestamp_str, datetime):
        return timestamp_str.replace(tzinfo=None) if timestamp_str.tzinfo else timestamp_str
    
    if not isinstance(timestamp_str, str):
        return None

    formats = [
        '%Y-%m-%d %H:%M:%S',
        '%Y-%m-%d %H:%M:%S.%f',
        '%Y-%m-%dT%H:%M:%S',
        '%Y-%m-%dT%H:%M:%S.%f',
    ]

    for fmt in formats:
        try:
            return datetime.strptime(timestamp_str, fmt)
        except ValueError:
            continue

    try:
        clean_str = timestamp_str.replace('Z', '+00:00')
        dt = datetime.fromisoformat(clean_str)
        return dt.replace(tzinfo=None)
    except ValueError:
        pass

    return None


def get_timestamp_from_reading(reading: Dict) -> Optional[datetime]:
    """Extract and parse timestamp from a weather reading dict."""
    timestamp_str = (
        reading.get('DateTime') or 
        reading.get('DateTimeStamp') or 
        reading.get('Timestamp')
    )
    return parse_weather_timestamp(timestamp_str)


def safe_float(value: Any, default: Optional[float] = None) -> Optional[float]:
    """Safely convert value to float, returning default on failure."""
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


# =============================================================================
# INTERVAL GENERATION - For chart data processing
# =============================================================================

def create_hourly_intervals(
    start_time: datetime, 
    end_time: datetime, 
    step_hours: int = 1
) -> List[datetime]:
    """Create list of hourly datetime points from start to end (inclusive)."""
    intervals = []
    current = start_time
    
    while current <= end_time:
        intervals.append(current)
        current = current + timedelta(hours=step_hours)
    
    return intervals


# =============================================================================
# DISPLAY FORMATTING - For UI and templates
# =============================================================================

def format_datetime(dt: Union[str, datetime], format: str = '%I:%M %p') -> str:
    """
    Format datetime for display - handles datetime objects, full datetime strings,
    and time-only strings (HH:MM:SS or HH:MM).
    """
    if not dt:
        return '--:--'
    
    try:
        dt_obj = None
        
        if isinstance(dt, datetime):
            dt_obj = dt
        elif isinstance(dt, str):
            dt_obj = parse_weather_timestamp(dt)
            
            if not dt_obj:
                for fmt in ['%H:%M:%S', '%H:%M']:
                    try:
                        dt_obj = datetime.strptime(dt.strip(), fmt)
                        break
                    except ValueError:
                        continue
        
        if dt_obj:
            formatted = dt_obj.strftime(format)
            if formatted.startswith('0'):
                formatted = formatted[1:]
            return formatted
        
        return dt[:16] if isinstance(dt, str) and len(dt) >= 16 else str(dt)
    
    except (ValueError, AttributeError, TypeError):
        return '--:--'


def format_datetime_full(dt: Union[str, datetime]) -> str:
    """Format datetime as 'January 09, 2026 12:18 PM' for display."""
    if not dt:
        return '--'
    
    try:
        dt_obj = None
        
        if isinstance(dt, datetime):
            dt_obj = dt
        elif isinstance(dt, str):
            dt_obj = parse_weather_timestamp(dt)
        
        if dt_obj:
            return dt_obj.strftime('%B %d, %Y %I:%M %p')
        
        return str(dt)
    
    except (ValueError, AttributeError, TypeError):
        return '--'


def format_hour_label(hour: int) -> str:
    """Format 24-hour time to 12-hour with AM/PM for chart labels."""
    if hour == 0:
        return '12 AM'
    elif hour < 12:
        return f'{hour} AM'
    elif hour == 12:
        return '12 PM'
    else:
        return f'{hour - 12} PM'


def format_time_label(dt: datetime) -> str:
    """Format datetime as readable time label (e.g., '12 AM', '1 PM')."""
    return format_hour_label(dt.hour)


def format_day_label(date: datetime, reference_date: Optional[datetime] = None) -> str:
    """Format date relative to reference date."""
    reference = (reference_date or datetime.now()).date()
    target = date.date()
    
    if target == reference:
        return 'Today'
    elif target == reference - timedelta(days=1):
        return 'Yesterday'
    elif target == reference + timedelta(days=1):
        return 'Tomorrow'
    elif target == reference - timedelta(days=2):
        return '2 days ago'
    elif target == reference - timedelta(days=3):
        return '3 days ago'
    else:
        return date.strftime('%B %d, %Y')


def format_weather_value(value, unit: str = '', decimals: int = 1) -> str:
    """Format weather values for display."""
    if value is None or value == '':
        return '--'
    
    try:
        numeric_value = float(value) if isinstance(value, str) else float(value)
        formatted = f"{numeric_value:.{decimals}f}"
        if unit:
            formatted += unit
        return formatted
    except (TypeError, ValueError, AttributeError):
        return '--'


# =============================================================================
# API REQUEST VALIDATION
# =============================================================================

def validate_date_string(date_str: str) -> Tuple[bool, Optional[datetime], Optional[str]]:
    """
    Validate and parse a date string in YYYY-MM-DD format.
    
    Returns:
        Tuple of (is_valid, parsed_date, error_message)
    """
    if not date_str:
        return True, None, None
    
    if len(date_str) != 10:
        return False, None, 'Invalid date format. Use YYYY-MM-DD (e.g., 2024-11-23)'
    
    try:
        target_date = datetime.strptime(date_str, '%Y-%m-%d')
    except ValueError:
        return False, None, f'Invalid date: {date_str}. Use YYYY-MM-DD format.'
    
    current_year = datetime.now().year
    if target_date.year < 2020 or target_date.year > current_year + 1:
        return False, None, f'Date must be between 2020 and {current_year + 1}'
    
    if target_date > datetime.now() + timedelta(days=7):
        return False, None, 'Cannot request data more than 7 days in the future'
    
    return True, target_date, None


def validate_and_get_date(request):
    """
    Validate date from request parameters.
    
    Returns:
        Tuple of (target_date_or_none, error_response_or_none)
    """
    date_str = request.args.get('date')
    is_valid, target_date, error_msg = validate_date_string(date_str)
    
    if not is_valid:
        return None, create_api_error_response(error_msg, 400)
    
    return target_date, None


# =============================================================================
# API RESPONSE HELPERS
# =============================================================================

def create_api_error_response(error_message: str, status_code: int = 400, extra_data: dict = None):
    """Create standardized API error response."""
    response = {
        'success': False,
        'error': error_message,
        'timestamp': datetime.now().isoformat()
    }
    
    if extra_data:
        response.update(extra_data)
    
    return jsonify(response), status_code


def create_api_success_response(data: dict):
    """Create standardized API success response."""
    response = {'success': True}
    response.update(data)
    return jsonify(response)