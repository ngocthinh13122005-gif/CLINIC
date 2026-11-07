"""Allowlisted, validated settings. Unknown keys can never be persisted via the API."""
from django.core.validators import validate_email
from django.core.exceptions import ValidationError
from django.conf import settings


DEFINITIONS = {
    'user': {
        'ui.compact_sidebar': {'group': 'personal', 'type': 'boolean', 'default': False,
                               'label': 'Thu gọn thanh điều hướng'},
        'ui.show_date': {'group': 'personal', 'type': 'boolean', 'default': True,
                         'label': 'Hiển thị ngày trên thanh tiêu đề'},
        'ui.default_route': {'group': 'personal', 'type': 'route', 'default': '',
                             'label': 'Trang mặc định sau đăng nhập'},
        'ui.calendar_view': {'group': 'personal', 'type': 'choice', 'choices': ['calendar', 'list'],
                             'default': 'calendar', 'label': 'Chế độ xem lịch mặc định'},
        'notification.profile_updates': {'group': 'personal', 'type': 'boolean', 'default': True,
                                         'label': 'Thông báo thay đổi hồ sơ'},
        'notification.payroll_updates': {'group': 'personal', 'type': 'boolean', 'default': True,
                                         'label': 'Thông báo bảng lương'},
        'notification.loyalty_updates': {'group': 'personal', 'type': 'boolean', 'default': True,
                                         'label': 'Thông báo điểm thưởng và hạng thành viên'},
        'notification.marketing_updates': {'group': 'personal', 'type': 'boolean', 'default': True,
                                           'label': 'Thông báo hoạt động marketing'},
    },
    'clinic': {
        'clinic.brand_name': {'group': 'clinic-info', 'type': 'text', 'max_length': 120,
                              'default': 'PHÒNG KHÁM DA LIỄU AkinaClinic', 'label': 'Tên thương hiệu', 'required': True},
        'clinic.legal_name': {'group': 'clinic-info', 'type': 'text', 'max_length': 160,
                              'default': '', 'label': 'Tên pháp lý'},
        'clinic.address': {'group': 'clinic-info', 'type': 'text', 'max_length': 255,
                           'default': '', 'label': 'Địa chỉ'},
        'clinic.hotline': {'group': 'clinic-info', 'type': 'text', 'max_length': 30,
                           'default': '', 'label': 'Hotline'},
        'clinic.email': {'group': 'clinic-info', 'type': 'email', 'max_length': 254,
                         'default': '', 'label': 'Email liên hệ'},
        'clinic.website': {'group': 'clinic-info', 'type': 'url', 'max_length': 255,
                           'default': '', 'label': 'Website'},
        'clinic.tax_code': {'group': 'clinic-info', 'type': 'text', 'max_length': 32,
                            'default': '', 'label': 'Mã số thuế'},
        'clinic.license': {'group': 'clinic-info', 'type': 'text', 'max_length': 80,
                           'default': '', 'label': 'Giấy phép hoạt động'},
        'clinic.medical_director': {'group': 'clinic-info', 'type': 'text', 'max_length': 120,
                                    'default': '', 'label': 'Người chịu trách nhiệm chuyên môn'},
        'clinic.timezone': {'group': 'clinic-info', 'type': 'timezone', 'default': 'Asia/Ho_Chi_Minh',
                            'label': 'Múi giờ'},
        'booking.online_enabled': {'group': 'appointments', 'type': 'boolean', 'default': True,
                                   'label': 'Tiếp nhận yêu cầu đặt lịch trực tuyến'},
        'booking.minimum_advance_minutes': {'group': 'appointments', 'type': 'integer', 'min': 0, 'max': 1440,
                                            'default': 30, 'label': 'Thời gian đặt trước tối thiểu (phút)'},
        'booking.maximum_advance_days': {'group': 'appointments', 'type': 'integer', 'min': 0, 'max': 730,
                                         'default': 0, 'label': 'Thời gian đặt trước tối đa (ngày; 0 = không giới hạn)'},
        'booking.customer_change_notice_hours': {'group': 'appointments', 'type': 'integer', 'min': 0, 'max': 720,
                                                 'default': 24, 'label': 'Thời hạn khách tự đổi/hủy trước giờ hẹn (giờ)'},
        'booking.customer_cancel_notice_hours': {'group': 'appointments', 'type': 'integer', 'min': 0, 'max': 720,
                                                'default': 24, 'label': 'Thời hạn khách tự hủy trước giờ hẹn (giờ)',
                                                'help_text': 'Chính sách này chỉ áp dụng cho khách hàng; nhân viên vẫn xử lý hủy theo quyền nghiệp vụ.'},
        'booking.require_cancel_reason': {'group': 'appointments', 'type': 'boolean', 'default': False,
                                          'label': 'Yêu cầu lý do khi khách tự hủy lịch',
                                          'help_text': 'Lý do được lưu trong lịch sử thao tác của lịch hẹn.'},
        'booking.max_pending_per_customer': {'group': 'appointments', 'type': 'integer', 'min': 0, 'max': 20,
                                             'default': 0, 'label': 'Số lịch chờ xác nhận tối đa mỗi khách (0 = không giới hạn)',
                                             'help_text': 'Chỉ đếm lịch đang chờ xác nhận; lịch đã xác nhận không bị ảnh hưởng.'},
        'booking.buffer_minutes': {'group': 'appointments', 'type': 'choice', 'choices': [0, 5, 10, 15, 30],
                                   'default': 0, 'label': 'Thời gian đệm giữa hai lịch (phút)',
                                   'help_text': 'Áp dụng cho slot mới khi kiểm tra xung đột và phân công nhân sự.'},
        'booking.slot_interval_minutes': {'group': 'appointments', 'type': 'choice',
                                          'choices': [5, 10, 15, 30], 'default': 15,
                                          'label': 'Bước thời gian đặt lịch (phút)'},
        'reception.allow_walk_ins': {'group': 'reception', 'type': 'boolean', 'default': True,
                                     'label': 'Tiếp nhận khách chưa đặt lịch'},
        'reception.checkin_early_minutes': {'group': 'reception', 'type': 'integer', 'min': 0, 'max': 720,
                                            'default': 0, 'label': 'Cho check-in sớm trước lịch (phút; 0 = không giới hạn)'},
        'reception.no_show_grace_minutes': {'group': 'reception', 'type': 'integer', 'min': 0, 'max': 240,
                                            'default': 0, 'label': 'Thời gian chờ trước khi ghi nhận khách không đến (phút)',
                                            'help_text': 'Nhân viên chỉ có thể ghi nhận vắng mặt sau giờ hẹn cộng thời gian chờ này.'},
        'care.post_care_enabled': {'group': 'care-automation', 'type': 'boolean', 'default': True,
                                   'label': 'Tạo việc hỏi thăm sau lượt khám hoàn thành',
                                   'help_text': 'Chỉ tạo cho lượt khám đã hoàn thành; không tạo kết luận y khoa.'},
        'care.post_care_delay_days': {'group': 'care-automation', 'type': 'integer', 'min': 0, 'max': 30,
                                      'default': 1, 'label': 'Hỏi thăm sau (ngày)',
                                      'help_text': '0 = trong ngày; 1 = ngày hôm sau.'},
        'care.revisit_enabled': {'group': 'care-automation', 'type': 'boolean', 'default': True,
                                 'label': 'Tạo việc nhắc tái khám từ bệnh án đã ký'},
        'care.revisit_lead_days': {'group': 'care-automation', 'type': 'integer', 'min': 0, 'max': 30,
                                   'default': 2, 'label': 'Nhắc trước lịch tái khám (ngày)'},
        'care.session_enabled': {'group': 'care-automation', 'type': 'boolean', 'default': True,
                                 'label': 'Tạo việc nhắc buổi liệu trình sắp tới'},
        'care.session_lead_days': {'group': 'care-automation', 'type': 'integer', 'min': 0, 'max': 30,
                                   'default': 1, 'label': 'Nhắc trước buổi liệu trình (ngày)'},
        'care.debt_enabled': {'group': 'care-automation', 'type': 'boolean', 'default': True,
                              'label': 'Tạo việc nhắc hóa đơn còn công nợ'},
        'care.debt_after_days': {'group': 'care-automation', 'type': 'integer', 'min': 1, 'max': 90,
                                 'default': 7, 'label': 'Nhắc công nợ sau khi hóa đơn được tạo (ngày)'},
        'billing.default_due_days': {'group': 'billing', 'type': 'choice', 'choices': [0, 7, 15, 30],
                                     'default': 0, 'label': 'Điều khoản thanh toán mặc định (ngày)',
                                     'help_text': 'Chỉ áp dụng khi tạo hóa đơn mới; hóa đơn cũ giữ nguyên điều khoản và ngày đến hạn.'},
        'billing.cash_close_variance_manager_threshold': {'group': 'billing', 'type': 'integer', 'min': 0, 'max': 100000000,
                                                          'default': 0, 'label': 'Lệch quỹ vượt mức cần quản lý duyệt (VNĐ; 0 = không đặt ngưỡng)',
                                                          'help_text': 'Thu ngân không thể tự đóng ca vượt ngưỡng; quản lý cần đối chiếu và đóng ca.'},
        'inventory.expiry_warning_days': {'group': 'inventory', 'type': 'integer', 'min': 1, 'max': 365,
                                          'default': 90, 'label': 'Cảnh báo thuốc sắp hết hạn trong (ngày)',
                                          'help_text': 'Dùng cho bộ lọc lô sắp hết hạn và tổng quan kho.'},
        'inventory.require_lot_number': {'group': 'inventory', 'type': 'boolean', 'default': False,
                                         'label': 'Bắt buộc ghi số lô khi nhập hàng',
                                         'help_text': 'Chặn phiếu nhập mới nếu thiếu số lô; dữ liệu tồn kho cũ không bị sửa.'},
        'inventory.require_expiry_date': {'group': 'inventory', 'type': 'boolean', 'default': False,
                                          'label': 'Bắt buộc ghi hạn dùng khi nhập hàng',
                                          'help_text': 'Chặn phiếu nhập mới nếu thiếu hạn dùng; dữ liệu tồn kho cũ không bị sửa.'},
        'crm.loyalty_enabled': {'group': 'crm', 'type': 'boolean', 'default': True,
                                'label': 'Tích điểm cho dịch vụ đã hoàn thành',
                                'help_text': 'Chỉ áp dụng cho lượt hoàn tất từ thời điểm này; không cộng bù giao dịch cũ.'},
        'crm.vnd_per_point': {'group': 'crm', 'type': 'integer', 'min': 1000, 'max': 1000000,
                              'default': getattr(settings, 'LOYALTY_VND_PER_POINT', 10000), 'label': 'Chi tiêu để nhận 1 điểm (VNĐ)'},
        'marketing.campaigns_enabled': {'group': 'marketing', 'type': 'boolean', 'default': True,
                                        'label': 'Cho phép gửi chiến dịch email',
                                        'help_text': 'Khi bật, backend vẫn loại người đã rút đồng ý, hủy đăng ký hoặc bị chặn.'},
        'marketing.max_recipients': {'group': 'marketing', 'type': 'integer', 'min': 1, 'max': 5000,
                                     'default': 500, 'label': 'Số người nhận tối đa mỗi chiến dịch'},
        'access.restricted_actions': {
            'group': 'access', 'type': 'choice_list', 'default': [], 'label': 'Giới hạn thao tác theo vai trò',
            'help_text': 'Chỉ áp dụng thêm giới hạn. Không thể cấp quyền vượt quá ma trận vai trò và quy tắc bảo vệ bệnh án hiện có.',
            'choices': [
                {'value': 'consultant:booking:confirm', 'label': 'Tư vấn viên · Xác nhận lịch hẹn'},
                {'value': 'consultant:booking:cancel', 'label': 'Tư vấn viên · Hủy lịch hẹn'},
                {'value': 'consultant:reception:create', 'label': 'Tư vấn viên · Tạo lượt tiếp đón'},
                {'value': 'consultant:reception:update', 'label': 'Tư vấn viên · Chỉnh sửa tiếp đón'},
                {'value': 'consultant:billing:create', 'label': 'Tư vấn viên · Lập hóa đơn / thu tiền'},
                {'value': 'doctor:booking:confirm', 'label': 'Bác sĩ · Xác nhận lịch hẹn'},
                {'value': 'doctor:reception:update', 'label': 'Bác sĩ · Chỉnh sửa tiếp đón'},
                {'value': 'doctor:clinical:view', 'label': 'Bác sĩ · Xem bệnh án'},
                {'value': 'doctor:clinical:update', 'label': 'Bác sĩ · Ghi / cập nhật bệnh án'},
                {'value': 'manager:clinical:view', 'label': 'Quản lý · Xem bệnh án'},
                {'value': 'staff:booking:update', 'label': 'Nhân viên · Cập nhật lịch hẹn'},
                {'value': 'manager:billing:approve', 'label': 'Quản lý · Duyệt nghiệp vụ tài chính'},
                {'value': 'manager:inventory:approve', 'label': 'Quản lý · Duyệt nghiệp vụ kho'},
                {'value': 'manager:marketing:approve', 'label': 'Quản lý · Gửi chiến dịch marketing'},
            ],
        },
    },
}

