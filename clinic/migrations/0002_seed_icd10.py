from django.db import migrations

from clinic.icd10_data import ICD10


def load(apps, schema_editor):
    Icd10Code = apps.get_model('clinic', 'Icd10Code')
    for group, rows in ICD10:
        for code, name in rows:
            Icd10Code.objects.update_or_create(code=code, defaults={'name': name, 'group': group})


class Migration(migrations.Migration):
    dependencies = [('clinic', '0001_initial')]
    operations = [migrations.RunPython(load, migrations.RunPython.noop)]
