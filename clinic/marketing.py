from django.conf import settings
from django.core.mail import EmailMultiAlternatives
from django.db.models import Count, Q
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.permissions import AllowAny
from rest_framework.response import Response

from .models import EmailCampaign, MailingList, MarketingContact
from .permissions import IsClinicStaff
from core.role_permissions import configured_action_allowed


class ContactSerializer(serializers.ModelSerializer):
    class Meta:
        model = MarketingContact
        fields = '__all__'
        read_only_fields = ('unsubscribe_token', 'unsubscribed_at', 'created_at')

    def validate(self, attrs):
        if attrs.get('status', MarketingContact.ACTIVE) == MarketingContact.ACTIVE and not attrs.get('consent_note'):
            raise serializers.ValidationError({'consent_note': 'Cần ghi nhận căn cứ đồng ý nhận email quảng bá.'})
        return attrs


class ListSerializer(serializers.ModelSerializer):
    contact_count = serializers.IntegerField(read_only=True, default=0)
    active_contact_count = serializers.IntegerField(read_only=True, default=0)
    class Meta:
        model = MailingList
        fields = ('id', 'name', 'description', 'is_active', 'contact_count', 'active_contact_count', 'created_at')


class CampaignSerializer(serializers.ModelSerializer):
    mailing_list_name = serializers.CharField(source='mailing_list.name', read_only=True)
    class Meta:
        model = EmailCampaign
        fields = '__all__'
        read_only_fields = ('status', 'sent_at', 'recipient_count', 'sent_count', 'failed_count', 'created_by', 'created_at', 'updated_at')


def manager_only(request):
    return request.user.is_authenticated and request.user.role == 'manager'


@api_view(['GET', 'POST'])
@permission_classes([IsClinicStaff])
def contacts(request):
    if not manager_only(request): return Response({'detail': 'Chỉ quản lý được truy cập Email Marketing.'}, status=403)
    if request.method == 'POST':
        s = ContactSerializer(data=request.data)
        s.is_valid(raise_exception=True); obj = s.save()
        for list_id in request.data.get('list_ids', []): obj.mailing_lists.add(list_id)
        return Response(ContactSerializer(obj).data, status=201)
    qs = MarketingContact.objects.all()
    q = request.query_params.get('q', '').strip()
    if q: qs = qs.filter(Q(email__icontains=q) | Q(full_name__icontains=q))
    if request.query_params.get('status'): qs = qs.filter(status=request.query_params['status'])
    return Response(ContactSerializer(qs[:300], many=True).data)


@api_view(['GET', 'POST'])
@permission_classes([IsClinicStaff])
def lists(request):
    if not manager_only(request): return Response({'detail': 'Chỉ quản lý được truy cập Email Marketing.'}, status=403)
    if request.method == 'POST':
        s = ListSerializer(data=request.data); s.is_valid(raise_exception=True)
        return Response(ListSerializer(s.save(created_by=request.user)).data, status=201)
    qs = MailingList.objects.annotate(contact_count=Count('contacts', distinct=True), active_contact_count=Count('contacts', filter=Q(contacts__status='active'), distinct=True))
    return Response(ListSerializer(qs, many=True).data)


@api_view(['GET', 'POST'])
@permission_classes([IsClinicStaff])
def campaigns(request):
    if not manager_only(request): return Response({'detail': 'Chỉ quản lý được truy cập Email Marketing.'}, status=403)
    if request.method == 'POST':
        s = CampaignSerializer(data=request.data); s.is_valid(raise_exception=True)
        return Response(CampaignSerializer(s.save(created_by=request.user)).data, status=201)
    return Response(CampaignSerializer(EmailCampaign.objects.select_related('mailing_list')[:200], many=True).data)


