from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("clinic", "0023_patient_message"),
    ]

    operations = [
        migrations.AddField(
            model_name="patientmessage",
            name="cc",
            field=models.CharField(blank=True, max_length=255),
        ),
        migrations.AddField(
            model_name="patientmessage",
            name="bcc",
            field=models.CharField(blank=True, max_length=255),
        ),
    ]
