from django.db import migrations, models


def rebrand_chat_configuration(apps, schema_editor):
    branded_fields = {
        'ChatSetting': ('greeting_message',),
        'ChatbotSetting': ('assistant_name', 'greeting_message', 'system_prompt', 'fallback_message'),
        'ChatbotFAQ': ('question', 'answer'),
        'ChatbotQuickAction': ('value',),
    }

    for model_name, fields in branded_fields.items():
        model = apps.get_model('core', model_name)
        for row in model.objects.all().iterator():
            changed = []
            for field in fields:
                value = getattr(row, field)
                updated = value.replace('OHIO', 'AkinaClinic').replace('Ohio', 'AkinaClinic')
                if updated != value:
                    setattr(row, field, updated)
                    changed.append(field)
            if changed:
                row.save(update_fields=changed)


class Migration(migrations.Migration):
    dependencies = [
        ('core', '0018_remove_skin_analysis'),
    ]

    operations = [
        migrations.RunPython(
            rebrand_chat_configuration,
            reverse_code=migrations.RunPython.noop,
        ),
        migrations.AlterField(
            model_name='chatsetting',
            name='greeting_message',
            field=models.CharField(
                default='Xin chào! Đội ngũ AkinaClinic có thể giúp gì cho bạn?',
                max_length=255,
                verbose_name='Lời chào',
            ),
        ),
        migrations.AlterField(
            model_name='chatbotsetting',
            name='assistant_name',
            field=models.CharField(
                default='Trợ lý AkinaClinic',
                max_length=80,
                verbose_name='Tên trợ lý',
            ),
        ),
        migrations.AlterField(
            model_name='chatbotsetting',
            name='greeting_message',
            field=models.TextField(
                default='Xin chào, tôi là Trợ lý AkinaClinic. Tôi có thể hỗ trợ bạn về dịch vụ, đặt lịch và thông tin chăm sóc khách hàng.',
                verbose_name='Lời chào',
            ),
        ),
        migrations.AlterField(
            model_name='chatbotsetting',
            name='system_prompt',
            field=models.TextField(
                default=(
                    'Bạn là Trợ lý AkinaClinic của hệ thống spa AkinaClinic. Trả lời bằng tiếng Việt, ngắn gọn, lịch sự và chỉ dựa trên '
                    'thông tin AkinaClinic được cung cấp. Không tự bịa giá, voucher, lịch bác sĩ hoặc chính sách. Với câu hỏi sức khỏe '
                    'hoặc da liễu, chỉ cung cấp thông tin chăm sóc chung; không chẩn đoán bệnh, không kê thuốc và không thay thế '
                    'bác sĩ/chuyên viên. Nếu không chắc, hãy nói rõ và đề nghị khách gặp tư vấn viên AkinaClinic.'
                ),
                verbose_name='System prompt',
            ),
        ),
        migrations.AlterField(
            model_name='chatbotsetting',
            name='fallback_message',
            field=models.TextField(
                default='Tôi chưa có đủ thông tin để trả lời chính xác. Bạn có thể chọn “Gặp tư vấn viên” để được AkinaClinic hỗ trợ trực tiếp.',
                verbose_name='Tin nhắn khi AI không trả lời được',
            ),
        ),
    ]
