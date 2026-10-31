from django.db import migrations
from django.utils import timezone


def reconcile_legacy_payments(apps, schema_editor):
    """Các khoản thu tồn tại trước khi đưa quy trình đối soát vào sử dụng là số dư đầu kỳ đã chốt."""
    Payment = apps.get_model('clinic', 'Payment')
    Payment.objects.filter(reconciliation_status='pending').update(
        reconciliation_status='reconciled', reconciled_at=timezone.now())


class Migration(migrations.Migration):
    dependencies = [('clinic', '0007_billing_operations')]

    operations = [migrations.RunPython(reconcile_legacy_payments, migrations.RunPython.noop)]
