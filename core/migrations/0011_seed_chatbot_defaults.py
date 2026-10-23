from django.db import migrations


def seed_chatbot(apps, schema_editor):
    Setting = apps.get_model('core', 'ChatbotSetting')
    FAQ = apps.get_model('core', 'ChatbotFAQ')
    Action = apps.get_model('core', 'ChatbotQuickAction')

    Setting.objects.get_or_create(pk=1)

    faqs = [
        (
            'Tôi muốn xem các dịch vụ của OHIO',
            'Bạn có thể xem danh sách dịch vụ, mức giá và thời lượng tại mục Dịch vụ trên website OHIO.',
            'dịch vụ, bảng giá, giá dịch vụ, spa có gì',
            10,
        ),
        (
            'Làm thế nào để đặt lịch tại OHIO?',
            'Bạn chọn “Đặt lịch”, chọn dịch vụ, ngày giờ và chuyên viên phù hợp, sau đó xác nhận thông tin liên hệ.',
            'đặt lịch, hẹn lịch, booking, lịch hẹn',
            20,
        ),
        (
            'Tôi muốn gặp tư vấn viên',
            'Bạn có thể chọn nút “Gặp tư vấn viên” để chuyển sang kênh tư vấn trực tiếp của OHIO.',
            'tư vấn viên, cskh, nhân viên tư vấn, gặp người thật',
            30,
        ),
    ]
    for q, a, keywords, order in faqs:
        FAQ.objects.get_or_create(question=q, defaults={
            'answer': a, 'keywords': keywords, 'sort_order': order, 'is_active': True,
        })

    actions = [
        ('Dịch vụ', 'message', 'Cho tôi xem các dịch vụ nổi bật của OHIO', 'bi-stars', 10),
        ('Đặt lịch', 'url', '/dat-lich/', 'bi-calendar-check', 20),
        ('Khuyến mãi', 'message', 'OHIO hiện có khuyến mãi hoặc voucher nào?', 'bi-ticket-perforated', 30),
        ('Gặp tư vấn viên', 'human', '', 'bi-headset', 40),
    ]
    for label, action_type, value, icon, order in actions:
        Action.objects.get_or_create(label=label, defaults={
            'action_type': action_type, 'value': value, 'icon': icon,
            'sort_order': order, 'is_active': True,
        })


def unseed_chatbot(apps, schema_editor):
    # Keep user-managed data on reverse migration; schema migration handles table removal.
    pass


class Migration(migrations.Migration):
    dependencies = [('core', '0010_chatbotfaq_chatbotquickaction_chatbotsetting_and_more')]
    operations = [migrations.RunPython(seed_chatbot, unseed_chatbot)]
