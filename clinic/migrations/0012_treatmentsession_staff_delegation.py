from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('clinic', '0011_email_marketing'),
    ]

    operations = [
        migrations.AddField(
            model_name='treatmentsession',
            name='allow_staff_delegation',
            field=models.BooleanField(
                default=False,
                help_text='Bác sĩ phụ trách quyết định cho từng buổi; mặc định bác sĩ phải trực tiếp thực hiện.',
                verbose_name='Cho phép giao nhân sự đủ điều kiện thực hiện',
            ),
        ),
    ]
