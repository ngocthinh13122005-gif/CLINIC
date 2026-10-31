import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('clinic', '0011_email_marketing'),
        ('core', '0025_facebook_messenger_channel'),
    ]

    operations = [
        migrations.AddField(
            model_name='booking',
            name='treatment_session',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.SET_NULL,
                related_name='bookings',
                to='clinic.treatmentsession',
                verbose_name='Buổi liệu trình',
            ),
        ),
    ]
