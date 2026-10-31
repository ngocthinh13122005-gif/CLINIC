from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('core', '0024_staff_commission_rate')]

    operations = [
        migrations.AddField(
            model_name='conversation', name='channel',
            field=models.CharField(choices=[('web', 'Website'), ('facebook', 'Facebook Messenger')], db_index=True, default='web', max_length=16, verbose_name='Kênh'),
        ),
        migrations.AddField(
            model_name='conversation', name='external_customer_id',
            field=models.CharField(blank=True, db_index=True, max_length=128, verbose_name='Mã khách ngoài hệ thống'),
        ),
        migrations.AddField(
            model_name='conversation', name='external_page_id',
            field=models.CharField(blank=True, max_length=64, verbose_name='Mã Trang'),
        ),
        migrations.AddField(
            model_name='message', name='external_message_id',
            field=models.CharField(blank=True, max_length=180, null=True, unique=True, verbose_name='Mã tin nhắn ngoài hệ thống'),
        ),
        migrations.AddField(
            model_name='message', name='external_sent_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Thời gian gửi từ kênh ngoài'),
        ),
    ]
