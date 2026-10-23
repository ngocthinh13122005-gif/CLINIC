from django.core.management.base import BaseCommand

from clinic import backup


class Command(BaseCommand):
    help = 'Sao lưu dữ liệu phòng khám (mã hóa). --verify: kiểm tra đọc lại; --genkey: sinh khóa mã hóa mới.'

    def add_arguments(self, p):
        p.add_argument('--verify', action='store_true')
        p.add_argument('--genkey', action='store_true')

    def handle(self, *a, **o):
        if o['genkey']:
            self.stdout.write(backup.generate_key())
            return
        log = backup.make_backup(note='Chạy từ dòng lệnh')
        self.stdout.write(self.style.SUCCESS(f'Đã sao lưu: {log.filename} ({log.size:,} byte)'))
        if o['verify']:
            v = backup.verify_backup(log)
            self.stdout.write((self.style.SUCCESS if v.ok else self.style.ERROR)(f'Kiểm tra: {v.note}'))
