from django.db import migrations


def remove_email_marketing_settings(apps, schema_editor):
    setting_values = apps.get_model('core', 'ClinicSettingValue')
    setting_values.objects.filter(key__in=[
        'marketing.campaigns_enabled',
        'marketing.max_recipients',
        'notification.marketing_updates',
    ]).delete()


class Migration(migrations.Migration):
    dependencies = [
        ('clinic', '0021_invoiceitem_treatment_session'),
        ('core', '0028_clinic_settings_center'),
    ]

    operations = [
        migrations.RunPython(remove_email_marketing_settings, migrations.RunPython.noop),
        migrations.DeleteModel(name='EmailCampaign'),
        migrations.DeleteModel(name='MailingList'),
        migrations.DeleteModel(name='MarketingContact'),
    ]
