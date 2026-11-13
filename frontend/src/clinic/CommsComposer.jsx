import { useEffect, useMemo, useRef, useState } from 'react';
import AddLinkRounded from '@mui/icons-material/AddLinkRounded';
import ArrowBackIosNewRounded from '@mui/icons-material/ArrowBackIosNewRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CodeRounded from '@mui/icons-material/CodeRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import EventAvailableOutlined from '@mui/icons-material/EventAvailableOutlined';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import FormatBoldRounded from '@mui/icons-material/FormatBoldRounded';
import FormatItalicRounded from '@mui/icons-material/FormatItalicRounded';
import FormatListBulletedRounded from '@mui/icons-material/FormatListBulletedRounded';
import FormatListNumberedRounded from '@mui/icons-material/FormatListNumberedRounded';
import FormatQuoteRounded from '@mui/icons-material/FormatQuoteRounded';
import FormatUnderlinedRounded from '@mui/icons-material/FormatUnderlinedRounded';
import StrikethroughSRounded from '@mui/icons-material/StrikethroughSRounded';
import GridViewRounded from '@mui/icons-material/GridViewRounded';
import ViewListRounded from '@mui/icons-material/ViewListRounded';
import MinimizeRounded from '@mui/icons-material/MinimizeRounded';
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import RedoRounded from '@mui/icons-material/RedoRounded';
import UndoRounded from '@mui/icons-material/UndoRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import SmartButtonRounded from '@mui/icons-material/SmartButtonRounded';
import ViewQuiltOutlined from '@mui/icons-material/ViewQuiltOutlined';
import api from '../api/client';
import { Avatar, errMsg, fmtDate, fmtTime, money, useLoad } from './ui';
import { dayKey } from './CommsExtras';

