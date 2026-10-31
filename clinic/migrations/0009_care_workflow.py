from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


class Migration(migrations.Migration):
    dependencies = [('clinic', '0008_reconcile_legacy_payments')]
    operations = [
        migrations.AlterField(model_name='caretask', name='status', field=models.CharField(choices=[('pending', 'Cần làm'), ('escalated', 'Chờ bác sĩ'), ('done', 'Đã xong'), ('skipped', 'Bỏ qua')], db_index=True, default='pending', max_length=10)),
        migrations.AddField(model_name='caretask', name='priority', field=models.CharField(choices=[('normal', 'Bình thường'), ('high', 'Ưu tiên cao'), ('urgent', 'Khẩn cấp')], db_index=True, default='normal', max_length=8)),
        migrations.AddField(model_name='caretask', name='escalation_reason', field=models.CharField(blank=True, max_length=500, verbose_name='Lý do chuyển bác sĩ')),
        migrations.AddField(model_name='caretask', name='escalated_at', field=models.DateTimeField(blank=True, null=True)),
        migrations.CreateModel(name='CareContactLog', fields=[
            ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
            ('channel', models.CharField(choices=[('call','Điện thoại'),('zalo','Zalo'),('messenger','Messenger'),('sms','SMS'),('email','Email'),('in_person','Tại phòng khám')], default='call', max_length=12)),
            ('result', models.CharField(choices=[('contacted','Đã liên hệ'),('no_answer','Không nghe máy / chưa phản hồi'),('rescheduled','Hẹn liên hệ lại'),('needs_doctor','Cần bác sĩ đánh giá'),('completed','Hoàn tất chăm sóc')], default='contacted', max_length=16)),
            ('note', models.TextField(max_length=2000, verbose_name='Nội dung trao đổi')),
            ('next_contact_at', models.DateTimeField(blank=True, null=True)),
            ('clinical_alert', models.BooleanField(default=False, verbose_name='Có dấu hiệu cần chuyên môn')),
            ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
            ('created_by', models.ForeignKey(null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to=settings.AUTH_USER_MODEL)),
            ('task', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='contact_logs', to='clinic.caretask')),
        ], options={'ordering': ['-created_at', '-id']}),
    ]


