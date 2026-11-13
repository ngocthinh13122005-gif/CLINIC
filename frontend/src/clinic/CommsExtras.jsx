import { useMemo, useState } from 'react';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import ForumOutlined from '@mui/icons-material/ForumOutlined';
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded';
import { fmtDate, fmtTime } from './ui';

export const dayKey = (v) => { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

/* ---------------------------------------------------------------- lịch "Nhảy tới ngày" */
export function JumpCalendar({ days, onPick, onClose }) {
  const keys = useMemo(() => [...days].sort(), [days]);
  const first = keys[0]; const last = keys[keys.length - 1];
  const [cursor, setCursor] = useState(() => { const d = new Date(`${last || dayKey(Date.now())}T00:00:00`); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [picked, setPicked] = useState('');
  const y = cursor.getFullYear(); const m = cursor.getMonth();
  const lead = (new Date(y, m, 1).getDay() + 6) % 7; // thứ Hai là cột đầu
  const cells = Array.from({ length: 42 }, (_, i) => new Date(y, m, 1 - lead + i));
  const fmt = (k) => { const [a, b, c] = k.split('-'); return `${c}/${b}/${a}`; };
  const minM = first ? new Date(`${first}T00:00:00`) : null; const maxM = last ? new Date(`${last}T00:00:00`) : null;
  const canPrev = minM && (y > minM.getFullYear() || (y === minM.getFullYear() && m > minM.getMonth()));
  const canNext = maxM && (y < maxM.getFullYear() || (y === maxM.getFullYear() && m < maxM.getMonth()));
  return <>
    <div className="cm-scrim" onClick={onClose} />
    <div className="cm-cal" role="dialog" aria-label="Nhảy tới ngày">
      <div className="cm-cal-range">{first ? `Đang hiển thị ${fmt(first)} — ${fmt(last)}` : 'Chưa có liên lạc'}</div>
      <div className="cm-cal-card">
        <div className="cm-cal-head"><b>Tháng {m + 1}/{y}</b>
          <span><button disabled={!canPrev} aria-label="Tháng trước" onClick={() => setCursor(new Date(y, m - 1, 1))}><ChevronLeftRounded /></button>
            <button disabled={!canNext} aria-label="Tháng sau" onClick={() => setCursor(new Date(y, m + 1, 1))}><ChevronRightRounded /></button></span></div>
        <div className="cm-cal-grid">
          {['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'].map((d) => <i key={d} className="dow">{d}</i>)}
          {cells.map((d) => { const k = dayKey(d); const has = days.has(k); const out = d.getMonth() !== m;
            return <button key={k + (out ? 'o' : '')} disabled={!has} className={`${out ? 'out' : ''} ${has ? 'has' : ''} ${picked === k ? 'sel' : ''}`}
              onClick={() => { setPicked(k); onPick(k); onClose(); }}>{d.getDate()}</button>; })}
        </div>
      </div>
    </div>
  </>;
}

/* ---------------------------------------------------------------- hộp thoại "In liên lạc" */
const CH = [['email', 'Email', MailOutlineRounded, 'email'], ['sms', 'SMS', ChatBubbleOutlineRounded, 'sms'], ['chat', 'Chat', ForumOutlined, 'chat']];
const STATUS = { sent: 'Đã gửi', simulated: 'Chưa gửi thật', failed: 'Gửi lỗi' };

function reportHtml(patient, rows) {
  const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const now = new Date();
  const typeLabel = { email: 'Email', sms: 'SMS', chat: 'Chat' };
  const body = rows.map((m) => {
    const isChat = m.channel === 'chat';
    const subject = isChat ? `Chat · ${m.subject}` : m.channel === 'sms' ? 'SMS' : m.subject;
    const meta = isChat ? `${m.channel_label} · ${m.message_count} tin nhắn` : `Từ ${m.from_address || '—'} · Tới ${m.to_address}`;
    const text = isChat ? `Tin gần nhất: ${m.body || ''}` : m.body;
    return `<tr><td class="t">${typeLabel[m.channel]}</td><td class="d">${esc(fmtDate(m.created_at))}, ${esc(fmtTime(m.created_at))}</td>
      <td><b>${esc(subject)}</b><div class="m">${esc(meta)}</div><div class="b">${esc(text).replace(/\n/g, '<br>')}</div></td>
      <td class="s">${esc(isChat ? m.status_label : STATUS[m.status] || m.status)}</td></tr>`;
  }).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Liên lạc — ${esc(patient.full_name)}</title><style>
    @page{margin:16mm 14mm}*{box-sizing:border-box}body{font:12px/1.5 Arial,Helvetica,sans-serif;color:#1d2a33;margin:0}
    h1{font-size:22px;margin:0 0 4px}.sub{color:#5b6b77;font-size:11.5px;margin-bottom:16px}
    table{width:100%;border-collapse:collapse}th{text-align:left;font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:#6b7c88;padding:8px 6px;border-bottom:2px solid #cfd9e0}
    td{vertical-align:top;padding:10px 6px;border-bottom:1px solid #e3eaee}tr{page-break-inside:avoid}.t{width:56px;font-weight:700}.d{width:120px;white-space:nowrap}.s{width:96px}
    .m{color:#6b7c88;font-size:10.5px;margin:2px 0 4px;overflow-wrap:anywhere}.b{font-size:11.5px;color:#33434e;overflow-wrap:anywhere}thead{display:table-header-group}
  </style></head><body><h1>Liên lạc — ${esc(patient.full_name)}</h1>
  <div class="sub">${esc(patient.full_name)} · ${rows.length} mục · Tạo lúc ${esc(fmtDate(now))} ${esc(fmtTime(now))} · Cuộc chat chỉ in tóm tắt</div>
  <table><thead><tr><th>Loại</th><th>Ngày</th><th>Tiêu đề / nội dung</th><th>Trạng thái</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
}

export function printRecord(patient, rows) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.srcdoc = reportHtml(patient, rows);
  f.onload = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1500); };
}

export function PrintModal({ patient, items, counts, onClose }) {
  const [sel, setSel] = useState(['email', 'sms', 'chat']);
  const toggle = (k) => setSel((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));
  const rows = items.filter((m) => sel.includes(m.channel));
  return <div className="cm-modal-wrap" role="dialog" aria-modal="true" aria-label="In liên lạc" onClick={onClose}>
    <div className="cm-modal sm" onClick={(e) => e.stopPropagation()}>
      <header><h3>In liên lạc</h3><button aria-label="Đóng" onClick={onClose}><CloseRounded /></button></header>
      <div className="cm-modal-body">
        <p>Chọn các kênh muốn đưa vào bản in.</p>
        <div className="cm-pm-row"><span className="cm-lbl">KÊNH</span><button className="cm-link" onClick={() => setSel([])}>Bỏ chọn tất cả</button></div>
        <div className="cm-pm-grid">{CH.map(([k, t, Ic]) => <button key={k} className={`cm-pm-card ${sel.includes(k) ? 'on' : ''}`} onClick={() => toggle(k)} aria-pressed={sel.includes(k)}>
          <span className={`cm-ico ${k}`}><Ic /></span><span><b>{t}</b><small>{counts[k] || 0} mục</small></span><i>{sel.includes(k) && <CheckRounded />}</i></button>)}</div>
        <p className="cm-pm-note">Cuộc chat chỉ in phần tóm tắt, không in toàn bộ nội dung.</p>
      </div>
      <footer><button className="cm-btn" onClick={onClose}>Hủy</button>
        <button className="cm-send" disabled={!rows.length} onClick={() => { printRecord(patient, rows); onClose(); }}>In {rows.length} mục</button></footer>
    </div>
  </div>;
}
