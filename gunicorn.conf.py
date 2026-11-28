"""Keep API workers responsive while concurrent requests wait for MySQL or SMTP."""
import os

# Gunicorn selects its threaded worker when threads > 1; CLI worker/bind options remain unchanged.
threads = max(1, int(os.environ.get('GUNICORN_THREADS', '2')))
