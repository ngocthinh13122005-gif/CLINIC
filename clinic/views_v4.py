"""v4: tuân thủ — đồng ý xử lý dữ liệu, yêu cầu của chủ thể, lưu trữ, sự cố, sao lưu, hóa đơn điện tử."""
import hashlib
import json
from datetime import timedelta
from io import BytesIO

from django.conf import settings
from django.http import HttpResponse
from django.utils import timezone
from rest_framework import serializers, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from accounts.models import ActivityLog, User
from . import backup
from .audit import audit
from .models import (BackupLog, ConsentForm, DataConsent, DataIncident, DataRequest, Invoice, MedicalRecord, Patient, Prescription, Visit)
from .serializers import uname
from .views import deny
from .views_v3 import FRONT, MANAGER, pc

NOTICE_VERSION = '1.0'
NOTICE_TEXT = """THÔNG BÁO XỬ LÝ DỮ LIỆU CÁ NHÂN (phiên bản 1.0)

Phòng khám xử lý dữ liệu cá nhân của bạn, trong đó có DỮ LIỆU SỨC KHỎE — là loại dữ liệu cá nhân NHẠY CẢM — gồm: thông tin định danh và liên lạc, tiền sử bệnh, kết quả khám, chẩn đoán, đơn thuốc, hình ảnh vùng da, thông tin thanh toán.

Mục đích: khám, chữa bệnh; lập và lưu hồ sơ bệnh án theo quy định; kê đơn; thanh toán; (nếu bạn đồng ý riêng) nhắc lịch, chăm sóc sau điều trị, chụp ảnh, thông tin ưu đãi.
Thời gian lưu: theo quy định về lưu trữ hồ sơ bệnh án (thông thường tối thiểu 10 năm).
Quyền của bạn: được biết, xem, sao chép, chỉnh sửa, yêu cầu xóa hoặc hạn chế xử lý, rút lại sự đồng ý. Việc rút lại không ảnh hưởng đến việc xử lý đã thực hiện trước đó, và phòng khám vẫn phải lưu hồ sơ bệnh án trong thời hạn luật định.
Chia sẻ: chỉ với cơ quan có thẩm quyền theo quy định pháp luật (ví dụ liên thông đơn thuốc) hoặc khi bạn đồng ý.
Mọi đồng ý đều là tự nguyện; mục "quảng bá" không bắt buộc và không ảnh hưởng đến việc được khám chữa bệnh.

[Nội dung này là mẫu — phòng khám cần để luật sư rà soát và chỉnh theo thực tế trước khi sử dụng chính thức.]"""
NOTICE_HASH = hashlib.sha256(NOTICE_TEXT.encode()).hexdigest()
REQUEST_SLA_HOURS = 72   # hạn xử lý nội bộ — đối chiếu quy định hiện hành
INCIDENT_SLA_HOURS = 72  # hạn báo cơ quan có thẩm quyền — đối chiếu quy định hiện hành
ADMIN_ROLES = {'manager'}


# --------------------------------------------------------------------------- đồng ý dữ liệu
class ConsentSer(serializers.ModelSerializer):
    purpose_label = serializers.CharField(source='get_purpose_display', read_only=True)
    recorded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = DataConsent
        fields = ('id', 'patient', 'purpose', 'purpose_label', 'status', 'notice_version', 'method', 'given_at', 'withdrawn_at', 'recorded_by_name',
                  'signer_name', 'signer_relation', 'note')

    def get_recorded_by_name(self, o):
        return uname(o.recorded_by)


