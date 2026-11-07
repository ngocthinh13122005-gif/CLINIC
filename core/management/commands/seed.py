from django.core.management import call_command
from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = 'Tạo bộ dữ liệu demo tối giản.'

    def handle(self, *args, **options):
        call_command('seed_minimal_demo')
