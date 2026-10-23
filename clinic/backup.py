"""Sao lưu dữ liệu có mã hóa (Fernet/AES) và kiểm tra khả năng khôi phục."""
import base64
import gzip
import hashlib
import io
import json
import os
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from django.conf import settings
from django.core.management import call_command
from django.utils import timezone

from .models import BackupLog

APPS = ['accounts', 'core', 'clinic']
EXCLUDE = ['contenttypes', 'auth.permission', 'sessions', 'authtoken', 'admin.logentry']


def backup_dir():
    d = Path(os.environ.get('BACKUP_DIR') or settings.BASE_DIR / 'backups')
    d.mkdir(parents=True, exist_ok=True)
    return d


def _key():
    raw = os.environ.get('BACKUP_ENCRYPTION_KEY')
    if raw:
        return raw.encode(), True
    # Dự phòng: suy ra từ SECRET_KEY (vẫn mã hóa, nhưng nên đặt BACKUP_ENCRYPTION_KEY riêng và cất ngoài máy chủ).
    return base64.urlsafe_b64encode(hashlib.sha256(settings.SECRET_KEY.encode()).digest()), False


def generate_key():
    return Fernet.generate_key().decode()


def make_backup(user=None, note=''):
    buf = io.StringIO()
    call_command('dumpdata', *APPS, exclude=EXCLUDE, indent=None, stdout=buf, use_natural_foreign_keys=False)
    raw = gzip.compress(buf.getvalue().encode('utf-8'))
    key, own = _key()
    blob = Fernet(key).encrypt(raw)
    name = f'ohio-backup-{timezone.localtime():%Y%m%d-%H%M%S}.json.gz.enc'
    path = backup_dir() / name
    path.write_bytes(blob)
    try:
        os.chmod(path, 0o600)
    except OSError:
        pass
    return BackupLog.objects.create(kind='backup', filename=name, size=len(blob), sha256=hashlib.sha256(blob).hexdigest(), encrypted=True,
                                    note=note or ('Khóa riêng (BACKUP_ENCRYPTION_KEY)' if own else 'Khóa suy ra từ SECRET_KEY — nên đặt BACKUP_ENCRYPTION_KEY'), by=user)


def read_backup(path):
    blob = Path(path).read_bytes()
    key, _ = _key()
    return json.loads(gzip.decompress(Fernet(key).decrypt(blob)).decode('utf-8')), blob


def verify_backup(log, user=None):
    """Giải mã + đọc lại + đối chiếu mã băm; không ghi đè dữ liệu đang chạy."""
    path = backup_dir() / log.filename
    try:
        data, blob = read_backup(path)
        if hashlib.sha256(blob).hexdigest() != log.sha256:
            raise ValueError('Mã băm không khớp — file có thể bị sửa.')
        models = {}
        for o in data:
            models[o['model']] = models.get(o['model'], 0) + 1
        note = f'{len(data)} bản ghi / {len(models)} bảng đọc lại thành công'
        ok = len(data) > 0
    except (FileNotFoundError, InvalidToken, ValueError, OSError) as e:
        note, ok = f'Lỗi: {e.__class__.__name__} {e}'[:250], False
    return BackupLog.objects.create(kind='verify', filename=log.filename, size=log.size, sha256=log.sha256, encrypted=True, ok=ok, note=note, by=user)
