import json
import tempfile

from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from clinic import backup


class Command(BaseCommand):
    help = 'KHÔI PHỤC từ file sao lưu mã hóa. Ghi đè dữ liệu cùng khóa chính — chỉ chạy trên hệ thống trống hoặc khi đã chắc chắn.'

    def add_arguments(self, p):
        p.add_argument('path')
        p.add_argument('--yes', action='store_true', help='Xác nhận thực sự ghi dữ liệu')

    def handle(self, *a, **o):
        try:
            data, _ = backup.read_backup(o['path'])
        except Exception as e:
            raise CommandError(f'Không đọc được file sao lưu: {e}')
        self.stdout.write(f'File hợp lệ: {len(data)} bản ghi.')
        if not o['yes']:
            self.stdout.write('Chưa ghi gì. Thêm --yes để khôi phục thật.')
            return
        with tempfile.NamedTemporaryFile('w', suffix='.json', delete=False, encoding='utf-8') as f:
            json.dump(data, f)
        call_command('loaddata', f.name)
        self.stdout.write(self.style.SUCCESS('Đã khôi phục.'))
