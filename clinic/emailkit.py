"""Khung và thành phần email của phòng khám (dùng chung cho email soạn tay và email đặt lịch).

- layout(): khung email hoàn chỉnh, bảng + inline CSS để hiển thị ổn định trên Gmail/Outlook/Apple Mail.
- fragment_to_html(): nhận HTML do người dùng soạn (chỉ giữ thẻ an toàn) và gắn style inline cho từng thẻ.
  Thẻ ngữ nghĩa được hiểu: h2, p, ul/ol/li, blockquote (khung nhấn), dl/dt/dd (bảng thông tin), a[data-btn] (nút), hr.
"""
import html as htmllib
import re
from html.parser import HTMLParser

from django.conf import settings

BRAND, BRAND_DARK, BRAND_SOFT = '#0a5964', '#0f2f38', '#eef6f7'
INK, MUTED, LINE = '#2b3a45', '#6b7c88', '#e3eaee'
FONT = "'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


def clinic():
    g = lambda k, d='': getattr(settings, k, d) or d
    return {'name': g('CLINIC_NAME', 'AkinaClinic'), 'tagline': g('CLINIC_TAGLINE', 'Phòng khám da liễu'),
            'address': g('CLINIC_ADDRESS'), 'phone': g('CLINIC_PHONE'), 'email': g('CLINIC_EMAIL'), 'website': g('CLINIC_WEBSITE')}


def esc(v):
    return htmllib.escape(str(v or ''))


def button(url, label):
    return (f'<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:22px 0"><tr>'
            f'<td align="center" bgcolor="{BRAND}" style="border-radius:8px;background-color:{BRAND}">'
            f'<a href="{esc(url)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;padding:13px 28px;font-family:{FONT};'
            f'font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">{esc(label)}</a></td></tr></table>')


def details_table(rows):
    """rows: [(nhãn, giá trị)] -> bảng thông tin có kẻ ngang."""
    out = [f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0;border:1px solid {LINE};'
           f'border-radius:10px;border-collapse:separate;background-color:#ffffff">']
    for i, (k, v) in enumerate(rows):
        bd = '' if i == len(rows) - 1 else f'border-bottom:1px solid {LINE};'
        out.append(f'<tr><td style="padding:12px 16px;{bd}font-family:{FONT};font-size:13px;color:{MUTED};width:36%;vertical-align:top">{esc(k)}</td>'
                   f'<td style="padding:12px 16px;{bd}font-family:{FONT};font-size:14px;color:{BRAND_DARK};font-weight:600;vertical-align:top">{v}</td></tr>')
    out.append('</table>')
    return ''.join(out)


def callout(inner):
    return (f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0"><tr>'
            f'<td style="background-color:{BRAND_SOFT};border-left:4px solid {BRAND};border-radius:6px;padding:14px 18px;font-family:{FONT};'
            f'font-size:14px;line-height:22px;color:{INK}">{inner}</td></tr></table>')


def layout(title, inner, *, preheader='', eyebrow=''):
    c = clinic()
    contact = ' &nbsp;·&nbsp; '.join(x for x in [esc(c['address']), (f"Hotline {esc(c['phone'])}" if c['phone'] else ''),
                                                  esc(c['email']), esc(c['website'])] if x)
    pre = (f'<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#eef2f5;font-size:1px;line-height:1px">{esc(preheader)}</div>' if preheader else '')
    eb = (f'<div style="font-family:{FONT};font-size:12px;line-height:16px;font-weight:700;letter-spacing:1.4px;text-transform:uppercase;color:{BRAND};margin-bottom:8px">{esc(eyebrow)}</div>' if eyebrow else '')
    return (
        '<!doctype html><html lang="vi"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>{esc(title)}</title></head><body style="margin:0;padding:0;background-color:#eef2f5">{pre}'
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#eef2f5"><tr><td align="center" style="padding:28px 12px">'
        '<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #dde5ea">'
        f'<tr><td height="5" style="height:5px;line-height:5px;font-size:0;background-color:{BRAND}">&nbsp;</td></tr>'
        f'<tr><td style="padding:26px 36px 18px"><div style="font-family:{FONT};font-size:22px;line-height:26px;font-weight:800;color:{BRAND};letter-spacing:.2px">{esc(c["name"])}</div>'
        f'<div style="font-family:{FONT};font-size:11px;line-height:16px;letter-spacing:1.6px;text-transform:uppercase;color:{MUTED};margin-top:3px">{esc(c["tagline"])}</div></td></tr>'
        f'<tr><td style="padding:26px 36px 24px;background-color:{BRAND_SOFT};border-top:1px solid {LINE};border-bottom:1px solid {LINE}">{eb}'
        f'<h1 style="margin:0;font-family:{FONT};font-size:25px;line-height:32px;font-weight:800;color:{BRAND_DARK}">{esc(title)}</h1></td></tr>'
        f'<tr><td style="padding:28px 36px 8px;font-family:{FONT};font-size:15px;line-height:25px;color:{INK}">{inner}</td></tr>'
        f'<tr><td style="padding:6px 36px 30px;font-family:{FONT};font-size:15px;line-height:24px;color:{INK}">Trân trọng,<br>'
        f'<strong style="color:{BRAND_DARK}">Đội ngũ {esc(c["name"])}</strong></td></tr>'
        f'<tr><td style="padding:20px 36px;background-color:#f7f9fa;border-top:1px solid {LINE};font-family:{FONT};font-size:12px;line-height:19px;color:{MUTED}">'
        f'{contact}<div style="margin-top:8px">Email này được gửi riêng cho bạn. Vui lòng không chuyển tiếp hoặc chia sẻ công khai nếu có thông tin cá nhân.</div></td></tr>'
        '</table></td></tr></table></body></html>')