class DataConsentViewSet(viewsets.GenericViewSet):
    serializer_class = ConsentSer
    permission_classes = [pc(FRONT | {'doctor'})]
    queryset = DataConsent.objects.select_related('recorded_by')

    def list(self, request):
        qs = self.get_queryset()
        if request.query_params.get('patient'):
            qs = qs.filter(patient_id=request.query_params['patient'])
        return Response(self.get_serializer(qs[:200], many=True).data)

    def create(self, request):
        """body: {patient, purposes:[...], confirmed:true, signer_name, signer_relation, method}. Phải do người dùng chủ động chọn."""
        pt = Patient.objects.filter(pk=request.data.get('patient')).first()
        purposes = [p for p in (request.data.get('purposes') or []) if p in dict(DataConsent.PURPOSES)]
        if not pt:
            return deny('Không tìm thấy bệnh nhân.', 400)
        if request.data.get('confirmed') is not True:
            return deny('Cần xác nhận bệnh nhân đã được thông báo và tự nguyện đồng ý.', 400)
        if 'care' not in purposes:
            return deny('Mục "Khám, chữa bệnh và lưu hồ sơ" là cần thiết để phòng khám tiếp nhận bệnh nhân.', 400)
        name = (request.data.get('signer_name') or '').strip()
        if not name:
            return deny('Nhập họ tên người đồng ý.', 400)
        out = []
        for p in purposes:
            DataConsent.objects.filter(patient=pt, purpose=p, status=DataConsent.GRANTED).update(status=DataConsent.WITHDRAWN, withdrawn_at=timezone.now(), note='Thay bằng bản ghi mới')
            out.append(DataConsent.objects.create(patient=pt, purpose=p, notice_version=NOTICE_VERSION, notice_hash=NOTICE_HASH, signer_name=name[:120],
                                                  signer_relation=(request.data.get('signer_relation') or 'Bản thân')[:60], recorded_by=request.user,
                                                  method=(request.data.get('method') or 'in_person')[:20]))
        audit(request.user, 'dataconsent.grant', f'{pt.code}: {",".join(purposes)}')
        return Response(self.get_serializer(out, many=True).data, status=201)

    def withdraw(self, request, pk=None):
        c = self.get_queryset().filter(pk=pk).first()
        if not c or c.status != DataConsent.GRANTED:
            return deny('Không có sự đồng ý đang hiệu lực.', 400)
        c.status, c.withdrawn_at, c.note = DataConsent.WITHDRAWN, timezone.now(), (request.data.get('note') or 'Bệnh nhân rút lại đồng ý')[:255]
        c.save()
        audit(request.user, 'dataconsent.withdraw', f'{c.patient.code}: {c.purpose}')
        return Response(self.get_serializer(c).data)


@api_view(['GET'])
@permission_classes([pc(FRONT | {'doctor'})])
def notice(request):
    return Response({'version': NOTICE_VERSION, 'text': NOTICE_TEXT, 'purposes': [{'key': k, 'label': v, 'required': k == 'care'} for k, v in DataConsent.PURPOSES]})


# --------------------------------------------------------------------------- yêu cầu chủ thể
class RequestSer(serializers.ModelSerializer):
    patient_name = serializers.CharField(source='patient.full_name', read_only=True)
    patient_code = serializers.CharField(source='patient.code', read_only=True)
    kind_label = serializers.CharField(source='get_kind_display', read_only=True)
    status_label = serializers.CharField(source='get_status_display', read_only=True)
    handled_by_name = serializers.SerializerMethodField()
    overdue = serializers.SerializerMethodField()

    class Meta:
        model = DataRequest
        fields = ('id', 'patient', 'patient_name', 'patient_code', 'kind', 'kind_label', 'status', 'status_label', 'detail', 'received_at', 'due_at',
                  'handled_at', 'handled_by_name', 'response', 'overdue')
        read_only_fields = ('status', 'received_at', 'due_at', 'handled_at', 'response')

    def get_handled_by_name(self, o):
        return uname(o.handled_by)

    def get_overdue(self, o):
        return o.status == DataRequest.OPEN and bool(o.due_at) and o.due_at < timezone.now()


