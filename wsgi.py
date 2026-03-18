"""WSGI entry point for production deployment."""

import os
from app import create_app
from werkzeug.middleware.proxy_fix import ProxyFix

config_name = os.environ.get('FLASK_CONFIG', 'production')
app = create_app(config_name)

app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

if __name__ == "__main__":
    app.run()
