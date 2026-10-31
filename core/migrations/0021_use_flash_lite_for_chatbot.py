from django.db import migrations, models


def update_chatbot_model(apps, schema_editor):
    setting = apps.get_model('core', 'ChatbotSetting')
    setting.objects.filter(model_name='gemini-3.6-flash').update(model_name='gemini-3.5-flash-lite')


class Migration(migrations.Migration):
    dependencies = [('core', '0020_use_gemini_36_for_chatbot')]

    operations = [
        migrations.AlterField(
            model_name='chatbotsetting',
            name='model_name',
            field=models.CharField(default='gemini-3.5-flash-lite', max_length=80, verbose_name='Gemini model'),
        ),
        migrations.RunPython(update_chatbot_model, migrations.RunPython.noop),
    ]
