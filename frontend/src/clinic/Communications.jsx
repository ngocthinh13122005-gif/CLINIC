import { useEffect, useMemo, useRef, useState } from 'react';
import AddRounded from '@mui/icons-material/AddRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DoneAllRounded from '@mui/icons-material/DoneAllRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import MinimizeRounded from '@mui/icons-material/MinimizeRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import api from '../api/client';
import { Avatar, Empty, Loading, errMsg, fmtDate, fmtTime, useLoad } from './ui';
import './communications.css';

const DOW = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const dayKey = (v) => { const d = new Date(v); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const ago = (v) => {
  const days = Math.floor((Date.now() - new Date(v).getTime()) / 864e5);
  if (days < 1) return 'hôm nay';
  if (days < 7) return `${days} ngày trước`;
  if (days < 30) return `${Math.floor(days / 7)} tuần trước`;
  if (days < 365) return `${Math.floor(days / 30)} tháng trước`;
  return `${Math.floor(days / 365)} năm trước`;
};
export const smsSegments = (t) => {
  const n = [...(t || '')].length; if (!n) return 0;
  const ascii = /^[\x00-\x7F]*$/.test(t);
  const [one, multi] = ascii ? [160, 153] : [70, 67];
  return n <= one ? 1 : Math.ceil(n / multi);
};
const statusTone = { sent: null, simulated: 'amber', failed: 'red' };

function Bubble({ m }) {
  return <div className="cm-bubble-wrap"><time>{fmtDate(m.created_at)}, {fmtTime(m.created_at)}</time><div className="cm-bubble">{m.body}</div><small>Gửi tới {m.to_address}</small></div>;
}

function Item({ m, open, onToggle, onResend, onDelete, canDelete }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (!menu) return undefined; const h = (e) => ref.current && !ref.current.contains(e.target) && setMenu(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [menu]);
  const isSms = m.channel === 'sms';
  const preview = (m.body || '').replace(/\s+/g, ' ').slice(0, 160);
  const tone = statusTone[m.status];
  return <article className={`cm-item ${m.channel} ${open ? 'open' : ''}`}>
    <div className="cm-item-head" onClick={onToggle}>
      <span className={`cm-ico ${m.channel}`}>{isSms ? <ChatBubbleOutlineRounded /> : <MailOutlineRounded />}</span>
      <div className="cm-item-main">
        <h4>{isSms ? 'SMS' : m.subject || 'Email'}
          {m.status === 'sent' && (isSms ? <DoneAllRounded className="ok" /> : <CheckRounded className="ok" />)}
          {tone && <em className={tone}>{m.status === 'failed' ? <ErrorOutlineRounded /> : null}{m.status_label}</em>}</h4>
        <p className="cm-meta">{fmtDate(m.created_at)}, {fmtTime(m.created_at)} · Từ: {m.from_address || '—'} · Đến: {m.to_address}{m.sent_by_name ? ` · Gửi bởi ${m.sent_by_name}` : ''}</p>
        {m.error && <p className="cm-err">{m.error}</p>}
        {!open && <p className="cm-prev">{preview}</p>}
      </div>
      <button className="cm-icon-btn" aria-label={open ? 'Thu gọn' : 'Mở rộng'}><ExpandMoreRounded className="cm-chev" /></button>
      <div className="cm-menu-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
        <button className="cm-icon-btn" aria-label="Thao tác" onClick={() => setMenu(!menu)}><MoreVertRounded /></button>
        {menu && <div className="cm-menu"><button onClick={() => { setMenu(false); onResend(m); }}>Gửi lại</button>{canDelete && <button className="red" onClick={() => { setMenu(false); onDelete(m); }}>Xóa</button>}</div>}
      </div>
    </div>
    {open && <div className="cm-item-body">{isSms ? <Bubble m={m} /> : <div className="cm-mail">
      <header><b>{m.subject}</b><time>{fmtDate(m.created_at)}, {fmtTime(m.created_at)}</time></header>
      <dl><dt>Từ:</dt><dd>{m.from_address}</dd><dt>Tới:</dt><dd>{m.to_address}</dd></dl>
      <div className="cm-mail-body" dangerouslySetInnerHTML={{ __html: m.body_html || `<p>${m.body}</p>` }} /></div>}</div>}
  </article>;
}

/* ------------------------------------------------------------- soạn email / SMS */
function MergeMenu({ tags, onPick }) {
  const [o, setO] = useState(false);
  return <span className="cm-pop"><button type="button" className="cm-tool" onClick={() => setO(!o)}># Thẻ ghép<ExpandMoreRounded /></button>
    {o && <div className="cm-pop-box up">{tags.map(([k, t]) => <button key={k} onClick={() => { setO(false); onPick(`{{${k}}}`); }}>{t}<small>{`{{${k}}}`}</small></button>)}</div>}</span>;
}
function TemplateMenu({ templates, onPick, field }) {
  const [o, setO] = useState(false);
  return <span className="cm-pop"><button type="button" className="cm-tool" onClick={() => setO(!o)}>Mẫu có sẵn<ExpandMoreRounded /></button>
    {o && <div className="cm-pop-box up">{templates.map((t) => <button key={t.key} onClick={() => { setO(false); onPick(t); }}>{t.name}</button>)}</div>}</span>;
}

function Dock({ patient, title, onClose, children, sizeClass = '' }) {
  const [state, setState] = useState('normal');
  return <div className={`cm-dock ${state} ${sizeClass}`} role="dialog" aria-label={title}>
    <header><Avatar name={patient.full_name} size={28} /><b>{patient.full_name} – {title}</b>
      <span><button aria-label="Thu nhỏ" onClick={() => setState(state === 'min' ? 'normal' : 'min')}><MinimizeRounded /></button>
        <button aria-label="Phóng to" onClick={() => setState(state === 'max' ? 'normal' : 'max')}><OpenInFullRounded /></button>
        <button aria-label="Đóng" onClick={onClose}><CloseRounded /></button></span></header>
    {state !== 'min' && children}
  </div>;
}

function EmailComposer({ patient, info, onClose, onSent }) {
  const [subject, setSubject] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const ed = useRef(null);
  const exec = (cmd, val) => { ed.current?.focus(); document.execCommand(cmd, false, val); };
  const insert = (txt) => { ed.current?.focus(); document.execCommand('insertText', false, txt); };
  const send = async () => {
    setErr(''); setBusy(true);
    try { const { data } = await api.post('/clinic/messages/send-email/', { patient: patient.id, subject, body_html: ed.current?.innerHTML || '' }); onSent(data); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const link = () => { const u = window.prompt('Nhập địa chỉ liên kết (https://…)'); if (u) exec('createLink', u); };
  return <Dock patient={patient} title="Thư mới" onClose={onClose}>
    <div className="cm-dock-body">
      <div className="cm-details"><span className="cm-lbl">CHI TIẾT</span><b>{patient.email || <em className="cm-warn-txt">Chưa có email</em>}</b><span className="cm-dot">·</span>
        <input aria-label="Tiêu đề" placeholder="Tiêu đề email" value={subject} onChange={(e) => setSubject(e.target.value)} /></div>
      <div className="cm-toolbar" role="toolbar" aria-label="Định dạng">
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('bold')} aria-label="In đậm"><b>B</b></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('italic')} aria-label="In nghiêng"><i>I</i></button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('underline')} aria-label="Gạch chân"><u>U</u></button>
        <span className="sep" />
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertUnorderedList')} aria-label="Danh sách chấm">• ―</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('insertOrderedList')} aria-label="Danh sách số">1. ―</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={link} aria-label="Chèn liên kết">Liên kết</button>
        <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => exec('removeFormat')} aria-label="Xóa định dạng">Xóa định dạng</button></div>
      <div ref={ed} className="cm-editor" contentEditable suppressContentEditableWarning data-ph="Bắt đầu soạn email…" />
      {err && <div className="cm-alert">{err}</div>}
    </div>
    <footer className="cm-dock-foot">
      <div className="cm-tools"><TemplateMenu templates={info.templates} onPick={(t) => { setSubject(t.subject); if (ed.current) ed.current.innerHTML = `<p>${t.body}</p>`; }} />
        <MergeMenu tags={info.merge_tags} onPick={insert} /></div>
      <button className="cm-send" disabled={busy || !patient.email || !subject.trim()} onClick={send}><SendRounded />{busy ? 'Đang gửi…' : 'Gửi'}</button>
    </footer>
  </Dock>;
}