ROLE_ROUTES = {
    'manager': ['/dashboard', '/admin/dashboard', '/lich-hen', '/tiep-don', '/benh-nhan', '/admin/conversations', '/thu-ngan', '/kho-thuoc', '/bao-cao'],
    'doctor': ['/dashboard', '/lich-hen', '/benh-nhan', '/lieu-trinh', '/cham-soc'],
    'consultant': ['/dashboard', '/tiep-don', '/lich-hen', '/benh-nhan', '/admin/conversations', '/thu-ngan'],
    'staff': ['/dashboard', '/lich-hen', '/lieu-trinh', '/kho-thuoc'],
    'customer': ['/'],
    'sysadmin': ['/dashboard'],
}


def public_definition(scope, key, definition, user=None):
    item = {name: value for name, value in definition.items() if name not in {'validator'}}
    if item.get('type') == 'route':
        item['choices'] = [''] + ROLE_ROUTES.get(getattr(user, 'role', ''), ['/dashboard'])
    return {'key': key, **item}


def validate_setting(definition, value, user=None):
    kind = definition['type']
    if kind == 'boolean':
        if not isinstance(value, bool):
            raise ValueError('Giá trị phải là bật hoặc tắt.')
    elif kind == 'integer':
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError('Giá trị phải là số nguyên.')
        if value < definition['min'] or value > definition['max']:
            raise ValueError(f"Giá trị phải trong khoảng {definition['min']}–{definition['max']}.")
    elif kind == 'text':
        if not isinstance(value, str) or len(value) > definition['max_length']:
            raise ValueError(f"Nội dung tối đa {definition['max_length']} ký tự.")
        if definition.get('required') and not value.strip():
            raise ValueError('Trường này không được để trống.')
    elif kind == 'email':
        if not isinstance(value, str) or len(value) > definition['max_length']:
            raise ValueError('Email không hợp lệ.')
        if value:
            try:
                validate_email(value)
            except ValidationError as exc:
                raise ValueError('Email không hợp lệ.') from exc
    elif kind == 'url':
        if not isinstance(value, str) or len(value) > definition['max_length']:
            raise ValueError('Đường dẫn website quá dài.')
        if value and not value.startswith(('https://', 'http://')):
            raise ValueError('Website cần bắt đầu bằng http:// hoặc https://.')
    elif kind in {'choice', 'timezone'}:
        if kind == 'timezone':
            from zoneinfo import available_timezones
            choices = available_timezones()
        else:
            choices = definition['choices']
        if value not in choices:
            raise ValueError('Giá trị được chọn không hợp lệ.')
    elif kind == 'route':
        if value not in ['', *ROLE_ROUTES.get(getattr(user, 'role', ''), ['/dashboard'])]:
            raise ValueError('Vai trò của bạn không được mở trang mặc định này.')
    elif kind == 'choice_list':
        allowed = {item['value'] for item in definition['choices']}
        if not isinstance(value, list) or len(value) != len(set(value)) or any(item not in allowed for item in value):
            raise ValueError('Danh sách lựa chọn không hợp lệ.')
    return value
