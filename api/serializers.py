import secrets
from django.contrib.auth import get_user_model
from django.db import transaction
from django.db.models import Sum
from rest_framework import serializers

from core.models import (
    Attendance, Booking, BookingItem, Category, Conversation, LeaveRequest,
    Message, Notification, Service, Staff, Voucher, VoucherRedemption, WorkingHours, RosterShift,
    Tag, QuickReply, AgentPresence, ChatSetting, InternalNote, ConversationEvent,
)

User = get_user_model()


class UserSerializer(serializers.ModelSerializer):
    full_name = serializers.SerializerMethodField()
    avatar_url = serializers.SerializerMethodField()
    loyalty_tier = serializers.SerializerMethodField()
    total_spending = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = (
            'id', 'username', 'email', 'first_name', 'last_name', 'full_name', 'phone', 'date_of_birth',
            'avatar', 'avatar_url', 'role', 'loyalty_points', 'loyalty_tier', 'membership_tier_override', 'total_spending', 'must_change_password',
        )
        read_only_fields = ('username', 'role', 'loyalty_points', 'membership_tier_override', 'must_change_password', 'avatar_url')
        extra_kwargs = {'avatar': {'write_only': True, 'required': False}}

    def get_full_name(self, obj):
        return obj.get_full_name() or obj.username

    def get_avatar_url(self, obj):
        if not obj.avatar:
            return ''
        request = self.context.get('request')
        try:
            url = obj.avatar.url
        except Exception:
            return ''
        return request.build_absolute_uri(url) if request else url

    def get_total_spending(self, obj):
        if obj.role != 'customer':
            return 0
        from core.models import Booking
        return Booking.objects.filter(user=obj, status=Booking.COMPLETED).aggregate(v=Sum('total'))['v'] or 0

    def get_loyalty_tier(self, obj):
        if obj.role != 'customer':
            return ''
        return obj.membership_tier_override or User.loyalty_tier_for_spend(self.get_total_spending(obj))['name']

    def update(self, instance, validated_data):
        full_name = self.context.get('request').data.get('full_name') if self.context.get('request') else None
        if full_name is not None:
            instance.first_name = str(full_name).strip()
            instance.last_name = ''
        return super().update(instance, validated_data)


class CategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = Category
        fields = ('id', 'name')


class ServiceSerializer(serializers.ModelSerializer):
    category_name = serializers.CharField(source='category.name', read_only=True)
    image_url = serializers.SerializerMethodField()

    class Meta:
        model = Service
        fields = ('id', 'category', 'category_name', 'name', 'description', 'price', 'duration', 'image_url', 'is_active')

    def get_image_url(self, obj):
        if not obj.image:
            return ''
        request = self.context.get('request')
        try:
            url = obj.image.url
        except Exception:
            return ''
        return request.build_absolute_uri(url) if request else url


