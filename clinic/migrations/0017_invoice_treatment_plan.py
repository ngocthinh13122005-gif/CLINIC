from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('clinic', '0016_treatmentsession_adverse_reactions_and_more'),
    ]

    operations = [
        migrations.AddField(
            model_name='invoice',
            name='treatment_plan',
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='package_invoices',
                to='clinic.treatmentplan',
                verbose_name='Liệu trình bán trọn gói',
            ),
        ),
    ]
