from datetime import datetime, date, timedelta
from types import SimpleNamespace
import secrets
import random

from django.conf import settings
from django.contrib.auth import authenticate, get_user_model
from django.contrib.auth.hashers import make_password, check_password
from django.core.mail import send_mail
from django.db import IntegrityError, transaction
from django.db.models import Case, Count, IntegerField, OuterRef, Q, Subquery, Sum, When
from django.utils import timezone
from django.utils.dateparse import parse_date
from rest_framework import permissions, status, viewsets
from rest_framework.authtoken.models import Token
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import ValidationError
from rest_framework.pagination import PageNumberPagination
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import PasswordResetCode
from core.models import Attendance, Booking, BookingHistory, Category, Conversation, ConversationSession, LeaveRequest, Message, Notification, Service, Staff, Voucher, VoucherRedemption, WorkingHours, RosterShift, Tag, QuickReply, AgentPresence, ChatSetting, InternalNote, ConversationEvent, ConversationRead
from . import chatbot
from .firebase import create_custom_token, mirror_message, sync_conversation, mark_notification_read
from .events import broadcast_dashboard, notify_roles, notify_users
from .media import upload_to_cloudinary
from .permissions import CanCompleteBooking, IsManagerRole, IsStaffRole
from .serializers import (
    AttendanceSerializer, BookingSerializer, booking_request_fingerprint, ConversationListSerializer, ConversationSerializer, LeaveRequestSerializer,
    MessageSerializer, NotificationSerializer, ServiceSerializer, StaffSerializer, UserSerializer, VoucherSerializer, WorkingHoursSerializer, RosterShiftSerializer, CategorySerializer, TagSerializer, QuickReplySerializer, InternalNoteSerializer, ConversationEventSerializer,
)

User = get_user_model()
CUSTOMER_BOOKING_CHANGE_NOTICE = timedelta(hours=24)


def _queue_email(booking, request, event):
    try:
        from .tasks import send_booking_email_task
        send_booking_email_task.delay(booking.pk, event=event)
    except Exception:
        from core.booking_notifications import queue_booking_email
        queue_booking_email(booking.pk, event=event)


class RegisterView(APIView):
    # Public token endpoints must not inherit SessionAuthentication. A stale
    # Django session cookie would otherwise make DRF require a CSRF token
    # before a user can sign in or create a new account.
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        username = (request.data.get('username') or '').strip()
        password = request.data.get('password') or ''
        full_name = (request.data.get('full_name') or '').strip()
        email = (request.data.get('email') or '').strip()
        phone = (request.data.get('phone') or '').strip()
        if not username or not password:
            return Response({'detail': 'Thiếu tên đăng nhập hoặc mật khẩu.'}, status=400)
        if len(password) < 6:
            return Response({'detail': 'Mật khẩu cần ít nhất 6 ký tự.'}, status=400)
        if User.objects.filter(username=username).exists():
            return Response({'detail': 'Tên đăng nhập đã tồn tại.'}, status=400)
        if email and User.objects.filter(email__iexact=email).exists():
            return Response({'detail': 'Email này đã được sử dụng.'}, status=400)
        user = User.objects.create_user(username=username, password=password, email=email, first_name=full_name, phone=phone, role='customer')
        token, _ = Token.objects.get_or_create(user=user)
        return Response({'token': token.key, 'user': UserSerializer(user, context={'request': request}).data}, status=201)


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        username = request.data.get('username', '').strip()
        password = request.data.get('password', '')
        user = authenticate(request=request, username=username, password=password)
        if not user or not user.is_active:
            return Response({'detail': 'Tên đăng nhập hoặc mật khẩu không đúng.'}, status=status.HTTP_400_BAD_REQUEST)
        token, _ = Token.objects.get_or_create(user=user)
        return Response({'token': token.key, 'user': UserSerializer(user, context={'request': request}).data})


class LogoutView(APIView):
    def post(self, request):
        Token.objects.filter(user=request.user).delete()
        return Response(status=status.HTTP_204_NO_CONTENT)


class MeView(APIView):
    def get(self, request):
        return Response(UserSerializer(request.user, context={'request': request}).data)

    def patch(self, request):
        serializer = UserSerializer(request.user, data=request.data, partial=True, context={'request': request})
        serializer.is_valid(raise_exception=True)
        serializer.save()
        notify_users([request.user], 'profile.updated', 'Hồ sơ đã cập nhật', 'Thông tin hồ sơ của bạn đã được lưu.')
        return Response(serializer.data)


class ChangePasswordView(APIView):
    def post(self, request):
        current = request.data.get('current_password') or ''
        new_password = request.data.get('new_password') or ''
        if not request.user.check_password(current):
            return Response({'detail': 'Mật khẩu hiện tại không đúng.'}, status=400)
        if len(new_password) < 6:
            return Response({'detail': 'Mật khẩu mới cần ít nhất 6 ký tự.'}, status=400)
        request.user.set_password(new_password)
        request.user.must_change_password = False
        request.user.save(update_fields=['password', 'must_change_password'])
        Token.objects.filter(user=request.user).delete()
        token = Token.objects.create(user=request.user)
        return Response({'token': token.key, 'user': UserSerializer(request.user, context={'request': request}).data})


class ForgotPasswordRequestView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        if not email:
            return Response({'detail': 'Vui lòng nhập email.'}, status=400)
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        # Always return success to avoid account enumeration.
        if not user:
            return Response({'detail': 'Nếu email tồn tại, mã xác minh đã được gửi.'})
        code = f'{random.randint(0, 999999):06d}'
        PasswordResetCode.objects.filter(email__iexact=email, used=False).update(used=True)
        obj = PasswordResetCode.objects.create(
            email=email, code_hash=make_password(code),
            expires_at=timezone.now() + timedelta(minutes=settings.PASSWORD_RESET_CODE_TTL_MINUTES),
        )
        if settings.DEBUG and not settings.EMAIL_HOST_PASSWORD:
            return Response({'detail': 'SMTP chưa cấu hình. Đang dùng mã test local.', 'debug_code': code})
        try:
            send_mail(
                'Mã xác minh đặt lại mật khẩu AkinaClinic',
                f'Mã xác minh của bạn là: {code}. Mã có hiệu lực {settings.PASSWORD_RESET_CODE_TTL_MINUTES} phút.',
                settings.DEFAULT_FROM_EMAIL, [email], fail_silently=False,
            )
        except Exception:
            return Response({'detail': 'Không thể gửi email lúc này. Kiểm tra EMAIL_HOST_USER và Gmail App Password.'}, status=503)
        return Response({'detail': 'Mã xác minh đã được gửi qua email.'})


class ForgotPasswordVerifyView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        code = (request.data.get('code') or '').strip()
        obj = PasswordResetCode.objects.filter(email__iexact=email, used=False).first()
        if not obj or obj.expires_at < timezone.now():
            return Response({'detail': 'Mã đã hết hạn hoặc không tồn tại.'}, status=400)
        if obj.attempts >= 5:
            return Response({'detail': 'Bạn đã nhập sai quá nhiều lần. Hãy yêu cầu mã mới.'}, status=400)
        if not check_password(code, obj.code_hash):
            obj.attempts += 1
            obj.save(update_fields=['attempts'])
            return Response({'detail': 'Mã xác minh không đúng.'}, status=400)
        obj.verified = True
        obj.reset_token = secrets.token_urlsafe(32)
        obj.save(update_fields=['verified', 'reset_token'])
        return Response({'reset_token': obj.reset_token})


class ForgotPasswordResetView(APIView):
    authentication_classes = []
    permission_classes = [permissions.AllowAny]

    def post(self, request):
        email = (request.data.get('email') or '').strip().lower()
        reset_token = request.data.get('reset_token') or ''
        new_password = request.data.get('new_password') or ''
        if len(new_password) < 6:
            return Response({'detail': 'Mật khẩu mới cần ít nhất 6 ký tự.'}, status=400)
        obj = PasswordResetCode.objects.filter(email__iexact=email, reset_token=reset_token, verified=True, used=False).first()
        if not obj or obj.expires_at < timezone.now():
            return Response({'detail': 'Phiên đặt lại mật khẩu đã hết hạn.'}, status=400)
        user = User.objects.filter(email__iexact=email, is_active=True).first()
        if not user:
            return Response({'detail': 'Không tìm thấy tài khoản.'}, status=404)
        user.set_password(new_password)
        user.must_change_password = False
        user.save(update_fields=['password', 'must_change_password'])
        Token.objects.filter(user=user).delete()
        obj.used = True
        obj.save(update_fields=['used'])
        return Response({'detail': 'Đổi mật khẩu thành công. Bạn có thể đăng nhập bằng mật khẩu mới.'})


class CategoryViewSet(viewsets.ModelViewSet):
    serializer_class = CategorySerializer
    queryset = Category.objects.all().order_by('name')

    def get_permissions(self):
        if self.action in {'list', 'retrieve'}:
            return [permissions.AllowAny()]
        return [IsManagerRole()]


class ServiceViewSet(viewsets.ModelViewSet):
    serializer_class = ServiceSerializer
    queryset = Service.objects.select_related('category').all().order_by('name')

    def get_permissions(self):
        if self.action in {'list', 'retrieve'}:
            return [permissions.AllowAny()]
        return [IsManagerRole()]


class StaffViewSet(viewsets.ModelViewSet):
    serializer_class = StaffSerializer
    queryset = Staff.objects.select_related('user').prefetch_related('services').order_by('name')

    def get_queryset(self):
        qs = self.queryset
        if self.request.user.is_authenticated and self.request.user.role in {'manager', 'sysadmin'}:
            return qs
        return qs.filter(is_active=True)

    def get_permissions(self):
        if self.action in {'list', 'retrieve'}:
            return [permissions.AllowAny()]
        return [IsManagerRole()]


    def perform_destroy(self, instance):
        user = instance.user
        instance.delete()
        if user:
            user.is_active = False
            user.save(update_fields=['is_active'])

    @action(detail=True, methods=['post'], permission_classes=[IsManagerRole])
    def notify_payroll(self, request, pk=None):
        staff = self.get_object()
        if not staff.user:
            return Response({'detail': 'Nhân sự này chưa có tài khoản đăng nhập.'}, status=400)
        notify_users([staff.user], 'payroll.updated', 'Bảng lương đã được cập nhật', 'Quản lý vừa cập nhật trạng thái bảng lương của bạn.', {'staff_id': staff.pk})
        return Response({'detail': 'Đã gửi thông báo cho nhân sự.'})


class WorkingHoursViewSet(viewsets.ModelViewSet):
    serializer_class = WorkingHoursSerializer
    queryset = WorkingHours.objects.select_related('staff', 'staff__user').all()

    def get_queryset(self):
        qs = self.queryset
        staff_id = self.request.query_params.get('staff_id')
        if staff_id:
            qs = qs.filter(staff_id=staff_id)
        user = self.request.user
        if user.is_authenticated and user.role in {'manager', 'sysadmin'}:
            return qs
        if user.is_authenticated and user.role in {'staff', 'doctor'}:
            return qs.filter(staff__user=user)
        return qs.none()

    def get_permissions(self):
        if self.action in {'list', 'retrieve'}:
            return [permissions.IsAuthenticated()]
        return [IsManagerRole()]


class RosterShiftViewSet(viewsets.ModelViewSet):
    serializer_class = RosterShiftSerializer
    permission_classes = [IsManagerRole]
    queryset = RosterShift.objects.select_related('staff').all()

    def get_queryset(self):
        qs = self.queryset
        date_value = self.request.query_params.get('date')
        if date_value:
            qs = qs.filter(date=date_value)
        return qs

    @action(detail=False, methods=['post'])
    def toggle(self, request):
        staff_id = request.data.get('staff')
        date_value = request.data.get('date')
        if not staff_id or not date_value:
            return Response({'detail': 'Thiếu nhân sự hoặc ngày.'}, status=400)
        obj, _ = RosterShift.objects.get_or_create(staff_id=staff_id, date=date_value, defaults={'is_on_duty': True})
        obj.is_on_duty = not obj.is_on_duty
        obj.save(update_fields=['is_on_duty'])
        broadcast_dashboard('roster.changed', {'staff_id': staff_id, 'date': date_value, 'is_on_duty': obj.is_on_duty})
        return Response(self.get_serializer(obj).data)


def after_booking_created(booking, request):
    """Email + thông báo + dashboard sau khi tạo lịch hẹn (dùng chung cho trang đặt lịch và Trợ lý AkinaClinic)."""
    _queue_email(booking, request, 'created')
    data = {'booking_id': booking.pk, 'status': booking.status, 'appointment': booking.appointment.isoformat()}
    notify_roles(['manager', 'sysadmin', 'consultant'], 'booking.created', 'Có lịch hẹn mới', f'{booking.customer_name} vừa tạo lịch hẹn #{booking.pk}.', data)
    if booking.staff and booking.staff.user:
        notify_users([booking.staff.user], 'booking.assigned', 'Bạn có lịch hẹn mới', f'Lịch hẹn #{booking.pk} đã được phân công cho bạn.', data)
    if booking.user:
        notify_users([booking.user], 'booking.created', 'Đặt lịch thành công', f'Lịch hẹn #{booking.pk} đang chờ xác nhận.', data)
    broadcast_dashboard('booking.created', data)


class BookingListPagination(PageNumberPagination):
    page_size = 20
    page_size_query_param = 'page_size'
    max_page_size = 100


