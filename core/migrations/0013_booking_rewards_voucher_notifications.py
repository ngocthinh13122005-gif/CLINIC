from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('accounts', '0004_user_date_of_birth_passwordresetcode'), ('core', '0012_chatbot_agent_automation')]
    operations = [
        migrations.AddField(model_name='booking', name='discount_total', field=models.PositiveIntegerField(default=0, verbose_name='Giảm giá')),
        migrations.AddField(model_name='booking', name='loyalty_awarded', field=models.BooleanField(default=False, verbose_name='Đã cộng điểm thưởng')),
        migrations.AddField(model_name='booking', name='loyalty_points_earned', field=models.PositiveIntegerField(default=0, verbose_name='Điểm thưởng nhận được')),
        migrations.AddField(model_name='booking', name='applied_voucher', field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='bookings', to='core.voucher', verbose_name='Voucher đã áp dụng')),
        migrations.CreateModel(
            name='Notification',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('event_type', models.CharField(db_index=True, max_length=80)),
                ('title', models.CharField(max_length=160)),
                ('message', models.CharField(blank=True, max_length=500)),
                ('data', models.JSONField(blank=True, default=dict)),
                ('is_read', models.BooleanField(default=False)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='notifications', to=settings.AUTH_USER_MODEL)),
            ],
            options={'ordering': ['-created_at']},
        ),
        migrations.CreateModel(
            name='VoucherRedemption',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('status', models.CharField(choices=[('available', 'Chưa sử dụng'), ('used', 'Đã sử dụng')], default='available', max_length=12)),
                ('redeemed_at', models.DateTimeField(auto_now_add=True)),
                ('used_at', models.DateTimeField(blank=True, null=True)),
                ('booking', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='voucher_redemption', to='core.booking')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='voucher_redemptions', to=settings.AUTH_USER_MODEL)),
                ('voucher', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='redemptions', to='core.voucher')),
            ],
            options={'ordering': ['-redeemed_at'], 'unique_together': {('user', 'voucher')}},
        ),
    ]
