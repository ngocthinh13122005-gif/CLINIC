from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Kiểm tra kiến trúc tư vấn khách hàng của OHIO.'

    def handle(self, *args, **options):
        self.stdout.write(self.style.SUCCESS('Chat OHIO: HTTP polling mode'))
        self.stdout.write('Không yêu cầu Redis, Django Channels, Daphne hoặc WebSocket.')
        self.stdout.write('Gửi tin: POST /tu-van/<id>/gui/')
        self.stdout.write('Đồng bộ: GET /tu-van/<id>/ theo chu kỳ ngắn ở trình duyệt.')
        self.stdout.write(self.style.SUCCESS('Có thể chạy trực tiếp bằng: python manage.py runserver'))
