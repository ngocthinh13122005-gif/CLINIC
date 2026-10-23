import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('core', '0002_staff_services_staff_user'),
    ]

    operations = [
        migrations.CreateModel(
            name='WorkingHours',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('weekday', models.PositiveSmallIntegerField(choices=[(0, 'Thứ Hai'), (1, 'Thứ Ba'), (2, 'Thứ Tư'), (3, 'Thứ Năm'), (4, 'Thứ Sáu'), (5, 'Thứ Bảy'), (6, 'Chủ Nhật')], verbose_name='Thứ trong tuần')),
                ('start_time', models.TimeField(verbose_name='Bắt đầu')),
                ('end_time', models.TimeField(verbose_name='Kết thúc')),
                ('staff', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='working_hours', to='core.staff', verbose_name='Nhân sự')),
            ],
            options={
                'verbose_name': 'Lịch làm việc',
                'verbose_name_plural': 'Lịch làm việc',
                'ordering': ['staff', 'weekday', 'start_time'],
                'unique_together': {('staff', 'weekday', 'start_time')},
            },
        ),
    ]