class DataRequestViewSet(viewsets.ModelViewSet):
    serializer_class = RequestSer
    permission_classes = [pc(FRONT)]
    queryset = DataRequest.objects.select_related('patient', 'handled_by')
    http_method_names = ['get', 'post', 'head', 'options']

    def get_queryset(self):
        qs = super().get_queryset()
        p = self.request.query_params
        if p.get('patient'):
            qs = qs.filter(patient_id=p['patient'])
        if p.get('status'):
            qs = qs.filter(status=p['status'])
        return qs

    def perform_create(self, ser):
        now = timezone.now()
        obj = ser.save(created_by=self.request.user, received_at=now, due_at=now + timedelta(hours=REQUEST_SLA_HOURS))
        if obj.kind == 'withdraw':
            DataConsent.objects.filter(patient=obj.patient, status=DataConsent.GRANTED).exclude(purpose='care').update(status=DataConsent.WITHDRAWN, withdrawn_at=now, note='Theo yêu cầu rút đồng ý')
        audit(self.request.user, 'datarequest.create', f'{obj.patient.code} {obj.kind}')

    def resolve(self, request, pk=None):
        if request.user.role not in ADMIN_ROLES:
            return deny('Chỉ quản lý được kết thúc yêu cầu.', 403)
        r = self.get_queryset().filter(pk=pk).first()
        if not r or r.status != DataRequest.OPEN:
            return deny('Yêu cầu đã xử lý.', 400)
        res = (request.data.get('response') or '').strip()
        status = DataRequest.REJECTED if request.data.get('reject') else DataRequest.DONE
        if len(res) < 5:
            return deny('Ghi rõ phản hồi / căn cứ xử lý (tối thiểu 5 ký tự).', 400)
        r.status, r.response, r.handled_at, r.handled_by = status, res[:2000], timezone.now(), request.user
        r.save()
        audit(request.user, 'datarequest.resolve', f'#{r.pk} {status}')
        return Response(self.get_serializer(r).data)


@api_view(['GET'])
@permission_classes([pc(MANAGER)])
def patient_export(request, pk):
    """Xuất toàn bộ dữ liệu của một bệnh nhân (đáp ứng yêu cầu xem / sao chép dữ liệu)."""
    p = Patient.objects.filter(pk=pk).first()
    if not p:
        return deny('Không tìm thấy.', 404)
    data = {
        'xuat_luc': timezone.now().isoformat(),
        'benh_nhan': {k: str(getattr(p, k) or '') for k in ('code', 'full_name', 'gender', 'date_of_birth', 'phone', 'email', 'national_id', 'address', 'occupation', 'allergies',
                                                         'chronic_conditions', 'current_medications', 'family_history', 'skin_history')},
        'benh_an': [{'so': r.code, 'ngay': str(r.created_at.date()), 'ly_do': r.chief_complaint, 'chan_doan': r.diagnosis_name, 'icd10': r.diagnosis_code,
                     'huong_dieu_tri': r.treatment_direction, 'da_ky': r.status == 'signed'} for r in p.records.all()],
        'don_thuoc': [{'so': x.code, 'ngay': str(x.created_at.date()), 'chan_doan': x.diagnosis,
                       'thuoc': [{'ten': i.medicine.name, 'so_luong': i.quantity, 'lieu': i.dosage, 'cach_dung': i.usage, 'ngay': i.days} for i in x.items.select_related('medicine')]}
                      for x in p.prescriptions.filter(status='issued')],
        'hoa_don': [{'so': i.code, 'ngay': str(i.created_at.date()), 'tong': i.total, 'da_thu': i.paid} for i in p.invoices.exclude(status='void')],
        'dong_y_du_lieu': [{'muc_dich': c.get_purpose_display(), 'trang_thai': c.status, 'luc': c.given_at.isoformat()} for c in p.data_consents.all()],
    }
    audit(request.user, 'patient.export', p.code)
    resp = HttpResponse(json.dumps(data, ensure_ascii=False, indent=2), content_type='application/json; charset=utf-8')
    resp['Content-Disposition'] = f'attachment; filename="du-lieu-{p.code}.json"'
    return resp


# --------------------------------------------------------------------------- lưu trữ
@api_view(['GET'])
@permission_classes([pc(MANAGER)])
def retention(request):
    today = timezone.localdate()
    rows = []
    for r in MedicalRecord.objects.filter(status='signed').select_related('patient').order_by('signed_at')[:1000]:
        until = r.retain_until()
        rows.append({'id': r.id, 'code': r.code, 'patient': r.patient.full_name, 'patient_code': r.patient.code, 'signed_at': r.signed_at, 'outcome': r.outcome,
                     'legal_hold': r.legal_hold, 'retain_until': until, 'expired': until < today, 'days_left': (until - today).days})
    rows.sort(key=lambda x: x['retain_until'])
    return Response({'total': MedicalRecord.objects.count(), 'signed': len(rows), 'expired': sum(1 for x in rows if x['expired'] and not x['legal_hold']),
                     'adverse': MedicalRecord.objects.filter(outcome='adverse').count(), 'holds': MedicalRecord.objects.filter(legal_hold=True).count(),
                     'rows': rows[:200],
                     'policy': 'Hồ sơ bệnh án KHÔNG bị xóa trong hệ thống. Hết thời hạn lưu chỉ được đưa vào danh sách xem xét, việc hủy do quản lý quyết định theo quy trình của phòng khám.'})