class StaffSerializer(serializers.ModelSerializer):
    user_id = serializers.IntegerField(source='user.id', read_only=True)
    username = serializers.CharField(write_only=True, required=False)
    email = serializers.EmailField(write_only=True, required=False, allow_blank=True)
    password = serializers.CharField(write_only=True, required=False, min_length=6)
    role = serializers.ChoiceField(choices=['staff', 'doctor'], write_only=True, required=False, default='staff')
    service_ids = serializers.ListField(child=serializers.IntegerField(), write_only=True, required=False)
    account_username = serializers.CharField(source='user.username', read_only=True, default='')
    account_email = serializers.EmailField(source='user.email', read_only=True, default='')
    account_role = serializers.CharField(source='user.role', read_only=True, default='')
    service_names = serializers.SerializerMethodField()
    photo_url = serializers.SerializerMethodField()
    service_ids_current = serializers.SerializerMethodField()

    class Meta:
        model = Staff
        fields = ('id', 'user_id', 'name', 'position', 'phone', 'is_active', 'rating', 'experience_years',
                  'base_salary', 'bonus', 'manual_deduction', 'payroll_status', 'username', 'email', 'password', 'role',
                  'service_ids', 'service_ids_current', 'account_username', 'account_email', 'account_role', 'service_names', 'photo_url')

    def to_representation(self, obj):
        data = super().to_representation(obj)
        req = self.context.get('request')
        if not (req and req.user.is_authenticated and req.user.role in {'manager', 'sysadmin'}):
            for f in ('base_salary', 'bonus', 'manual_deduction', 'payroll_status', 'phone'):
                data.pop(f, None)
        return data

    def get_photo_url(self, obj):
        """Ảnh chân dung (nên là PNG tách nền) tải lên trong Django admin."""
        if not obj.photo:
            return ''
        try:
            url = obj.photo.url
        except Exception:
            return ''
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url

    def get_service_names(self, obj):
        return list(obj.services.order_by('name').values_list('name', flat=True))

    def get_service_ids_current(self, obj):
        return list(obj.services.values_list('id', flat=True))

    def validate_username(self, value):
        if value and User.objects.filter(username=value).exists():
            raise serializers.ValidationError('Tên đăng nhập đã tồn tại.')
        return value

    @transaction.atomic
    def create(self, validated_data):
        service_ids = validated_data.pop('service_ids', [])
        username = validated_data.pop('username', '').strip()
        email = validated_data.pop('email', '')
        password = validated_data.pop('password', '')
        role = validated_data.pop('role', 'staff')
        user = None
        if username:
            user = User.objects.create_user(
                username=username, email=email, password=password or secrets.token_urlsafe(10),
                first_name=validated_data.get('name', ''), phone=validated_data.get('phone', ''),
                role=role, must_change_password=True,
            )
        staff = Staff.objects.create(user=user, **validated_data)
        if service_ids:
            staff.services.set(Service.objects.filter(pk__in=service_ids))
        return staff

    @transaction.atomic
    def update(self, instance, validated_data):
        service_ids = validated_data.pop('service_ids', None)
        email = validated_data.pop('email', None)
        role = validated_data.pop('role', None)
        password = validated_data.pop('password', None)
        validated_data.pop('username', None)
        instance = super().update(instance, validated_data)
        if service_ids is not None:
            instance.services.set(Service.objects.filter(pk__in=service_ids))
        if instance.user:
            changed = []
            if email is not None:
                instance.user.email = email; changed.append('email')
            if role:
                instance.user.role = role; changed.append('role')
            if password:
                instance.user.set_password(password); instance.user.must_change_password = True; changed += ['password','must_change_password']
            if changed:
                instance.user.save()
        return instance


class WorkingHoursSerializer(serializers.ModelSerializer):
    staff_name = serializers.CharField(source='staff.name', read_only=True)
    weekday_label = serializers.CharField(source='get_weekday_display', read_only=True)

    class Meta:
        model = WorkingHours
        fields = ('id', 'staff', 'staff_name', 'weekday', 'weekday_label', 'start_time', 'end_time')


class RosterShiftSerializer(serializers.ModelSerializer):
    staff_name = serializers.CharField(source='staff.name', read_only=True)

    class Meta:
        model = RosterShift
        fields = ('id', 'staff', 'staff_name', 'date', 'is_on_duty', 'note')


class BookingItemSerializer(serializers.ModelSerializer):
    service_name = serializers.CharField(source='service.name', read_only=True)

    class Meta:
        model = BookingItem
        fields = ('id', 'service', 'service_name', 'price')


