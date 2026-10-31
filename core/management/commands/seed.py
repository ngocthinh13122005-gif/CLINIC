from django.core.management.base import BaseCommand
from accounts.models import User
from core.models import *

class Command(BaseCommand):
    help = 'Tạo dữ liệu mẫu'
    def handle(self, *a, **k):
        if User.objects.filter(username='admin').exists():
            User.objects.filter(username='admin').update(role=User.Role.SYSADMIN)
        else:
            User.objects.create_superuser('admin', 'admin@clinic.vn', 'admin123', first_name='Quản trị', role=User.Role.SYSADMIN)
        data = {'Khám & tư vấn': [('Khám da liễu tổng quát', 200000, 30), ('Tái khám da liễu', 100000, 20), ('Soi da chuyên sâu', 250000, 30)],
                'Điều trị mụn & sẹo': [('Điều trị mụn viêm', 600000, 45), ('Lăn kim / vi kim điều trị sẹo rỗ', 1200000, 60), ('Peel da y khoa', 800000, 45)],
                'Nám & sắc tố': [('Điều trị nám – tàn nhang', 1500000, 45), ('Laser Pico xóa sắc tố', 2500000, 45)],
                'Thủ thuật da liễu': [('Đốt laser mụn cóc / mụn thịt', 500000, 30), ('Tiêm nội thương tổn (sẹo lồi)', 400000, 20)]}
        for c, items in data.items():
            cat, _ = Category.objects.get_or_create(name=c)
            for n, p, d in items:
                Service.objects.get_or_create(name=n, defaults=dict(category=cat, price=p, duration=d,
                    description=f'{n} theo phác đồ do bác sĩ chỉ định.'))
        skin_cat = Category.objects.get(name='Điều trị mụn & sẹo')
        massage_cat = Category.objects.get(name='Khám & tư vấn')
        hair_cat = Category.objects.get(name='Thủ thuật da liễu')
        display_staff = {}
        for n, pos, cats in [('BS. Trần Minh Anh', 'Bác sĩ da liễu', [massage_cat, skin_cat, hair_cat]),
                              ('ĐD. Nguyễn Thu Hà', 'Điều dưỡng da liễu', [skin_cat, hair_cat])]:
            s, _ = Staff.objects.get_or_create(name=n, defaults=dict(position=pos))
            s.services.set(Service.objects.filter(category__in=cats))
            display_staff[n] = s

        # ---- Giai đoạn 3: tài khoản demo cho từng vai trò (RBAC) ----
        demo_accounts = [
            ('cskh1', 'Lê Thị CSKH', User.Role.CONSULTANT, 'cskh12345', None),
            ('nhanvien1', 'Phạm Văn Nhân Viên', User.Role.STAFF, 'nv12345', 'Điều dưỡng da liễu'),
            ('bacsi1', 'BS. Nguyễn Văn A', User.Role.DOCTOR, 'bacsi12345', 'Bác sĩ da liễu'),
            ('quanly1', 'Trần Quản Lý', User.Role.MANAGER, 'quanly12345', None),
            ('sysadmin1', 'IT SysAdmin', User.Role.SYSADMIN, 'sysadmin12345', None),
        ]
        login_staff = {}
        for username, name, role, pwd, position in demo_accounts:
            u = User.objects.filter(username=username).first()
            if not u:
                u = User.objects.create_user(username=username, email=f'{username}@clinic.vn', password=pwd,
                                              first_name=name, role=role)
            if role in (User.Role.STAFF, User.Role.DOCTOR):
                profile, _ = Staff.objects.get_or_create(user=u, defaults=dict(name=name, position=position))
                profile.name = name
                profile.position = position
                if role == User.Role.DOCTOR:
                    profile.rating = 4.9; profile.experience_years = 7; profile.base_salary = 12000000
                else:
                    profile.rating = 4.8; profile.experience_years = 3; profile.base_salary = 7000000
                profile.save()
                login_staff[username] = profile

        # ---- Khách hàng + hội thoại mẫu để dashboard/chat có dữ liệu ngay ----
        customer, created = User.objects.get_or_create(
            username='khach1',
            defaults={'email': 'khach1@clinic.vn', 'first_name': 'Khách AkinaClinic', 'role': User.Role.CUSTOMER},
        )
        if created:
            customer.set_password('khach12345')
            customer.save(update_fields=['password'])
        consultant = User.objects.filter(username='cskh1').first()
        conversation, _ = Conversation.objects.get_or_create(
            customer=customer, subject='Tư vấn khám da liễu',
            defaults={'assigned_to': consultant, 'status': Conversation.OPEN},
        )
        if not conversation.messages.exists():
            Message.objects.create(conversation=conversation, sender=customer, text='Xin chào AkinaClinic, tôi muốn được tư vấn khám da liễu.')

        # ---- Hộp thư tư vấn kiểu OA: nhãn, mẫu trả lời, SLA và presence ----
        ChatSetting.objects.get_or_create(pk=1, defaults={'sla_minutes': 15})
        for name, color in [('VIP','warning'),('Mụn','danger'),('Đặt lịch','primary'),('Chờ bác sĩ','info'),('Khiếu nại','danger'),('Theo dõi lại','success')]:
            Tag.objects.get_or_create(name=name, defaults={'color':color})
        for title, body in [
            ('Chào khách','Xin chào anh/chị, AkinaClinic rất vui được hỗ trợ. Anh/chị đang quan tâm dịch vụ nào ạ?'),
            ('Thông tin đặt lịch','Anh/chị vui lòng cho em biết dịch vụ, ngày và khung giờ mong muốn để AkinaClinic kiểm tra lịch trống.'),
            ('Chờ kiểm tra','Anh/chị chờ em một chút, em đang kiểm tra lịch và thông tin phù hợp.'),
            ('Chăm sóc sau dịch vụ','Sau điều trị, anh/chị vui lòng làm theo hướng dẫn của bác sĩ và liên hệ AkinaClinic nếu có dấu hiệu bất thường.'),
        ]:
            QuickReply.objects.get_or_create(title=title, defaults={'body':body, 'created_by':consultant})
        if consultant:
            AgentPresence.objects.update_or_create(user=consultant, defaults={'status':AgentPresence.ONLINE})
        manager = User.objects.filter(username='quanly1').first()
        doctor = User.objects.filter(username='bacsi1').first()
        if manager: AgentPresence.objects.update_or_create(user=manager, defaults={'status':AgentPresence.ONLINE})
        if doctor: AgentPresence.objects.update_or_create(user=doctor, defaults={'status':AgentPresence.ONLINE})

        # Ca chưa gán để demo hàng chờ.
        customer2, c2new = User.objects.get_or_create(username='khach2', defaults={'email':'khach2@clinic.vn','first_name':'Nguyễn Minh Anh','phone':'0905123456','role':User.Role.CUSTOMER})
        if c2new:
            customer2.set_password('khach12345'); customer2.save(update_fields=['password'])
        conv2, _ = Conversation.objects.get_or_create(customer=customer2, subject='Tư vấn điều trị mụn và đặt lịch khám', defaults={'status':Conversation.OPEN,'priority':Conversation.URGENT})
        if not conv2.messages.exists(): Message.objects.create(conversation=conv2, sender=customer2, text='Tôi đang bị mụn viêm và muốn đặt lịch sớm, AkinaClinic tư vấn giúp tôi với.')

        # ---- Giai đoạn 2: dịch vụ đảm nhận + lịch làm việc mẫu để có slot khả dụng ngay khi demo ----
        if 'nhanvien1' in login_staff:
            login_staff['nhanvien1'].services.set(Service.objects.filter(category__in=[skin_cat, hair_cat]))
        if 'bacsi1' in login_staff:
            login_staff['bacsi1'].services.set(Service.objects.all())

        WORKWEEK = [0, 1, 2, 3, 4, 5]  # Thứ Hai → Thứ Bảy, nghỉ Chủ Nhật
        for staff in list(display_staff.values()) + list(login_staff.values()):
            for wd in WORKWEEK:
                WorkingHours.objects.get_or_create(staff=staff, weekday=wd,
                                                    defaults=dict(start_time='08:00', end_time='17:00'))

        from django.core.management import call_command
        call_command('seed_clinic')
        call_command('seed_demo')
        self.stdout.write('Đã tạo dữ liệu mẫu. Admin: admin / admin123')
        self.stdout.write('Tài khoản demo (mật khẩu tạm không bắt buộc đổi): cskh1/cskh12345, nhanvien1/nv12345, '
                           'bacsi1/bacsi12345, quanly1/quanly12345, sysadmin1/sysadmin12345')
