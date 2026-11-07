"""Gói liệu trình mẫu (bán trong màn Bán hàng) + ghi chú khách hàng."""
from django.db.models import Q
from rest_framework import mixins, serializers, viewsets
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response

from core.models import Booking
from .audit import audit
from .models import PackageTemplate, Patient, PatientNote
from .permissions import IsClinicStaff
from .serializers import uname
from .views_v2 import BILLING_READ, MANAGER, perm


class PackageTemplateSerializer(serializers.ModelSerializer):
    service_name = serializers.CharField(source='service.name', read_only=True, default='')
    category_name = serializers.CharField(source='service.category.name', read_only=True, default='')

    class Meta:
        model = PackageTemplate
        fields = ('id', 'name', 'description', 'service', 'service_name', 'category_name', 'total_sessions', 'interval_days',
                  'validity_months', 'price', 'is_active')

    def validate_total_sessions(self, v):
        if not 1 <= v <= 60:
            raise serializers.ValidationError('Số buổi từ 1 đến 60.')
        return v

    def validate_validity_months(self, v):
        if v > 60:
            raise serializers.ValidationError('Hiệu lực tối đa 60 tháng.')
        return v

    def validate_name(self, v):
        if not v.strip():
            raise serializers.ValidationError('Nhập tên gói.')
        return v.strip()


class PackageTemplateViewSet(mixins.ListModelMixin, mixins.CreateModelMixin, mixins.UpdateModelMixin, viewsets.GenericViewSet):
    """Đọc: quản lý / tư vấn / bác sĩ. Thêm, sửa, ngừng bán: chỉ quản lý (không xóa để giữ lịch sử các gói đã bán)."""
    serializer_class = PackageTemplateSerializer
    http_method_names = ['get', 'post', 'patch', 'head', 'options']

    def get_permissions(self):
        return [perm(BILLING_READ)] if self.action == 'list' else [perm(MANAGER)]

    def get_queryset(self):
        qs = PackageTemplate.objects.filter(is_custom=False).select_related('service__category')
        if not (self.request.query_params.get('all') and self.request.user.role == 'manager'):
            qs = qs.filter(is_active=True)
        return qs

    def perform_create(self, serializer):
        obj = serializer.save()
        audit(self.request.user, 'package.create', obj.name)

    def perform_update(self, serializer):
        obj = serializer.save()
        audit(self.request.user, 'package.update', obj.name)


@api_view(['GET', 'POST'])
@permission_classes([IsClinicStaff])
def patient_notes(request, pk):
    p = Patient.objects.filter(pk=pk).first()
    if not p:
        return Response({'detail': 'Không tìm thấy khách hàng.'}, status=404)
    if request.method == 'POST':
        text = (request.data.get('text') or '').strip()
        if not text:
            return Response({'detail': 'Nhập nội dung ghi chú.'}, status=400)
        PatientNote.objects.create(patient=p, author=request.user, text=text[:2000])
        audit(request.user, 'patient.note', p.code)
    client = [{'id': n.id, 'text': n.text, 'author': uname(n.author), 'created_at': n.created_at, 'mine': n.author_id == request.user.id}
              for n in p.notes.select_related('author')]
    appts = [{'id': b.id, 'text': b.note, 'appointment': b.appointment, 'code': b.confirm_code}
             for b in Booking.objects.filter(patient=p).exclude(note='').order_by('-appointment')]
    return Response({'client': client, 'appointments': appts}, status=201 if request.method == 'POST' else 200)


@api_view(['DELETE'])
@permission_classes([IsClinicStaff])
def patient_note_delete(request, pk, note_id):
    n = PatientNote.objects.filter(pk=note_id, patient_id=pk).first()
    if not n:
        return Response({'detail': 'Không tìm thấy ghi chú.'}, status=404)
    if request.user.role != 'manager' and n.author_id != request.user.id:
        return Response({'detail': 'Chỉ người viết hoặc quản lý mới xóa được ghi chú.'}, status=403)
    n.delete()
    return Response(status=204)
