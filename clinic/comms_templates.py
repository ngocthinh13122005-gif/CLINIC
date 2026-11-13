"""Mẫu email / SMS mặc định (nội dung dùng thẻ ngữ nghĩa, khung email do emailkit lo)."""
from .models import MessageTemplate

T = '{{ten_khach}}'
INFO = ('<dl><dt>Thời gian</dt><dd>{{lich_hen}}</dd><dt>Địa điểm</dt><dd>{{phong_kham}}{{dia_chi_dong}}</dd></dl>')

EMAIL = [
    ('confirm', 'confirmation', 'Xác nhận lịch hẹn', 'Lịch hẹn của bạn đã được xác nhận',
     f'<p>Xin chào <b>{T}</b>,</p><p>Cảm ơn bạn đã đặt lịch tại {{{{phong_kham}}}}. Lịch hẹn của bạn đã được xác nhận với thông tin sau:</p>{INFO}'
     '<blockquote>Bạn vui lòng đến trước giờ hẹn 10 phút và mang theo giấy tờ tùy thân để làm thủ tục nhanh hơn.</blockquote>'
     '<p>Nếu cần thay đổi lịch, hãy phản hồi email này hoặc gọi hotline {{hotline}}.</p>'),
    ('confirm_form', 'confirmation', 'Xác nhận lịch hẹn kèm phiếu khai y tế', 'Xác nhận lịch hẹn và phiếu khai thông tin sức khỏe',
     f'<p>Xin chào <b>{T}</b>,</p><p>Lịch hẹn của bạn đã được xác nhận:</p>{INFO}'
     '<h2>Phiếu khai thông tin sức khỏe</h2><p>Để bác sĩ chuẩn bị tốt nhất cho buổi hẹn, bạn vui lòng điền phiếu khai thông tin sức khỏe (chỉ mất vài phút). '
     'Thông tin được bảo mật theo quy định về dữ liệu y tế.</p><p><a data-btn="1" href="https://example.com/form">Điền phiếu khai</a></p>'),
    ('resched', 'confirmation', 'Thay đổi lịch hẹn', 'Lịch hẹn của bạn đã được thay đổi',
     f'<p>Xin chào <b>{T}</b>,</p><p>Lịch hẹn của bạn đã được cập nhật sang thời gian mới:</p>{INFO}'
     '<p>Rất xin lỗi nếu việc thay đổi gây bất tiện. Nếu thời gian mới chưa phù hợp, hãy phản hồi email này, chúng tôi sẽ sắp xếp lại ngay.</p>'),
    ('cancel', 'confirmation', 'Hủy lịch hẹn', 'Lịch hẹn của bạn đã được hủy',
     f'<p>Xin chào <b>{T}</b>,</p><p>Lịch hẹn của bạn vào <b>{{{{lich_hen}}}}</b> đã được hủy theo yêu cầu.</p>'
     '<p>Khi cần đặt lại, bạn chỉ cần phản hồi email này hoặc gọi hotline {{hotline}}. {{phong_kham}} luôn sẵn sàng phục vụ bạn.</p>'),
    ('missed', 'confirmation', 'Lỡ lịch hẹn', 'Chúng tôi rất tiếc đã không gặp bạn hôm nay',
     f'<p>Xin chào <b>{T}</b>,</p><p>Hôm nay {{{{phong_kham}}}} chưa được đón bạn theo lịch hẹn đã đặt. Hy vọng bạn vẫn ổn.</p>'
     '<p>Nếu bạn muốn đặt lại lịch, hãy phản hồi email này hoặc gọi hotline {{hotline}}, chúng tôi sẽ ưu tiên sắp xếp thời gian phù hợp.</p>'),
    ('remind', 'reminder', 'Nhắc lịch hẹn', 'Nhắc lịch hẹn sắp tới của bạn',
     f'<p>Xin chào <b>{T}</b>,</p><p>{{{{phong_kham}}}} xin nhắc bạn có lịch hẹn sắp tới:</p>{INFO}'
     '<p>Nếu bạn cần đổi hoặc hủy lịch, vui lòng báo trước để chúng tôi sắp xếp cho khách khác.</p>'),
    ('precare', 'precare', 'Dặn dò trước điều trị', 'Chuẩn bị trước buổi điều trị của bạn',
     f'<p>Xin chào <b>{T}</b>,</p><p>Để buổi điều trị đạt kết quả tốt nhất, bạn vui lòng lưu ý:</p>'
     '<ul><li>Không tẩy da chết, không dùng retinol / AHA / BHA trong 3 ngày trước buổi hẹn.</li><li>Hạn chế phơi nắng; thoa kem chống nắng đầy đủ.</li>'
     '<li>Cho bác sĩ biết nếu bạn đang dùng thuốc, đang mang thai hoặc có tiền sử dị ứng.</li></ul>'
     f'{INFO}'),
    ('aftercare', 'aftercare', 'Chăm sóc sau điều trị', 'Hướng dẫn chăm sóc da sau điều trị',
     f'<p>Xin chào <b>{T}</b>,</p><p>Cảm ơn bạn đã tin tưởng {{{{phong_kham}}}}. Một vài lưu ý giúp da hồi phục tốt:</p>'
     '<ul><li>Giữ da sạch, dùng sữa rửa mặt dịu nhẹ và kem dưỡng ẩm theo hướng dẫn.</li><li>Thoa kem chống nắng mỗi ngày, che chắn khi ra ngoài.</li>'
     '<li>Không tự ý bóc vảy, không dùng sản phẩm có hoạt chất mạnh khi chưa được bác sĩ đồng ý.</li></ul>'
     '<blockquote>Nếu thấy đỏ rát kéo dài, sưng hoặc có dấu hiệu bất thường, hãy liên hệ ngay hotline {{hotline}}.</blockquote>'),
    ('checkin', 'aftercare', 'Hỏi thăm sau điều trị', 'Bạn cảm thấy thế nào sau buổi điều trị?',
     f'<p>Xin chào <b>{T}</b>,</p><p>{{{{phong_kham}}}} muốn hỏi thăm tình trạng da của bạn sau buổi điều trị gần đây. Bạn cảm thấy thế nào?</p>'
     '<p>Mọi thắc mắc hoặc thay đổi trên da, bạn cứ phản hồi email này, bác sĩ sẽ hỗ trợ ngay.</p>'),
    ('thanks', 'general', 'Cảm ơn bạn đã đến', 'Cảm ơn bạn đã đến với phòng khám',
     f'<p>Xin chào <b>{T}</b>,</p><p>Cảm ơn bạn đã đến với {{{{phong_kham}}}}. Chúng tôi rất vui được đồng hành cùng bạn trên hành trình chăm sóc làn da.</p>'
     '<p>Rất mong nhận được góp ý của bạn để chúng tôi phục vụ tốt hơn.</p>'),
    ('payment', 'general', 'Nhắc thanh toán', 'Nhắc thanh toán hóa đơn',
     f'<p>Xin chào <b>{T}</b>,</p><p>{{{{phong_kham}}}} xin gửi nhắc nhẹ về khoản thanh toán còn lại của bạn. Nếu bạn đã thanh toán, vui lòng bỏ qua email này.</p>'
     '<p>Cần hỗ trợ về hóa đơn, bạn có thể phản hồi email này hoặc gọi hotline {{hotline}}.</p>'),
    ('birthday', 'general', 'Chúc mừng sinh nhật', 'Chúc mừng sinh nhật bạn!',
     f'<p>Xin chào <b>{T}</b>,</p><p>{{{{phong_kham}}}} xin gửi lời chúc mừng sinh nhật tốt đẹp nhất đến bạn. Chúc bạn thật nhiều sức khỏe, niềm vui và làn da luôn rạng rỡ.</p>'),
    ('offer', 'marketing', 'Ưu đãi dành riêng cho bạn', 'Ưu đãi dành riêng cho bạn từ phòng khám',
     f'<p>Xin chào <b>{T}</b>,</p><p>{{{{phong_kham}}}} dành tặng bạn một ưu đãi đặc biệt cho dịch vụ chăm sóc da trong thời gian tới.</p>'
     '<blockquote><b>Nội dung ưu đãi:</b> điền chi tiết ưu đãi và thời hạn tại đây.</blockquote><p><a data-btn="1" href="https://example.com">Đặt lịch ngay</a></p>'),
]
SMS = [
    ('sms_confirm', 'confirmation', 'Xác nhận lịch hẹn', 'Chào {{ten_khach}}, lịch hẹn của bạn tại {{phong_kham}} đã được xác nhận: {{lich_hen}}. Vui lòng đến trước 10 phút. Hotline {{hotline}}.'),
    ('sms_remind', 'reminder', 'Nhắc lịch hẹn', 'Chào {{ten_khach}}, {{phong_kham}} nhắc bạn có lịch hẹn: {{lich_hen}}. Cần đổi lịch xin báo trước. Hotline {{hotline}}.'),
    ('sms_after', 'aftercare', 'Chăm sóc sau điều trị', 'Chào {{ten_khach}}, cảm ơn bạn đã đến {{phong_kham}}. Bạn nhớ dùng kem chống nắng, giữ da sạch và gọi {{hotline}} nếu có dấu hiệu bất thường.'),
    ('sms_payment', 'general', 'Nhắc thanh toán', 'Chào {{ten_khach}}, {{phong_kham}} nhắc bạn khoản thanh toán còn lại. Nếu đã thanh toán xin bỏ qua tin này. Hotline {{hotline}}.'),
    ('sms_birthday', 'general', 'Chúc mừng sinh nhật', 'Chúc mừng sinh nhật {{ten_khach}}! {{phong_kham}} chúc bạn một ngày thật vui và làn da luôn khỏe đẹp.'),
]


def ensure_defaults():
    """Tạo mẫu mặc định còn thiếu (không ghi đè mẫu đã có hoặc đã sửa)."""
    have = set(MessageTemplate.objects.exclude(key__isnull=True).values_list('key', flat=True))
    new = []
    for key, cat, name, subject, body in EMAIL:
        if key not in have:
            new.append(MessageTemplate(key=key, channel='email', category=cat, name=name, subject=subject, body=body))
    for key, cat, name, body in SMS:
        if key not in have:
            new.append(MessageTemplate(key=key, channel='sms', category=cat, name=name, body=body))
    if new:
        MessageTemplate.objects.bulk_create(new)
