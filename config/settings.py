from pathlib import Path
import os

BASE_DIR = Path(__file__).resolve().parent.parent

# Lightweight .env loader: environment variables still take priority.
env_file = BASE_DIR / '.env'
if env_file.exists():
    for raw_line in env_file.read_text(encoding='utf-8').splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY', 'ohio-local-development-key')
DEBUG = os.environ.get('DJANGO_DEBUG', '1') == '1'
ALLOWED_HOSTS = [x.strip() for x in os.environ.get('DJANGO_ALLOWED_HOSTS', 'localhost,127.0.0.1').split(',') if x.strip()]

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    'rest_framework',
    'rest_framework.authtoken',
    'django_filters',
    'corsheaders',
    'django_celery_beat',
    'accounts',
    'core',
    'clinic',
    'api',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'whitenoise.middleware.WhiteNoiseMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'config.urls'
TEMPLATES = [{
    'BACKEND': 'django.template.backends.django.DjangoTemplates',
    'DIRS': [],
    'APP_DIRS': True,
    'OPTIONS': {
        'context_processors': [
            'django.template.context_processors.request',
            'django.contrib.auth.context_processors.auth',
            'django.contrib.messages.context_processors.messages',
        ],
    },
}]
WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

if os.environ.get('DB_ENGINE', '').lower() in {'mysql', 'django.db.backends.mysql'}:
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.mysql',
            'NAME': os.environ.get('DB_NAME', 'ohio_spa'),
            'USER': os.environ.get('DB_USER', 'ohio'),
            'PASSWORD': os.environ.get('DB_PASSWORD', 'ohio_dev_password'),
            'HOST': os.environ.get('DB_HOST', 'mysql'),
            'PORT': os.environ.get('DB_PORT', '3306'),
            'OPTIONS': {'charset': 'utf8mb4'},
        }
    }
else:
    DATABASES = {'default': {'ENGINE': 'django.db.backends.sqlite3', 'NAME': BASE_DIR / 'db.sqlite3'}}

AUTH_PASSWORD_VALIDATORS = [
    {'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator'},
    {'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator'},
    {'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator'},
    {'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator'},
]
AUTH_USER_MODEL = 'accounts.User'

LANGUAGE_CODE = 'vi'
TIME_ZONE = 'Asia/Ho_Chi_Minh'
USE_I18N = True
USE_TZ = True

STATIC_URL = '/static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'
STORAGES = {
    'default': {'BACKEND': 'django.core.files.storage.FileSystemStorage'},
    'staticfiles': {'BACKEND': 'whitenoise.storage.CompressedManifestStaticFilesStorage'},
}
MEDIA_URL = '/media/'
MEDIA_ROOT = BASE_DIR / 'media'
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [
        'rest_framework.authentication.TokenAuthentication',
        'rest_framework.authentication.SessionAuthentication',
    ],
    'DEFAULT_PERMISSION_CLASSES': ['rest_framework.permissions.IsAuthenticated'],
    'DEFAULT_FILTER_BACKENDS': ['django_filters.rest_framework.DjangoFilterBackend'],
    'DEFAULT_RENDERER_CLASSES': ['rest_framework.renderers.JSONRenderer'],
}

CORS_ALLOWED_ORIGINS = [x.strip() for x in os.environ.get(
    'CORS_ALLOWED_ORIGINS',
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080',
).split(',') if x.strip()]
CSRF_TRUSTED_ORIGINS = [x.strip() for x in os.environ.get(
    'CSRF_TRUSTED_ORIGINS',
    'http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080',
).split(',') if x.strip()]
CORS_ALLOW_CREDENTIALS = True

FRONTEND_BASE_URL = os.environ.get('FRONTEND_BASE_URL', 'http://localhost:5173').rstrip('/')
SITE_BASE_URL = os.environ.get('SITE_BASE_URL', FRONTEND_BASE_URL).rstrip('/')

EMAIL_HOST = os.environ.get('EMAIL_HOST', 'smtp.gmail.com')
EMAIL_PORT = int(os.environ.get('EMAIL_PORT', '587'))
EMAIL_USE_TLS = os.environ.get('EMAIL_USE_TLS', '1') == '1'
EMAIL_HOST_USER = os.environ.get('EMAIL_HOST_USER', '')
EMAIL_HOST_PASSWORD = os.environ.get('EMAIL_HOST_PASSWORD', '')
DEFAULT_FROM_EMAIL = os.environ.get('DEFAULT_FROM_EMAIL', f'AkinaClinic <{EMAIL_HOST_USER or "no-reply@akinaclinic.local"}>')
EMAIL_BACKEND = 'django.core.mail.backends.smtp.EmailBackend' if EMAIL_HOST_PASSWORD else 'django.core.mail.backends.console.EmailBackend'
EMAIL_TIMEOUT = int(os.environ.get('EMAIL_TIMEOUT', '12'))

CELERY_BROKER_URL = os.environ.get('CELERY_BROKER_URL', 'redis://127.0.0.1:6379/0')
CELERY_RESULT_BACKEND = os.environ.get('CELERY_RESULT_BACKEND', 'redis://127.0.0.1:6379/1')
CELERY_TASK_ALWAYS_EAGER = os.environ.get('CELERY_TASK_ALWAYS_EAGER', '1') == '1'
CELERY_TASK_EAGER_PROPAGATES = True
CELERY_BEAT_SCHEDULER = 'django_celery_beat.schedulers:DatabaseScheduler'

FIREBASE_ENABLED = os.environ.get('FIREBASE_ENABLED', '0') == '1'
FIREBASE_SERVICE_ACCOUNT_FILE = os.environ.get('FIREBASE_SERVICE_ACCOUNT_FILE', '')
FIREBASE_SERVICE_ACCOUNT_JSON = os.environ.get('FIREBASE_SERVICE_ACCOUNT_JSON', '')
CLOUDINARY_URL = os.environ.get('CLOUDINARY_URL', '')
GEMINI_API_KEY = os.environ.get('GEMINI_API_KEY', '')
GEMINI_MODEL = os.environ.get('GEMINI_MODEL', 'gemini-3.6-flash')

# Meta Messenger. Secrets belong in .env only; never expose them to the frontend.
META_APP_ID = os.environ.get('META_APP_ID', '')
META_APP_SECRET = os.environ.get('META_APP_SECRET', '')
META_PAGE_ID = os.environ.get('META_PAGE_ID', '')
META_PAGE_ACCESS_TOKEN = os.environ.get('META_PAGE_ACCESS_TOKEN', '')
META_WEBHOOK_VERIFY_TOKEN = os.environ.get('META_WEBHOOK_VERIFY_TOKEN', '')
META_GRAPH_API_VERSION = os.environ.get('META_GRAPH_API_VERSION', 'v24.0')

LOYALTY_VND_PER_POINT = int(os.environ.get('LOYALTY_VND_PER_POINT', '10000'))
PASSWORD_RESET_CODE_TTL_MINUTES = int(os.environ.get('PASSWORD_RESET_CODE_TTL_MINUTES', '10'))