function SmsComposer({ patient, info, history, onClose, onSent }) {
  const [text, setText] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const box = useRef(null); const area = useRef(null);
  const chat = useMemo(() => [...history].filter((m) => m.channel === 'sms').reverse(), [history]);
  useEffect(() => { if (box.current) box.current.scrollTop = box.current.scrollHeight; }, [chat.length]);
  const insert = (tag) => { const el = area.current; const s = el?.selectionStart ?? text.length; setText(text.slice(0, s) + tag + text.slice(el?.selectionEnd ?? s)); el?.focus(); };
  const send = async () => {
    setErr(''); setBusy(true);
    try { const { data } = await api.post('/clinic/messages/send-sms/', { patient: patient.id, body: text }); setText(''); onSent(data); }
    catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const seg = smsSegments(text);
  let last = '';
  return <Dock patient={patient} title="Gửi SMS" onClose={onClose} sizeClass="sms">
    <div className="cm-chat" ref={box}>
      <div className="cm-to">Gửi tới <b>{patient.phone || 'chưa có số điện thoại'}</b></div>
      {chat.length === 0 && <p className="cm-chat-empty">Chưa có tin nhắn nào với khách này.</p>}
      {chat.map((m) => { const k = dayKey(m.created_at); const showDay = k !== last; last = k;
        return <div key={m.id}>{showDay && <div className="cm-daychip"><span>{fmtDate(m.created_at)}</span></div>}<div className="cm-bubble-wrap own"><div className="cm-bubble">{m.body}</div><small>{fmtTime(m.created_at)}{m.status !== 'sent' ? ` · ${m.status_label}` : ''}</small></div></div>; })}
    </div>
    {err && <div className="cm-alert">{err}</div>}
    <div className="cm-sms-input"><textarea ref={area} rows={3} placeholder="Nhập nội dung tin nhắn…" value={text} onChange={(e) => setText(e.target.value)} /></div>
    <footer className="cm-dock-foot">
      <div className="cm-tools"><TemplateMenu templates={info.templates} onPick={(t) => setText(t.body)} /><MergeMenu tags={info.merge_tags} onPick={insert} />
        <span className="cm-count">{[...text].length} ký tự · {seg} SMS</span></div>
      <button className="cm-send" disabled={busy || !text.trim() || !patient.phone} onClick={send}><SendRounded />{busy ? 'Đang gửi…' : 'Gửi'}</button>
    </footer>
  </Dock>;
}

/* ------------------------------------------------------------- tab */
export default function Communications({ patient, role, onChanged, toast }) {
  const [channel, setChannel] = useState('all');
  const [open, setOpen] = useState({}); const [fab, setFab] = useState(false);
  const [composer, setComposer] = useState(null); const [jump, setJump] = useState('');
  const { data, loading, error, reload } = useLoad(async () => (await api.get('/clinic/messages/', { params: { patient: patient.id, channel: channel === 'all' ? undefined : channel } })).data, [patient.id, channel]);
  const all = useLoad(async () => (await api.get('/clinic/messages/', { params: { patient: patient.id } })).data, [patient.id]);
  const info = all.data || data;
  const rows = data?.results || [];
  const groups = useMemo(() => {
    const days = {};
    rows.forEach((m) => { (days[dayKey(m.created_at)] = days[dayKey(m.created_at)] || []).push(m); });
    return Object.entries(days).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);
  const months = useMemo(() => groups.reduce((acc, [k, items]) => { const mk = k.slice(0, 7); (acc[mk] = acc[mk] || []).push([k, items]); return acc; }, {}), [groups]);
  const refresh = () => { reload(true); all.reload(true); onChanged?.(); };
  const sent = (d) => { refresh();
    toast?.(d.status === 'sent' ? 'Đã gửi.' : d.status === 'simulated' ? 'Đã ghi nhật ký (chưa gửi thật: chưa cấu hình nhà cung cấp).' : `Gửi lỗi: ${d.error || 'không rõ'}`, d.status === 'failed' ? 'err' : undefined);
    if (d.channel === 'email') setComposer(null); };
  const resend = async (m) => { try { const { data: d } = await api.post(`/clinic/messages/${m.id}/resend/`); sent(d); } catch (e) { toast?.(errMsg(e), 'err'); } };
  const del = async (m) => { if (!window.confirm('Xóa mục này khỏi nhật ký liên lạc?')) return; try { await api.delete(`/clinic/messages/${m.id}/`); refresh(); } catch (e) { toast?.(errMsg(e), 'err'); } };
  const jumpTo = (v) => { setJump(v); const el = document.getElementById(`cm-day-${v}`) || [...document.querySelectorAll('[data-day]')].find((n) => n.dataset.day <= v); el?.scrollIntoView({ behavior: 'smooth', block: 'start' }); };
  const counts = info?.counts || { all: 0, email: 0, sms: 0 };
  const tabs = [['all', 'Tất cả', counts.all, null], ['email', 'Email', counts.email, MailOutlineRounded], ['sms', 'SMS', counts.sms, ChatBubbleOutlineRounded]];
  return <div className="cm">
    {info && (!info.email_live || !info.sms_live) && <div className="cm-banner"><ErrorOutlineRounded /><span>
      {!info.email_live && <>Email chưa cấu hình SMTP nên thư chỉ được lưu nhật ký, chưa gửi thật. </>}
      {!info.sms_live && <>SMS chưa kết nối nhà cung cấp nên tin nhắn chỉ được lưu nhật ký, chưa gửi thật.</>}</span></div>}
    {info && !info.contact_consent && <div className="cm-banner soft"><ErrorOutlineRounded /><span>Khách chưa có đồng ý nhận liên hệ nhắc lịch / chăm sóc. Chỉ gửi nội dung phục vụ điều trị; tin quảng bá cần đồng ý riêng.</span></div>}
    <div className="cm-bar">
      <nav className="cm-tabs" role="tablist">{tabs.map(([k, t, n, Ic]) => <button key={k} role="tab" aria-selected={channel === k} className={channel === k ? 'on' : ''} onClick={() => setChannel(k)}>{Ic && <Ic />}{t}<i>{n}</i></button>)}</nav>
      <div className="cm-right"><span className="cm-chip green"><i />{(all.data?.results || []).filter((m) => m.status === 'sent').length} đã gửi thật / {counts.all} mục</span>
        <label className="cm-btn"><CalendarMonthOutlined />Nhảy tới ngày<input type="date" value={jump} onChange={(e) => jumpTo(e.target.value)} /></label>
        <button className="cm-btn" onClick={() => window.print()}><PrintOutlined />In tất cả</button></div>
    </div>
    {error && <div className="cl-alert error">{error}</div>}
    {loading && !data ? <Loading /> : !rows.length ? <Empty title="Chưa có liên lạc nào" hint="Bấm nút + ở góc phải để gửi email hoặc SMS cho khách." />
      : <div className="cm-timeline">{Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([mk, days]) => <section key={mk}>
        <h3 className="cm-month">THÁNG {mk.slice(5)}/{mk.slice(0, 4)}</h3>
        {days.map(([k, items]) => { const d = new Date(`${k}T00:00:00`); return <div key={k} className="cm-day" id={`cm-day-${k}`} data-day={k}>
          <div className="cm-day-head"><i />{DOW[d.getDay()]} {fmtDate(d)}<small> · {ago(d)} · {items.length} mục</small></div>
          {items.map((m) => <Item key={m.id} m={m} open={!!open[m.id]} onToggle={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))} onResend={resend} onDelete={del} canDelete={role === 'manager'} />)}</div>; })}
      </section>)}</div>}

    <div className="cm-fab-wrap">
      {fab && <div className="cm-fab-menu"><header><b>Liên lạc</b></header>
        <button onClick={() => { setFab(false); setComposer('email'); }}><span className="cm-ico email"><MailOutlineRounded /></span><span><b>Email</b><small>Gửi email</small></span></button>
        <button onClick={() => { setFab(false); setComposer('sms'); }}><span className="cm-ico sms"><ChatBubbleOutlineRounded /></span><span><b>SMS</b><small>Gửi tin nhắn SMS</small></span></button></div>}
      <button className="cm-fab" aria-label="Soạn liên lạc" aria-expanded={fab} onClick={() => setFab(!fab)}>{fab ? <CloseRounded /> : <AddRounded />}</button>
    </div>
    {composer === 'email' && info && <EmailComposer patient={patient} info={info} onClose={() => setComposer(null)} onSent={sent} />}
    {composer === 'sms' && info && <SmsComposer patient={patient} info={info} history={rows.length && channel !== 'email' ? rows : (all.data?.results || [])} onClose={() => setComposer(null)} onSent={sent} />}
  </div>;
}