export const smsSegments = (t) => {
  const n = [...(t || '')].length; if (!n) return 0;
  const ascii = /^[\x00-\x7F]*$/.test(t);
  const [one, multi] = ascii ? [160, 153] : [70, 67];
  return n <= one ? 1 : Math.ceil(n / multi);
};
const fillTags = (text, values) => String(text || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k) => (values?.[k] ?? m));
const escHtml = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function usePop() {
  const [open, setOpen] = useState(false); const ref = useRef(null);
  useEffect(() => { if (!open) return undefined; const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [open]);
  return [open, setOpen, ref];
}

export function Dock({ patient, title, onClose, children, sizeClass = '' }) {
  const [state, setState] = useState('normal');
  return <div className={`cm-dock ${state} ${sizeClass}`} role="dialog" aria-label={title}>
    <header><Avatar name={patient.full_name} size={28} /><b>{patient.full_name} – {title}</b>
      <span><button aria-label="Thu nhỏ" onClick={() => setState(state === 'min' ? 'normal' : 'min')}><MinimizeRounded /></button>
        <button aria-label="Phóng to" onClick={() => setState(state === 'max' ? 'normal' : 'max')}><OpenInFullRounded /></button>
        <button aria-label="Đóng" onClick={onClose}><CloseRounded /></button></span></header>
    {state !== 'min' && children}
  </div>;
}

/* ---------------------------------------------------------------- chọn mẫu */
export function TemplateModal({ channel, onPick, onClose, role, userId, onToast }) {
  const { data, loading, reload } = useLoad(async () => (await api.get('/clinic/message-templates/', { params: { channel } })).data, [channel]);
  const [cat, setCat] = useState('all'); const [q, setQ] = useState('');
  const [view, setView] = useState(() => { try { return localStorage.getItem('cm-tpl-view') || 'list'; } catch { return 'list'; } });
  const rows = data || [];
  const ORDER = ['confirmation', 'reminder', 'precare', 'aftercare', 'general', 'marketing'];
  const cats = useMemo(() => { const m = new Map(); rows.forEach((t) => m.set(t.category, t.category_label)); return [...m].sort((a, b) => ORDER.indexOf(a[0]) - ORDER.indexOf(b[0])); }, [rows]);
  const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
  const shown = rows.filter((t) => (cat === 'all' || t.category === cat) && (!q.trim() || norm(`${t.name} ${t.subject}`).includes(norm(q))));
  const groups = useMemo(() => { const g = {}; shown.forEach((t) => { (g[t.category_label] = g[t.category_label] || []).push(t); }); const rank = (l) => ORDER.indexOf((rows.find((t) => t.category_label === l) || {}).category); return Object.entries(g).sort((a, b) => rank(a[0]) - rank(b[0])); }, [shown, rows]);
  const setV = (v) => { setView(v); try { localStorage.setItem('cm-tpl-view', v); } catch { /* bỏ qua */ } };
  const del = async (t) => { if (!window.confirm(`Xóa mẫu "${t.name}"?`)) return; try { await api.delete(`/clinic/message-templates/${t.id}/`); reload(true); } catch (e) { onToast?.(errMsg(e), 'err'); } };
  return <div className="cm-modal-wrap" role="dialog" aria-modal="true" aria-label="Chọn mẫu" onClick={onClose}>
    <div className="cm-modal lg" onClick={(e) => e.stopPropagation()}>
      <header><button className="cm-back" aria-label="Quay lại" onClick={onClose}><ArrowBackIosNewRounded /></button><h3>Chọn mẫu {channel === 'email' ? 'email' : 'SMS'}</h3>
        <button aria-label="Đóng" onClick={onClose}><CloseRounded /></button></header>
      <div className="cm-tpl-bar">
        <nav className="cm-tpl-tabs"><button className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>Tất cả<i>{rows.length}</i></button>
          {cats.map(([k, l]) => <button key={k} className={cat === k ? 'on' : ''} onClick={() => setCat(k)}>{l}<i>{rows.filter((t) => t.category === k).length}</i></button>)}</nav>
        <label className="cm-tpl-search"><SearchRounded /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm mẫu…" /></label>
        <div className="cm-toggle"><button className={view === 'grid' ? 'on' : ''} aria-label="Dạng lưới" onClick={() => setV('grid')}><GridViewRounded /></button>
          <button className={view === 'list' ? 'on' : ''} aria-label="Dạng danh sách" onClick={() => setV('list')}><ViewListRounded /></button></div>
      </div>
      <div className="cm-tpl-body">
        {loading && !data ? <p className="cm-muted">Đang tải…</p> : !shown.length ? <p className="cm-muted">Không có mẫu phù hợp.</p>
          : view === 'list' ? <table className="cm-tpl-table"><thead><tr><th>Tên</th><th>Người tạo</th><th>Ngày tạo</th><th>Danh mục</th><th /></tr></thead>
            <tbody>{groups.map(([g, items]) => [<tr key={`g-${g}`} className="grp"><td colSpan={5}>{g}</td></tr>, ...items.map((t) => <tr key={t.id} tabIndex={0} onClick={() => onPick(t)} onKeyDown={(e) => e.key === 'Enter' && onPick(t)}>
              <td><span className="cm-tpl-ico"><ViewQuiltOutlined /></span><b>{t.name}</b></td><td>{t.created_by_name}</td><td>{fmtDate(t.created_at)}</td><td>{t.category_label}</td>
              <td className="r">{(role === 'manager' || t.created_by_name !== 'Hệ thống') && t.created_by_name !== 'Hệ thống' && <button className="cm-icon-btn" aria-label="Xóa mẫu" onClick={(e) => { e.stopPropagation(); del(t); }}><DeleteOutlineRounded /></button>}</td></tr>)])}</tbody></table>
            : <div className="cm-tpl-grid">{shown.map((t) => <button key={t.id} className="cm-tpl-card" onClick={() => onPick(t)}><small>{t.category_label}</small><b>{t.name}</b>
              <span>{(t.subject || t.body).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 120)}</span></button>)}</div>}
      </div>
    </div>
  </div>;
}

