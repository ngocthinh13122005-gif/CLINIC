import uuid

import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [('clinic', '0010_caretask_source_key'), migrations.swappable_dependency(settings.AUTH_USER_MODEL)]

    operations = [
        migrations.CreateModel(
            name='MarketingContact',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('email', models.EmailField(db_index=True, max_length=254, unique=True)),
                ('full_name', models.CharField(blank=True, max_length=120)),
                ('source', models.CharField(choices=[('patient', 'Hồ sơ bệnh nhân có đồng ý'), ('website', 'Đăng ký trên website'), ('manual', 'Nhập thủ công có xác nhận'), ('import', 'Nhập từ tệp có xác nhận')], default='manual', max_length=12)),
                ('status', models.CharField(choices=[('active', 'Đang nhận tin'), ('unsubscribed', 'Đã hủy đăng ký'), ('blacklisted', 'Danh sách chặn')], db_index=True, default='active', max_length=14)),
                ('consent_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('consent_note', models.CharField(blank=True, max_length=255)),
                ('unsubscribed_at', models.DateTimeField(blank=True, null=True)),
                ('unsubscribe_token', models.UUIDField(default=uuid.uuid4, editable=False, unique=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('patient', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='marketing_contacts', to='clinic.patient')),
            ], options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='MailingList',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=120, unique=True)), ('description', models.CharField(blank=True, max_length=255)),
                ('is_active', models.BooleanField(default=True)), ('created_at', models.DateTimeField(auto_now_add=True)),
                ('contacts', models.ManyToManyField(blank=True, related_name='mailing_lists', to='clinic.marketingcontact')),
                ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
            ], options={'ordering': ['name']},
        ),
        migrations.CreateModel(
            name='EmailCampaign',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=160)), ('subject', models.CharField(max_length=180)),
                ('preview_text', models.CharField(blank=True, max_length=180)), ('body_html', models.TextField(blank=True)),
                ('status', models.CharField(choices=[('draft', 'Bản nháp'), ('scheduled', 'Đã lên lịch'), ('sent', 'Đã gửi'), ('cancelled', 'Đã hủy')], db_index=True, default='draft', max_length=12)),
                ('scheduled_at', models.DateTimeField(blank=True, null=True)), ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('recipient_count', models.PositiveIntegerField(default=0)), ('sent_count', models.PositiveIntegerField(default=0)), ('failed_count', models.PositiveIntegerField(default=0)),
                ('created_at', models.DateTimeField(auto_now_add=True)), ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('mailing_list', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='campaigns', to='clinic.mailinglist')),
            ], options={'ordering': ['-created_at']},
        ),
    ]