class BookingSerializer(serializers.ModelSerializer):
    items = BookingItemSerializer(many=True, read_only=True)
    service_ids = serializers.ListField(child=serializers.IntegerField(min_value=1), write_only=True, required=False)
    voucher_id = serializers.IntegerField(write_only=True, required=False, allow_null=True)
    customer_name = serializers.CharField(read_only=True)
    customer_phone = serializers.CharField(read_only=True)
    customer_email = serializers.CharField(read_only=True)
    staff_name = serializers.CharField(source='staff.name', read_only=True, default='')
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    applied_voucher_code = serializers.CharField(source='applied_voucher.code', read_only=True, default='')
    subtotal = serializers.SerializerMethodField()
    patient_code = serializers.CharField(source='patient.code', read_only=True, default='')
    appointment_type_label = serializers.CharField(source='get_appointment_type_display', read_only=True)
    end_time = serializers.DateTimeField(read_only=True)
    duration_minutes = serializers.IntegerField(read_only=True)
    visit_id = serializers.SerializerMethodField()
    visit_status = serializers.SerializerMethodField()

    class Meta:
        model = Booking
        fields = (
            'patient', 'patient_code', 'appointment_type', 'appointment_type_label', 'end_time', 'duration_minutes',
            'visit_id', 'visit_status',
            'id', 'user', 'guest_name', 'guest_phone', 'guest_email', 'confirm_code',
            'staff', 'staff_name', 'appointment', 'subtotal', 'discount_total', 'total', 'note', 'status', 'status_label',
            'applied_voucher', 'applied_voucher_code', 'loyalty_points_earned', 'loyalty_awarded',
            'created_at', 'customer_name', 'customer_phone', 'customer_email', 'items', 'service_ids', 'voucher_id',
        )
        read_only_fields = ('user', 'confirm_code', 'subtotal', 'discount_total', 'total', 'applied_voucher', 'loyalty_points_earned', 'loyalty_awarded', 'created_at')

    def get_subtotal(self, obj):
        return sum(item.price for item in obj.items.all())

    def get_visit_id(self, obj):
        v = getattr(obj, 'visit', None)
        return v.pk if v else None

    def get_visit_status(self, obj):
        v = getattr(obj, 'visit', None)
        return v.status if v else None

    def validate(self, attrs):
        from django.utils import timezone
        from core.availability import has_conflict, qualified_staff
        request = self.context.get('request')
        if request and not request.user.is_authenticated:
            if not (attrs.get('guest_name') and attrs.get('guest_phone')):
                raise serializers.ValidationError('Khách vãng lai cần nhập họ tên và số điện thoại.')
        appointment = attrs.get('appointment')
        if appointment and appointment <= timezone.now():
            raise serializers.ValidationError({'appointment': 'Thời gian hẹn phải ở tương lai.'})
        service_ids = attrs.get('service_ids') or []
        staff = attrs.get('staff')
        if service_ids:
            duration = sum(Service.objects.filter(pk__in=service_ids).values_list('duration', flat=True)) or 60
            if staff:
                eligible = qualified_staff(Staff.objects.filter(pk=staff.pk), service_ids).exists()
                if not eligible:
                    raise serializers.ValidationError({'staff': 'Chuyên viên không thực hiện đủ các dịch vụ đã chọn.'})
                if appointment and has_conflict(staff, appointment, duration):
                    raise serializers.ValidationError({'appointment': 'Khung giờ này không còn khả dụng với chuyên viên đã chọn.'})
            elif appointment:
                candidates = qualified_staff(Staff.objects.all(), service_ids)
                if not any(not has_conflict(candidate, appointment, duration) for candidate in candidates):
                    raise serializers.ValidationError({'appointment': 'Không còn nhân viên phù hợp ở khung giờ này.'})
        voucher_id = attrs.get('voucher_id')
        if voucher_id and (not request or not request.user.is_authenticated or request.user.role != 'customer'):
            raise serializers.ValidationError({'voucher_id': 'Cần đăng nhập tài khoản khách hàng để sử dụng voucher.'})
        return attrs

    def validate_service_ids(self, value):
        if not value:
            raise serializers.ValidationError('Cần chọn ít nhất một dịch vụ.')
        found = set(Service.objects.filter(id__in=value, is_active=True).values_list('id', flat=True))
        missing = set(value) - found
        if missing:
            raise serializers.ValidationError(f'Dịch vụ không hợp lệ: {sorted(missing)}')
        return value

    @transaction.atomic
    def create(self, validated_data):
        from django.utils import timezone
        service_ids = validated_data.pop('service_ids', [])
        voucher_id = validated_data.pop('voucher_id', None)
        request = self.context.get('request')
        staff_roles = {'consultant', 'manager', 'doctor', 'sysadmin'}
        patient = validated_data.get('patient')
        if patient and not (request and request.user.is_authenticated and request.user.role in staff_roles):
            validated_data.pop('patient')  # chỉ nhân viên phòng khám mới được gắn hồ sơ bệnh nhân
            patient = None
        if patient:
            validated_data['guest_name'] = validated_data.get('guest_name') or patient.full_name
            validated_data['guest_phone'] = validated_data.get('guest_phone') or patient.phone
            validated_data['guest_email'] = validated_data.get('guest_email') or patient.email
            validated_data.setdefault('user', patient.user)
        if request and request.user.is_authenticated and request.user.role == 'customer' and not validated_data.get('user'):
            validated_data['user'] = request.user
            validated_data['guest_name'] = validated_data.get('guest_name') or (request.user.get_full_name() or request.user.username)
            validated_data['guest_phone'] = validated_data.get('guest_phone') or request.user.phone
            validated_data['guest_email'] = validated_data.get('guest_email') or request.user.email
        services = list(Service.objects.filter(id__in=service_ids, is_active=True))
        subtotal = sum(service.price for service in services)
        if not validated_data.get('staff') and validated_data.get('appointment'):
            from core.availability import qualified_staff, has_conflict
            duration = sum(service.duration for service in services) or 60
            for candidate in qualified_staff(Staff.objects.all(), service_ids):
                if not has_conflict(candidate, validated_data['appointment'], duration):
                    validated_data['staff'] = candidate
                    break
        voucher = None
        redemption = None
        discount = 0
        if voucher_id and request and request.user.is_authenticated:
            try:
                redemption = VoucherRedemption.objects.select_for_update().select_related('voucher').get(user=request.user, voucher_id=voucher_id, status=VoucherRedemption.AVAILABLE)
            except VoucherRedemption.DoesNotExist:
                raise serializers.ValidationError({'voucher_id': 'Voucher chưa được đổi hoặc đã sử dụng.'})
            voucher = redemption.voucher
            if not voucher.is_active or voucher.is_expired:
                raise serializers.ValidationError({'voucher_id': 'Voucher đã hết hiệu lực.'})
            if subtotal < voucher.min_spend:
                raise serializers.ValidationError({'voucher_id': f'Đơn hàng tối thiểu {voucher.min_spend:,}đ để dùng voucher.'})
            discount = min(voucher.discount_value, subtotal)
        booking = Booking.objects.create(**validated_data, applied_voucher=voucher, discount_total=discount, total=max(0, subtotal-discount))
        for service in services:
            BookingItem.objects.create(booking=booking, service=service, price=service.price)
        if redemption:
            redemption.status = VoucherRedemption.USED
            redemption.used_at = timezone.now()
            redemption.booking = booking
            redemption.save(update_fields=['status', 'used_at', 'booking'])
        return booking