# ---------------------------------------------------------------- làm sạch + gắn style
ALLOWED = {'p', 'br', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'a', 'h2', 'h3', 'blockquote', 'div', 'span', 'hr', 'dl', 'dt', 'dd'}
STYLE = {
    'p': f'margin:0 0 14px;font-family:{FONT};font-size:15px;line-height:25px;color:{INK}',
    'h2': f'margin:26px 0 10px;font-family:{FONT};font-size:19px;line-height:26px;font-weight:800;color:{BRAND_DARK}',
    'h3': f'margin:20px 0 8px;font-family:{FONT};font-size:16px;line-height:23px;font-weight:700;color:{BRAND_DARK}',
    'ul': f'margin:0 0 14px;padding-left:22px;font-family:{FONT};font-size:15px;line-height:25px;color:{INK}',
    'ol': f'margin:0 0 14px;padding-left:22px;font-family:{FONT};font-size:15px;line-height:25px;color:{INK}',
    'li': 'margin:0 0 6px',
    'div': f'font-family:{FONT};font-size:15px;line-height:25px;color:{INK}',
}


class _Inline(HTMLParser):
    def __init__(self, inline):
        super().__init__(convert_charrefs=True)
        self.out, self.skip, self.stack, self.inline = [], 0, [], inline
        self.dl_open = False

    def _attrs(self, tag, attrs):
        if tag != 'a':
            return '', False
        d = dict(attrs)
        href = d.get('href', '')
        if not re.match(r'^(https?://|mailto:|tel:)', href or '', re.I):
            return '', False
        btn = d.get('data-btn') is not None
        return f' href="{htmllib.escape(href, quote=True)}" target="_blank" rel="noopener noreferrer"', btn

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
            return
        if tag not in ALLOWED or self.skip:
            return
        extra, btn = self._attrs(tag, attrs)
        if not self.inline:
            self.out.append(f'<{tag}{extra}{" data-btn" if btn else ""}>')
            self.stack.append(tag)
            return
        if tag == 'br' or tag == 'hr':
            self.out.append('<br>' if tag == 'br' else f'<table role="presentation" width="100%" border="0" cellspacing="0" cellpadding="0" style="margin:18px 0"><tr><td height="1" style="height:1px;line-height:1px;font-size:0;background-color:{LINE}">&nbsp;</td></tr></table>')
            return
        if tag == 'blockquote':
            self.out.append(f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0"><tr><td style="background-color:{BRAND_SOFT};border-left:4px solid {BRAND};border-radius:6px;padding:14px 18px;font-family:{FONT};font-size:14px;line-height:22px;color:{INK}">')
        elif tag == 'dl':
            self.out.append(f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="margin:18px 0;border:1px solid {LINE};border-radius:10px;border-collapse:separate">')
        elif tag == 'dt':
            self.out.append(f'<tr><td style="padding:11px 16px;border-bottom:1px solid {LINE};font-family:{FONT};font-size:13px;color:{MUTED};width:36%;vertical-align:top">')
        elif tag == 'dd':
            self.out.append(f'<td style="padding:11px 16px;border-bottom:1px solid {LINE};font-family:{FONT};font-size:14px;color:{BRAND_DARK};font-weight:600;vertical-align:top">')
        elif tag == 'a' and btn:
            self.out.append(f'<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:20px 0"><tr><td align="center" bgcolor="{BRAND}" style="border-radius:8px;background-color:{BRAND}"><a{extra} style="display:inline-block;padding:13px 28px;font-family:{FONT};font-size:15px;line-height:20px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:8px">')
        elif tag == 'a':
            self.out.append(f'<a{extra} style="color:{BRAND};text-decoration:underline;font-weight:600">')
        elif tag in ('b', 'strong'):
            self.out.append('<strong>')
        elif tag in ('i', 'em', 'u', 's', 'span'):
            self.out.append(f'<{tag}>')
        else:
            self.out.append(f'<{tag} style="{STYLE.get(tag, "")}">')
        self.stack.append((tag, btn))

    def handle_endtag(self, tag):
        if tag in ('script', 'style'):
            self.skip = max(0, self.skip - 1)
            return
        if tag not in ALLOWED or tag in ('br', 'hr') or self.skip:
            return
        if not self.inline:
            self.out.append(f'</{tag}>')
            return
        btn = False
        for i in range(len(self.stack) - 1, -1, -1):
            if self.stack[i][0] == tag:
                btn = self.stack[i][1]
                del self.stack[i:]
                break
        if tag == 'blockquote':
            self.out.append('</td></tr></table>')
        elif tag == 'dl':
            self.out.append('</table>')
        elif tag == 'dt':
            self.out.append('</td>')
        elif tag == 'dd':
            self.out.append('</td></tr>')
        elif tag == 'a' and btn:
            self.out.append('</a></td></tr></table>')
        elif tag in ('b', 'strong'):
            self.out.append('</strong>')
        else:
            self.out.append(f'</{tag}>')

    def handle_data(self, data):
        if not self.skip:
            self.out.append(htmllib.escape(data))


def clean(src):
    """Làm sạch HTML người dùng soạn (giữ nguyên thẻ, bỏ style/script/thuộc tính nguy hiểm)."""
    p = _Inline(False)
    p.feed(src or '')
    p.close()
    return ''.join(p.out)


def fragment_to_html(src):
    """HTML đã làm sạch -> HTML có style inline, sẵn sàng đặt vào khung email."""
    p = _Inline(True)
    p.feed(src or '')
    p.close()
    out = ''.join(p.out)
    # bọc text trần (không nằm trong thẻ khối) thành đoạn văn
    if not re.search(r'<(p|h2|h3|ul|ol|table|blockquote|div)\b', out):
        out = f'<p style="{STYLE["p"]}">{out}</p>'
    return out