@api_view(['POST'])
@permission_classes([IsClinicStaff])
def campaign_send(request, pk):
    if not manager_only(request): return Response({'detail': 'Chỉ quản lý được gửi chiến dịch.'}, status=403)
    if not configured_action_allowed(request.user, 'marketing', 'approve'):
        return Response({'detail': 'Quyền gửi chiến dịch đã bị giới hạn theo ma trận vai trò.'}, status=403)
    from core.operational_settings import clinic_setting
    if not clinic_setting('marketing.campaigns_enabled'):
        return Response({'detail': 'Chiến dịch email đang tạm dừng theo cài đặt phòng khám.'}, status=403)
    if not (settings.EMAIL_HOST_USER and settings.EMAIL_HOST_PASSWORD):
        return Response({'detail': 'SMTP chưa cấu hình. Hãy dùng Gmail App Password trong biến môi trường.'}, status=503)
    try: campaign = EmailCampaign.objects.select_related('mailing_list').get(pk=pk)
    except EmailCampaign.DoesNotExist: return Response({'detail': 'Không tìm thấy chiến dịch.'}, status=404)
    if campaign.status != EmailCampaign.DRAFT: return Response({'detail': 'Chỉ bản nháp mới được gửi.'}, status=400)
    if not campaign.mailing_list.is_active:
        return Response({'detail': 'Danh sách nhận tin đang tạm ngưng.'}, status=400)
    from django.db.models import Q
    from .models import DataConsent
    eligible = campaign.mailing_list.contacts.filter(status=MarketingContact.ACTIVE).exclude(email='').filter(
        Q(patient__isnull=True, consent_at__isnull=False) & ~Q(consent_note='')
        | Q(patient__data_consents__purpose='marketing', patient__data_consents__status=DataConsent.GRANTED)
    ).distinct()
    recipient_limit = int(clinic_setting('marketing.max_recipients'))
    if eligible.count() > recipient_limit:
        return Response({'detail': f'Chiến dịch có nhiều hơn giới hạn {recipient_limit} người nhận. Hãy chia nhỏ danh sách trước khi gửi.'}, status=400)
    sent = failed = 0
    base = getattr(settings, 'SITE_BASE_URL', 'http://localhost:8080').rstrip('/')
    recipients = eligible.order_by('id')
    for contact in recipients:
        unsubscribe = f'{base}/api/clinic/marketing/unsubscribe/{contact.unsubscribe_token}/'
        footer = f'<hr><p style="font-size:12px;color:#64748b">Bạn nhận email vì đã đồng ý nhận tin từ AkinaClinic. <a href="{unsubscribe}">Hủy đăng ký</a>.</p>'
        try:
            mail = EmailMultiAlternatives(campaign.subject, campaign.body_html, settings.DEFAULT_FROM_EMAIL, [contact.email])
            mail.attach_alternative(campaign.body_html.replace('\n', '<br>') + footer, 'text/html')
            mail.send(); sent += 1
        except Exception: failed += 1
    campaign.recipient_count = sent + failed; campaign.sent_count = sent; campaign.failed_count = failed
    campaign.status = EmailCampaign.SENT; campaign.sent_at = timezone.now()
    campaign.save(update_fields=['recipient_count', 'sent_count', 'failed_count', 'status', 'sent_at', 'updated_at'])
    return Response(CampaignSerializer(campaign).data)


@api_view(['GET'])
@permission_classes([IsClinicStaff])
def overview(request):
    if not manager_only(request): return Response({'detail': 'Chỉ quản lý được truy cập Email Marketing.'}, status=403)
    return Response({
        'contacts': MarketingContact.objects.count(), 'active_contacts': MarketingContact.objects.filter(status='active').count(),
        'unsubscribed': MarketingContact.objects.exclude(status='active').count(), 'lists': MailingList.objects.filter(is_active=True).count(),
        'campaigns': EmailCampaign.objects.count(), 'sent_campaigns': EmailCampaign.objects.filter(status='sent').count(),
        'smtp': {'configured': bool(settings.EMAIL_HOST_USER and settings.EMAIL_HOST_PASSWORD), 'host': settings.EMAIL_HOST,
                 'port': settings.EMAIL_PORT, 'sender': settings.EMAIL_HOST_USER or '', 'tls': settings.EMAIL_USE_TLS},
    })


@api_view(['POST'])
@permission_classes([AllowAny])
def unsubscribe(request, token):
    try: obj = MarketingContact.objects.get(unsubscribe_token=token)
    except MarketingContact.DoesNotExist: return Response({'detail': 'Liên kết không hợp lệ.'}, status=404)
    obj.status = MarketingContact.UNSUBSCRIBED; obj.unsubscribed_at = timezone.now()
    obj.save(update_fields=['status', 'unsubscribed_at'])
    return Response({'detail': 'Bạn đã hủy đăng ký email thành công.'})
