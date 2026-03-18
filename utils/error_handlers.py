"""Error handling decorators and handlers for Flask application."""

import logging
from functools import wraps
from flask import render_template
from .helpers import create_api_error_response

logger = logging.getLogger(__name__)


def handle_service_errors(f):
    """Decorator to handle errors in service layer and render error pages."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except ValueError as e:
            logger.error("ValueError in %s: %s", f.__name__, str(e), exc_info=True)
            return render_template('errors/500.html'), 500
        except ConnectionError as e:
            logger.error("Connection error in %s: %s", f.__name__, str(e), exc_info=True)
            return render_template('errors/503.html'), 503
        except Exception as e:  # pylint: disable=broad-exception-caught
            logger.error("Unexpected error in %s: %s", f.__name__, str(e), exc_info=True)
            return render_template('errors/500.html'), 500
    return decorated_function


def handle_api_errors(f):
    """Decorator to handle errors in API endpoints and return JSON responses."""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except ValueError as e:
            logger.error("ValueError in API %s: %s", f.__name__, str(e), exc_info=True)
            return create_api_error_response(
                'Invalid request parameters. Please check your input.',
                400
            )
        except ConnectionError as e:
            logger.error("Connection error in API %s: %s", f.__name__, str(e), exc_info=True)
            return create_api_error_response(
                'External service temporarily unavailable. Please try again in a few moments.',
                503
            )
        except KeyError as e:
            logger.error("Missing key in API %s: %s", f.__name__, str(e), exc_info=True)
            return create_api_error_response(
                'Configuration error. Technical team has been notified.',
                500
            )
        except Exception as e:  # pylint: disable=broad-exception-caught
            logger.error("Unexpected error in API %s: %s", f.__name__, str(e), exc_info=True)
            return create_api_error_response(
                'An unexpected error occurred. Technical team has been notified.',
                500
            )
    return decorated_function


def register_error_handlers(app):
    """Register global error handlers for the Flask application."""
    @app.errorhandler(404)
    def not_found(_error):
        return render_template('errors/404.html'), 404

    @app.errorhandler(500)
    def server_error(_error):
        logger.error("Server error: %s", str(_error))
        return render_template('errors/500.html'), 500