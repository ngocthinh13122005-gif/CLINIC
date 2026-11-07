from datetime import datetime, time, timedelta

from django.db import migrations
from django.utils import timezone


DEFAULT_TYPES = [
    ('email', 'Email', 'mail', '#0a6fc2'),
    ('recall', 'Nhắc tái khám', 'recall', '#7c4dff'),
    ('call', 'Cuộc gọi', 'phone', '#1f9d62'),
    ('first_lead_call', 'Gọi khách tiềm năng lần đầu', 'phone_lead', '#17a2b8'),
    ('message', 'Tin nhắn', 'message', '#5b6570'),
    ('meeting', 'Cuộc họp', 'users', '#e08a00'),
]
KIND_TYPE = {
    'post_care': 'call',
    'revisit': 'recall',
    'session': 'message',
    'payment': 'call',
    'other': 'message',
}


def seed_activity_types(apps, schema_editor):
    ActivityType = apps.get_model('clinic', 'ActivityType')
    CareTask = apps.get_model('clinic', 'CareTask')
    db_alias = schema_editor.connection.alias
    by_code = {}

    for sort, (code, name, icon, color) in enumerate(DEFAULT_TYPES):
        activity_type, _ = ActivityType.objects.using(db_alias).get_or_create(
            code=code,
            defaults={
                'name': name,
                'icon': icon,
                'color': color,
                'sort': sort,
                'is_active': True,
            },
        )
        by_code[code] = activity_type

    tz = timezone.get_current_timezone()
    for task in CareTask.objects.using(db_alias).filter(type__isnull=True).iterator():
        task_type = by_code[KIND_TYPE.get(task.kind, 'message')]
        updates = {'type': task_type}
        start_at = task.start_at
        end_at = task.end_at

        if task.due_date and (start_at is None or end_at is None):
            start_at = timezone.make_aware(datetime.combine(task.due_date, time(9, 0)), tz)
            end_at = start_at + timedelta(minutes=30)
            updates.update(start_at=start_at, end_at=end_at)

        CareTask.objects.using(db_alias).filter(pk=task.pk).update(**updates)


class Migration(migrations.Migration):
    dependencies = [
        ('clinic', '0019_activitytype_caretask_conversation_and_more'),
    ]

    operations = [
        migrations.RunPython(seed_activity_types, migrations.RunPython.noop),
    ]