class BookingViewSet(viewsets.ModelViewSet):
    serializer_class = BookingSerializer
    pagination_class = BookingListPagination
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        user = self.request.user
        qs = Booking.objects.select_related(
            'user', 'staff', 'patient', 'visit', 'follow_up_visit', 'treatment_session__plan',
        ).prefetch_related('items__service', 'history__actor')
        if not user.is_authenticated:
            return qs.none()
        p = self.request.query_params
        start_date = parse_date(p['from']) if p.get('from') else None
        end_date = parse_date(p['to']) if p.get('to') else None
        if p.get('from') and start_date is None:
            raise ValidationError({'from': 'Ngày bắt đầu không hợp lệ.'})
        if p.get('to') and end_date is None:
            raise ValidationError({'to': 'Ngày kết thúc không hợp lệ.'})
        if start_date and end_date and start_date > end_date:
            raise ValidationError({'to': 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.'})
        if start_date:
            qs = qs.filter(appointment__date__gte=start_date)
        if end_date:
            qs = qs.filter(appointment__date__lte=end_date)
        if p.get('patient'):
            qs = qs.filter(patient_id=p['patient'])
        if p.get('status'):
            statuses = [value.strip() for value in p['status'].split(',') if value.strip()]
            valid_statuses = {value for value, _ in Booking.STATUS}
            invalid_statuses = set(statuses) - valid_statuses
            if not statuses or invalid_statuses:
                raise ValidationError({'status': 'Trạng thái lịch hẹn không hợp lệ.'})
            qs = qs.filter(status__in=statuses)
        if p.get('staff'):
            try:
                staff_id = int(p['staff'])
            except (TypeError, ValueError):
                raise ValidationError({'staff': 'Nhân sự không hợp lệ.'})
            qs = qs.filter(staff_id=staff_id)
        search = p.get('q', '').strip()
        if len(search) > 100:
            raise ValidationError({'q': 'Từ khóa tìm kiếm tối đa 100 ký tự.'})
        if search:
            for term in search.split():
                lookup = (
                    Q(guest_name__icontains=term)
                    | Q(guest_phone__icontains=term)
                    | Q(user__first_name__icontains=term)
                    | Q(user__last_name__icontains=term)
                    | Q(user__username__icontains=term)
                    | Q(patient__full_name__icontains=term)
                    | Q(staff__name__icontains=term)
                    | Q(items__service__name__icontains=term)
                    | Q(confirm_code__icontains=term)
                )
                if term.isdecimal() and len(term) <= 18:
                    lookup |= Q(pk=int(term))
                qs = qs.filter(lookup)
            qs = qs.distinct()
        if user.role in {'manager', 'sysadmin', 'consultant'}:
            return qs
        if user.role in {'staff', 'doctor'}:
            staff = getattr(user, 'staff_profile', None)
            return qs.filter(staff=staff) if staff else qs.none()
        return qs.filter(user=user)

    def list(self, request, *args, **kwargs):
        queryset = self.filter_queryset(self.get_queryset())
        if request.query_params.get('view') != 'list':
            serializer = self.get_serializer(queryset, many=True)
            return Response(serializer.data)
        if 'pending' in {value.strip() for value in request.query_params.get('status', '').split(',')}:
            queryset = queryset.order_by('appointment', 'pk')
        else:
            queryset = queryset.order_by('-created_at', 'pk')
        page = self.paginate_queryset(queryset)
        if page is not None:
            serializer = self.get_serializer(page, many=True)
            return self.get_paginated_response(serializer.data)
        serializer = self.get_serializer(queryset, many=True)
        return Response(serializer.data)

    def get_permissions(self):
        if self.action == 'create':
            return [permissions.AllowAny()]
        if self.action in {'update', 'partial_update', 'destroy'}:
            return [IsStaffRole()]
        return [permissions.IsAuthenticated()]

    def perform_create(self, serializer):
        booking = serializer.save()
        after_booking_created(booking, self.request)

    def create(self, request, *args, **kwargs):
        idempotency_key = request.headers.get('Idempotency-Key', '').strip()
        if idempotency_key:
            if len(idempotency_key) > 128:
                return Response({'detail': 'Idempotency-Key tối đa 128 ký tự.'}, status=400)
            fingerprint = booking_request_fingerprint(request)
            existing = Booking.objects.filter(idempotency_key=idempotency_key).first()
            if existing:
                same_owner = (
                    existing.user_id == request.user.id
                    if request.user.is_authenticated
                    else existing.user_id is None
                    and existing.guest_phone == request.data.get('guest_phone', '')
                )
                if not same_owner or existing.idempotency_fingerprint != fingerprint:
                    return Response(
                        {'detail': 'Idempotency-Key đã được dùng cho một yêu cầu khác.'},
                        status=409,
                    )
                return Response(
                    self.get_serializer(existing).data,
                    status=status.HTTP_200_OK,
                )
        try:
            return super().create(request, *args, **kwargs)
        except IntegrityError:
            if not idempotency_key:
                raise
            existing = Booking.objects.filter(idempotency_key=idempotency_key).first()
            if not existing:
                raise
            same_owner = (
                existing.user_id == request.user.id
                if request.user.is_authenticated
                else existing.user_id is None
                and existing.guest_phone == request.data.get('guest_phone', '')
            )
            if not same_owner or existing.idempotency_fingerprint != booking_request_fingerprint(request):
                return Response(
                    {'detail': 'Idempotency-Key đã được dùng cho một yêu cầu khác.'},
                    status=409,
                )
            return Response(self.get_serializer(existing).data, status=status.HTTP_200_OK)

    @action(detail=True, methods=['post'], permission_classes=[IsStaffRole])
    def confirm(self, request, pk=None):
        with transaction.atomic():
            booking = Booking.objects.select_for_update().select_related(
                'treatment_session__plan__doctor',
                'treatment_session__plan__service',
                'staff',
            ).get(pk=self.get_object().pk)
            if request.user.role == 'staff':
                return Response({'detail': 'Nhân viên chỉ tiếp nhận lịch được phân công; lễ tân hoặc bác sĩ xác nhận lịch.'}, status=403)
            if booking.status != Booking.PENDING:
                return Response({'detail': 'Chỉ lịch đang chờ xác nhận mới có thể xác nhận.'}, status=400)
            if booking.treatment_session_id:
                from core.availability import qualified_staff
                from clinic.models import TreatmentPlan, TreatmentSession

                session = TreatmentSession.objects.select_for_update().select_related(
                    'plan__doctor', 'plan__service',
                ).get(pk=booking.treatment_session_id)
                service_ids = list(booking.items.values_list('service_id', flat=True))
                if (
                    session.status != TreatmentSession.PENDING
                    or session.plan.status != TreatmentPlan.ACTIVE
                    or not session.plan.doctor_id
                    or not session.plan.doctor.is_active
                    or not session.plan.service_id
                    or not session.plan.service.is_active
                    or service_ids != [session.plan.service_id]
                ):
                    return Response({'detail': 'Buổi liệu trình không còn đủ điều kiện xác nhận.'}, status=400)
                eligible = qualified_staff(
                    Staff.objects.filter(
                        is_active=True,
                        user__is_active=True,
                        user__role__in=['doctor', 'staff'],
                    ),
                    service_ids,
                )
                if not session.allow_staff_delegation:
                    eligible = eligible.filter(user_id=session.plan.doctor_id)
                if not booking.staff_id or not eligible.filter(pk=booking.staff_id).exists():
                    return Response({'detail': 'Người được phân công không đủ điều kiện theo chỉ định của bác sĩ phụ trách.'}, status=400)
            old_status = booking.status
            booking.status = Booking.CONFIRMED
            booking.save(update_fields=['status'])
            BookingHistory.objects.create(
                booking=booking, actor=request.user, event='confirmed',
                old_status=old_status, new_status=booking.status,
                old_appointment=booking.appointment, new_appointment=booking.appointment,
            )
        _queue_email(booking, request, 'confirmed')
        data = {'booking_id': booking.pk, 'status': booking.status}
        targets = [booking.user] if booking.user else []
        if booking.staff and booking.staff.user: targets.append(booking.staff.user)
        notify_users(targets, 'booking.confirmed', 'Lịch hẹn đã được xác nhận', f'Lịch hẹn #{booking.pk} đã được xác nhận.', data)
        broadcast_dashboard('booking.confirmed', data)
        return Response(self.get_serializer(booking).data)

    @action(detail=True, methods=['post'], permission_classes=[CanCompleteBooking])
    def complete(self, request, pk=None):
        from django.db import transaction
        from clinic.models import TreatmentSession, Visit

        with transaction.atomic():
            booking = Booking.objects.select_for_update().select_related(
                'treatment_session',
            ).get(pk=self.get_object().pk)
            if booking.status in {Booking.CANCELLED, Booking.NO_SHOW}:
                return Response({'detail': 'Lịch đã hủy hoặc khách không đến, không thể hoàn thành.'}, status=400)
            if booking.status == Booking.COMPLETED:
                return Response(self.get_serializer(booking).data)
            if booking.status not in {Booking.CHECKED_IN, Booking.IN_PROGRESS}:
                return Response({'detail': 'Chỉ lịch đã check-in hoặc đang phục vụ mới có thể hoàn thành.'}, status=400)
            visit = Visit.objects.filter(booking=booking).first()
            if not visit or visit.status != Visit.COMPLETED:
                return Response({
                    'detail': 'Chỉ hoàn tất lịch từ lượt khám sau khi bác sĩ kết thúc chuyên môn.',
                }, status=400)
            if (
                booking.treatment_session_id
                and booking.treatment_session.status != TreatmentSession.DONE
            ):
                return Response({
                    'detail': 'Buổi liệu trình phải được ghi nhận đã thực hiện trước khi hoàn tất lịch.',
                }, status=400)
            old_status = booking.status
            booking.status = Booking.COMPLETED
            if booking.user and not booking.loyalty_awarded:
                points = (
                    max(1, int(booking.total / max(1, settings.LOYALTY_VND_PER_POINT)))
                    if booking.total else 0
                )
                booking.user.loyalty_points = (booking.user.loyalty_points or 0) + points
                booking.user.save(update_fields=['loyalty_points'])
                booking.loyalty_awarded = True
                booking.loyalty_points_earned = points
            booking.save(update_fields=['status', 'loyalty_awarded', 'loyalty_points_earned'])
            BookingHistory.objects.create(
                booking=booking, actor=request.user, event='completed',
                old_status=old_status, new_status=booking.status,
                old_appointment=booking.appointment, new_appointment=booking.appointment,
            )
        data = {'booking_id': booking.pk, 'status': booking.status, 'points': booking.loyalty_points_earned}
        if booking.user:
            notify_users([booking.user], 'booking.completed', 'Dịch vụ đã hoàn thành', f'Bạn nhận được {booking.loyalty_points_earned} điểm thưởng từ lịch hẹn #{booking.pk}.', data)
        notify_roles(['manager', 'sysadmin'], 'booking.completed', 'Lịch hẹn hoàn thành', f'Lịch hẹn #{booking.pk} đã hoàn thành.', data)
        broadcast_dashboard('booking.completed', data)
        return Response(self.get_serializer(booking).data)

    @action(detail=True, methods=['post'], permission_classes=[IsStaffRole])
    @transaction.atomic
    def hold(self, request, pk=None):
        booking = self.get_object()
        if booking.status not in {Booking.PENDING, Booking.CONFIRMED}:
            return Response({'detail': 'Chỉ lịch đang chờ hoặc đã xác nhận mới có thể đưa về chờ xử lý.'}, status=400)
        old_status = booking.status
        booking.status = Booking.PENDING
        booking.save(update_fields=['status'])
        BookingHistory.objects.create(
            booking=booking, actor=request.user, event='held',
            old_status=old_status, new_status=Booking.PENDING,
            old_appointment=booking.appointment, new_appointment=booking.appointment,
        )
        data = {'booking_id': booking.pk, 'status': booking.status}
        if booking.user:
            notify_users([booking.user], 'booking.pending', 'Lịch hẹn đang chờ xử lý', f'Lịch hẹn #{booking.pk} đang được giữ ở trạng thái chờ xác nhận.', data)
        broadcast_dashboard('booking.pending', data)
        return Response(self.get_serializer(booking).data)

    @action(detail=True, methods=['post'])
    @transaction.atomic
    def cancel(self, request, pk=None):
        with transaction.atomic():
            booking = Booking.objects.select_for_update().get(pk=self.get_object().pk)
            if booking.status not in {Booking.PENDING, Booking.CONFIRMED}:
                return Response({'detail': 'Chỉ lịch đang chờ hoặc đã xác nhận mới có thể hủy.'}, status=400)
            if (
                request.user.role == 'customer'
                and booking.appointment < timezone.now() + CUSTOMER_BOOKING_CHANGE_NOTICE
            ):
                return Response({
                    'detail': 'Bạn chỉ có thể tự hủy lịch trước giờ hẹn ít nhất 24 giờ. Vui lòng liên hệ phòng khám để được hỗ trợ.',
                }, status=400)
            old_status = booking.status
            booking.status = Booking.CANCELLED
            booking.save(update_fields=['status'])
            BookingHistory.objects.create(
                booking=booking, actor=request.user if request.user.is_authenticated else None,
                event='cancelled', old_status=old_status, new_status=booking.status,
                old_appointment=booking.appointment, new_appointment=booking.appointment,
                reason=(request.data.get('reason') or '')[:255],
            )
        redemption = getattr(booking, 'voucher_redemption', None)
        if redemption:
            redemption.status = VoucherRedemption.AVAILABLE
            redemption.used_at = None
            redemption.booking = None
            redemption.save(update_fields=['status', 'used_at', 'booking'])
            booking.applied_voucher = None
            booking.discount_total = 0
            booking.total = sum(item.price for item in booking.items.all())
            booking.save(update_fields=['applied_voucher', 'discount_total', 'total'])
        _queue_email(booking, request, 'cancelled')
        data = {'booking_id': booking.pk, 'status': booking.status}
        targets = [booking.user] if booking.user else []
        if booking.staff and booking.staff.user: targets.append(booking.staff.user)
        notify_users(targets, 'booking.cancelled', 'Lịch hẹn đã hủy', f'Lịch hẹn #{booking.pk} đã được hủy.', data)
        broadcast_dashboard('booking.cancelled', data)
        return Response(self.get_serializer(booking).data)

    @action(detail=True, methods=['post'], permission_classes=[IsManagerRole])
    def restore(self, request, pk=None):
        """Khôi phục lịch hủy nhầm: chỉ Manager, phải ghi lý do và kiểm tra lại slot."""
        from core.availability import has_conflict, qualified_staff
        from clinic.models import TreatmentPlan, TreatmentSession

        if request.user.role != 'manager':
            return Response({'detail': 'Chỉ quản lý vận hành được khôi phục lịch hẹn.'}, status=403)
        reason = str(request.data.get('reason') or '').strip()
        if len(reason) < 5 or len(reason) > 255:
            return Response({'reason': 'Vui lòng nhập lý do khôi phục từ 5 đến 255 ký tự.'}, status=400)
        with transaction.atomic():
            booking = Booking.objects.select_for_update().select_related(
                'staff', 'treatment_session__plan__doctor', 'treatment_session__plan__service',
            ).get(pk=self.get_object().pk)
            if booking.status != Booking.CANCELLED:
                return Response({'detail': 'Chỉ khôi phục được lịch đã hủy.'}, status=400)
            if booking.appointment <= timezone.now():
                return Response({'detail': 'Lịch đã qua thời gian hẹn, vui lòng tạo yêu cầu mới.'}, status=400)
            if hasattr(booking, 'visit') and booking.visit is not None:
                return Response({'detail': 'Lịch đã có lượt khám, không thể khôi phục tự động.'}, status=400)
            if booking.treatment_session_id:
                session = TreatmentSession.objects.select_for_update().select_related(
                    'plan__doctor', 'plan__service',
                ).get(pk=booking.treatment_session_id)
                if (
                    session.status != TreatmentSession.PENDING
                    or session.plan.status != TreatmentPlan.ACTIVE
                    or not session.plan.doctor_id or not session.plan.doctor.is_active
                    or not session.plan.service_id or not session.plan.service.is_active
                    or session.bookings.exclude(pk=booking.pk).filter(status__in=Booking.ACTIVE_STATUSES).exists()
                ):
                    return Response({'detail': 'Buổi liệu trình không còn khả dụng.'}, status=409)
            service_ids = list(booking.items.values_list('service_id', flat=True))
            if booking.appointment_type in {Booking.APPOINTMENT_TYPE_CONSULT, Booking.APPOINTMENT_TYPE_FOLLOW_UP}:
                candidates = Staff.objects.filter(is_active=True, user__is_active=True, user__role='doctor')
            else:
                candidates = qualified_staff(
                    Staff.objects.filter(is_active=True, user__is_active=True),
                    service_ids,
                )
                if booking.treatment_session_id and not session.allow_staff_delegation:
                    candidates = candidates.filter(user_id=session.plan.doctor_id)
            staff = booking.staff
            if not staff or not candidates.filter(pk=staff.pk).exists():
                return Response({'detail': 'Nhân sự cũ không còn đủ điều kiện. Hãy đặt lịch mới.'}, status=409)
            staff = Staff.objects.select_for_update().get(pk=staff.pk)
            duration = 60 if booking.appointment_type in {Booking.APPOINTMENT_TYPE_CONSULT, Booking.APPOINTMENT_TYPE_FOLLOW_UP} else booking.duration_minutes or 60
            if has_conflict(staff, booking.appointment, duration, exclude_booking_id=booking.pk):
                return Response({'detail': 'Khung giờ đã có lịch khác hoặc nhân sự không còn khả dụng.'}, status=409)
            previous = booking.status
            booking.status = Booking.PENDING
            booking.save(update_fields=['status'])
            BookingHistory.objects.create(
                booking=booking, actor=request.user, event='restored',
                old_status=previous, new_status=booking.status,
                old_appointment=booking.appointment, new_appointment=booking.appointment,
                reason=reason,
            )
        _queue_email(booking, request, 'rescheduled')
        broadcast_dashboard('booking.restored', {'booking_id': booking.pk, 'status': booking.status})
        return Response(self.get_serializer(booking).data)

    @action(detail=True, methods=['post'], permission_classes=[IsStaffRole])
    def no_show(self, request, pk=None):
        with transaction.atomic():
            booking = Booking.objects.select_for_update().get(pk=self.get_object().pk)
            if booking.status not in {Booking.PENDING, Booking.CONFIRMED}:
                return Response({'detail': 'Chỉ lịch chưa check-in mới có thể ghi nhận khách không đến.'}, status=400)
            if booking.appointment > timezone.now():
                return Response({'detail': 'Chỉ ghi nhận khách không đến sau giờ hẹn.'}, status=400)
            old_status = booking.status
            booking.status = Booking.NO_SHOW
            booking.save(update_fields=['status'])
            BookingHistory.objects.create(
                booking=booking, actor=request.user, event='no_show',
                old_status=old_status, new_status=booking.status,
                old_appointment=booking.appointment,
                new_appointment=booking.appointment,
                reason=(request.data.get('reason') or '')[:255],
            )
        return Response(self.get_serializer(booking).data)

    @action(detail=True, methods=['post'])
    def reschedule(self, request, pk=None):
        from core.availability import has_conflict, qualified_staff
        from clinic.models import TreatmentPlan, TreatmentSession

        if request.user.role == 'staff':
            return Response({'detail': 'Nhân viên chỉ tiếp nhận lịch được phân công; hãy liên hệ lễ tân để đổi lịch.'}, status=403)
        try:
            new_appointment = datetime.fromisoformat(str(request.data.get('appointment')))
        except (TypeError, ValueError):
            return Response({'detail': 'Thời gian hẹn mới không hợp lệ.'}, status=400)
        if timezone.is_naive(new_appointment):
            new_appointment = timezone.make_aware(new_appointment, timezone.get_current_timezone())
        if new_appointment <= timezone.now():
            return Response({'detail': 'Thời gian hẹn phải ở tương lai.'}, status=400)

        with transaction.atomic():
            booking = Booking.objects.select_for_update().select_related(
                'treatment_session__plan__doctor', 'treatment_session__plan__service', 'staff',
            ).get(pk=self.get_object().pk)
            if booking.status not in {Booking.PENDING, Booking.CONFIRMED}:
                return Response({'detail': 'Chỉ lịch đang chờ hoặc đã xác nhận mới có thể đổi lịch.'}, status=400)
            if (
                request.user.role == 'customer'
                and booking.appointment < timezone.now() + CUSTOMER_BOOKING_CHANGE_NOTICE
            ):
                return Response({
                    'detail': 'Bạn chỉ có thể tự đổi lịch trước giờ hẹn ít nhất 24 giờ. Vui lòng liên hệ phòng khám để được hỗ trợ.',
                }, status=400)
            if (
                request.user.role == 'customer'
                and new_appointment < timezone.now() + CUSTOMER_BOOKING_CHANGE_NOTICE
            ):
                return Response({
                    'detail': 'Thời gian mới phải cách hiện tại ít nhất 24 giờ.',
                }, status=400)
            treatment_session = None
            if booking.treatment_session_id:
                treatment_session = TreatmentSession.objects.select_for_update().select_related(
                    'plan__doctor', 'plan__service',
                ).get(pk=booking.treatment_session_id)
                if treatment_session.status != TreatmentSession.PENDING or treatment_session.plan.status != TreatmentPlan.ACTIVE:
                    return Response({'detail': 'Buổi liệu trình không còn đủ điều kiện đổi lịch.'}, status=400)

            service_ids = list(booking.items.values_list('service_id', flat=True))
            clinician_required = booking.appointment_type in {
                Booking.APPOINTMENT_TYPE_CONSULT,
                Booking.APPOINTMENT_TYPE_FOLLOW_UP,
            }
            duration = 60 if clinician_required else booking.duration_minutes or 60
            staff_id = request.data.get('staff')
            if staff_id is not None and request.user.role == 'customer':
                return Response({'detail': 'Phòng khám điều phối người thực hiện; bạn chỉ có thể yêu cầu đổi thời gian.'}, status=403)
            session = treatment_session
            if session:
                if (
                    session.status != TreatmentSession.PENDING
                    or session.plan.status != TreatmentPlan.ACTIVE
                    or not session.plan.doctor_id
                    or not session.plan.doctor.is_active
                    or not session.plan.service_id
                    or not session.plan.service.is_active
                    or service_ids != [session.plan.service_id]
                ):
                    return Response({'detail': 'Buổi liệu trình không còn đủ điều kiện đổi lịch.'}, status=400)
                candidates = qualified_staff(
                    Staff.objects.filter(
                        is_active=True,
                        user__is_active=True,
                        user__role__in=['doctor', 'staff'],
                    ),
                    service_ids,
                )
                if not session.allow_staff_delegation:
                    candidates = candidates.filter(user_id=session.plan.doctor_id)
            elif clinician_required:
                candidates = Staff.objects.filter(is_active=True, user__role='doctor')
            else:
                candidates = qualified_staff(Staff.objects.all(), service_ids)
            if staff_id is not None:
                try:
                    candidates = candidates.filter(pk=int(staff_id))
                except (TypeError, ValueError):
                    return Response({'detail': 'Nhân sự được chọn không hợp lệ.'}, status=400)
            elif booking.staff_id:
                candidates = candidates.filter(pk=booking.staff_id)

            candidate_ids = list(candidates.values_list('pk', flat=True))
            locked_candidates = list(
                Staff.objects.select_for_update().filter(pk__in=candidate_ids).order_by('pk')
            )
            new_staff = next(
                (
                    candidate for candidate in locked_candidates
                    if not has_conflict(
                        candidate, new_appointment, duration, exclude_booking_id=booking.pk,
                    )
                ),
                None,
            )
            if not new_staff:
                return Response({'detail': 'Khung giờ vừa được người khác đặt hoặc không còn khả dụng.'}, status=409)

            old_status = booking.status
            old_appointment = booking.appointment
            booking.appointment = new_appointment
            booking.staff = new_staff
            booking.status = Booking.PENDING
            booking.save(update_fields=['appointment', 'staff', 'status'])
            BookingHistory.objects.create(
                booking=booking, actor=request.user, event='rescheduled',
                old_status=old_status, new_status=booking.status,
                old_appointment=old_appointment, new_appointment=new_appointment,
                reason=(request.data.get('reason') or '')[:255],
            )

        _queue_email(booking, request, 'rescheduled')
        return Response(self.get_serializer(booking).data)


class VoucherViewSet(viewsets.ModelViewSet):
    serializer_class = VoucherSerializer
    queryset = Voucher.objects.all().order_by('-created_at')

    def get_permissions(self):
        if self.action in {'list', 'retrieve'}:
            return [permissions.IsAuthenticated()] if self.request.user.is_authenticated else [permissions.AllowAny()]
        if self.action in {'redeem', 'mine'}:
            return [permissions.IsAuthenticated()]
        return [IsManagerRole()]

    def get_queryset(self):
        qs = Voucher.objects.all().order_by('-created_at')
        user = self.request.user
        if not user.is_authenticated or user.role == 'customer':
            return qs.filter(is_active=True)
        return qs

    @action(detail=True, methods=['post'], permission_classes=[permissions.IsAuthenticated])
    def redeem(self, request, pk=None):
        voucher = self.get_object()
        if request.user.role != 'customer':
            return Response({'detail': 'Chỉ khách hàng mới có thể đổi voucher.'}, status=403)
        if request.user.loyalty_points < voucher.points_cost:
            return Response({'detail': 'Không đủ điểm để đổi voucher.'}, status=400)
        if voucher.redeemed_by.filter(pk=request.user.pk).exists():
            return Response({'detail': 'Bạn đã đổi voucher này rồi.'}, status=400)
        if voucher.is_expired or not voucher.is_active:
            return Response({'detail': 'Voucher đã hết hiệu lực.'}, status=400)
        if VoucherRedemption.objects.filter(user=request.user, voucher=voucher).exists():
            return Response({'detail': 'Bạn đã đổi voucher này rồi.'}, status=400)
        request.user.loyalty_points -= voucher.points_cost
        request.user.save(update_fields=['loyalty_points'])
        voucher.redeemed_by.add(request.user)
        redemption = VoucherRedemption.objects.create(user=request.user, voucher=voucher)
        notify_users([request.user], 'voucher.redeemed', 'Đổi voucher thành công', f'Voucher {voucher.code} đã sẵn sàng sử dụng.', {'voucher_id': voucher.pk})
        return Response({'detail': 'Đổi voucher thành công.', 'loyalty_points': request.user.loyalty_points, 'redemption_id': redemption.pk})

    @action(detail=False, methods=['get'], permission_classes=[permissions.IsAuthenticated])
    def mine(self, request):
        qs = Voucher.objects.filter(redemptions__user=request.user, redemptions__status=VoucherRedemption.AVAILABLE, is_active=True).distinct()
        return Response(self.get_serializer(qs, many=True).data)


class AttendanceViewSet(viewsets.ModelViewSet):
    serializer_class = AttendanceSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_permissions(self):
        if self.action in {'create', 'update', 'partial_update', 'destroy'}:
            return [IsManagerRole()]
        return [permissions.IsAuthenticated()]

    def get_queryset(self):
        user = self.request.user
        qs = Attendance.objects.select_related('staff')
        if user.role in {'manager', 'sysadmin'}:
            return qs
        return qs.filter(staff=user)

    @action(detail=False, methods=['post'])
    def check_in(self, request):
        now = timezone.localtime()
        obj, _ = Attendance.objects.get_or_create(staff=request.user, date=now.date())
        if not obj.check_in:
            obj.check_in = now.time().replace(microsecond=0)
            obj.save(update_fields=['check_in'])
        return Response(self.get_serializer(obj).data)

    @action(detail=False, methods=['post'])
    def check_out(self, request):
        now = timezone.localtime()
        obj, _ = Attendance.objects.get_or_create(staff=request.user, date=now.date())
        obj.check_out = now.time().replace(microsecond=0)
        obj.save(update_fields=['check_out'])
        return Response(self.get_serializer(obj).data)


class LeaveRequestViewSet(viewsets.ModelViewSet):
    serializer_class = LeaveRequestSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        if self.request.user.role in {'manager', 'sysadmin'}:
            return LeaveRequest.objects.select_related('staff').all()
        return LeaveRequest.objects.filter(staff=self.request.user)

    def perform_create(self, serializer):
        obj = serializer.save(staff=self.request.user)
        notify_roles(['manager', 'sysadmin'], 'leave.created', 'Có đơn nghỉ phép mới', f'{self.request.user.get_full_name() or self.request.user.username} vừa gửi đơn nghỉ phép.', {'leave_id': obj.pk})

    @action(detail=True, methods=['post'], permission_classes=[IsManagerRole])
    def approve(self, request, pk=None):
        obj = self.get_object()
        obj.status = LeaveRequest.APPROVED
        obj.decided_by = request.user
        obj.decided_at = timezone.now()
        obj.save(update_fields=['status', 'decided_by', 'decided_at'])
        notify_users([obj.staff], 'leave.approved', 'Đơn nghỉ phép đã được duyệt', f'Đơn nghỉ từ {obj.start_date} đến {obj.end_date} đã được duyệt.', {'leave_id': obj.pk})
        broadcast_dashboard('leave.approved', {'leave_id': obj.pk})
        return Response(self.get_serializer(obj).data)

    @action(detail=True, methods=['post'], permission_classes=[IsManagerRole])
    def reject(self, request, pk=None):
        obj = self.get_object()
        obj.status = LeaveRequest.REJECTED
        obj.decided_by = request.user
        obj.decided_at = timezone.now()
        obj.save(update_fields=['status', 'decided_by', 'decided_at'])
        notify_users([obj.staff], 'leave.rejected', 'Đơn nghỉ phép bị từ chối', f'Đơn nghỉ từ {obj.start_date} đến {obj.end_date} đã bị từ chối.', {'leave_id': obj.pk})
        return Response(self.get_serializer(obj).data)


class ConversationViewSet(viewsets.ModelViewSet):
    serializer_class = ConversationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        cfg = ChatSetting.load()
        if cfg.auto_close_daily:
            now = timezone.now()
            stale = Conversation.objects.exclude(status=Conversation.CLOSED).filter(
                session_started_at__date__lt=timezone.localdate(),
            )
            for conversation in stale:
                conversation.status = Conversation.CLOSED
                conversation.resolved_at = now
                conversation.session_ended_at = now
                conversation.session_end_reason = ConversationSession.DAY_END
                conversation.save(update_fields=['status', 'resolved_at', 'session_ended_at', 'session_end_reason', 'updated_at'])
                self._finish_session(conversation, now, ConversationSession.DAY_END)

    def get_serializer_class(self):
        # Hàng chờ KHÔNG kèm tin nhắn/ghi chú/lịch sử để tải nhanh.
        if self.action == 'list':
            return ConversationListSerializer
        return ConversationSerializer

    @staticmethod
    def _current_session(conversation):
        session = conversation.sessions.order_by('-sequence').first()
        if session:
            return session
        return ConversationSession.objects.create(
            conversation=conversation,
            sequence=1,
            started_at=conversation.session_started_at or conversation.created_at,
            ended_at=conversation.session_ended_at,
            end_reason=conversation.session_end_reason or ConversationSession.ACTIVE,
            csat_invited_at=conversation.csat_invited_at,
            csat_score=conversation.csat_score,
            csat_comment=conversation.csat_comment,
        )

    def _finish_session(self, conversation, ended_at, reason, invite_message=None):
        session = self._current_session(conversation)
        session.ended_at = ended_at
        session.end_reason = reason
        if invite_message:
            session.invite_message = invite_message
            session.csat_invited_at = ended_at
        session.save(update_fields=['ended_at', 'end_reason', 'invite_message', 'csat_invited_at'])
        return session

    def _start_new_session(self, conversation, actor):
        previous = self._current_session(conversation)
        if not previous.ended_at:
            previous.ended_at = timezone.now()
            if previous.end_reason == ConversationSession.ACTIVE:
                previous.end_reason = ConversationSession.COMPLETED
            previous.save(update_fields=['ended_at', 'end_reason'])
        now = timezone.now()
        session = ConversationSession.objects.create(
            conversation=conversation,
            sequence=previous.sequence + 1,
            started_at=now,
        )
        conversation.status = Conversation.OPEN
        conversation.assigned_to = None
        conversation.escalated_to = None
        conversation.taken_over_by = None
        conversation.first_response_at = None
        conversation.resolved_at = None
        conversation.csat_score = None
        conversation.csat_comment = ''
        conversation.csat_invited_at = None
        conversation.session_started_at = now
        conversation.session_ended_at = None
        conversation.session_end_reason = ''
        conversation.save(update_fields=[
            'status', 'assigned_to', 'escalated_to', 'taken_over_by', 'first_response_at', 'resolved_at',
            'csat_score', 'csat_comment', 'csat_invited_at', 'session_started_at', 'session_ended_at',
            'session_end_reason', 'updated_at',
        ])
        ConversationEvent.objects.create(
            conversation=conversation,
            actor=actor,
            event_type=ConversationEvent.REOPENED,
            meta=f'Khách hàng bắt đầu phiên CSKH #{session.sequence}',
        )
        if hasattr(conversation, '_prefetched_objects_cache'):
            conversation._prefetched_objects_cache.pop('sessions', None)
        return session

    def _base_queryset(self, lean=True):
        qs = Conversation.objects.select_related('customer', 'assigned_to', 'escalated_to', 'taken_over_by')
        if lean:
            last = Message.objects.filter(conversation=OuterRef('pk')).order_by('-created_at', '-id')
            return qs.prefetch_related('tags', 'sessions').annotate(
                last_at_a=Subquery(last.values('created_at')[:1]),
                last_sender_a=Subquery(last.values('sender_id')[:1]),
                last_text_a=Subquery(last.values('text')[:1]),
                last_type_a=Subquery(last.values('message_type')[:1]),
                last_att_a=Subquery(last.values('attachment_name')[:1]),
            )
        return qs.prefetch_related('messages__sender', 'messages__csat_session', 'tags', 'sessions', 'notes__author', 'events__actor')

    def get_queryset(self):
        user = self.request.user
        qs = self._base_queryset(lean=self.action != 'retrieve')
        if user.role in {'manager', 'sysadmin'}:
            return qs
        if user.role == 'consultant':
            return qs.filter(Q(assigned_to=user) | Q(assigned_to__isnull=True, status=Conversation.OPEN)).distinct()
        if user.role == 'doctor':
            return qs.filter(escalated_to=user)
        return qs.filter(customer=user)

    def _last_message(self, conv):
        if hasattr(conv, 'last_at_a'):
            if not conv.last_at_a:
                return None
            return SimpleNamespace(created_at=conv.last_at_a, sender_id=conv.last_sender_a, text=conv.last_text_a or '',
                                   message_type=conv.last_type_a or 'text', attachment_name=conv.last_att_a or '')
        return conv.messages.select_related('sender').order_by('-created_at', '-id').first()

    def _list_context(self, rows, user):
        ids = [c.pk for c in rows]
        unread, spend = {}, {}
        if ids:
            reads = {r['conversation_id']: r['last_read_at'] for r in
                     ConversationRead.objects.filter(user=user, conversation_id__in=ids).values('conversation_id', 'last_read_at')}
            customer_read = {c.pk: c.customer_last_read_at for c in rows}
            for cid, created in Message.objects.filter(conversation_id__in=ids).exclude(sender=user).values_list('conversation_id', 'created_at'):
                last_read = customer_read.get(cid) if user.role == 'customer' else reads.get(cid)
                if last_read is None or created > last_read:
                    unread[cid] = unread.get(cid, 0) + 1
            for row in Booking.objects.filter(user_id__in={c.customer_id for c in rows}, status=Booking.COMPLETED).values('user_id').annotate(t=Sum('total')):
                spend[row['user_id']] = row['t'] or 0
        daily_invited_customers = set(ConversationSession.objects.filter(
            csat_invited_at__date=timezone.localdate(),
        ).values_list('conversation__customer_id', flat=True))
        return {
            'unread_map': unread,
            'spend_map': spend,
            'chat_cfg': ChatSetting.load(),
            'daily_invited_customers': daily_invited_customers,
        }

    def _queue_rows(self, user, tab):
        qs = self.get_queryset()
        if user.role == 'customer':
            return list(qs.order_by('-updated_at'))
        if user.role == 'doctor':
            rows = list(qs.exclude(status=Conversation.CLOSED).order_by('-updated_at'))
            return rows
        if user.role == 'consultant':
            if tab == 'closed':
                return list(qs.filter(assigned_to=user, status=Conversation.CLOSED).order_by('-resolved_at', '-updated_at'))
            base = list(qs.exclude(status=Conversation.CLOSED))
            if tab == 'unassigned':
                rows = [c for c in base if c.assigned_to_id is None and c.status == Conversation.OPEN]
                return sorted(rows, key=lambda c: c.created_at)
            if tab == 'waiting':
                rows = [c for c in base if c.assigned_to_id == user.id and (self._last_message(c) and self._last_message(c).sender_id != c.customer_id)]
                return sorted(rows, key=lambda c: c.updated_at, reverse=True)
            rows = [c for c in base if c.assigned_to_id == user.id and (not self._last_message(c) or self._last_message(c).sender_id == c.customer_id)]
            def mine_key(c):
                last = self._last_message(c)
                waiting = (timezone.now() - last.created_at).total_seconds() if last and last.sender_id == c.customer_id else 0
                return (c.priority == Conversation.URGENT, waiting, c.updated_at.timestamp())
            return sorted(rows, key=mine_key, reverse=True)
        # Manager / sysadmin
        rows = list(qs)
        if tab == 'unassigned':
            rows = [c for c in rows if c.assigned_to_id is None and c.status != Conversation.CLOSED]
            return sorted(rows, key=lambda c: c.created_at)
        if tab == 'active':
            rows = [c for c in rows if c.assigned_to_id and c.status != Conversation.CLOSED]
        elif tab == 'waiting':
            rows = [c for c in rows if c.status != Conversation.CLOSED and self._last_message(c) and self._last_message(c).sender_id != c.customer_id]
        elif tab == 'doctor':
            rows = [c for c in rows if c.escalated_to_id and c.status != Conversation.CLOSED]
        elif tab == 'closed':
            rows = [c for c in rows if c.status == Conversation.CLOSED]
        elif tab == 'overdue':
            sla = max(1, ChatSetting.load().sla_minutes)
            selected = []
            for c in rows:
                last = self._last_message(c)
                if last and last.sender_id == c.customer_id and c.status != Conversation.CLOSED:
                    if (timezone.now() - last.created_at).total_seconds() >= sla * 60:
                        selected.append(c)
            rows = selected
        return sorted(rows, key=lambda c: c.updated_at, reverse=True)

    def list(self, request, *args, **kwargs):
        tab = (request.query_params.get('tab') or '').strip()
        if not tab:
            tab = 'mine' if request.user.role == 'consultant' else ('doctor' if request.user.role == 'doctor' else 'all')
        rows = self._queue_rows(request.user, tab)
        q = (request.query_params.get('q') or '').strip().lower()
        if q:
            rows = [c for c in rows if q in (c.customer.get_full_name() or c.customer.username).lower()
                    or q in (c.subject or '').lower()
                    or q in ((self._last_message(c).text if self._last_message(c) else '') or '').lower()]
        tag_param = (request.query_params.get('tag') or '').strip()
        if tag_param:
            wanted = {int(x) for x in tag_param.split(',') if x.strip().isdigit()}
            if wanted:
                rows = [c for c in rows if wanted & {t.id for t in c.tags.all()}]
        extra = self._list_context(rows, request.user)
        if request.query_params.get('unread') == '1':
            rows = [c for c in rows if extra['unread_map'].get(c.pk)]
        ctx = {**self.get_serializer_context(), **extra}
        return Response(ConversationListSerializer(rows, many=True, context=ctx).data)

    def perform_create(self, serializer):
        conversation = serializer.save(customer=self.request.user)
        ConversationSession.objects.get_or_create(
            conversation=conversation,
            sequence=1,
            defaults={'started_at': conversation.session_started_at},
        )
        notify_roles(['consultant', 'manager'], 'chat.created', 'Có hội thoại CSKH mới', f'{self.request.user.get_full_name() or self.request.user.username} vừa bắt đầu một cuộc trò chuyện.', {'conversation_id': conversation.pk})
        try: sync_conversation(conversation, background=True)
        except Exception: pass

    def _mark_read(self, conversation, user):
        now = timezone.now()
        if user.id == conversation.customer_id:
            conversation.customer_last_read_at = now
            conversation.save(update_fields=['customer_last_read_at'])
        else:
            ConversationRead.objects.update_or_create(conversation=conversation, user=user, defaults={'last_read_at': now})

    def retrieve(self, request, *args, **kwargs):
        obj = self.get_object()
        self._mark_read(obj, request.user)
        return Response(self.get_serializer(obj).data)

    @action(detail=False, methods=['get'])
    def meta(self, request):
        user = request.user
        cfg = ChatSetting.load()
        presence, _ = AgentPresence.objects.get_or_create(user=user) if user.role in {'consultant', 'doctor', 'manager'} else (None, False)
        if user.role == 'consultant':
            tabs = [('unassigned','Chưa gán'),('mine','Của tôi'),('waiting','Chờ khách'),('closed','Hoàn thành')]
        elif user.role == 'doctor':
            tabs = [('doctor','Được chuyển cho tôi')]
        elif user.role in {'manager','sysadmin'}:
            tabs = [('all','Tất cả'),('unassigned','Chưa gán'),('active','Đang xử lý'),('waiting','Chờ khách'),('doctor','Đã chuyển bác sĩ'),('closed','Hoàn thành')]
        else:
            tabs = []
        counts = {key: len(self._queue_rows(user, key)) for key, _ in tabs}
        consultants = User.objects.filter(role='consultant', is_active=True).order_by('first_name','username')
        doctors = User.objects.filter(role='doctor', is_active=True).order_by('first_name','username')
        agents = []
        for u in consultants:
            pr, _ = AgentPresence.objects.get_or_create(user=u)
            agents.append({'id':u.id,'name':u.get_full_name() or u.username,'status':pr.status,
                           'active_cases':Conversation.objects.filter(assigned_to=u).exclude(status=Conversation.CLOSED).count()})
        return Response({
            'tabs':[{'key':k,'label':label,'count':counts.get(k,0)} for k,label in tabs],
            'presence': presence.status if presence else '',
            'sla_minutes': cfg.sla_minutes,
            'business_start': str(cfg.business_start)[:5], 'business_end': str(cfg.business_end)[:5],
            'auto_csat_enabled': cfg.auto_csat_enabled,
            'auto_close_daily': cfg.auto_close_daily,
            'quick_replies': QuickReplySerializer(QuickReply.objects.filter(is_active=True), many=True).data,
            'tags': TagSerializer(Tag.objects.all(), many=True).data,
            'doctors': [{'id':u.id,'name':u.get_full_name() or u.username} for u in doctors],
            'consultants': agents,
        })

    @action(detail=False, methods=['post'])
    def presence(self, request):
        if request.user.role not in {'consultant','doctor','manager'}:
            return Response({'detail':'Không có quyền cập nhật trạng thái.'}, status=403)
        value = (request.data.get('status') or '').strip()
        if value not in dict(AgentPresence.STATUS_CHOICES):
            return Response({'detail':'Trạng thái không hợp lệ.'}, status=400)
        obj, _ = AgentPresence.objects.update_or_create(user=request.user, defaults={'status':value})
        return Response({'status':obj.status})

    @action(detail=True, methods=['post'], url_path='ai-copilot')
    def ai_copilot(self, request, pk=None):
        if request.user.role not in {'manager', 'consultant', 'doctor'}:
            return Response({'detail': 'Chỉ nhân viên được sử dụng AI Copilot.'}, status=403)
        conversation = self.get_object()
        if conversation.status == Conversation.CLOSED:
            return Response({'detail': 'Hội thoại đã hoàn thành.'}, status=400)
        if not self._can_send(conversation, request.user):
            return Response({'detail': 'Bạn cần nhận hoặc tiếp quản đúng ca trước khi sử dụng AI Copilot.'}, status=403)
        from .ai_support import CopilotNoText, CopilotNotConfigured, CopilotUnavailable, generate_copilot
        try:
            return Response(generate_copilot(conversation, refresh=bool(request.data.get('refresh'))))
        except CopilotUnavailable as exc:
            return Response({'detail': str(exc), 'code': exc.code}, status=exc.status_code)

    @action(detail=True, methods=['post'])
    def claim(self, request, pk=None):
        if request.user.role != 'consultant':
            return Response({'detail':'Chỉ CSKH có thể nhận ca.'}, status=403)
        presence = AgentPresence.objects.filter(user=request.user).first()
        if presence and presence.status == AgentPresence.OFFLINE:
            return Response({'detail':'Bạn đang ở trạng thái Offline. Hãy chuyển sang Online hoặc Bận trước khi nhận ca.'}, status=400)
        with transaction.atomic():
            conv = Conversation.objects.select_for_update().select_related('assigned_to').get(pk=pk)
            if conv.assigned_to_id and conv.assigned_to_id != request.user.id:
                name = conv.assigned_to.get_full_name() or conv.assigned_to.username
                return Response({'detail':f'Ca này đã được {name} nhận trước.'}, status=409)
            if conv.status == Conversation.CLOSED:
                return Response({'detail':'Ca đã hoàn thành.'}, status=400)
            conv.assigned_to = request.user
            conv.save(update_fields=['assigned_to','updated_at'])
            ConversationEvent.objects.create(conversation=conv, actor=request.user, event_type=ConversationEvent.ASSIGNED)
        try: sync_conversation(conv, background=True)
        except Exception: pass
        return Response(self.get_serializer(conv).data)

    @action(detail=True, methods=['post'], url_path='return')
    def return_case(self, request, pk=None):
        conv = self.get_object()
        if request.user.role != 'consultant' or conv.assigned_to_id != request.user.id:
            return Response({'detail':'Bạn không phải người đang phụ trách ca này.'}, status=403)
        conv.assigned_to = None
        conv.taken_over_by = None
        conv.save(update_fields=['assigned_to','taken_over_by','updated_at'])
        ConversationEvent.objects.create(conversation=conv, actor=request.user, event_type=ConversationEvent.RETURNED)
        try: sync_conversation(conv, background=True)
        except Exception: pass
        notify_roles(['consultant','manager'], 'chat.returned', 'Ca tư vấn được trả lại hàng chờ', f'Ca #{conv.pk} đã được trả lại.', {'conversation_id':conv.pk})
        return Response(self.get_serializer(conv).data)

    @action(detail=True, methods=['post'])
    def takeover(self, request, pk=None):
        if request.user.role != 'manager':
            return Response({'detail':'Chỉ quản lý được tiếp quản ca.'}, status=403)
        conv = self.get_object()
        conv.taken_over_by = request.user
        conv.save(update_fields=['taken_over_by','updated_at'])
        ConversationEvent.objects.create(conversation=conv, actor=request.user, event_type=ConversationEvent.TAKEN_OVER)
        try: sync_conversation(conv, background=True)
        except Exception: pass
        return Response(self.get_serializer(conv).data)

    @action(detail=True, methods=['post'])
    def reassign(self, request, pk=None):
        if request.user.role != 'manager':
            return Response({'detail':'Chỉ quản lý được chia lại ca.'}, status=403)
        conv = self.get_object()
        agent_id = request.data.get('agent_id')
        agent = User.objects.filter(pk=agent_id, role='consultant', is_active=True).first() if agent_id else None
        conv.assigned_to = agent
        conv.taken_over_by = None
        conv.save(update_fields=['assigned_to','taken_over_by','updated_at'])
        ConversationEvent.objects.create(conversation=conv, actor=request.user, event_type=ConversationEvent.REASSIGNED, meta=(agent.get_full_name() or agent.username) if agent else 'Bỏ gán')
        try: sync_conversation(conv, background=True)
        except Exception: pass
        if agent: notify_users([agent], 'chat.assigned', 'Bạn được giao một ca tư vấn', f'Ca #{conv.pk} của {conv.customer}.', {'conversation_id':conv.pk})
        return Response(self.get_serializer(conv).data)

    @action(detail=True, methods=['post'])
    def escalate(self, request, pk=None):
        conv = self.get_object()
        if request.user.role == 'consultant' and conv.assigned_to_id != request.user.id:
            return Response({'detail':'Bạn cần nhận ca trước khi chuyển bác sĩ.'}, status=403)
        if request.user.role == 'manager' and conv.taken_over_by_id != request.user.id:
            return Response({'detail':'Bạn cần tiếp quản ca trước khi chuyển bác sĩ.'}, status=403)
        if request.user.role not in {'consultant','manager'}:
            return Response({'detail':'Không có quyền chuyển bác sĩ.'}, status=403)
        doctor = User.objects.filter(pk=request.data.get('doctor_id'), role='doctor', is_active=True).first()
        if not doctor:
            return Response({'detail':'Vui lòng chọn bác sĩ hợp lệ.'}, status=400)
        note = (request.data.get('note') or '').strip()[:500]
        conv.status = Conversation.ESCALATED
        conv.escalated_to = doctor
        conv.save(update_fields=['status','escalated_to','updated_at'])
        ConversationEvent.objects.create(conversation=conv, actor=request.user, event_type=ConversationEvent.TRANSFERRED, meta=f'{doctor.get_full_name() or doctor.username}' + (f' · {note}' if note else ''))
        if note: InternalNote.objects.create(conversation=conv, author=request.user, text=f'Ghi chú chuyển bác sĩ: {note}')
        try: sync_conversation(conv, background=True)
        except Exception: pass
        notify_users([doctor], 'chat.escalated', 'Có ca tư vấn được chuyển cho bạn', f'{conv.customer}: {note or conv.subject}', {'conversation_id':conv.pk})
        return Response(self.get_serializer(conv).data)

    @action(detail=True, methods=['post'])
    def close(self, request, pk=None):
        conv = self.get_object()
        allowed = (
            (request.user.role == 'consultant' and conv.assigned_to_id == request.user.id) or
            (request.user.role == 'doctor' and conv.escalated_to_id == request.user.id) or
            (request.user.role == 'manager' and conv.taken_over_by_id == request.user.id)
        )
        if not allowed:
            return Response({'detail':'Bạn không có quyền đóng ca này.'}, status=403)
        now = timezone.now()
        conv.status = Conversation.CLOSED
        conv.resolved_at = now
        conv.session_ended_at = now
        conv.session_end_reason = ConversationSession.COMPLETED
        cfg = ChatSetting.load()
        can_invite_today = not ConversationSession.objects.filter(
            conversation__customer_id=conv.customer_id,
            csat_invited_at__date=timezone.localdate(),
        ).exclude(conversation_id=conv.pk, sequence=self._current_session(conv).sequence).exists()
        invite_message = None
        if cfg.auto_csat_enabled and not conv.csat_invited_at and not conv.csat_score and can_invite_today:
            invite_message = self._post_system_message(conv, request.user, 'Đánh giá phiên chăm sóc', Message.CSAT)
            conv.csat_invited_at = now
            conv.session_end_reason = ConversationSession.CSAT_INVITE
        conv.save(update_fields=['status','resolved_at','session_ended_at','session_end_reason','csat_invited_at','updated_at'])
        self._finish_session(conv, now, conv.session_end_reason, invite_message)
        ConversationEvent.objects.create(conversation=conv, actor=request.user, event_type=ConversationEvent.CLOSED)
        notify_users([conv.customer], 'chat.closed', 'Phiên tư vấn đã hoàn thành', 'Bạn có thể đánh giá chất lượng hỗ trợ của AkinaClinic.', {'conversation_id':conv.pk})
        return Response(self.get_serializer(conv).data)

    @action(detail=True, methods=['post'])
    def reopen(self, request, pk=None):
        if request.user.role != 'manager':
            return Response({'detail':'Chỉ quản lý có thể mở lại ca.'}, status=403)
        conv = self.get_object()
        self._start_new_session(conv, request.user)
        return Response(self.get_serializer(conv).data)

    @action(detail=True, methods=['post'])
    def mark_read(self, request, pk=None):
        conv = self.get_object()
        self._mark_read(conv, request.user)
        return Response({'ok':True})

    @action(detail=True, methods=['post'], url_path='toggle-tag')
    def toggle_tag(self, request, pk=None):
        if request.user.role not in {'consultant','doctor','manager'}:
            return Response({'detail':'Không có quyền gắn nhãn.'}, status=403)
        conv = self.get_object()
        tag = Tag.objects.filter(pk=request.data.get('tag_id')).first()
        if not tag: return Response({'detail':'Nhãn không tồn tại.'}, status=404)
        if conv.tags.filter(pk=tag.pk).exists(): conv.tags.remove(tag); action_name='Bỏ nhãn'
        else: conv.tags.add(tag); action_name='Gắn nhãn'
        ConversationEvent.objects.create(conversation=conv, actor=request.user, event_type=ConversationEvent.TAGGED, meta=f'{action_name}: {tag.name}')
        return Response(self.get_serializer(conv).data)

    @action(detail=True, methods=['post'])
    def notes(self, request, pk=None):
        if request.user.role not in {'consultant','doctor','manager'}:
            return Response({'detail':'Không có quyền ghi chú.'}, status=403)
        conv = self.get_object()
        text = (request.data.get('text') or '').strip()[:1000]
        if not text: return Response({'detail':'Ghi chú không được để trống.'}, status=400)
        note = InternalNote.objects.create(conversation=conv, author=request.user, text=text)
        ConversationEvent.objects.create(conversation=conv, actor=request.user, event_type=ConversationEvent.NOTE_ADDED, meta=text[:120])
        return Response(InternalNoteSerializer(note, context={'request':request}).data, status=201)

    @action(detail=True, methods=['post'])
    def csat(self, request, pk=None):
        conv = self.get_object()
        if request.user.id != conv.customer_id:
            return Response({'detail': 'Chỉ khách hàng được đánh giá.'}, status=403)
        invite_id = request.data.get('message_id')
        invitation = conv.messages.filter(message_type=Message.CSAT, pk=invite_id).first() if invite_id else conv.messages.filter(message_type=Message.CSAT).order_by('-created_at', '-id').first()
        if not invitation:
            return Response({'detail': 'Phiên này chưa có lời mời đánh giá từ CSKH.'}, status=400)
        try:
            session = invitation.csat_session
        except ConversationSession.DoesNotExist:
            session = self._current_session(conv)
            session.invite_message = invitation
            session.csat_invited_at = invitation.created_at
            session.save(update_fields=['invite_message', 'csat_invited_at'])
        if session.csat_score:
            return Response({'detail': 'Bạn đã đánh giá phiên này rồi.'}, status=400)
        try: score = int(request.data.get('score') or 0)
        except Exception: score = 0
        if not 1 <= score <= 5: return Response({'detail': 'Điểm đánh giá phải từ 1 đến 5.'}, status=400)
        comment = (request.data.get('comment') or '').strip()[:500]
        session.csat_score = score
        session.csat_comment = comment
        session.save(update_fields=['csat_score', 'csat_comment'])
        if session.sequence == self._current_session(conv).sequence:
            conv.csat_score = score
            conv.csat_comment = comment
            conv.save(update_fields=['csat_score', 'csat_comment', 'updated_at'])
        summary = f'Khách hàng đã đánh giá phiên #{session.sequence}: {score}/5 sao' + (f': “{comment}”' if comment else '')
        self._post_system_message(conv, request.user, summary, Message.SYSTEM)
        notify_roles(['manager'], 'chat.csat', 'Có đánh giá CSKH mới', f'{conv.customer}: {score}/5 sao', {'conversation_id': conv.pk})
        return Response({'message_id': invitation.pk, 'session': session.sequence, 'csat_score': score, 'csat_comment': comment})

    @action(detail=True, methods=['post'])
    def realtime(self, request, pk=None):
        conversation = self.get_object()
        return Response({'enabled': bool(sync_conversation(conversation))})

    @staticmethod
    def _can_send(conversation, user):
        if user.id == conversation.customer_id:
            return True
        if user.role == 'consultant':
            return conversation.assigned_to_id == user.id
        if user.role == 'doctor':
            return conversation.escalated_to_id == user.id
        if user.role == 'manager':
            return conversation.taken_over_by_id == user.id
        return False

    def _post_system_message(self, conversation, sender, text, message_type):
        message = Message.objects.create(conversation=conversation, sender=sender, text=text, message_type=message_type)
        conversation.save(update_fields=['updated_at'])
        try:
            mirror_message(message)
        except Exception:
            pass
        return message

    @action(detail=True, methods=['post'], url_path='csat-invite')
    def csat_invite(self, request, pk=None):
        conversation = self.get_object()
        if request.user.id == conversation.customer_id or not self._can_send(conversation, request.user):
            return Response({'detail': 'Bạn cần nhận/tiếp quản ca trước khi gửi lời mời đánh giá.'}, status=403)
        if conversation.status == Conversation.CLOSED:
            return Response({'detail': 'Phiên chăm sóc đã kết thúc.'}, status=400)
        if conversation.csat_score:
            return Response({'detail': 'Khách hàng đã đánh giá phiên này.'}, status=400)
        current_session = self._current_session(conversation)
        if conversation.csat_invited_at or current_session.csat_invited_at:
            return Response({'detail': 'Mỗi phiên chỉ được gửi một lời mời đánh giá.'}, status=400)
        if ConversationSession.objects.filter(
            conversation__customer_id=conversation.customer_id,
            csat_invited_at__date=timezone.localdate(),
        ).exclude(pk=current_session.pk).exists():
            return Response({'detail': 'Khách hàng đã nhận lời mời đánh giá trong hôm nay.'}, status=400)
        message = self._post_system_message(conversation, request.user, 'Đánh giá phiên chăm sóc', Message.CSAT)
        now = timezone.now()
        conversation.status = Conversation.CLOSED
        conversation.resolved_at = now
        conversation.session_ended_at = now
        conversation.session_end_reason = ConversationSession.CSAT_INVITE
        conversation.csat_invited_at = now
        conversation.save(update_fields=['status','resolved_at','session_ended_at','session_end_reason','csat_invited_at','updated_at'])
        self._finish_session(conversation, now, ConversationSession.CSAT_INVITE, message)
        ConversationEvent.objects.create(conversation=conversation, actor=request.user, event_type=ConversationEvent.CLOSED, meta='Đã gửi mời đánh giá')
        notify_users([conversation.customer], 'chat.csat_invite', 'Mời đánh giá phiên chăm sóc',
                     'AkinaClinic muốn nghe góp ý của bạn về phiên hỗ trợ vừa rồi.', {'conversation_id': conversation.pk})
        return Response(MessageSerializer(message, context={'request': request}).data, status=201)

    @action(detail=True, methods=['get', 'post'])
    def messages(self, request, pk=None):
        conversation = self.get_object()
        user = request.user
        if request.method == 'GET':
            # Polling dự phòng: chỉ trả tin mới hơn `after`, không tải lại cả hội thoại.
            try:
                after = int(request.query_params.get('after') or 0)
            except ValueError:
                after = 0
            rows = list(conversation.messages.select_related('sender', 'csat_session').filter(id__gt=after).order_by('id'))
            if rows and request.query_params.get('mark_read') == '1':
                self._mark_read(conversation, user)
            return Response(MessageSerializer(rows, many=True, context={'request': request}).data)
        can_send = self._can_send(conversation, user)
        if not can_send:
            return Response({'detail':'Bạn cần nhận/tiếp quản đúng ca trước khi gửi tin.'}, status=403)
        text = (request.data.get('text') or '').strip()
        upload = request.FILES.get('attachment')
        if not text and not upload:
            return Response({'detail': 'Tin nhắn không được để trống.'}, status=400)
        reopened = user.id == conversation.customer_id and conversation.status == Conversation.CLOSED
        if reopened:
            self._start_new_session(conversation, user)
        if upload and upload.size > 15 * 1024 * 1024:
            return Response({'detail':'Tệp vượt quá giới hạn 15 MB.'}, status=400)
        mime = getattr(upload, 'content_type', '') if upload else ''
        if upload:
            allowed_mimes = {
                'image/jpeg','image/png','image/webp','image/gif',
                'application/pdf','application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'text/plain','application/zip','application/x-zip-compressed',
            }
            if mime not in allowed_mimes and not str(mime).startswith('image/'):
                return Response({'detail':'Định dạng tệp chưa được hỗ trợ. Hãy gửi ảnh, PDF, Word, Excel, TXT hoặc ZIP.'}, status=400)
        msg_type = Message.TEXT
        if upload:
            msg_type = Message.IMAGE if str(mime).startswith('image/') else Message.FILE
        message = Message.objects.create(
            conversation=conversation, sender=user, text=text[:2000], message_type=msg_type,
            attachment=upload if upload else None,
            attachment_name=(getattr(upload,'name','') or '')[:255] if upload else '',
            attachment_mime=(mime or '')[:120], attachment_size=getattr(upload,'size',0) if upload else 0,
        )
        if user.id != conversation.customer_id and not conversation.first_response_at:
            conversation.first_response_at = timezone.now()
            conversation.save(update_fields=['first_response_at','updated_at'])
        else:
            conversation.save(update_fields=['updated_at'])
        try:
            mirror_message(message)  # chạy nền, không chặn phản hồi gửi tin
        except Exception:
            pass
        if conversation.channel == Conversation.FACEBOOK and user.id != conversation.customer_id:
            try:
                from .messenger import send_message_to_channel
                send_message_to_channel(message)
            except RuntimeError as exc:
                message.delete()
                return Response({'detail': str(exc)}, status=502)
        targets = []
        if user != conversation.customer: targets.append(conversation.customer)
        for u in [conversation.assigned_to, conversation.escalated_to, conversation.taken_over_by]:
            if u and u != user: targets.append(u)
        if user == conversation.customer and not targets:
            targets.extend(User.objects.filter(role='consultant', is_active=True).exclude(presence__status=AgentPresence.OFFLINE)[:10])
        preview = text[:100] if text else (message.attachment_name or 'Tệp đính kèm')
        notify_users(targets, 'chat.message', 'Tin nhắn mới', f'{user.get_full_name() or user.username}: {preview}', {'conversation_id': conversation.pk})
        payload = dict(MessageSerializer(message, context={'request':request}).data)
        if reopened:
            payload['session_reopened'] = True
            payload['conversation_status'] = conversation.status
        return Response(payload, status=201)

    @action(detail=False, methods=['get'], url_path='search')
    def search(self, request):
        q = (request.query_params.get('q') or '').strip()
        if len(q) < 2:
            return Response({'all':[], 'conversations':[], 'messages':[], 'files':[], 'customers':[], 'bookings':[]})
        visible = self.get_queryset()
        convs = visible.filter(Q(subject__icontains=q)|Q(customer__first_name__icontains=q)|Q(customer__username__icontains=q)|Q(customer__phone__icontains=q)).distinct()[:20]
        msgs = Message.objects.filter(conversation__in=visible).filter(Q(text__icontains=q)|Q(attachment_name__icontains=q)).select_related('conversation','sender','conversation__customer').order_by('-created_at')[:30]
        files = [m for m in msgs if m.attachment_name][:20]
        customers = User.objects.filter(role='customer').filter(Q(first_name__icontains=q)|Q(username__icontains=q)|Q(phone__icontains=q)|Q(email__icontains=q))[:20]
        bookings = Booking.objects.filter(Q(guest_name__icontains=q)|Q(guest_phone__icontains=q)|Q(user__first_name__icontains=q)|Q(user__phone__icontains=q)).order_by('-created_at')[:20]
        result = {
            'conversations':[{'id':c.id,'customer_name':c.customer.get_full_name() or c.customer.username,'subject':c.subject,'updated_at':c.updated_at} for c in convs],
            'messages':[{'id':m.id,'conversation_id':m.conversation_id,'customer_name':m.conversation.customer.get_full_name() or m.conversation.customer.username,'text':m.text,'created_at':m.created_at} for m in msgs if m.text],
            'files':[{'id':m.id,'conversation_id':m.conversation_id,'customer_name':m.conversation.customer.get_full_name() or m.conversation.customer.username,'name':m.attachment_name,'url':MessageSerializer(m, context={'request':request}).data.get('attachment_url',''),'created_at':m.created_at} for m in files],
            'customers':[{'id':u.id,'name':u.get_full_name() or u.username,'phone':u.phone,'email':u.email} for u in customers],
            'bookings':[{'id':b.id,'customer_name':b.customer_name,'appointment':b.appointment,'status':b.status,'total':b.total} for b in bookings],
        }
        result['all'] = result['conversations'][:5] + result['messages'][:5] + result['files'][:5] + result['customers'][:5] + result['bookings'][:5]
        return Response(result)

    @action(detail=False, methods=['get'], url_path='analytics')
    def analytics(self, request):
        if request.user.role not in {'manager','consultant'}:
            return Response({'detail':'Không có quyền xem báo cáo.'}, status=403)
        qs = self._base_queryset(lean=True)
        closed = qs.filter(status=Conversation.CLOSED)
        session_qs = ConversationSession.objects.select_related('conversation')
        scored_sessions = session_qs.exclude(csat_score__isnull=True)
        avg_csat = scored_sessions.aggregate(v=Sum('csat_score'))['v'] or 0
        avg_csat = round(avg_csat / max(1, scored_sessions.count()), 2)
        cfg = ChatSetting.load()
        overdue = 0
        for c in qs.exclude(status=Conversation.CLOSED):
            last = self._last_message(c)
            if last and last.sender_id == c.customer_id and (timezone.now()-last.created_at).total_seconds() >= cfg.sla_minutes*60:
                overdue += 1
        staff_rows=[]
        for agent in User.objects.filter(role='consultant',is_active=True):
            handled=qs.filter(assigned_to=agent)
            closed_agent=handled.filter(status=Conversation.CLOSED)
            scores=session_qs.filter(conversation__assigned_to=agent).exclude(csat_score__isnull=True)
            total_score=scores.aggregate(v=Sum('csat_score'))['v'] or 0
            staff_rows.append({'id':agent.id,'name':agent.get_full_name() or agent.username,'active':handled.exclude(status=Conversation.CLOSED).count(),'closed':closed_agent.count(),'csat':round(total_score/max(1,scores.count()),2) if scores.exists() else None})
        invited = session_qs.exclude(csat_invited_at__isnull=True)
        responses = invited.exclude(csat_score__isnull=True)
        satisfied = responses.filter(csat_score__gte=4).count()
        daily = []
        for offset in range(6, -1, -1):
            day = timezone.localdate() - timedelta(days=offset)
            day_invited = invited.filter(csat_invited_at__date=day)
            day_responses = day_invited.exclude(csat_score__isnull=True)
            score_total = day_responses.aggregate(v=Sum('csat_score'))['v'] or 0
            daily.append({
                'date': day,
                'invited': day_invited.count(),
                'responses': day_responses.count(),
                'avg_csat': round(score_total / max(1, day_responses.count()), 2) if day_responses.exists() else 0,
            })
        distribution = {str(score): responses.filter(csat_score=score).count() for score in range(1, 6)}
        return Response({
            'new': session_qs.filter(started_at__date=timezone.localdate()).count(),
            'unassigned': qs.filter(assigned_to__isnull=True).exclude(status=Conversation.CLOSED).count(),
            'overdue': overdue,
            'closed': session_qs.exclude(ended_at__isnull=True).count(),
            'avg_csat': avg_csat,
            'invited': invited.count(),
            'responses': responses.count(),
            'response_rate': round(responses.count() * 100 / max(1, invited.count()), 1),
            'satisfaction_rate': round(satisfied * 100 / max(1, responses.count()), 1),
            'distribution': distribution,
            'daily': daily,
            'agents': staff_rows,
        })

    @action(detail=False, methods=['get', 'patch'], url_path='manager-settings')
    def manager_settings(self, request):
        if request.user.role != 'manager':
            return Response({'detail': 'Chỉ quản lý được cấu hình CSKH.'}, status=403)
        cfg = ChatSetting.load()
        if request.method == 'PATCH':
            fields = []
            for name in ('auto_csat_enabled', 'auto_close_daily'):
                if name in request.data:
                    setattr(cfg, name, bool(request.data.get(name)))
                    fields.append(name)
            if 'sla_minutes' in request.data:
                try:
                    cfg.sla_minutes = min(240, max(1, int(request.data.get('sla_minutes'))))
                    fields.append('sla_minutes')
                except (TypeError, ValueError):
                    return Response({'detail': 'SLA phải là số phút hợp lệ.'}, status=400)
            for name in ('business_start', 'business_end'):
                if name in request.data:
                    try:
                        setattr(cfg, name, datetime.strptime(str(request.data.get(name)), '%H:%M').time())
                        fields.append(name)
                    except ValueError:
                        return Response({'detail': 'Giờ làm việc phải có định dạng HH:MM.'}, status=400)
            if fields:
                cfg.save(update_fields=[*set(fields)])
        return Response({
            'auto_csat_enabled': cfg.auto_csat_enabled,
            'auto_close_daily': cfg.auto_close_daily,
            'sla_minutes': cfg.sla_minutes,
            'business_start': str(cfg.business_start)[:5],
            'business_end': str(cfg.business_end)[:5],
        })



class TagViewSet(viewsets.ModelViewSet):
    """Thẻ phân loại hội thoại . Mọi nhân viên xem được; CSKH/Quản lý được thêm, sửa, xóa."""
    serializer_class = TagSerializer
    permission_classes = [permissions.IsAuthenticated]
    queryset = Tag.objects.all()
    pagination_class = None

    def initial(self, request, *args, **kwargs):
        super().initial(request, *args, **kwargs)
        role = request.user.role
        write = request.method not in permissions.SAFE_METHODS
        allowed = {'consultant', 'manager', 'sysadmin'} if write else {'consultant', 'doctor', 'manager', 'sysadmin'}
        if role not in allowed:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied('Bạn không có quyền quản lý thẻ phân loại.')

    def _clean(self, data):
        import re
        name = (data.get('name') or '').strip()[:50]
        color = (data.get('color') or '').strip()
        if color and not re.fullmatch(r'#[0-9a-fA-F]{6}', color) and color not in {'primary', 'secondary', 'success', 'danger', 'warning', 'info'}:
            color = ''
        return name, color

    def create(self, request, *args, **kwargs):
        name, color = self._clean(request.data)
        if not name:
            return Response({'detail': 'Tên thẻ không được để trống.'}, status=400)
        if Tag.objects.filter(name__iexact=name).exists():
            return Response({'detail': 'Tên thẻ đã tồn tại.'}, status=400)
        tag = Tag.objects.create(name=name, color=color or '#3b82f6')
        return Response(TagSerializer(tag).data, status=201)

    def update(self, request, *args, **kwargs):
        tag = self.get_object()
        name, color = self._clean({**{'name': tag.name, 'color': tag.color}, **request.data})
        if not name:
            return Response({'detail': 'Tên thẻ không được để trống.'}, status=400)
        if Tag.objects.filter(name__iexact=name).exclude(pk=tag.pk).exists():
            return Response({'detail': 'Tên thẻ đã tồn tại.'}, status=400)
        tag.name, tag.color = name, color or tag.color
        tag.save(update_fields=['name', 'color'])
        return Response(TagSerializer(tag).data)

    partial_update = update


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def chatbot_session(request):
    """Cấu hình + lịch sử gần nhất của Trợ lý AkinaClinic theo visitor_key."""
    cfg = chatbot.public_config()
    key = request.query_params.get('visitor_key', '')
    session, key = chatbot.get_session(request, key, request.query_params.get('page', ''))
    if session is None:
        return Response({'detail': 'visitor_key không hợp lệ.'}, status=400)
    return Response({**cfg, 'visitor_key': key, 'messages': chatbot.recent_history(session)})


@api_view(['POST'])
@permission_classes([permissions.AllowAny])
def chatbot_message(request):
    if not chatbot.ChatbotSetting.load().enabled:
        return Response({'detail': 'Trợ lý AkinaClinic đang tạm ngưng.'}, status=503)
    session, key = chatbot.get_session(request, request.data.get('visitor_key', ''), request.data.get('page', ''))
    if session is None:
        return Response({'detail': 'visitor_key không hợp lệ.'}, status=400)
    text = str(request.data.get('text') or '')
    action = str(request.data.get('action') or '')
    if not text.strip() and not action:
        return Response({'detail': 'Tin nhắn không được để trống.'}, status=400)
    user_msg, bot_msg, navigate = chatbot.handle(request, session, text=text, action=action)
    return Response({
        'visitor_key': key,
        'user_message': chatbot.serialize_message(user_msg) if user_msg else None,
        'reply': chatbot.serialize_message(bot_msg) if bot_msg else None,
        'navigate': navigate,
    })


class NotificationViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = NotificationSerializer
    permission_classes = [permissions.IsAuthenticated]

    def get_queryset(self):
        return Notification.objects.filter(user=self.request.user)

    @action(detail=True, methods=['post'])
    def read(self, request, pk=None):
        obj = self.get_object()
        obj.is_read = True
        obj.save(update_fields=['is_read'])
        try: mark_notification_read(obj)
        except Exception: pass
        return Response(self.get_serializer(obj).data)

    @action(detail=False, methods=['post'])
    def read_all(self, request):
        rows = list(Notification.objects.filter(user=request.user, is_read=False))
        Notification.objects.filter(pk__in=[x.pk for x in rows]).update(is_read=True)
        for item in rows:
            item.is_read = True
            try: mark_notification_read(item)
            except Exception: pass
        return Response({'detail': 'Đã đánh dấu đã đọc.'})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def firebase_token(request):
    token = create_custom_token(request.user)
    if not token:
        return Response({'enabled': False, 'detail': 'Firebase chưa được cấu hình ở backend.'}, status=503)
    return Response({'enabled': True, 'token': token})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def dashboard_summary(request):
    today = timezone.localdate()
    bookings = Booking.objects.all()
    if request.user.role == 'customer':
        bookings = bookings.filter(user=request.user)
    revenue = bookings.filter(status=Booking.COMPLETED).aggregate(v=Sum('total'))['v'] or 0
    payload = {
        'bookings_total': bookings.count(),
        'bookings_today': bookings.filter(appointment__date=today).count(),
        'pending': bookings.filter(status=Booking.PENDING).count(),
        'confirmed': bookings.filter(status=Booking.CONFIRMED).count(),
        'completed': bookings.filter(status=Booking.COMPLETED).count(),
        'revenue': revenue,
        'customers': User.objects.filter(role='customer').count() if request.user.role in {'manager', 'sysadmin', 'consultant'} else None,
        'staff': Staff.objects.filter(is_active=True).count() if request.user.role in {'manager', 'sysadmin'} else None,
    }
    return Response(payload)






@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def manager_dashboard(request):
    today = timezone.localdate()
    start_of_week = today - timedelta(days=today.weekday())
    weekly = []
    for i in range(4):
        ws = start_of_week - timedelta(days=(3-i)*7)
        we = ws + timedelta(days=6)
        value = Booking.objects.filter(status=Booking.COMPLETED, appointment__date__gte=ws, appointment__date__lte=we).aggregate(v=Sum('total'))['v'] or 0
        weekly.append({'name': f'Tuần {i+1}', 'value': value})
    prev_week_start = start_of_week - timedelta(days=7)
    prev_week_end = start_of_week - timedelta(days=1)
    current_week_revenue = Booking.objects.filter(status=Booking.COMPLETED, appointment__date__gte=start_of_week, appointment__date__lte=today).aggregate(v=Sum('total'))['v'] or 0
    previous_week_revenue = Booking.objects.filter(status=Booking.COMPLETED, appointment__date__gte=prev_week_start, appointment__date__lte=prev_week_end).aggregate(v=Sum('total'))['v'] or 0
    revenue_growth = round(((current_week_revenue - previous_week_revenue) / previous_week_revenue) * 100, 1) if previous_week_revenue else (100.0 if current_week_revenue else 0)

    active_bookings = Booking.objects.filter(status__in=[Booking.PENDING, Booking.CONFIRMED]).count()
    pending_count = Booking.objects.filter(status=Booking.PENDING).count()
    completed_sessions = Booking.objects.filter(status=Booking.COMPLETED).count()
    staff_total = Staff.objects.filter(is_active=True).count() or 1
    off_today = set(RosterShift.objects.filter(date=today, is_on_duty=False).values_list('staff_id', flat=True))
    leave_user_ids = set(LeaveRequest.objects.filter(status=LeaveRequest.APPROVED, start_date__lte=today, end_date__gte=today).values_list('staff_id', flat=True))
    scheduled_ids = set(WorkingHours.objects.filter(weekday=today.weekday()).values_list('staff_id', flat=True))
    staff_on = Staff.objects.filter(is_active=True, pk__in=scheduled_ids).exclude(pk__in=off_today).exclude(user_id__in=leave_user_ids).count()
    roster_capacity = round((staff_on / staff_total) * 100)

    leaderboard = []
    for s in Staff.objects.filter(is_active=True):
        total = Booking.objects.filter(staff=s, status=Booking.COMPLETED).aggregate(v=Sum('total'))['v'] or 0
        today_count = Booking.objects.filter(staff=s, appointment__date=today).exclude(status=Booking.CANCELLED).count()
        leaderboard.append({'id': s.id, 'name': s.name, 'position': s.position, 'value': total, 'appointments_today': today_count})
    leaderboard.sort(key=lambda x: x['value'], reverse=True)

    recent = Booking.objects.select_related('staff', 'user').prefetch_related('items__service').order_by('-created_at')[:10]
    feed = []
    for b in recent:
        services = ', '.join([i.service.name for i in b.items.all()[:2]]) or 'Dịch vụ spa'
        feed.append({'id': b.id, 'title': f'{b.customer_name} · {services}', 'status': b.status, 'status_label': b.get_status_display(), 'time': b.appointment})

    heatmap_counts = {hour: 0 for hour in range(8, 19)}
    for booking in Booking.objects.filter(appointment__date=today).exclude(status=Booking.CANCELLED):
        hour = timezone.localtime(booking.appointment).hour
        if hour in heatmap_counts:
            heatmap_counts[hour] += 1
    heatmap = [{'hour': f'{hour:02d}:00', 'count': heatmap_counts[hour]} for hour in range(8, 19)]

    return Response({
        'summary': {
            'revenue': Booking.objects.filter(status=Booking.COMPLETED).aggregate(v=Sum('total'))['v'] or 0,
            'revenue_growth_percent': revenue_growth,
            'active_bookings': active_bookings,
            'pending': pending_count,
            'roster_capacity': roster_capacity,
            'completed_sessions': completed_sessions,
            'cancellation_today': Booking.objects.filter(status=Booking.CANCELLED, appointment__date=today).count(),
            'customers': User.objects.filter(role='customer').count(),
            'staff': staff_total,
            'confirmed': Booking.objects.filter(status=Booking.CONFIRMED).count(),
            'cancelled': Booking.objects.filter(status=Booking.CANCELLED).count(),
        },
        'revenue_growth': weekly,
        'leaderboard': leaderboard[:4],
        'feed': feed,
        'hourly_heatmap': heatmap,
        'live_date': today,
    })


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def crm_directory(request):
    customers = User.objects.filter(role='customer').order_by('username')
    rows = []
    for c in customers:
        completed = Booking.objects.filter(user=c, status=Booking.COMPLETED)
        spend = completed.aggregate(v=Sum('total'))['v'] or 0
        visits = completed.count()
        tier = User.loyalty_tier_for_spend(spend)
        history = []
        for b in completed.prefetch_related('items__service').order_by('-appointment')[:8]:
            history.append({'id': b.id, 'appointment': b.appointment, 'total': b.total, 'services': [i.service.name for i in b.items.all()]})
        rows.append({
            'id': c.id, 'name': c.get_full_name() or c.username, 'email': c.email, 'phone': c.phone,
            'loyalty_points': c.loyalty_points, 'total_spending': spend, 'visits': visits,
            'tier': c.membership_tier_override or tier['name'], 'tier_override': c.membership_tier_override,
            'history': history,
        })
    return Response(rows)


@api_view(['GET'])
@permission_classes([IsManagerRole])
def crm_forecast(request):
    """Dự báo có trọng số từ lịch hẹn thật; không suy diễn từ dữ liệu bệnh án."""
    today = timezone.localdate()
    start = today.replace(day=1)
    months = []
    for offset in range(6):
        year = start.year + (start.month - 1 + offset) // 12
        month = (start.month - 1 + offset) % 12 + 1
        month_start = start.replace(year=year, month=month, day=1)
        next_year = year + (1 if month == 12 else 0)
        next_month = 1 if month == 12 else month + 1
        month_end = month_start.replace(year=next_year, month=next_month, day=1)
        qs = Booking.objects.filter(appointment__date__gte=month_start, appointment__date__lt=month_end)
        pending = qs.filter(status=Booking.PENDING).aggregate(v=Sum('total'))['v'] or 0
        confirmed = qs.filter(status=Booking.CONFIRMED).aggregate(v=Sum('total'))['v'] or 0
        completed = qs.filter(status=Booking.COMPLETED).aggregate(v=Sum('total'))['v'] or 0
        weighted = round(pending * .3 + confirmed * .7 + completed)
        months.append({'month': month_start.strftime('%m/%Y'), 'pending': pending, 'confirmed': confirmed,
                       'actual': completed, 'forecast': weighted})
    active = Booking.objects.filter(status__in=[Booking.PENDING, Booking.CONFIRMED], appointment__date__gte=today).select_related('user', 'patient').prefetch_related('items__service').order_by('appointment')[:100]
    opportunities = []
    for b in active:
        probability = 70 if b.status == Booking.CONFIRMED else 30
        opportunities.append({'id': b.id, 'customer': b.customer_name, 'appointment': b.appointment,
                              'services': [x.service.name for x in b.items.all()], 'value': b.total,
                              'stage': b.status, 'probability': probability, 'weighted_value': round(b.total * probability / 100)})
    return Response({'months': months, 'opportunities': opportunities,
                     'summary': {'pipeline': sum(x['value'] for x in opportunities),
                                 'weighted': sum(x['weighted_value'] for x in opportunities),
                                 'opportunities': len(opportunities),
                                 'confirmed': sum(1 for x in opportunities if x['stage'] == Booking.CONFIRMED)}})


@api_view(['POST'])
@permission_classes([IsManagerRole])
def adjust_customer_points(request, user_id):
    customer = User.objects.filter(pk=user_id, role='customer').first()
    if not customer:
        return Response({'detail': 'Không tìm thấy khách hàng.'}, status=404)
    try:
        delta = int(request.data.get('delta', 0))
    except (TypeError, ValueError):
        return Response({'detail': 'Điểm điều chỉnh không hợp lệ.'}, status=400)
    customer.loyalty_points = max(0, (customer.loyalty_points or 0) + delta)
    customer.save(update_fields=['loyalty_points'])
    notify_users([customer], 'loyalty.adjusted', 'Điểm thưởng đã thay đổi', f'Số dư điểm hiện tại của bạn là {customer.loyalty_points} điểm.', {'delta': delta})
    return Response({'id': customer.pk, 'loyalty_points': customer.loyalty_points})


@api_view(['POST'])
@permission_classes([IsManagerRole])
def set_customer_tier(request, user_id):
    customer = User.objects.filter(pk=user_id, role='customer').first()
    if not customer:
        return Response({'detail': 'Không tìm thấy khách hàng.'}, status=404)
    tier = request.data.get('tier', '')
    if tier not in {'', 'Bronze', 'Silver', 'Gold', 'Platinum'}:
        return Response({'detail': 'Hạng thành viên không hợp lệ.'}, status=400)
    customer.membership_tier_override = tier
    customer.save(update_fields=['membership_tier_override'])
    notify_users([customer], 'loyalty.tier', 'Hạng thành viên đã cập nhật', f'Hạng thành viên hiện tại: {tier or "Tự động theo chi tiêu"}.', {'tier': tier})
    return Response({'id': customer.pk, 'tier': tier})


@api_view(['GET'])
@permission_classes([permissions.IsAuthenticated])
def payroll_report(request):
    rows = []
    staff_profiles = Staff.objects.select_related('user').filter(user__role__in=['staff','doctor']).order_by('name')
    for profile in staff_profiles:
        user = profile.user
        attendances = Attendance.objects.filter(staff=user)
        workdays = attendances.filter(status__in=[Attendance.FULL_DAY, Attendance.LATE]).count()
        leave_qs = LeaveRequest.objects.filter(staff=user, status=LeaveRequest.APPROVED)
        leave_days = sum(x.days for x in leave_qs)
        unpaid_days = sum(x.days for x in leave_qs.filter(leave_type=LeaveRequest.UNPAID))
        completed_revenue = Booking.objects.filter(staff=profile, status=Booking.COMPLETED).aggregate(v=Sum('total'))['v'] or 0
        commission_rate = profile.commission_rate or 0
        commission = round(completed_revenue * commission_rate / 100)
        late_minutes = 0
        for a in attendances.filter(status=Attendance.LATE, check_in__isnull=False):
            expected_hour = 9
            actual = a.check_in.hour * 60 + a.check_in.minute
            late_minutes += max(0, actual - expected_hour * 60)
        auto_deduction = late_minutes * 1000 + round((profile.base_salary / 26) * unpaid_days)
        deductions = profile.manual_deduction + auto_deduction
        net_pay = max(0, profile.base_salary + commission + profile.bonus - deductions)
        rows.append({
            'id': profile.id, 'user_id': user.id, 'name': profile.name, 'role': user.role, 'workdays': workdays,
            'leave_days': leave_days, 'annual_leave': 12, 'base_salary': profile.base_salary,
            'commission_base': completed_revenue, 'commission_rate': commission_rate, 'commission': commission,
            'bonus': profile.bonus, 'manual_deduction': profile.manual_deduction, 'auto_deduction': auto_deduction,
            'late_minutes': late_minutes, 'unpaid_days': unpaid_days, 'deductions': deductions, 'net_pay': net_pay,
            'status': profile.payroll_status,
        })
    total_payroll = sum([r['net_pay'] for r in rows])
    return Response({'summary': {'payroll': total_payroll, 'workdays': sum([r['workdays'] for r in rows]), 'approved': len([r for r in rows if r['status'] in {'approved','paid'}]), 'total_staff': len(rows)}, 'rows': rows})


@api_view(['POST'])
@permission_classes([permissions.IsAuthenticated])
def media_upload(request):
    file_obj = request.FILES.get('file')
    if not file_obj:
        return Response({'detail': 'Thiếu file.'}, status=400)
    if file_obj.size > 10 * 1024 * 1024:
        return Response({'detail': 'File tối đa 10MB.'}, status=400)
    result = upload_to_cloudinary(file_obj, folder=f'ohio/{request.user.role}')
    return Response(result, status=200 if result.get('enabled') else 503)


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def public_ticket(request, code):
    """Public electronic ticket resolved only by the unguessable booking confirmation code."""
    try:
        booking = Booking.objects.select_related('staff').prefetch_related('items__service').get(confirm_code=code)
    except Booking.DoesNotExist:
        return Response({'detail': 'Không tìm thấy vé.'}, status=404)
    return Response({
        'id': booking.pk,
        'confirm_code': booking.confirm_code,
        'customer_name': booking.customer_name,
        'appointment': booking.appointment,
        'appointment_type': booking.appointment_type,
        'appointment_type_label': booking.get_appointment_type_display(),
        'treatment_session_label': (
            f'{booking.treatment_session.plan.title} · Buổi {booking.treatment_session.number}'
            if booking.treatment_session_id else ''
        ),
        'status': booking.status,
        'status_label': booking.get_status_display(),
        'staff_name': booking.staff.name if booking.staff else '',
        'services': [item.service.name for item in booking.items.all()],
        'subtotal': sum(item.price for item in booking.items.all()),
        'discount_total': booking.discount_total,
        'applied_voucher_code': booking.applied_voucher.code if booking.applied_voucher else '',
        'total': booking.total,
        'loyalty_points_earned': booking.loyalty_points_earned,
    })


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def availability(request):
    """Return eligible staff and free start times for a service combination/day."""
    from core.availability import available_slots, qualified_staff
    from clinic.models import TreatmentPlan, TreatmentSession

    raw_ids = (request.query_params.get('service_ids') or '').split(',')
    try:
        service_ids = sorted({int(v) for v in raw_ids if v.strip()})
    except ValueError:
        return Response({'detail': 'service_ids không hợp lệ.'}, status=400)
    day_raw = request.query_params.get('date', '')
    try:
        day = date.fromisoformat(day_raw)
    except ValueError:
        return Response({'detail': 'date phải có dạng YYYY-MM-DD.'}, status=400)
    appointment_type = request.query_params.get('appointment_type', Booking.APPOINTMENT_TYPE_CONSULT)
    treatment_session_id = request.query_params.get('treatment_session_id')
    session = None
    if appointment_type == Booking.APPOINTMENT_TYPE_SESSION:
        if not request.user.is_authenticated or request.user.role != 'customer':
            return Response({'detail': 'Đăng nhập tài khoản bệnh nhân để xem lịch buổi liệu trình.'}, status=403)
        if not treatment_session_id:
            return Response({'detail': 'Vui lòng chọn buổi liệu trình cần xem lịch.'}, status=400)
        session = TreatmentSession.objects.select_related(
            'plan__patient', 'plan__doctor', 'plan__service',
        ).filter(
            pk=treatment_session_id,
            plan__patient__user=request.user,
            plan__status=TreatmentPlan.ACTIVE,
            status=TreatmentSession.PENDING,
        ).first()
        if not session:
            return Response({'detail': 'Buổi liệu trình không thuộc hồ sơ của bạn hoặc không còn khả dụng.'}, status=404)
        if session.bookings.filter(status__in=Booking.ACTIVE_STATUSES).exists():
            return Response({'detail': 'Buổi liệu trình này đã có lịch hiệu lực.'}, status=400)
        if not session.plan.doctor_id or not session.plan.doctor.is_active:
            return Response({'detail': 'Liệu trình chưa có bác sĩ phụ trách đang hoạt động.'}, status=400)
        if not session.plan.service_id or not session.plan.service.is_active:
            return Response({'detail': 'Buổi này chưa có dịch vụ được bác sĩ chỉ định hợp lệ.'}, status=400)
        if service_ids and set(service_ids) != {session.plan.service_id}:
            return Response({'detail': 'Dịch vụ của buổi liệu trình lấy theo chỉ định trong hồ sơ.'}, status=400)
        service_ids = [session.plan.service_id]
    elif treatment_session_id:
        return Response({'detail': 'Chỉ lịch buổi liệu trình mới nhận treatment_session_id.'}, status=400)
    if not service_ids:
        if appointment_type not in {
            Booking.APPOINTMENT_TYPE_CONSULT,
            Booking.APPOINTMENT_TYPE_FOLLOW_UP,
        }:
            return Response({'detail': 'Chỉ lịch khám/tư vấn mới được đặt khi chưa chọn dịch vụ.'}, status=400)
        duration = 60
        staff_qs = Staff.objects.filter(is_active=True, user__role='doctor').prefetch_related('working_hours')
    else:
        services = list(Service.objects.filter(pk__in=service_ids, is_active=True))
        if len(services) != len(service_ids):
            return Response({'detail': 'Có dịch vụ không tồn tại hoặc đã tắt.'}, status=400)
        if appointment_type == Booking.APPOINTMENT_TYPE_PROCEDURE and any(
            service.booking_policy != Service.BOOKING_DIRECT for service in services
        ):
            return Response({'detail': 'Dịch vụ cần được bác sĩ tư vấn hoặc chỉ định trước.'}, status=400)
        if appointment_type in {
            Booking.APPOINTMENT_TYPE_CONSULT,
            Booking.APPOINTMENT_TYPE_FOLLOW_UP,
        }:
            duration = 60
            staff_qs = Staff.objects.filter(
                is_active=True, user__role='doctor',
            ).prefetch_related('working_hours')
        elif session:
            staff_qs = qualified_staff(
                Staff.objects.filter(
                    is_active=True,
                    user__is_active=True,
                    user__role__in=['doctor', 'staff'],
                ),
                service_ids,
            )
            if not session.allow_staff_delegation:
                staff_qs = staff_qs.filter(user_id=session.plan.doctor_id)
            staff_qs = staff_qs.order_by(
                Case(
                    When(user_id=session.plan.doctor_id, then=0),
                    default=1,
                    output_field=IntegerField(),
                ),
                'name',
            )
            duration = sum(service.duration for service in services) or 60
        else:
            duration = sum(service.duration for service in services) or 60
            staff_qs = qualified_staff(Staff.objects.all(), service_ids).prefetch_related('working_hours')

    staff_id = request.query_params.get('staff_id')
    if staff_id:
        try:
            staff_qs = staff_qs.filter(pk=int(staff_id))
        except ValueError:
            return Response({'detail': 'staff_id không hợp lệ.'}, status=400)

    result = []
    for staff in staff_qs:
        result.append({
            'staff_id': staff.pk,
            'staff_name': staff.name,
            'is_plan_doctor': bool(session and staff.user_id == session.plan.doctor_id),
            'duration': duration,
            'slots': [slot.isoformat() for slot in available_slots(staff, day, duration)],
        })
    return Response({'date': day.isoformat(), 'duration': duration, 'staff': result})
