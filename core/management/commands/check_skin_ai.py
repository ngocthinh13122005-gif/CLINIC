from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Hiển thị trạng thái tính năng Phân tích da sơ bộ.'

    def handle(self, *args, **options):
        self.stdout.write(self.style.WARNING('Phân tích da sơ bộ: ĐANG BẢO TRÌ'))
        self.stdout.write('Engine AI/CV đã được tắt khỏi runtime của Django.')
        self.stdout.write('Không yêu cầu MediaPipe, OpenCV, PyTorch hoặc Python 3.12 riêng cho tính năng này.')
        self.stdout.write(self.style.SUCCESS('Project có thể chạy các chức năng còn lại bằng Django bình thường.'))
