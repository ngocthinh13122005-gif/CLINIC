import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


def _backfill_confirm_code(apps, schema_editor):
    from django.utils.crypto import get_random_string
    Booking = apps.get_model('core', 'Booking')
    existing = set(Booking.objects.exclude(confirm_code='').values_list('confirm_code', flat=True))
    for b in Booking.objects.filter(confirm_code=''):
        code = get_random_string(10, allowed_chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789')
        while code in existing:
            code = get_random_string(10, allowed_chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789')
        existing.add(code)
        b.confirm_code = code
        b.save(update_fields=['confirm_code'])


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0004_skintag_skinanalysis_service_skin_tags'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.AddField(
            model_name='booking', name='guest_name',
            field=models.CharField(blank=True, max_length=100, verbose_name='Họ tên (khách vãng lai)'),
        ),
        migrations.AddField(
            model_name='booking', name='guest_phone',
            field=models.CharField(blank=True, max_length=15, verbose_name='SĐT (khách vãng lai)'),
        ),
        migrations.AddField(
            model_name='booking', name='guest_email',
            field=models.EmailField(blank=True, max_length=254, verbose_name='Email (khách vãng lai)'),
        ),
        # Bước 1: thêm confirm_code KHÔNG unique trước, để không vỡ ràng buộc với dữ liệu cũ.
        migrations.AddField(
            model_name='booking', name='confirm_code',
            field=models.CharField(blank=True, default='', max_length=16, verbose_name='Mã xác nhận'),
        ),
        # Bước 2: sinh mã duy nhất cho các booking đã có sẵn.
        migrations.RunPython(_backfill_confirm_code, migrations.RunPython.noop),
        # Bước 3: giờ mới bật ràng buộc unique, khi mọi hàng đều đã có mã khác nhau.
        migrations.AlterField(
            model_name='booking', name='confirm_code',
            field=models.CharField(blank=True, max_length=16, unique=True, verbose_name='Mã xác nhận'),
        ),
        migrations.AlterField(
            model_name='booking', name='user',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL,
                                     related_name='bookings', to=settings.AUTH_USER_MODEL, verbose_name='Khách hàng'),
        ),
    ]
