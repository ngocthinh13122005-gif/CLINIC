from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0023_conversation_sessions')]

    operations = [
        migrations.AddField(
            model_name='staff',
            name='commission_rate',
            field=models.DecimalField(
                decimal_places=2,
                default=8.0,
                help_text='Tỷ lệ áp dụng trên doanh thu lịch hẹn đã hoàn thành.',
                max_digits=5,
                verbose_name='Tỷ lệ hoa hồng (%)',
            ),
        ),
    ]
