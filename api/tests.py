from datetime import timedelta
from unittest.mock import patch

from django.contrib.auth import get_user_model
from django.test import override_settings
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone
from rest_framework.authtoken.models import Token
from rest_framework.test import APITestCase

from core.models import Booking, Category, Conversation, LeaveRequest, Service, Staff, Voucher, VoucherRedemption, WorkingHours, Message, AgentPresence

User = get_user_model()


@override_settings(FIREBASE_ENABLED=False, CELERY_TASK_ALWAYS_EAGER=True)
class OhioApiIntegrationTests(APITestCase):
    def setUp(self):
        self.manager = User.objects.create_user(
            username='manager1', password='pass12345', role='manager', email='manager@example.com'
        )
        self.customer = User.objects.create_user(
            username='customer1', password='pass12345', role='customer', email='customer@example.com'
        )
        self.category = Category.objects.create(name='Chăm sóc da')
        self.service = Service.objects.create(
            category=self.category, name='Facial test', price=350000, duration=60
        )

    def make_staff(self):
        from datetime import time as _t
        staff = Staff.objects.create(name='Chuyên viên Test', position='KTV')
        staff.services.add(self.service)
        for wd in range(7):
            WorkingHours.objects.create(staff=staff, weekday=wd, start_time=_t(8, 0), end_time=_t(20, 0))
        return staff

    def slot(self, days=2, hour=10):
        """Giờ hẹn cố định trong giờ làm việc, tránh test phụ thuộc giờ chạy."""
        d = timezone.localtime() + timedelta(days=days)
        return d.replace(hour=hour, minute=0, second=0, microsecond=0)

    def auth(self, user):
        token, _ = Token.objects.get_or_create(user=user)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {token.key}')

    def test_login_and_me(self):
        response = self.client.post(
            '/api/auth/login/', {'username': 'customer1', 'password': 'pass12345'}, format='json'
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('token', response.data)
        self.client.credentials(HTTP_AUTHORIZATION=f"Token {response.data['token']}")
        me = self.client.get('/api/auth/me/')
        self.assertEqual(me.status_code, 200)
        self.assertEqual(me.data['role'], 'customer')

    @patch('api.views._queue_email')
    def test_guest_booking_creates_items_and_total(self, queue_email):
        self.make_staff()
        appointment = self.slot().isoformat()
        response = self.client.post('/api/bookings/', {
            'guest_name': 'Khách Test',
            'guest_phone': '0900000000',
            'guest_email': 'guest@example.com',
            'appointment': appointment,
            'service_ids': [self.service.id],
            'note': 'Test API',
        }, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data['id'])
        self.assertEqual(booking.total, 350000)
        self.assertEqual(booking.items.count(), 1)
        queue_email.assert_called_once()

    def test_customer_only_sees_own_bookings(self):
        Booking.objects.create(user=self.customer, appointment=timezone.now() + timedelta(days=1))
        other = User.objects.create_user(username='other', password='pass12345', role='customer')
        Booking.objects.create(user=other, appointment=timezone.now() + timedelta(days=1))
        self.auth(self.customer)
        response = self.client.get('/api/bookings/')
        self.assertEqual(response.status_code, 200)
        rows = response.data.get('results', response.data) if isinstance(response.data, dict) else response.data
        self.assertEqual(len(rows), 1)

    @patch('api.tasks.mirror_chat_message_task.delay', return_value=None)
    def test_chat_message_persists_before_realtime_mirror(self, _delay):
        self.auth(self.customer)
        conversation = Conversation.objects.create(customer=self.customer, subject='Tư vấn test')
        response = self.client.post(
            f'/api/conversations/{conversation.id}/messages/', {'text': 'Xin chào OHIO'}, format='json'
        )
        self.assertEqual(response.status_code, 201, response.data)
        self.assertEqual(conversation.messages.count(), 1)
        self.assertEqual(conversation.messages.first().text, 'Xin chào OHIO')

    def test_manager_dashboard_summary(self):
        self.auth(self.manager)
        response = self.client.get('/api/dashboard/summary/')
        self.assertEqual(response.status_code, 200)
        self.assertIn('bookings_total', response.data)
        self.assertIn('revenue', response.data)

    def test_public_ticket_lookup(self):
        booking = Booking.objects.create(
            user=self.customer, appointment=timezone.now() + timedelta(days=1), total=350000
        )
        response = self.client.get(f'/api/tickets/{booking.confirm_code}/')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data['confirm_code'], booking.confirm_code)

    def test_availability_returns_qualified_staff_slots(self):
        staff = Staff.objects.create(name='Chuyên viên test', position='Chuyên viên')
        staff.services.add(self.service)
        target_day = timezone.localdate() + timedelta(days=2)
        WorkingHours.objects.create(
            staff=staff, weekday=target_day.weekday(), start_time='08:00', end_time='17:00'
        )
        response = self.client.get(
            '/api/availability/', {'service_ids': str(self.service.id), 'date': target_day.isoformat()}
        )
        self.assertEqual(response.status_code, 200, response.data)
        self.assertEqual(response.data['staff'][0]['staff_id'], staff.id)
        self.assertTrue(response.data['staff'][0]['slots'])
    @patch('api.views.sync_conversation', return_value=True)
    def test_realtime_bootstrap_endpoint(self, sync):
        self.auth(self.customer)
        conversation = Conversation.objects.create(customer=self.customer, subject='Realtime test')
        response = self.client.post(f'/api/conversations/{conversation.id}/realtime/')
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data['enabled'])
        sync.assert_called_once()



    def test_approved_leave_hides_staff_from_availability(self):
        staff_user = User.objects.create_user(username='staffleave', password='pass12345', role='staff')
        staff = Staff.objects.create(user=staff_user, name='Staff leave', position='KTV')
        staff.services.add(self.service)
        target_day = timezone.localdate() + timedelta(days=3)
        WorkingHours.objects.create(staff=staff, weekday=target_day.weekday(), start_time='08:00', end_time='17:00')
        LeaveRequest.objects.create(staff=staff_user, start_date=target_day, end_date=target_day, status=LeaveRequest.APPROVED)
        response = self.client.get('/api/availability/', {'service_ids': str(self.service.id), 'date': target_day.isoformat()})
        self.assertEqual(response.status_code, 200)
        # Nhân viên nghỉ phép không có slot nào khả dụng trong ngày đó.
        self.assertFalse(any(row['slots'] for row in response.data['staff'] if row['staff_id'] == staff.id))

    @patch('api.views._queue_email')
    def test_voucher_redeem_and_apply_to_booking(self, _email):
        self.customer.loyalty_points = 500
        self.customer.save(update_fields=['loyalty_points'])
        voucher = Voucher.objects.create(code='SAVE50', title='Giảm 50K', points_cost=100, discount_value=50000, min_spend=100000)
        self.auth(self.customer)
        redeemed = self.client.post(f'/api/vouchers/{voucher.id}/redeem/')
        self.assertEqual(redeemed.status_code, 200, redeemed.data)
        self.make_staff()
        appointment = self.slot().isoformat()
        response = self.client.post('/api/bookings/', {'appointment': appointment, 'service_ids': [self.service.id], 'voucher_id': voucher.id}, format='json')
        self.assertEqual(response.status_code, 201, response.data)
        booking = Booking.objects.get(pk=response.data['id'])
        self.assertEqual(booking.discount_total, 50000)
        self.assertEqual(booking.total, 300000)
        self.assertEqual(VoucherRedemption.objects.get(user=self.customer, voucher=voucher).status, VoucherRedemption.USED)

    @patch('api.views._queue_email')
    def test_completed_booking_awards_loyalty_only_once(self, _email):
        manager_token, _ = Token.objects.get_or_create(user=self.manager)
        self.client.credentials(HTTP_AUTHORIZATION=f'Token {manager_token.key}')
        booking = Booking.objects.create(user=self.customer, appointment=timezone.now() + timedelta(days=1), total=200000, status=Booking.CONFIRMED)
        first = self.client.post(f'/api/bookings/{booking.id}/complete/')
        self.assertEqual(first.status_code, 200, first.data)
        self.customer.refresh_from_db(); points = self.customer.loyalty_points
        second = self.client.post(f'/api/bookings/{booking.id}/complete/')
        self.assertEqual(second.status_code, 200, second.data)
        self.customer.refresh_from_db()
        self.assertEqual(self.customer.loyalty_points, points)

    def test_consultant_claim_is_exclusive(self):
        agent1 = User.objects.create_user(username='agent1', password='pass12345', role='consultant')
        agent2 = User.objects.create_user(username='agent2', password='pass12345', role='consultant')
        AgentPresence.objects.create(user=agent1, status=AgentPresence.ONLINE)
        AgentPresence.objects.create(user=agent2, status=AgentPresence.ONLINE)
        conv = Conversation.objects.create(customer=self.customer, subject='Ca chưa gán')
        self.auth(agent1)
        first = self.client.post(f'/api/conversations/{conv.id}/claim/')
        self.assertEqual(first.status_code, 200, first.data)
        self.auth(agent2)
        second = self.client.post(f'/api/conversations/{conv.id}/claim/')
        self.assertEqual(second.status_code, 409, second.data)
        conv.refresh_from_db()
        self.assertEqual(conv.assigned_to_id, agent1.id)

    @patch('api.tasks.mirror_chat_message_task.delay', return_value=None)
    def test_chat_accepts_image_attachment(self, _delay):
        self.auth(self.customer)
        conv = Conversation.objects.create(customer=self.customer, subject='Gửi ảnh')
        upload = SimpleUploadedFile('da-mat.jpg', b'fake-image-content', content_type='image/jpeg')
        response = self.client.post(f'/api/conversations/{conv.id}/messages/', {'text':'Ảnh da của tôi', 'attachment':upload}, format='multipart')
        self.assertEqual(response.status_code, 201, response.data)
        msg = Message.objects.get(pk=response.data['id'])
        self.assertEqual(msg.message_type, Message.IMAGE)
        self.assertEqual(msg.attachment_name, 'da-mat.jpg')

    def test_support_meta_has_role_specific_tabs(self):
        agent = User.objects.create_user(username='agentmeta', password='pass12345', role='consultant')
        self.auth(agent)
        response = self.client.get('/api/conversations/meta/')
        self.assertEqual(response.status_code, 200)
        keys = [row['key'] for row in response.data['tabs']]
        self.assertEqual(keys, ['unassigned', 'mine', 'waiting'])

    def test_chat_list_is_lean_and_incremental_polling(self):
        consultant = User.objects.create_user(username='cskh1', password='pass12345', role='consultant')
        conv = Conversation.objects.create(customer=self.customer, subject='Mụn viêm', assigned_to=consultant)
        self.auth(self.customer)
        first = self.client.post(f'/api/conversations/{conv.id}/messages/', {'text': 'xin chào'}, format='multipart')
        self.assertEqual(first.status_code, 201)
        self.auth(consultant)
        listing = self.client.get('/api/conversations/', {'tab': 'mine'})
        self.assertEqual(listing.status_code, 200)
        row = listing.data[0]
        self.assertNotIn('messages', row)
        self.assertEqual(row['last_message'], 'xin chào')
        self.assertEqual(row['unread_count'], 1)
        self.assertEqual(row['sla_state'], 'normal')
        reply = self.client.post(f'/api/conversations/{conv.id}/messages/', {'text': 'chào bạn'}, format='multipart')
        self.assertEqual(reply.status_code, 201)
        after = self.client.get(f'/api/conversations/{conv.id}/messages/', {'after': first.data['id'], 'mark_read': 1})
        self.assertEqual([m['text'] for m in after.data], ['chào bạn'])
        detail = self.client.get(f'/api/conversations/{conv.id}/')
        self.assertEqual(len(detail.data['messages']), 2)
        self.assertEqual(self.client.get('/api/conversations/', {'tab': 'waiting'}).data[0]['unread_count'], 0)

    # ---------------- Trợ lý OHIO ----------------
    KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6'

    @patch.dict('os.environ', {'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})
    def test_chatbot_guest_buttons_use_real_data_and_persist_history(self):
        self.make_staff()
        from core.models import Voucher
        Voucher.objects.create(code='HELLO50', title='Giảm 50K', points_cost=10, discount_value=50000, min_spend=200000)
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'action': 'services'}, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        self.assertIn(self.service.name, r.data['reply']['content'])
        self.assertIn('phút', r.data['reply']['content'])
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'action': 'promotions'}, format='json')
        self.assertIn('HELLO50', r.data['reply']['content'])
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'action': 'booking'}, format='json')
        self.assertIn('bk:svc:', r.data['reply']['content'])  # bắt đầu quy trình đặt lịch trong chat
        self.assertEqual(r.data['navigate'], '')
        # Câu hỏi tự do khi chưa có Gemini key => fallback, không lỗi
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'text': 'da mình bị khô thì sao'}, format='json')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['reply']['source'], 'fallback')
        # Mở lại: lịch sử còn
        r = self.client.get('/api/chatbot/session/', {'visitor_key': self.KEY})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(len(r.data['messages']), 8)
        self.assertEqual([a['label'] for a in r.data['actions'][:4]], ['Dịch vụ', 'Đặt lịch', 'Khuyến mãi', 'Gặp tư vấn viên'])

    def test_chatbot_human_requires_login_then_opens_conversation(self):
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'action': 'human'}, format='json')
        self.assertIn('/login', r.data['reply']['content'])
        self.assertEqual(Conversation.objects.count(), 0)
        self.auth(self.customer)
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'action': 'human'}, format='json')
        conv = Conversation.objects.get(customer=self.customer)
        self.assertIn(f'[[link:/chat?c={conv.pk}|', r.data['reply']['content'])
        self.assertIsNone(conv.assigned_to)
        self.assertEqual(conv.messages.count(), 1)
        # bấm lần nữa không tạo ca thứ hai
        self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'action': 'human'}, format='json')
        self.assertEqual(Conversation.objects.filter(customer=self.customer).count(), 1)

    def test_chatbot_session_of_another_user_is_not_exposed(self):
        self.auth(self.customer)
        self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'text': 'xin chào'}, format='json')
        self.client.credentials()
        r = self.client.get('/api/chatbot/session/', {'visitor_key': self.KEY})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['messages'], [])
        self.assertNotEqual(r.data['visitor_key'], self.KEY)

    def test_chatbot_faq_match_and_bad_key(self):
        from core.models import ChatbotFAQ
        ChatbotFAQ.objects.create(question='Giờ mở cửa?', answer='OHIO mở cửa 8h-21h.', keywords='giờ mở cửa, mấy giờ')
        r = self.client.post('/api/chatbot/message/', {'visitor_key': self.KEY, 'text': 'Mấy giờ mở cửa vậy'}, format='json')
        self.assertEqual(r.data['reply']['source'], 'faq')
        self.assertIn('8h-21h', r.data['reply']['content'])
        bad = self.client.post('/api/chatbot/message/', {'visitor_key': 'x', 'text': 'hi'}, format='json')
        self.assertEqual(bad.status_code, 400)

    # ---------------- Đánh giá phiên ----------------
    def test_csat_invite_and_rating_flow(self):
        consultant = User.objects.create_user(username='cskh2', password='pass12345', role='consultant')
        conv = Conversation.objects.create(customer=self.customer, subject='Đánh giá', assigned_to=consultant)
        self.auth(self.customer)
        self.assertEqual(self.client.post(f'/api/conversations/{conv.id}/csat/', {'score': 5}, format='json').status_code, 400)
        self.assertEqual(self.client.post(f'/api/conversations/{conv.id}/csat-invite/').status_code, 403)
        self.auth(consultant)
        invite = self.client.post(f'/api/conversations/{conv.id}/csat-invite/')
        self.assertEqual(invite.status_code, 201)
        self.assertEqual(invite.data['message_type'], 'csat')
        self.auth(self.customer)
        ok = self.client.post(f'/api/conversations/{conv.id}/csat/', {'score': 4, 'comment': 'Tốt'}, format='json')
        self.assertEqual(ok.status_code, 200, ok.data)
        self.assertEqual(self.client.post(f'/api/conversations/{conv.id}/csat/', {'score': 1}, format='json').status_code, 400)
        self.assertTrue(conv.messages.filter(message_type='system', text__contains='4/5').exists())
        self.auth(consultant)
        self.assertEqual(self.client.post(f'/api/conversations/{conv.id}/csat-invite/').status_code, 400)

    def test_close_adds_rating_card_once(self):
        consultant = User.objects.create_user(username='cskh3', password='pass12345', role='consultant')
        conv = Conversation.objects.create(customer=self.customer, subject='Đóng ca', assigned_to=consultant)
        self.auth(consultant)
        self.assertEqual(self.client.post(f'/api/conversations/{conv.id}/close/').status_code, 200)
        self.assertEqual(conv.messages.filter(message_type='csat').count(), 1)

    # ---------------- Thẻ phân loại ----------------
    def test_tag_management_and_conversation_filters(self):
        consultant = User.objects.create_user(username='cskh4', password='pass12345', role='consultant')
        conv = Conversation.objects.create(customer=self.customer, subject='Thẻ', assigned_to=consultant)
        conv2 = Conversation.objects.create(customer=self.customer, subject='Không thẻ', assigned_to=consultant)
        self.auth(self.customer)
        self.assertEqual(self.client.get('/api/tags/').status_code, 403)
        self.auth(consultant)
        made = self.client.post('/api/tags/', {'name': 'Khách VIP', 'color': '#ef4444'}, format='json')
        self.assertEqual(made.status_code, 201, made.data)
        self.assertEqual(self.client.post('/api/tags/', {'name': 'khách vip'}, format='json').status_code, 400)
        tid = made.data['id']
        self.assertEqual(self.client.patch(f'/api/tags/{tid}/', {'color': '#22c55e'}, format='json').data['color'], '#22c55e')
        self.client.post(f'/api/conversations/{conv.id}/toggle-tag/', {'tag_id': tid}, format='json')
        rows = self.client.get('/api/conversations/', {'tab': 'mine', 'tag': str(tid)}).data
        self.assertEqual([r['id'] for r in rows], [conv.id])
        self.assertEqual(rows[0]['tags'][0]['name'], 'Khách VIP')
        Message.objects.create(conversation=conv2, sender=self.customer, text='chưa đọc')
        unread = self.client.get('/api/conversations/', {'tab': 'mine', 'unread': '1'}).data
        self.assertEqual([r['id'] for r in unread], [conv2.id])
        self.assertEqual(self.client.delete(f'/api/tags/{tid}/').status_code, 204)

    # ---------------- Trợ lý OHIO: quy trình đặt lịch ----------------
    def _bot(self, **kw):
        kw.setdefault('visitor_key', self.KEY)
        r = self.client.post('/api/chatbot/message/', kw, format='json')
        self.assertEqual(r.status_code, 200, r.data)
        return r.data['reply']['content']

    @patch.dict('os.environ', {'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})
    @patch('api.views._queue_email')
    def test_chatbot_booking_flow_creates_real_booking_only_on_confirm(self, _email):
        staff = self.make_staff()
        self.auth(self.customer)
        day = (timezone.localdate() + timedelta(days=2)).isoformat()
        self.assertIn(f'bk:svc:{self.service.id}', self._bot(action='booking'))
        self.assertIn('bk:date:', self._bot(action=f'bk:svc:{self.service.id}', text='Facial'))
        self.assertIn(f'bk:staff:{staff.id}', self._bot(action=f'bk:date:{day}', text='ngày'))
        self.assertIn('bk:time:1000', self._bot(action='bk:staff:0', text='Bất kỳ'))
        confirm = self._bot(action='bk:time:1000', text='10:00')
        self.assertIn('XÁC NHẬN LỊCH HẸN', confirm)
        self.assertIn('bk:confirm', confirm)
        self.assertEqual(Booking.objects.count(), 0)  # chưa xác nhận => chưa có lịch
        done = self._bot(action='bk:confirm', text='Xác nhận')
        self.assertIn('Đặt lịch thành công', done)
        b = Booking.objects.get()
        self.assertEqual((b.user, b.staff, b.total), (self.customer, staff, 350000))
        # Bấm lại nút Xác nhận cũ không tạo thêm lịch
        self._bot(action='bk:confirm', text='Xác nhận')
        self.assertEqual(Booking.objects.count(), 1)

    @patch.dict('os.environ', {'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})
    def test_chatbot_booking_requires_login_to_confirm_and_keeps_state(self):
        self.make_staff()
        day = (timezone.localdate() + timedelta(days=2)).isoformat()
        for action in (f'bk:svc:{self.service.id}', f'bk:date:{day}', 'bk:staff:0', 'bk:time:1000'):
            self._bot(action=action, text='x')
        reply = self._bot(action='bk:confirm', text='Xác nhận')
        self.assertIn('đăng nhập', reply)
        self.assertEqual(Booking.objects.count(), 0)
        # Đăng nhập xong, cùng visitor_key => xác nhận tiếp được
        self.auth(self.customer)
        self.assertIn('Đặt lịch thành công', self._bot(action='bk:confirm', text='Xác nhận'))
        self.assertEqual(Booking.objects.count(), 1)

    @patch.dict('os.environ', {'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})
    def test_chatbot_booking_free_text_prefills_and_rejects_taken_slot(self):
        staff = self.make_staff()
        tomorrow = timezone.localdate() + timedelta(days=1)
        taken = timezone.make_aware(timezone.datetime.combine(tomorrow, timezone.datetime.min.time().replace(hour=15)))
        Booking.objects.create(staff=staff, appointment=taken, guest_name='A', guest_phone='1', total=1)  # trùng 15:00
        # (Booking không có items => thời lượng mặc định 60 phút)
        reply = self._bot(text='Facial mai 15h đặt được không')
        self.assertNotIn('XÁC NHẬN LỊCH HẸN', reply)      # giờ đã kín: không được xác nhận
        self.assertIn('bk:time:', reply)                   # gợi ý giờ khác thật từ backend
        self.assertNotIn('bk:time:1500', reply)
        reply = self._bot(text='Facial mai 10h đặt được không')
        self.assertIn('XÁC NHẬN LỊCH HẸN', reply)
        self.assertIn('10:00', reply)

    @patch.dict('os.environ', {'GEMINI_API_KEY': '', 'GOOGLE_API_KEY': ''})
    def test_chatbot_account_intents_and_medical_guard(self):
        self.assertIn('đăng nhập', self._bot(text='lịch của tôi'))
        self.customer.loyalty_points = 1234
        self.customer.save(update_fields=['loyalty_points'])
        self.auth(self.customer)
        self.assertIn('1.234', self._bot(text='điểm thành viên của tôi'))
        self.assertIn('bk:svc:', self._bot(text='giá facial test bao nhiêu'))
        self.assertIn('350.000', self._bot(text='giá facial test bao nhiêu'))
        reply = self._bot(text='tôi bị dị ứng thuốc thì dùng được không')
        self.assertIn('không đưa ra chẩn đoán', reply)
        self.assertEqual(Conversation.objects.count(), 0)  # chỉ gợi ý nút, không tự tạo ca
        self.assertIn('Mở cuộc trò chuyện với CSKH', self._bot(text='tôi muốn gặp bác sĩ'))

