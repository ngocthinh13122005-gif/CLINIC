from django.db import migrations, models
import django.utils.timezone


def backfill_sessions(apps, schema_editor):
    Conversation = apps.get_model('core', 'Conversation')
    Message = apps.get_model('core', 'Message')
    for conversation in Conversation.objects.all().iterator():
        updates = {
            'session_started_at': conversation.created_at,
        }
        invite = Message.objects.filter(
            conversation_id=conversation.pk,
            message_type='csat',
        ).order_by('created_at').first()
        if invite:
            updates['csat_invited_at'] = invite.created_at
        if conversation.status == 'closed':
            updates['session_ended_at'] = conversation.resolved_at or conversation.updated_at
            updates['session_end_reason'] = 'csat_invite' if invite else 'completed'
        Conversation.objects.filter(pk=conversation.pk).update(**updates)


class Migration(migrations.Migration):
    dependencies = [('core', '0021_use_flash_lite_for_chatbot')]

    operations = [
        migrations.AddField(
            model_name='chatsetting',
            name='auto_close_daily',
            field=models.BooleanField(default=True, verbose_name='Tự kết thúc phiên cuối ngày'),
        ),
        migrations.AddField(
            model_name='chatsetting',
            name='auto_csat_enabled',
            field=models.BooleanField(default=True, verbose_name='Tự gửi mời đánh giá khi hoàn tất'),
        ),
        migrations.AddField(
            model_name='conversation',
            name='csat_invited_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Đã mời đánh giá lúc'),
        ),
        migrations.AddField(
            model_name='conversation',
            name='session_end_reason',
            field=models.CharField(blank=True, max_length=20, verbose_name='Lý do kết thúc phiên'),
        ),
        migrations.AddField(
            model_name='conversation',
            name='session_ended_at',
            field=models.DateTimeField(blank=True, null=True, verbose_name='Kết thúc phiên CSKH'),
        ),
        migrations.AddField(
            model_name='conversation',
            name='session_started_at',
            field=models.DateTimeField(default=django.utils.timezone.now, verbose_name='Bắt đầu phiên CSKH'),
        ),
        migrations.RunPython(backfill_sessions, migrations.RunPython.noop),
    ]