@api_view(['POST'])
@permission_classes([pc({'manager', 'doctor'})])
def record_flags(request, pk):
    r = MedicalRecord.objects.filter(pk=pk).first()
    if not r:
        return deny('Không tìm thấy bệnh án.', 404)
    d = request.data
    if 'outcome' in d and d['outcome'] in dict(MedicalRecord._meta.get_field('outcome').choices):
        r.outcome = d['outcome']
    if 'legal_hold' in d:
        r.legal_hold = bool(d['legal_hold'])
    r.save(update_fields=['outcome', 'legal_hold'])
    audit(request.user, 'record.flags', f'{r.code} outcome={r.outcome} hold={r.legal_hold}')
    return Response({'outcome': r.outcome, 'legal_hold': r.legal_hold, 'retain_until': r.retain_until()})


# --------------------------------------------------------------------------- sự cố
class IncidentSer(serializers.ModelSerializer):
    kind_label = serializers.CharField(source='get_kind_display', read_only=True)
    reported_by_name = serializers.SerializerMethodField()
    authority_deadline = serializers.SerializerMethodField()
    overdue = serializers.SerializerMethodField()

    class Meta:
        model = DataIncident
        fields = ('id', 'kind', 'kind_label', 'title', 'description', 'detected_at', 'affected_count', 'measures', 'authority_notified_at',
                  'subjects_notified_at', 'status', 'reported_by_name', 'authority_deadline', 'overdue')

    def get_reported_by_name(self, o):
        return uname(o.reported_by)

    def get_authority_deadline(self, o):
        return o.detected_at + timedelta(hours=INCIDENT_SLA_HOURS)

    def get_overdue(self, o):
        return o.status == 'open' and not o.authority_notified_at and timezone.now() > o.detected_at + timedelta(hours=INCIDENT_SLA_HOURS)


class IncidentViewSet(viewsets.ModelViewSet):
    serializer_class = IncidentSer
    permission_classes = [pc(MANAGER)]
    queryset = DataIncident.objects.select_related('reported_by')
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def perform_create(self, ser):
        obj = ser.save(reported_by=self.request.user)
        audit(self.request.user, 'incident.create', f'#{obj.pk} {obj.title[:60]}')

    def perform_update(self, ser):
        obj = ser.save()
        audit(self.request.user, 'incident.update', f'#{obj.pk} {obj.status}')


# --------------------------------------------------------------------------- sao lưu
class BackupSer(serializers.ModelSerializer):
    by_name = serializers.SerializerMethodField()

    class Meta:
        model = BackupLog
        fields = ('id', 'created_at', 'kind', 'filename', 'size', 'sha256', 'encrypted', 'ok', 'note', 'by_name')

    def get_by_name(self, o):
        return uname(o.by) if o.by_id else 'Hệ thống'


@api_view(['GET', 'POST'])
@permission_classes([pc(MANAGER)])
def backups(request):
    if request.method == 'POST':
        log = backup.make_backup(user=request.user)
        v = backup.verify_backup(log, request.user)
        audit(request.user, 'backup.run', f'{log.filename} verify={v.ok}')
        return Response({'backup': BackupSer(log).data, 'verify': BackupSer(v).data}, status=201)
    return Response({'rows': BackupSer(BackupLog.objects.all()[:50], many=True).data, 'dir': str(backup.backup_dir()), 'own_key': bool(__import__('os').environ.get('BACKUP_ENCRYPTION_KEY'))})


@api_view(['POST'])
@permission_classes([pc(MANAGER)])
def backup_verify(request, pk):
    log = BackupLog.objects.filter(pk=pk, kind='backup').first()
    if not log:
        return deny('Không tìm thấy bản sao lưu.', 404)
    v = backup.verify_backup(log, request.user)
    audit(request.user, 'backup.verify', f'{log.filename} ok={v.ok}')
    return Response(BackupSer(v).data)


