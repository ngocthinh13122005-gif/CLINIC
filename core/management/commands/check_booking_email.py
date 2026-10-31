from django.conf import settings
from django.core.mail import send_mail
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Kiểm tra cấu hình Gmail SMTP dùng để gửi vé đặt lịch AkinaClinic.'

    def add_arguments(self, parser):
        parser.add_argument('--send-to', dest='send_to', help='Gửi một email test tới địa chỉ này.')

    def handle(self, *args, **options):
        configured = bool(getattr(settings, 'EMAIL_HOST_PASSWORD', ''))
        self.stdout.write(f"Email backend: {settings.EMAIL_BACKEND}")
        self.stdout.write(f"SMTP host: {getattr(settings, 'EMAIL_HOST', '')}:{getattr(settings, 'EMAIL_PORT', '')}")
        self.stdout.write(f"Tài khoản gửi: {getattr(settings, 'EMAIL_HOST_USER', '')}")
        self.stdout.write(f"Gmail App Password: {'ĐÃ CẤU HÌNH' if configured else 'CHƯA CẤU HÌNH'}")
        self.stdout.write(f"SITE_BASE_URL: {getattr(settings, 'SITE_BASE_URL', '')}")
        if not configured:
            self.stdout.write(self.style.WARNING('Thêm EMAIL_HOST_PASSWORD vào .env để bật gửi mail thật.'))
            return
        target = options.get('send_to')
        if target:
            send_mail(
                'AkinaClinic — Kiểm tra email đặt lịch',
                'Nếu bạn nhận được email này, Gmail SMTP của AkinaClinic đã hoạt động.',
                None,
                [target],
                fail_silently=False,
            )
            self.stdout.write(self.style.SUCCESS(f'Đã gửi email test tới {target}.'))
        else:
            self.stdout.write(self.style.SUCCESS('Cấu hình SMTP đã sẵn sàng. Dùng --send-to email@example.com để gửi thử.'))
