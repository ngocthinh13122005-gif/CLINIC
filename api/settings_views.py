from django.core.cache import cache
from django.db import transaction
from datetime import datetime
from rest_framework import permissions, status
from rest_framework.decorators import api_view, permission_classes
from rest_framework.response import Response
from rest_framework.views import APIView

from core.models import ChatSetting, ChatbotSetting, ClinicSettingAudit, ClinicSettingValue
from core.settings_registry import DEFINITIONS, public_definition, validate_setting


class SettingsScopeView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    CLINIC_READ_ROLES = {'manager', 'doctor', 'consultant', 'staff'}
    CLINIC_SAFE_READ_KEYS = {
        'clinic.brand_name', 'clinic.address', 'clinic.hotline', 'clinic.email',
        'clinic.website', 'clinic.timezone', 'booking.online_enabled',
        'booking.minimum_advance_minutes', 'booking.maximum_advance_days',
        'booking.customer_change_notice_hours', 'booking.slot_interval_minutes',
        'booking.customer_cancel_notice_hours', 'booking.require_cancel_reason',
        'booking.max_pending_per_customer', 'booking.buffer_minutes',
        'reception.allow_walk_ins', 'reception.checkin_early_minutes', 'reception.no_show_grace_minutes',
        'billing.default_due_days', 'inventory.expiry_warning_days',
        'inventory.require_lot_number', 'inventory.require_expiry_date', 'crm.loyalty_enabled', 'crm.vnd_per_point',
        'billing.cash_close_variance_manager_threshold',
    }

    def _authorize(self, request, scope):
        role = request.user.role
        if scope == ClinicSettingValue.SCOPE_USER:
            return True
        if scope == ClinicSettingValue.SCOPE_CLINIC:
            return role in self.CLINIC_READ_ROLES
        if scope == ClinicSettingValue.SCOPE_SYSTEM:
            return role == 'sysadmin'
        return False

    def _can_edit(self, request, scope):
        if scope == ClinicSettingValue.SCOPE_USER:
            return True
        if scope == ClinicSettingValue.SCOPE_CLINIC:
            return request.user.role == 'manager'
        if scope == ClinicSettingValue.SCOPE_SYSTEM:
            return request.user.role == 'sysadmin'
        return False

    def _scope_key(self, request, scope):
        return str(request.user.pk) if scope == ClinicSettingValue.SCOPE_USER else 'default'

    def _payload(self, request, scope):
        scope_key = self._scope_key(request, scope)
        definitions = DEFINITIONS.get(scope, {})
        if scope == ClinicSettingValue.SCOPE_CLINIC and request.user.role != 'manager':
            definitions = {key: value for key, value in definitions.items() if key in self.CLINIC_SAFE_READ_KEYS}
        rows = ClinicSettingValue.objects.filter(scope=scope, scope_key=scope_key, key__in=definitions)
        stored = {row.key: row for row in rows}
        values, versions, public = {}, {}, []
        for key, definition in definitions.items():
            row = stored.get(key)
            values[key] = row.value if row else definition['default']
            versions[key] = row.version if row else 0
            public.append(public_definition(scope, key, definition, request.user))
        return {'scope': scope, 'values': values, 'versions': versions, 'definitions': public}

    def get(self, request, scope):
        if scope not in {ClinicSettingValue.SCOPE_USER, ClinicSettingValue.SCOPE_CLINIC, ClinicSettingValue.SCOPE_SYSTEM}:
            return Response({'detail': 'Phạm vi cài đặt không hợp lệ.'}, status=404)
        if not self._authorize(request, scope):
            return Response({'detail': 'Bạn không có quyền xem cài đặt này.'}, status=403)
        return Response(self._payload(request, scope))

    def put(self, request, scope):
        if scope not in DEFINITIONS:
            return Response({'detail': 'Phạm vi cài đặt không hợp lệ.'}, status=404)
        if not self._can_edit(request, scope):
            return Response({'detail': 'Bạn không có quyền thay đổi cài đặt này.'}, status=403)
        values = request.data.get('values')
        versions = request.data.get('versions') or {}
        reason = str(request.data.get('reason') or '').strip()
        if scope != ClinicSettingValue.SCOPE_USER and not reason:
            return Response({'detail': 'Vui lòng nhập lý do thay đổi để lưu nhật ký kiểm toán.'}, status=400)
        if len(reason) > 255:
            return Response({'detail': 'Lý do thay đổi tối đa 255 ký tự.'}, status=400)
        if not isinstance(values, dict) or not values:
            return Response({'detail': 'Không có thay đổi để lưu.'}, status=400)
        definitions = DEFINITIONS[scope]
        errors, cleaned = {}, {}
        for key, value in values.items():
            definition = definitions.get(key)
            if not definition:
                errors[key] = ['Không được phép thay đổi cài đặt này.']
                continue
            try:
                cleaned[key] = validate_setting(definition, value, request.user)
            except ValueError as exc:
                errors[key] = [str(exc)]
        if errors:
            return Response({'errors': errors}, status=400)

        scope_key = self._scope_key(request, scope)
        with transaction.atomic():
            current_rows = {
                row.key: row for row in ClinicSettingValue.objects.select_for_update().filter(
                    scope=scope, scope_key=scope_key, key__in=cleaned,
                )
            }
            conflicts = {}
            for key in cleaned:
                try:
                    expected_version = int(versions.get(key, 0))
                except (TypeError, ValueError):
                    expected_version = -1
                actual_version = current_rows[key].version if key in current_rows else 0
                if expected_version != actual_version:
                    conflicts[key] = actual_version
            if conflicts:
                return Response({'detail': 'Cài đặt đã được người khác cập nhật. Hãy tải lại trước khi lưu.',
                                 'versions': conflicts}, status=status.HTTP_409_CONFLICT)
            for key, value in cleaned.items():
                row = current_rows.get(key)
                old_value = row.value if row else None
                if old_value == value:
                    continue
                next_version = (row.version + 1) if row else 1
                if row:
                    row.value = value
                    row.version = next_version
                    row.updated_by = request.user
                    row.save(update_fields=['value', 'version', 'updated_by', 'updated_at'])
                else:
                    ClinicSettingValue.objects.create(scope=scope, scope_key=scope_key, key=key, value=value,
                                                      version=next_version, updated_by=request.user)
                ClinicSettingAudit.objects.create(setting_key=key, scope=scope, scope_key=scope_key,
                                                  old_value=old_value, new_value=value, actor=request.user,
                                                  reason=reason, version=next_version)
                cache.delete(f'akina_setting:{scope}:{scope_key}:{key}')
        return Response(self._payload(request, scope))