# --------------------------------------------------------------------------- trung tâm tuân thủ
DEMO_ACCOUNTS = [('admin', 'admin123'), ('cskh1', 'cskh12345'), ('nhanvien1', 'nv12345'), ('bacsi1', 'bacsi12345'), ('quanly1', 'quanly12345'), ('sysadmin1', 'sysadmin12345')]


_DEMO_CACHE = {'at': 0, 'v': []}


def _demo_accounts():
    import time
    if time.time() - _DEMO_CACHE['at'] < 60:
        return _DEMO_CACHE['v']
    v = [u for u, pw in DEMO_ACCOUNTS if (x := User.objects.filter(username=u, is_active=True).first()) and x.check_password(pw)]
    _DEMO_CACHE.update(at=time.time(), v=v)
    return v


@api_view(['GET'])
@permission_classes([pc(MANAGER)])
def overview(request):
    now = timezone.now()
    today = timezone.localdate()
    demo = _demo_accounts()
    last_bk = BackupLog.objects.filter(kind='backup', ok=True).first()
    last_vf = BackupLog.objects.filter(kind='verify', ok=True).first()
    no_consent = Patient.objects.filter(is_active=True).exclude(data_consents__purpose='care', data_consents__status='granted').count()
    open_req = DataRequest.objects.filter(status='open')
    inc_open = DataIncident.objects.filter(status='open')
    unsigned_old = MedicalRecord.objects.filter(status='draft', created_at__lt=now - timedelta(days=3)).count()
    rx_pending = Prescription.objects.filter(status='issued').exclude(national_status='sent').count()
    ei_pending = Invoice.objects.filter(einvoice_status='requested').count()
    secret_default = settings.SECRET_KEY == 'ohio-local-development-key'
    import os
    items = [
        ('Đổi tài khoản và mật khẩu mặc định', 'ok' if not demo else 'bad', f'Còn {len(demo)} tài khoản demo dùng mật khẩu mặc định: {", ".join(demo)}' if demo else 'Không còn mật khẩu mặc định.'),
        ('Khóa bí mật hệ thống (DJANGO_SECRET_KEY)', 'bad' if secret_default else 'ok', 'Đang dùng khóa mặc định — phải đặt khóa riêng.' if secret_default else 'Đã đặt khóa riêng.'),
        ('Tắt chế độ gỡ lỗi (DEBUG)', 'bad' if settings.DEBUG else 'ok', 'DEBUG đang bật — tắt khi chạy thật (DJANGO_DEBUG=0).' if settings.DEBUG else 'Đã tắt.'),
        ('HTTPS', 'warn' if not getattr(settings, 'SECURE_SSL_REDIRECT', False) else 'ok', 'Cần đặt sau reverse proxy có chứng chỉ TLS (Nginx/Caddy/Cloudflare). Hệ thống không tự kiểm tra được.'),
        ('Sao lưu mã hóa gần đây', 'ok' if last_bk and last_bk.created_at > now - timedelta(days=2) else ('warn' if last_bk else 'bad'),
         f'Lần gần nhất: {timezone.localtime(last_bk.created_at):%d/%m/%Y %H:%M}' if last_bk else 'Chưa có bản sao lưu nào.'),
        ('Đã thử khôi phục / kiểm tra bản sao lưu', 'ok' if last_vf and last_vf.created_at > now - timedelta(days=35) else 'warn',
         f'Lần gần nhất: {timezone.localtime(last_vf.created_at):%d/%m/%Y}' if last_vf else 'Chưa kiểm tra lần nào.'),
        ('Khóa mã hóa sao lưu riêng (BACKUP_ENCRYPTION_KEY)', 'ok' if os.environ.get('BACKUP_ENCRYPTION_KEY') else 'warn', 'Đã đặt.' if os.environ.get('BACKUP_ENCRYPTION_KEY') else 'Đang suy ra từ SECRET_KEY. Nên đặt khóa riêng và cất ngoài máy chủ.'),
        ('Bệnh nhân đã có đồng ý xử lý dữ liệu', 'ok' if no_consent == 0 else 'warn', f'{no_consent} bệnh nhân chưa có bản ghi đồng ý.' if no_consent else 'Đầy đủ.'),
        ('Yêu cầu của chủ thể dữ liệu quá hạn', 'bad' if open_req.filter(due_at__lt=now).exists() else 'ok', f'{open_req.count()} đang mở, {open_req.filter(due_at__lt=now).count()} quá hạn.'),
        ('Sự cố dữ liệu chưa báo / quá hạn', 'bad' if any(i.detected_at + timedelta(hours=INCIDENT_SLA_HOURS) < now and not i.authority_notified_at for i in inc_open) else 'ok', f'{inc_open.count()} sự cố đang mở.'),
        ('Bệnh án nháp tồn đọng quá 3 ngày', 'ok' if not unsigned_old else 'warn', f'{unsigned_old} bệnh án chưa ký — bệnh án phải được hoàn tất và ký ngay.' if unsigned_old else 'Không có.'),
        ('Đơn thuốc chưa liên thông quốc gia', 'ok' if not rx_pending else 'warn', f'{rx_pending} đơn chờ gửi (chưa có kết nối tự động — đối soát thủ công).' if rx_pending else 'Không có.'),
        ('Hóa đơn điện tử chờ xuất', 'ok' if not ei_pending else 'warn', f'{ei_pending} hóa đơn khách yêu cầu xuất.' if ei_pending else 'Không có.'),
        ('Chữ ký số của bác sĩ (bệnh án & đơn thuốc)', 'bad', 'CHƯA tích hợp: hệ thống mới có mã băm toàn vẹn nội bộ, chưa phải chữ ký số công cộng. Cần nhà cung cấp chứng thực chữ ký số.'),
        ('Liên thông đơn thuốc quốc gia', 'bad', 'CHƯA kết nối tự động: cần tài khoản và tài liệu kỹ thuật từ cơ quan quản lý.'),
    ]
    return Response({'items': [{'title': t, 'level': l, 'detail': d} for t, l, d in items],
                     'score': {'ok': sum(1 for i in items if i[1] == 'ok'), 'warn': sum(1 for i in items if i[1] == 'warn'), 'bad': sum(1 for i in items if i[1] == 'bad')}})