/* ---------------------------------------------------------------- soạn email */
function Chips({ items, onRemove, onAdd, placeholder }) {
  const [v, setV] = useState('');
  const commit = () => { const t = v.trim().replace(/[,;]$/, ''); if (t) onAdd(t); setV(''); };
  return <div className="cm-chips">{items.map((e) => <span key={e} className="cm-chip-mail"><i>{e.slice(0, 2).toUpperCase()}</i>{e}<button aria-label={`Bỏ ${e}`} onClick={() => onRemove(e)}><CloseRounded /></button></span>)}
    <input value={v} placeholder={items.length ? '' : placeholder} onChange={(e) => setV(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (['Enter', ',', ';', 'Tab'].includes(e.key) && v.trim()) { e.preventDefault(); commit(); } }} /></div>;
}

export function EmailComposer({ patient, info, role, onClose, onSent, onToast }) {
  const clinic = info.clinic || {};
  const [subject, setSubject] = useState('');
  const [to, setTo] = useState(patient.email ? [patient.email] : []);
  const [cc, setCc] = useState([]); const [bcc, setBcc] = useState([]);
  const [showCc, setShowCc] = useState(false); const [showBcc, setShowBcc] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [from, setFrom] = useState(info.from_options?.[0]?.name || '');
  const [booking, setBooking] = useState(null); const [followUp, setFollowUp] = useState(false);
  const [src, setSrc] = useState(null); // null = chế độ soạn thường; chuỗi = đang sửa mã HTML
  const [tplOpen, setTplOpen] = useState(false);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const ed = useRef(null); const subjRef = useRef(null);
  const att = useLoad(async () => (await api.get('/clinic/messages/attachables/', { params: { patient: patient.id } })).data, [patient.id]);
  const [invOpen, setInvOpen, invRef] = usePop(); const [mergeOpen, setMergeOpen, mergeRef] = usePop(); const [apptOpen, setApptOpen, apptRef] = usePop();
  useEffect(() => { try { document.execCommand('defaultParagraphSeparator', false, 'p'); } catch { /* bỏ qua */ } }, []);
  const html = () => (src !== null ? src : ed.current?.innerHTML || '');
  const run = (cmd, val) => { ed.current?.focus(); document.execCommand(cmd, false, val); };
  const keep = (e) => e.preventDefault();
  const insertHtml = (h) => { ed.current?.focus(); document.execCommand('insertHTML', false, h); };
  const insertTag = (tag) => {
    if (document.activeElement === subjRef.current) { const el = subjRef.current; const s = el.selectionStart; setSubject(subject.slice(0, s) + tag + subject.slice(el.selectionEnd)); } else { ed.current?.focus(); document.execCommand('insertText', false, tag); }
  };
  const link = () => { const u = window.prompt('Nhập địa chỉ liên kết (https://…)'); if (u) run('createLink', u); };
  const button = () => { const u = window.prompt('Địa chỉ liên kết của nút (https://…)'); if (!u) return; const l = window.prompt('Chữ trên nút', 'Xem chi tiết'); if (l) insertHtml(`<p><a data-btn="1" href="${escHtml(u)}">${escHtml(l)}</a></p>`); };
  const pickTemplate = (t) => { setSubject(fillTags(t.subject, info.merge_values)); const h = fillTags(t.body, info.merge_values); if (src !== null) setSrc(h); else if (ed.current) ed.current.innerHTML = h; setTplOpen(false); };
  const insertInvoice = (i) => { setInvOpen(false); insertHtml(`<dl><dt>Số hóa đơn</dt><dd>${escHtml(i.code)}</dd><dt>Ngày lập</dt><dd>${fmtDate(i.at)}</dd><dt>Tổng tiền</dt><dd>${money(i.total)}</dd><dt>Trạng thái</dt><dd>${escHtml(i.status_label)}</dd></dl>`); };
  const toggleSrc = () => { if (src === null) setSrc(ed.current?.innerHTML || ''); else { const h = src; setSrc(null); setTimeout(() => { if (ed.current) ed.current.innerHTML = h; }, 0); } };
  const addMail = (setter) => (v) => setter((a) => (a.includes(v) ? a : [...a, v]));
  const send = async () => {
    setErr(''); setBusy(true);
    try {
      const { data } = await api.post('/clinic/messages/send-email/', { patient: patient.id, subject, body_html: html(), to, cc, bcc, from_name: from, booking_ids: booking ? [booking.id] : [], follow_up: followUp });
      onSent(data);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const saveTemplate = async () => {
    const name = window.prompt('Tên mẫu mới'); if (!name) return;
    try { await api.post('/clinic/message-templates/', { channel: 'email', name, subject, body: html() }); onToast?.('Đã lưu thành mẫu.'); } catch (e) { setErr(errMsg(e)); }
  };
  const contact = [clinic.address, clinic.phone && `Hotline ${clinic.phone}`, clinic.email].filter(Boolean).join(' · ');
  return <Dock patient={patient} title="Thư mới" onClose={onClose} sizeClass="email">
    <div className="cm-dock-body">
      <div className="cm-details-wrap">
        <button className="cm-details-row" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          <span className="cm-lbl">CHI TIẾT</span>
          {expanded ? <span className="cm-muted">Bấm để thu gọn</span> : <><b>{to[0] || <em className="cm-warn-txt">Chưa có email</em>}</b><span className="cm-dot">·</span><span className={subject ? '' : 'cm-muted'}>{subject || 'Thư này nói về điều gì?'}</span></>}
          <ExpandMoreRounded className={`cm-chev ${expanded ? 'up' : ''}`} />
        </button>
        {expanded && <div className="cm-details-form">
          <div className="cm-row"><label>GỬI TỚI</label><div className="cm-field"><Chips items={to} onRemove={(e) => setTo(to.filter((x) => x !== e))} onAdd={addMail(setTo)} placeholder="Nhập email" />
            <span className="cm-ccs"><button className={showCc ? 'on' : ''} onClick={() => setShowCc(!showCc)}>Cc</button><button className={showBcc ? 'on' : ''} onClick={() => setShowBcc(!showBcc)}>Bcc</button></span></div></div>
          {showCc && <div className="cm-row"><label>CC</label><div className="cm-field"><Chips items={cc} onRemove={(e) => setCc(cc.filter((x) => x !== e))} onAdd={addMail(setCc)} placeholder="Email Cc" /></div></div>}
          {showBcc && <div className="cm-row"><label>BCC</label><div className="cm-field"><Chips items={bcc} onRemove={(e) => setBcc(bcc.filter((x) => x !== e))} onAdd={addMail(setBcc)} placeholder="Email Bcc" /></div></div>}
          <div className="cm-row"><label>TIÊU ĐỀ</label><div className="cm-field"><input ref={subjRef} maxLength={78} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Thư này nói về điều gì?" /><span className="cm-count-inline">{subject.length}/78</span></div></div>
          <div className="cm-row"><label>NGƯỜI GỬI</label><div className="cm-field select"><select value={from} onChange={(e) => setFrom(e.target.value)}>{(info.from_options || []).map((o) => <option key={o.name} value={o.name}>{o.name} — {o.email}</option>)}</select></div></div>
          <div className="cm-row top"><label>ĐÍNH KÈM</label><div className="cm-attach">
            <div className="cm-pop" ref={apptRef}><button className={`cm-attach-card ${booking ? 'on' : ''}`} onClick={() => setApptOpen(!apptOpen)}>
              <span className="cm-ico appt"><EventAvailableOutlined /></span><span><b>{booking ? booking.service : 'Lịch hẹn'}</b><small>{booking ? `${fmtDate(booking.at)} · ${fmtTime(booking.at)} · gửi kèm tệp .ics` : 'Đính kèm lịch hẹn của khách'}</small></span>
              {booking ? <i onClick={(e) => { e.stopPropagation(); setBooking(null); }}><CloseRounded /></i> : <ExpandMoreRounded />}</button>
              {apptOpen && <div className="cm-pop-box wide"><h5>LỊCH HẸN GẦN ĐÂY CỦA KHÁCH</h5>{!(att.data?.bookings || []).length && <p className="cm-muted pad">Khách chưa có lịch hẹn.</p>}
                {(att.data?.bookings || []).map((b) => <button key={b.id} onClick={() => { setBooking(b); setApptOpen(false); }}><span><b>{b.service}</b><small>{fmtDate(b.at)} · {fmtTime(b.at)}{b.staff ? ` · ${b.staff}` : ''}</small></span>{booking?.id === b.id && <CheckRounded />}</button>)}</div>}</div>
          </div></div>
        </div>}
      </div>
      <div className="cm-toolbar" role="toolbar" aria-label="Định dạng">
        <button onMouseDown={keep} onClick={() => run('undo')} aria-label="Hoàn tác"><UndoRounded /></button><button onMouseDown={keep} onClick={() => run('redo')} aria-label="Làm lại"><RedoRounded /></button><span className="sep" />
        <select aria-label="Kiểu đoạn" defaultValue="p" onChange={(e) => { run('formatBlock', `<${e.target.value}>`); e.target.value = 'p'; }}><option value="p">Đoạn văn</option><option value="h2">Tiêu đề lớn</option><option value="h3">Tiêu đề nhỏ</option></select><span className="sep" />
        <button onMouseDown={keep} onClick={() => run('bold')} aria-label="In đậm"><FormatBoldRounded /></button><button onMouseDown={keep} onClick={() => run('italic')} aria-label="In nghiêng"><FormatItalicRounded /></button>
        <button onMouseDown={keep} onClick={() => run('underline')} aria-label="Gạch chân"><FormatUnderlinedRounded /></button><button onMouseDown={keep} onClick={() => run('strikeThrough')} aria-label="Gạch ngang"><StrikethroughSRounded /></button><span className="sep" />
        <button onMouseDown={keep} onClick={link} aria-label="Chèn liên kết"><AddLinkRounded /></button><button onMouseDown={keep} onClick={button} aria-label="Chèn nút"><SmartButtonRounded /></button><span className="sep" />
        <button onMouseDown={keep} onClick={() => run('insertUnorderedList')} aria-label="Danh sách chấm"><FormatListBulletedRounded /></button><button onMouseDown={keep} onClick={() => run('insertOrderedList')} aria-label="Danh sách số"><FormatListNumberedRounded /></button>
        <button onMouseDown={keep} onClick={() => run('formatBlock', '<blockquote>')} aria-label="Khung nhấn"><FormatQuoteRounded /></button><span className="sep" />
        <button className={src !== null ? 'on' : ''} onMouseDown={keep} onClick={toggleSrc} aria-label="Sửa mã HTML" title="Sửa mã HTML"><CodeRounded /></button>
      </div>
      <div className="cm-stage">
        <div className="cm-mailcard">
          <div className="mc-bar" />
          <div className="mc-brand"><b>{clinic.name}</b><small>{clinic.tagline}</small></div>
          <div className="mc-hero"><h1>{subject || 'Tiêu đề email'}</h1></div>
          {src !== null ? <textarea className="cm-src" spellCheck={false} value={src} onChange={(e) => setSrc(e.target.value)} />
            : <div ref={ed} className="cm-editor" contentEditable suppressContentEditableWarning data-ph="Bắt đầu soạn email…" />}
          <div className="mc-sign">Trân trọng,<br /><b>Đội ngũ {clinic.name}</b></div>
          <div className="mc-foot">{contact || 'Thông tin liên hệ phòng khám sẽ hiện ở đây (đặt CLINIC_ADDRESS, CLINIC_PHONE trong .env).'}</div>
        </div>
      </div>
      {err && <div className="cm-alert">{err}</div>}
    </div>
    <footer className="cm-dock-foot col">
      <div className="cm-foot-tools">
        <button className="cm-tool" onClick={() => setTplOpen(true)}><ViewQuiltOutlined />Mẫu<ExpandMoreRounded /></button>
        <span className="cm-pop" ref={invRef}><button className="cm-tool" onClick={() => setInvOpen(!invOpen)}><DescriptionOutlined />Hóa đơn<ExpandMoreRounded /></button>
          {invOpen && <div className="cm-pop-box up wide"><h5>HÓA ĐƠN</h5>{!(att.data?.invoices || []).length && <p className="cm-muted pad">Khách chưa có hóa đơn.</p>}
            {(att.data?.invoices || []).map((i) => <div key={i.id} className="cm-inv"><span><b>{i.code}</b><small>{fmtDate(i.at)} · {money(i.total)}</small></span><em className={i.status}>{i.status_label}</em>
              <button className="cm-mini" onClick={() => insertInvoice(i)}>Chèn</button></div>)}</div>}</span>
        <span className="cm-pop" ref={mergeRef}><button className="cm-tool" onClick={() => setMergeOpen(!mergeOpen)}># Thẻ ghép<ExpandMoreRounded /></button>
          {mergeOpen && <div className="cm-pop-box up">{info.merge_tags.map(([k, t]) => <button key={k} onClick={() => { setMergeOpen(false); insertTag(`{{${k}}}`); }}>{t}<small>{`{{${k}}}`}</small></button>)}</div>}</span>
        <button className="cm-tool" onClick={saveTemplate}>Lưu thành mẫu</button>
      </div>
      <div className="cm-send-row"><button className="cm-send" disabled={busy || !to.length || !subject.trim()} onClick={send}><SendRounded />{busy ? 'Đang gửi…' : 'Gửi'}</button>
        <label className="cm-check"><input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />Tạo việc theo dõi phản hồi</label></div>
    </footer>
    {tplOpen && <TemplateModal channel="email" role={role} onPick={pickTemplate} onClose={() => setTplOpen(false)} onToast={onToast} />}
  </Dock>;
}

/* ---------------------------------------------------------------- gửi SMS */
export function SmsComposer({ patient, info, history, role, onClose, onSent, onToast }) {
  const [text, setText] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [tplOpen, setTplOpen] = useState(false); const [mergeOpen, setMergeOpen, mergeRef] = usePop();
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
      <div className="cm-tools"><button className="cm-tool" onClick={() => setTplOpen(true)}><ViewQuiltOutlined />Mẫu<ExpandMoreRounded /></button>
        <span className="cm-pop" ref={mergeRef}><button className="cm-tool" onClick={() => setMergeOpen(!mergeOpen)}># Thẻ ghép<ExpandMoreRounded /></button>
          {mergeOpen && <div className="cm-pop-box up">{info.merge_tags.map(([k, t]) => <button key={k} onClick={() => { setMergeOpen(false); insert(`{{${k}}}`); }}>{t}<small>{`{{${k}}}`}</small></button>)}</div>}</span>
        <span className="cm-count">{[...text].length} ký tự · {seg} SMS</span></div>
      <button className="cm-send" disabled={busy || !text.trim() || !patient.phone} onClick={send}><SendRounded />{busy ? 'Đang gửi…' : 'Gửi'}</button>
    </footer>
    {tplOpen && <TemplateModal channel="sms" role={role} onPick={(t) => { setText(fillTags(t.body, info.merge_values)); setTplOpen(false); }} onClose={() => setTplOpen(false)} onToast={onToast} />}
  </Dock>;
}