class SettingsAuditView(APIView):
    permission_classes = [permissions.IsAuthenticated]

    def get(self, request):
        role = request.user.role
        if role not in {'manager', 'sysadmin'}:
            return Response({'detail': 'Bạn không có quyền xem nhật ký cài đặt.'}, status=403)
        rows = ClinicSettingAudit.objects.select_related('actor')
        if role == 'manager':
            rows = rows.filter(scope=ClinicSettingValue.SCOPE_CLINIC)
        requested_scope = request.query_params.get('scope')
        if requested_scope in {ClinicSettingValue.SCOPE_USER, ClinicSettingValue.SCOPE_CLINIC, ClinicSettingValue.SCOPE_SYSTEM}:
            if role == 'manager' and requested_scope != ClinicSettingValue.SCOPE_CLINIC:
                return Response({'detail': 'Bạn không có quyền xem nhật ký phạm vi này.'}, status=403)
            rows = rows.filter(scope=requested_scope)
        results = [{
            'id': row.pk, 'key': row.setting_key, 'scope': row.scope,
            'old_value': row.old_value, 'new_value': row.new_value,
            'actor': (row.actor.get_full_name() or row.actor.username) if row.actor else 'Hệ thống',
            'reason': row.reason, 'version': row.version, 'effective_at': row.effective_at,
        } for row in rows[:200]]
        return Response({'results': results})


