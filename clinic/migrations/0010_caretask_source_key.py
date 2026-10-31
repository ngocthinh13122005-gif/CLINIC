import re

from django.db import migrations, models


def deduplicate_and_key(apps, schema_editor):
    CareTask = apps.get_model('clinic', 'CareTask')
    MedicalRecord = apps.get_model('clinic', 'MedicalRecord')
    TreatmentSession = apps.get_model('clinic', 'TreatmentSession')
    Invoice = apps.get_model('clinic', 'Invoice')

    records = {r.code: r.pk for r in MedicalRecord.objects.only('id', 'code')}
    invoices = {i.code: i.pk for i in Invoice.objects.only('id', 'code')}
    sessions = {(s.plan_id, s.number): s.pk for s in TreatmentSession.objects.only('id', 'plan_id', 'number')}
    keyed = {}

    for task in CareTask.objects.filter(auto=True).order_by('id'):
        key = None
        if task.kind == 'post_care' and task.visit_id:
            key = f'visit:post_care:{task.visit_id}'
        elif task.kind == 'revisit':
            match = re.search(r'bệnh án\s+([^\)]+)', task.title, re.I)
            record_id = records.get(match.group(1).strip()) if match else None
            if record_id:
                key = f'record:revisit:{record_id}'
        elif task.kind == 'session' and task.plan_id:
            match = re.search(r'buổi\s+(\d+)', task.title, re.I)
            session_id = sessions.get((task.plan_id, int(match.group(1)))) if match else None
            if session_id:
                key = f'session:{session_id}'
        elif task.kind == 'payment':
            match = re.search(r'hóa đơn\s+([^\s—]+)', task.title, re.I)
            invoice_id = invoices.get(match.group(1).strip()) if match else None
            if invoice_id:
                key = f'invoice:payment:{invoice_id}'

        if not key:
            continue
        if key in keyed:
            task.delete()
        else:
            task.source_key = key
            task.save(update_fields=['source_key'])
            keyed[key] = task.pk


class Migration(migrations.Migration):
    dependencies = [('clinic', '0009_care_workflow')]

    operations = [
        migrations.AddField(
            model_name='caretask',
            name='source_key',
            field=models.CharField(blank=True, editable=False, max_length=120, null=True, unique=True, verbose_name='Khóa nguồn tự động'),
        ),
        migrations.RunPython(deduplicate_and_key, migrations.RunPython.noop),
    ]
