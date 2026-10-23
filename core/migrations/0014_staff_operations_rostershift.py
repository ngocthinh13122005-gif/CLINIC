from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):
    dependencies = [('core', '0013_booking_rewards_voucher_notifications')]
    operations = [
        migrations.AddField(model_name='staff', name='rating', field=models.DecimalField(decimal_places=1, default=5.0, max_digits=2, verbose_name='Điểm đánh giá')),
        migrations.AddField(model_name='staff', name='experience_years', field=models.PositiveSmallIntegerField(default=0, verbose_name='Số năm kinh nghiệm')),
        migrations.AddField(model_name='staff', name='base_salary', field=models.PositiveIntegerField(default=6000000, verbose_name='Lương cơ bản')),
        migrations.AddField(model_name='staff', name='bonus', field=models.PositiveIntegerField(default=0, verbose_name='Thưởng')),
        migrations.AddField(model_name='staff', name='manual_deduction', field=models.PositiveIntegerField(default=0, verbose_name='Khấu trừ thủ công')),
        migrations.AddField(model_name='staff', name='payroll_status', field=models.CharField(choices=[('draft', 'Nháp'), ('approved', 'Đã duyệt'), ('paid', 'Đã thanh toán')], default='draft', max_length=12, verbose_name='Trạng thái lương')),
        migrations.CreateModel(
            name='RosterShift',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('date', models.DateField(verbose_name='Ngày')),
                ('is_on_duty', models.BooleanField(default=True, verbose_name='Đang trực')),
                ('note', models.CharField(blank=True, max_length=160, verbose_name='Ghi chú')),
                ('staff', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='roster_shifts', to='core.staff', verbose_name='Nhân sự')),
            ],
            options={'verbose_name': 'Trạng thái trực', 'verbose_name_plural': 'Trạng thái trực', 'ordering': ['date', 'staff__name'], 'unique_together': {('staff', 'date')}},
        ),
    ]