class SupportSettingsView(APIView):
    """Expose existing CSKH/chatbot settings through Settings Center without duplicating storage."""
    permission_classes = [permissions.IsAuthenticated]
    READ_ROLES = {'manager', 'doctor', 'consultant', 'staff'}
    FIELDS = {
        'support.business_start': ('support', 'business_start', 'time', 'Giờ bắt đầu hỗ trợ'),
        'support.business_end': ('support', 'business_end', 'time', 'Giờ kết thúc hỗ trợ'),
        'support.sla_minutes': ('support', 'sla_minutes', 'integer', 'SLA phản hồi đầu tiên (phút)'),
        'support.auto_csat_enabled': ('support', 'auto_csat_enabled', 'boolean', 'Tự mời đánh giá khi hoàn tất phiên'),
        'support.auto_close_daily': ('support', 'auto_close_daily', 'boolean', 'Tự kết thúc phiên lúc cuối ngày'),
        'chatbot.enabled': ('chatbot', 'enabled', 'boolean', 'Cho phép hiển thị chatbot trên website'),
        'chatbot.ai_enabled': ('chatbot', 'ai_enabled', 'boolean', 'Cho phép AI soạn câu trả lời'),
        'chatbot.automation_enabled': ('chatbot', 'automation_enabled', 'boolean', 'Cho phép chatbot thực hiện thao tác được cấp phép'),
        'chatbot.assistant_name': ('chatbot', 'assistant_name', 'text', 'Tên trợ lý'),
        'chatbot.greeting_message': ('chatbot', 'greeting_message', 'text', 'Lời chào'),
        'chatbot.fallback_message': ('chatbot', 'fallback_message', 'text', 'Thông báo khi chưa đủ thông tin'),
    }

    def _version(self, key):
        return ClinicSettingAudit.objects.filter(scope=ClinicSettingValue.SCOPE_CLINIC,
                                                 scope_key='default', setting_key=key).order_by('-version').values_list('version', flat=True).first() or 0

    def _payload(self):
        support = ChatSetting.load()
        chatbot = ChatbotSetting.load()
        values = {}
        for key, (group, attribute, _kind, _label) in self.FIELDS.items():
            value = getattr(support if group == 'support' else chatbot, attribute)
            values[key] = value.strftime('%H:%M') if hasattr(value, 'strftime') else value
        definitions = []
        for key, (_group, _attribute, kind, label) in self.FIELDS.items():
            maximum_length = 80 if key == 'chatbot.assistant_name' else 255 if key.startswith('support.') or key == 'chatbot.greeting_message' else 1000 if kind == 'text' else None
            definitions.append({'key': key, 'group': 'support', 'type': kind, 'label': label,
                                'default': values[key], 'max_length': maximum_length,
                                'min': 1 if key == 'support.sla_minutes' else None,
                                'max': 240 if key == 'support.sla_minutes' else None})
        versions = {key: self._version(key) for key in self.FIELDS}
        return {'scope': 'support', 'values': values, 'versions': versions, 'definitions': definitions,
                'confirmation_required': True}

    def get(self, request):
        if request.user.role not in self.READ_ROLES:
            return Response({'detail': 'Bạn không có quyền xem cài đặt CSKH.'}, status=403)
        return Response(self._payload())

    def put(self, request):
        if request.user.role != 'manager':
            return Response({'detail': 'Chỉ Quản lý phòng khám được thay đổi cài đặt CSKH & AI.'}, status=403)
        values = request.data.get('values')
        versions = request.data.get('versions') or {}
        reason = str(request.data.get('reason') or '').strip()
        if not isinstance(values, dict) or not values:
            return Response({'detail': 'Không có thay đổi để lưu.'}, status=400)
        if not reason or len(reason) > 255:
            return Response({'detail': 'Cần nhập lý do thay đổi (tối đa 255 ký tự).'}, status=400)
        errors, cleaned = {}, {}
        for key, value in values.items():
            definition = self.FIELDS.get(key)
            if not definition:
                errors[key] = ['Không được phép thay đổi cài đặt này.']
                continue
            _group, _attribute, kind, _label = definition
            if kind == 'boolean' and not isinstance(value, bool):
                errors[key] = ['Giá trị phải là bật hoặc tắt.']
            elif kind == 'integer' and (isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 240):
                errors[key] = ['SLA phải từ 1 đến 240 phút.']
            elif kind == 'time':
                try:
                    cleaned[key] = datetime.strptime(str(value), '%H:%M').time()
                except ValueError:
                    errors[key] = ['Giờ phải theo định dạng HH:MM.']
            elif kind == 'text' and (not isinstance(value, str) or not value.strip() or len(value) > (80 if key == 'chatbot.assistant_name' else 255 if key.startswith('support.') else 1000)):
                errors[key] = ['Nội dung không hợp lệ hoặc vượt quá giới hạn ký tự.']
            elif kind != 'time':
                cleaned[key] = value.strip() if kind == 'text' else value
        if errors:
            return Response({'errors': errors}, status=400)

        existing = self._payload()
        proposed_start = cleaned.get('support.business_start', datetime.strptime(existing['values']['support.business_start'], '%H:%M').time())
        proposed_end = cleaned.get('support.business_end', datetime.strptime(existing['values']['support.business_end'], '%H:%M').time())
        if proposed_start >= proposed_end:
            return Response({'errors': {'support.business_end': ['Giờ kết thúc phải sau giờ bắt đầu trong cùng ngày.']}}, status=400)

        with transaction.atomic():
            support = ChatSetting.objects.select_for_update().get(pk=ChatSetting.load().pk)
            chatbot = ChatbotSetting.objects.select_for_update().get(pk=ChatbotSetting.load().pk)
            current_versions = {key: self._version(key) for key in cleaned}
            conflicts = {}
            for key in cleaned:
                try:
                    expected = int(versions.get(key, -1))
                except (TypeError, ValueError):
                    expected = -1
                if expected != current_versions[key]:
                    conflicts[key] = current_versions[key]
            if conflicts:
                return Response({'detail': 'Cài đặt đã được người khác cập nhật. Hãy tải lại trước khi lưu.',
                                 'versions': conflicts}, status=status.HTTP_409_CONFLICT)
            changed_models = {'support': set(), 'chatbot': set()}
            audits = []
            for key, value in cleaned.items():
                group, attribute, _kind, _label = self.FIELDS[key]
                obj = support if group == 'support' else chatbot
                old_value = getattr(obj, attribute)
                old_serialized = old_value.strftime('%H:%M') if hasattr(old_value, 'strftime') else old_value
                new_serialized = value.strftime('%H:%M') if hasattr(value, 'strftime') else value
                if old_value == value:
                    continue
                setattr(obj, attribute, value)
                changed_models[group].add(attribute)
                audits.append((key, old_serialized, new_serialized, current_versions[key] + 1))
            if changed_models['support']:
                support.save(update_fields=list(changed_models['support']))
            if changed_models['chatbot']:
                chatbot.save(update_fields=[*changed_models['chatbot'], 'updated_at'])
            for key, old_value, new_value, version in audits:
                ClinicSettingAudit.objects.create(setting_key=key, scope=ClinicSettingValue.SCOPE_CLINIC,
                                                  scope_key='default', old_value=old_value, new_value=new_value,
                                                  actor=request.user, reason=reason, version=version)
        return Response(self._payload())


@api_view(['GET'])
@permission_classes([permissions.AllowAny])
def clinic_profile(request):
    """Public clinic contact details reused on the site and printed clinic documents."""
    from core.operational_settings import clinic_setting

    profile = {
        'brand_name': clinic_setting('clinic.brand_name'),
        'address': clinic_setting('clinic.address'),
        'hotline': clinic_setting('clinic.hotline'),
        'email': clinic_setting('clinic.email'),
        'website': clinic_setting('clinic.website'),
        'license': clinic_setting('clinic.license'),
    }
    if request.user.is_authenticated and request.user.role in {'manager', 'doctor', 'consultant', 'staff', 'sysadmin'}:
        profile.update({
            'legal_name': clinic_setting('clinic.legal_name'),
            'tax_code': clinic_setting('clinic.tax_code'),
            'medical_director': clinic_setting('clinic.medical_director'),
        })
    return Response(profile)