class AttendanceSerializer(serializers.ModelSerializer):
    staff_name = serializers.SerializerMethodField()
    status_label = serializers.CharField(source='get_status_display', read_only=True)

    class Meta:
        model = Attendance
        fields = ('id', 'staff', 'staff_name', 'date', 'check_in', 'check_out', 'status', 'status_label', 'note', 'hours')

    def get_staff_name(self, obj):
        return obj.staff.get_full_name() or obj.staff.username


class LeaveRequestSerializer(serializers.ModelSerializer):
    staff_name = serializers.SerializerMethodField()

    class Meta:
        model = LeaveRequest
        fields = ('id', 'staff', 'staff_name', 'start_date', 'end_date', 'leave_type', 'reason', 'status', 'days', 'created_at')
        read_only_fields = ('staff', 'status', 'created_at')

    def get_staff_name(self, obj):
        return obj.staff.get_full_name() or obj.staff.username


class VoucherSerializer(serializers.ModelSerializer):
    is_expired = serializers.BooleanField(read_only=True)
    redeemed = serializers.SerializerMethodField()
    redemption_status = serializers.SerializerMethodField()

    class Meta:
        model = Voucher
        fields = ('id', 'code', 'title', 'description', 'points_cost', 'discount_value', 'min_spend', 'expires_at', 'is_active', 'is_expired', 'redeemed', 'redemption_status')

    def _redemption(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return None
        return VoucherRedemption.objects.filter(user=request.user, voucher=obj).first()

    def get_redeemed(self, obj):
        return bool(self._redemption(obj))

    def get_redemption_status(self, obj):
        redemption = self._redemption(obj)
        return redemption.status if redemption else ''


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ('id', 'event_type', 'title', 'message', 'data', 'is_read', 'created_at')
        read_only_fields = fields


class TagSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tag
        fields = ('id', 'name', 'color')


class QuickReplySerializer(serializers.ModelSerializer):
    class Meta:
        model = QuickReply
        fields = ('id', 'title', 'body')


class InternalNoteSerializer(serializers.ModelSerializer):
    author_name = serializers.SerializerMethodField()

    class Meta:
        model = InternalNote
        fields = ('id', 'author', 'author_name', 'text', 'created_at')
        read_only_fields = ('author', 'created_at')

    def get_author_name(self, obj):
        return obj.author.get_full_name() or obj.author.username


class ConversationEventSerializer(serializers.ModelSerializer):
    actor_name = serializers.SerializerMethodField()
    event_label = serializers.CharField(source='get_event_type_display', read_only=True)

    class Meta:
        model = ConversationEvent
        fields = ('id', 'event_type', 'event_label', 'actor_name', 'meta', 'created_at')

    def get_actor_name(self, obj):
        return (obj.actor.get_full_name() or obj.actor.username) if obj.actor else 'Hệ thống'


class MessageSerializer(serializers.ModelSerializer):
    sender_name = serializers.SerializerMethodField()
    sender_role = serializers.CharField(source='sender.role', read_only=True)
    attachment_url = serializers.SerializerMethodField()

    class Meta:
        model = Message
        fields = ('id', 'conversation', 'sender', 'sender_name', 'sender_role', 'text', 'message_type',
                  'attachment', 'attachment_url', 'attachment_name', 'attachment_mime', 'attachment_size', 'created_at')
        read_only_fields = ('sender', 'created_at', 'attachment_name', 'attachment_mime', 'attachment_size', 'message_type', 'attachment_url')
        extra_kwargs = {'attachment': {'write_only': True, 'required': False}}

    def get_sender_name(self, obj):
        return obj.sender.get_full_name() or obj.sender.username

    def get_attachment_url(self, obj):
        if not obj.attachment:
            return ''
        try:
            url = obj.attachment.url
        except Exception:
            return ''
        # Giữ URL tương đối để frontend Docker/Nginx cùng origin luôn mở đúng /media/.
        return url


class ConversationSerializer(serializers.ModelSerializer):
    customer_name = serializers.SerializerMethodField()
    customer_phone = serializers.CharField(source='customer.phone', read_only=True, default='')
    customer_email = serializers.EmailField(source='customer.email', read_only=True, default='')
    customer_avatar_url = serializers.SerializerMethodField()
    customer_loyalty_points = serializers.IntegerField(source='customer.loyalty_points', read_only=True, default=0)
    customer_tier = serializers.SerializerMethodField()
    customer_total_spending = serializers.SerializerMethodField()
    assigned_name = serializers.SerializerMethodField()
    escalated_name = serializers.SerializerMethodField()
    takeover_name = serializers.SerializerMethodField()
    messages = MessageSerializer(many=True, read_only=True)
    tags = TagSerializer(many=True, read_only=True)
    notes = InternalNoteSerializer(many=True, read_only=True)
    events = ConversationEventSerializer(many=True, read_only=True)
    unread_count = serializers.SerializerMethodField()
    last_message = serializers.SerializerMethodField()
    last_message_at = serializers.SerializerMethodField()
    waiting_minutes = serializers.SerializerMethodField()
    sla_state = serializers.SerializerMethodField()
    sla_minutes = serializers.SerializerMethodField()
    next_actor = serializers.SerializerMethodField()
    read_only = serializers.SerializerMethodField()

    class Meta:
        model = Conversation
        fields = (
            'id', 'customer', 'customer_name', 'customer_phone', 'customer_email', 'customer_avatar_url',
            'customer_loyalty_points', 'customer_tier', 'customer_total_spending',
            'subject', 'assigned_to', 'assigned_name', 'escalated_to', 'escalated_name', 'taken_over_by', 'takeover_name',
            'status', 'priority', 'tags', 'first_response_at', 'resolved_at',
            'csat_score', 'csat_comment', 'messages', 'notes', 'events', 'unread_count', 'last_message', 'last_message_at',
            'waiting_minutes', 'sla_state', 'sla_minutes', 'next_actor', 'read_only', 'created_at', 'updated_at',
        )
        read_only_fields = ('customer', 'first_response_at', 'resolved_at', 'csat_score', 'csat_comment', 'created_at', 'updated_at')

    def get_customer_name(self, obj):
        return obj.customer.get_full_name() or obj.customer.username

    def get_customer_avatar_url(self, obj):
        if not obj.customer.avatar:
            return ''
        try:
            url = obj.customer.avatar.url
        except Exception:
            return ''
        request = self.context.get('request')
        return request.build_absolute_uri(url) if request else url

    def get_customer_total_spending(self, obj):
        spend_map = self.context.get('spend_map')
        if spend_map is not None:
            return spend_map.get(obj.customer_id, 0)
        return Booking.objects.filter(user=obj.customer, status=Booking.COMPLETED).aggregate(v=Sum('total'))['v'] or 0

    def get_customer_tier(self, obj):
        spend = self.get_customer_total_spending(obj)
        return obj.customer.membership_tier_override or User.loyalty_tier_for_spend(spend)['name']

    def get_assigned_name(self, obj):
        return (obj.assigned_to.get_full_name() or obj.assigned_to.username) if obj.assigned_to else ''

    def get_escalated_name(self, obj):
        return (obj.escalated_to.get_full_name() or obj.escalated_to.username) if obj.escalated_to else ''

    def get_takeover_name(self, obj):
        return (obj.taken_over_by.get_full_name() or obj.taken_over_by.username) if obj.taken_over_by else ''

    def get_unread_count(self, obj):
        unread_map = self.context.get('unread_map')
        if unread_map is not None:
            return unread_map.get(obj.pk, 0)
        request = self.context.get('request')
        return obj.unread_for(request.user) if request and request.user.is_authenticated else 0

    def _cfg(self):
        cfg = self.context.get('chat_cfg')
        if cfg is None:
            cfg = ChatSetting.load()
            self.context['chat_cfg'] = cfg
        return cfg

    def _last(self, obj):
        if hasattr(obj, '_last_msg_cache'):
            return obj._last_msg_cache
        if hasattr(obj, 'last_at_a'):
            from types import SimpleNamespace
            cached = SimpleNamespace(created_at=obj.last_at_a, sender_id=obj.last_sender_a, text=obj.last_text_a or '',
                                     message_type=obj.last_type_a or 'text', attachment_name=obj.last_att_a or '') if obj.last_at_a else None
        else:
            cached = obj.messages.select_related('sender').order_by('-created_at', '-id').first()
        obj._last_msg_cache = cached
        return cached

    def get_last_message(self, obj):
        m = self._last(obj)
        if not m:
            return obj.subject or ''
        if m.text:
            return m.text
        return m.attachment_name or ('Hình ảnh' if m.message_type == Message.IMAGE else 'Tệp đính kèm')

    def get_last_message_at(self, obj):
        m = self._last(obj)
        return m.created_at if m else obj.updated_at

    def get_waiting_minutes(self, obj):
        m = self._last(obj)
        if not m or m.sender_id != obj.customer_id or obj.status == Conversation.CLOSED:
            return None
        from django.utils import timezone
        return max(0, int((timezone.now() - m.created_at).total_seconds() // 60))

    def get_sla_minutes(self, obj):
        return self._cfg().sla_minutes

    def get_sla_state(self, obj):
        waiting = self.get_waiting_minutes(obj)
        if waiting is None:
            return 'none'
        sla = max(1, self._cfg().sla_minutes)
        if waiting >= sla:
            return 'overdue'
        if waiting >= max(1, int(sla * 0.7)):
            return 'warning'
        return 'normal'

    def get_next_actor(self, obj):
        m = self._last(obj)
        if not m:
            return 'staff'
        return 'staff' if m.sender_id == obj.customer_id else 'customer'

    def get_read_only(self, obj):
        request = self.context.get('request')
        if not request or not request.user.is_authenticated:
            return True
        user = request.user
        if user.role == 'manager':
            return obj.taken_over_by_id != user.pk
        if user.role == 'consultant':
            return obj.assigned_to_id not in (None, user.pk)
        if user.role == 'doctor':
            return obj.escalated_to_id != user.pk
        return user.pk != obj.customer_id



class ConversationListSerializer(ConversationSerializer):
    """Bản gọn cho hàng chờ: bỏ messages/notes/events (tải riêng khi mở hội thoại)."""
    messages = None
    notes = None
    events = None

    class Meta(ConversationSerializer.Meta):
        fields = tuple(f for f in ConversationSerializer.Meta.fields if f not in ('messages', 'notes', 'events'))
