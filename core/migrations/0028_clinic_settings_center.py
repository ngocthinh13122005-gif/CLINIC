import django.db.models.deletion
import django.utils.timezone
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0027_booking_workflow'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ClinicSettingValue',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('scope', models.CharField(choices=[('user', 'Người dùng'), ('clinic', 'Phòng khám'), ('system', 'Hệ thống')], db_index=True, max_length=12)),
                ('scope_key', models.CharField(default='default', max_length=64)),
                ('key', models.CharField(max_length=100)),
                ('value', models.JSONField()),
                ('version', models.PositiveIntegerField(default=1)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('updated_by', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='clinic_settings_updated', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ('scope', 'key')},
        ),
        migrations.CreateModel(
            name='ClinicSettingAudit',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('setting_key', models.CharField(db_index=True, max_length=100)),
                ('scope', models.CharField(choices=[('user', 'Người dùng'), ('clinic', 'Phòng khám'), ('system', 'Hệ thống')], max_length=12)),
                ('scope_key', models.CharField(default='default', max_length=64)),
                ('old_value', models.JSONField(blank=True, null=True)),
                ('new_value', models.JSONField()),
                ('reason', models.CharField(blank=True, max_length=255)),
                ('version', models.PositiveIntegerField()),
                ('effective_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('actor', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='clinic_settings_audit', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ('-effective_at', '-pk')},
        ),
        migrations.AddConstraint(
            model_name='clinicsettingvalue',
            constraint=models.UniqueConstraint(fields=('scope', 'scope_key', 'key'), name='uniq_clinic_setting_scope_key'),
        ),
        migrations.AddIndex(
            model_name='clinicsettingvalue',
            index=models.Index(fields=['scope', 'scope_key'], name='clinic_setting_scope_idx'),
        ),
        migrations.AddIndex(
            model_name='clinicsettingaudit',
            index=models.Index(fields=['scope', 'scope_key', 'setting_key'], name='clinic_setting_audit_idx'),
        ),
    ]
