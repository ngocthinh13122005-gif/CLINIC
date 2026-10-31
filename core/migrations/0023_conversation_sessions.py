from django.db import migrations, models
import django.db.models.deletion
import django.utils.timezone


def backfill_conversation_sessions(apps, schema_editor):
    Conversation = apps.get_model('core', 'Conversation')
    Message = apps.get_model('core', 'Message')
    Session = apps.get_model('core', 'ConversationSession')
    for conversation in Conversation.objects.all().iterator():
        invite = Message.objects.filter(
            conversation_id=conversation.pk,
            message_type='csat',
        ).order_by('-created_at', '-id').first()
        Session.objects.create(
            conversation_id=conversation.pk,
            sequence=1,
            started_at=conversation.session_started_at or conversation.created_at,
            ended_at=conversation.session_ended_at,
            end_reason=conversation.session_end_reason or ('active' if conversation.status != 'closed' else 'completed'),
            csat_invited_at=conversation.csat_invited_at,
            invite_message_id=invite.pk if invite else None,
            csat_score=conversation.csat_score,
            csat_comment=conversation.csat_comment,
        )


class Migration(migrations.Migration):
    dependencies = [('core', '0022_support_session_rules')]

    operations = [
        migrations.CreateModel(
            name='ConversationSession',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('sequence', models.PositiveIntegerField(default=1, verbose_name='Số phiên')),
                ('started_at', models.DateTimeField(default=django.utils.timezone.now, verbose_name='Bắt đầu lúc')),
                ('ended_at', models.DateTimeField(blank=True, null=True, verbose_name='Kết thúc lúc')),
                ('end_reason', models.CharField(choices=[('active', 'Đang hoạt động'), ('csat_invite', 'Đã gửi mời đánh giá'), ('completed', 'Hoàn tất thủ công'), ('day_end', 'Kết thúc cuối ngày')], default='active', max_length=20, verbose_name='Lý do kết thúc')),
                ('csat_invited_at', models.DateTimeField(blank=True, null=True, verbose_name='Mời đánh giá lúc')),
                ('csat_score', models.PositiveSmallIntegerField(blank=True, null=True, verbose_name='Đánh giá')),
                ('csat_comment', models.TextField(blank=True, verbose_name='Góp ý')),
                ('conversation', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='sessions', to='core.conversation')),
                ('invite_message', models.OneToOneField(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='csat_session', to='core.message')),
            ],
            options={'verbose_name': 'Phiên chăm sóc', 'verbose_name_plural': 'Phiên chăm sóc', 'ordering': ['sequence'], 'unique_together': {('conversation', 'sequence')}},
        ),
        migrations.RunPython(backfill_conversation_sessions, migrations.RunPython.noop),
    ]