# --------------------------------------------------------------------------- hóa đơn điện tử: file chuyển nhà cung cấp
@api_view(['GET'])
@permission_classes([pc(FRONT)])
def einvoice_export(request):
    from openpyxl import Workbook
    from openpyxl.styles import Font, PatternFill
    wb = Workbook()
    ws = wb.active
    ws.title = 'Hóa đơn cần xuất'
    head = ['Số phiếu thu', 'Ngày', 'Tên người mua', 'Mã số thuế', 'Địa chỉ', 'Email', 'Tên hàng hóa, dịch vụ', 'ĐVT', 'Số lượng', 'Đơn giá', 'Thành tiền', 'Giảm giá (cả hóa đơn)', 'Tổng thanh toán']
    ws.append(head)
    for c in ws[1]:
        c.font, c.fill = Font(bold=True, color='FFFFFF'), PatternFill('solid', fgColor='0D7A8A')
    qs = Invoice.objects.filter(einvoice_status='requested').exclude(status='void').select_related('patient').prefetch_related('items')
    for inv in qs:
        buyer = inv.buyer_name or inv.patient.full_name
        for it in inv.items.all():
            ws.append([inv.code, timezone.localtime(inv.created_at).strftime('%d/%m/%Y'), buyer, inv.buyer_tax_code, inv.buyer_address or inv.patient.address, inv.buyer_email,
                       it.name, 'lần', it.quantity, it.unit_price, it.quantity * it.unit_price, inv.discount, inv.total])
    for col, w in zip('ABCDEFGHIJKLM', [14, 12, 28, 14, 34, 24, 34, 8, 10, 12, 14, 16, 16]):
        ws.column_dimensions[col].width = w
    bio = BytesIO()
    wb.save(bio)
    audit(request.user, 'einvoice.export', f'{qs.count()} hóa đơn')
    r = HttpResponse(bio.getvalue(), content_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    r['Content-Disposition'] = 'attachment; filename="hoa-don-can-xuat.xlsx"'
    return r
