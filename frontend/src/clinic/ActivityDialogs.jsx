import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { errMsg, initials, useDebounce, useLoad } from './ui';
import { PatientPicker } from './PatientForm';
import { STATE, STATES, defaultRange, fmtDue, joinDateTime, removeToken, splitDateTime, splitNote, tokensIn, validateForm } from './activityKit';
import { fireConfetti } from './confetti';
import './activities.css';

const arr = (d) => d?.results || d || [];

/* ---------------- biểu tượng loại hoạt động ---------------- */
const PATHS = {
  mail: <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></>,
  recall: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18" /></>,
  phone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2z" />,
  phone_lead: <><rect x="3" y="4" width="18" height="17" rx="2" /><path d="M8 2v4M16 2v4M3 10h18M9 15h6" /></>,
  message: <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M21.5 20a6.5 6.5 0 0 0-4-6" /></>,
  task: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>,
};
export function TypeIcon({ icon = 'task', size = 18, color = 'currentColor' }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{PATHS[icon] || PATHS.task}</svg>;
}

/* ---------------- khung hộp thoại ---------------- */
export function AcModal({ title, lead, onClose, children, footer, width = 640, className = '' }) {
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return <div className="ac-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className={`ac-modal ${className}`} style={{ width }} role="dialog" aria-modal="true" aria-label={title}>
      <header>{lead}<h2>{title}</h2><button className="ac-x" onClick={onClose} aria-label="Đóng">×</button></header>
      <div className="ac-modal-b">{children}</div>
      {footer && <footer>{footer}</footer>}
    </div>
  </div>;
}

/* ---------------- menu nổi (hàng ⋯, chọn trạng thái) ---------------- */
export function usePopMenu() {
  const [m, setM] = useState(null);
  const ref = useRef(null);
  useEffect(() => {
    if (!m) return undefined;
    const close = () => setM(null);
    const down = (e) => ref.current && !ref.current.contains(e.target) && close();
    const esc = (e) => e.key === 'Escape' && close();
    document.addEventListener('mousedown', down); document.addEventListener('keydown', esc); window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', esc); window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); };
  }, [m]);
  const open = (e, items, variant = 'list') => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    const h = items.length * (variant === 'pills' ? 46 : 42) + 16;
    setM({ items, variant, right: Math.max(8, window.innerWidth - r.right), top: r.bottom + 6 + h > window.innerHeight ? Math.max(8, r.top - h - 6) : r.bottom + 6 });
  };
  const node = m && <div ref={ref} className={`ac-menu ${m.variant}`} style={{ top: m.top, right: m.right }} role="menu">
    {m.items.map((it, i) => it.sep ? <hr key={i} /> : <button key={i} role="menuitem" disabled={it.disabled} className={`${it.danger ? 'danger' : ''} ${it.active ? 'on' : ''}`}
      onClick={(e) => { e.stopPropagation(); setM(null); it.onClick?.(); }}>{it.dot && <i style={{ background: it.dot }} />}{it.icon && <span className="ac-mi">{it.icon}</span>}{it.label}</button>)}
  </div>;
  return [open, node];
}

/** Viên thuốc trạng thái có menu chọn (ảnh 13). */
export function StatusPill({ state, onChange, disabled, size }) {
  const [open, node] = usePopMenu();
  const s = STATE[state] || STATE.todo;
  const items = STATES.map(([k, label, color]) => ({ label, dot: color, active: k === state, onClick: () => k !== state && onChange(k) }));
  return <>
    <button className={`ac-pill ${size || ''}`} style={{ color: s.color, background: s.bg }} disabled={disabled} onClick={(e) => open(e, items, 'pills')} aria-haspopup="menu">
      <i style={{ background: s.color }} />{s.label}</button>{node}</>;
}

/** Ghi chú có chip liên kết: bấm chip đi đúng đến hóa đơn / liệu trình / lịch hẹn / lượt khám. */
export function NoteView({ note, links, empty = 'Không có ghi chú.' }) {
  const nav = useNavigate();
  if (!note?.trim()) return <span className="ac-muted">{empty}</span>;
  return <>{splitNote(note, links).map((p, i) => p.link
    ? <button key={i} className="ac-chip" title="Mở hồ sơ liên kết" onClick={(e) => { e.stopPropagation(); nav(p.link.url); }}>{p.link.label}</button>
    : <span key={i}>{p.text}</span>)}</>;
}

export function ImplicitLinks({ links }) {
  return <>{(links || []).filter((x) => !x.token).map((link) => <NavChip key={link.kind + link.id} link={link} />)}</>;
}

/* ---------------- chọn khách tiềm năng (ca tư vấn) ---------------- */
function LeadPicker({ value, onPick }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const dq = useDebounce(q, 250);
  const l = useLoad(async () => (open ? arr((await api.get('/clinic/activities/leads/', { params: { q: dq } })).data) : []), [dq, open]);
  if (value) return <div className="ac-picked"><span>{value.label}</span><button type="button" onClick={() => onPick(null)} aria-label="Bỏ chọn">×</button></div>;
  return <div className="ac-search"><input value={q} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} placeholder="Chọn khách tiềm năng…" />
    {open && <div className="ac-search-list" onMouseLeave={() => setOpen(false)}>{(l.data || []).map((c) => <button type="button" key={c.id} onClick={() => { onPick(c); setOpen(false); }}>{c.label}</button>)}
      {l.data && !l.data.length && <div className="ac-muted pad">Không có ca tư vấn phù hợp.</div>}</div>}</div>;
}

/* ---------------- form tạo / sửa (ảnh 3, 4, 11) ---------------- */
export function ActivityForm({ item, preset, onClose, onSaved }) {
  const edit = !!item;
  const types = useLoad(async () => arr((await api.get('/clinic/activity-types/')).data), []);
  const staff = useLoad(async () => (await api.get('/clinic/activities/assignees/')).data, []);
  const init = useMemo(() => {
    if (item) {
      const fallback = defaultRange();
      const s = item.start_at ? splitDateTime(item.start_at) : fallback.from;
      const e = item.end_at ? splitDateTime(item.end_at) : fallback.to;
      return { type: item.type, title: item.title, fromDate: s.date, fromTime: s.time, toDate: e.date, toTime: e.time, note: item.note || '', assigned_to: item.assigned_to || '',
        patient: item.patient ? { id: item.patient, full_name: item.patient_name, code: item.patient_code } : null,
        conversation: item.conversation ? { id: item.conversation, label: item.conversation_label } : null };
    }
    const r = defaultRange();
    return { type: preset?.type || null, title: preset?.title || '', fromDate: r.from.date, fromTime: r.from.time, toDate: r.to.date, toTime: r.to.time, note: preset?.note || '',
      assigned_to: '', patient: preset?.patient || null, conversation: preset?.conversation || null };
  }, [item, preset]);
  const [f, setF] = useState(init);
  const [touched, setTouched] = useState(edit);       // đã tự sửa tên chưa (nếu chưa thì tên bám theo loại)
  const [errs, setErrs] = useState({});
  const [top, setTop] = useState('');
  const [busy, setBusy] = useState(false);
  const [linkables, setLinkables] = useState([]);
  const [insertOpen, setInsertOpen] = useState(false);
  const [showLinks, setShowLinks] = useState(false);
  const [linksOpen, setLinksOpen] = useState(false);
  const noteRef = useRef(null);
  const linksRef = useRef(null);
  const set = (k, v) => { setF((s) => ({ ...s, [k]: v })); setErrs((x) => ({ ...x, [k]: undefined })); };
  const typeList = types.data || [];
  const cur = typeList.find((t) => t.id === f.type);
  useEffect(() => { // danh sách hồ sơ có thể chèn của bệnh nhân đang chọn
    setLinkables([]);
    if (f.patient?.id) api.get('/clinic/activities/linkables/', { params: { patient: f.patient.id } }).then(({ data }) => setLinkables(data)).catch(() => setLinkables([]));
  }, [f.patient?.id]);
  const labelOf = (tk) => linkables.find((l) => l.token === tk)?.label || item?.links?.find((l) => l.token === tk)?.label || tk.replace(/[{}]/g, '');

  const pickType = (t) => setF((s) => ({ ...s, type: t.id, title: !touched || s.title === cur?.name ? t.name : s.title }));
  const insert = (tk) => {
    setInsertOpen(false);
    setF((s) => (s.note.includes(tk) ? s : { ...s, note: `${s.note}${s.note && !s.note.endsWith(' ') ? ' ' : ''}${tk} ` }));
    setTimeout(() => noteRef.current?.focus(), 0);
  };
  const readOnly = edit && item.status !== 'pending';

  const submit = async () => {
    const e = validateForm(f);
    setErrs(e); setTop('');
    if (Object.keys(e).length) {
      if (e.patient) {
        setShowLinks(true);
        setLinksOpen(true);
        setTimeout(() => linksRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }), 0);
      }
      return;
    }
    setBusy(true);
    const body = { type: f.type, title: f.title.trim(), start_at: joinDateTime(f.fromDate, f.fromTime), end_at: joinDateTime(f.toDate, f.toTime), note: f.note,
      assigned_to: f.assigned_to || null, patient: f.patient?.id || null, conversation: f.conversation?.id || null };
    try {
      const { data } = edit ? await api.patch(`/clinic/activities/${item.id}/`, body) : await api.post('/clinic/activities/', body);
      onSaved(data, { created: !edit });
    } catch (er) {
      const d = er.response?.data;
      if (d && typeof d === 'object' && !d.detail) setErrs(Object.fromEntries(Object.entries(d).map(([k, v]) => [k, [].concat(v).join(' ')])));
      else setTop(errMsg(er));
    } finally { setBusy(false); }
  };

  const err = (k) => errs[k] && <div className="ac-err">{errs[k]}</div>;
  return <AcModal onClose={onClose} width={560} className="ac-form-modal"
    title={edit ? `${item.patient_name || 'Khách tiềm năng'} – Sửa hoạt động` : 'Thêm hoạt động'}
    lead={edit && <span className="ac-av sm">{initials(item.patient_name || 'KT')}</span>}
    footer={<><button className="ac-btn" onClick={onClose}>Hủy</button><button className="ac-btn primary" disabled={busy || readOnly} onClick={submit}>{busy ? 'Đang lưu…' : 'Lưu'}</button></>}>
    {readOnly && <div className="ac-note-warn">Hoạt động đã hoàn thành — hãy mở lại trước khi chỉnh sửa.</div>}
    {top && <div className="ac-alert">{top}</div>}
    <label className="ac-lab">Loại hoạt động</label>
    <div className="ac-types" role="radiogroup" aria-label="Loại hoạt động">{typeList.map((t) => <button type="button" key={t.id} role="radio" aria-checked={f.type === t.id}
      className={f.type === t.id ? 'on' : ''} disabled={readOnly} onClick={() => pickType(t)}><TypeIcon icon={t.icon} size={20} /><span>{t.name}</span></button>)}</div>
    {err('type')}
    <label className="ac-lab" htmlFor="ac-title">Tên hoạt động</label>
    <input id="ac-title" className="ac-input" value={f.title} disabled={readOnly} maxLength={200} onChange={(e) => { setTouched(true); set('title', e.target.value); }} placeholder={cur?.name || 'Tên hoạt động'} />
    {err('title')}
    <label className="ac-lab">Hạn xử lý</label>
    <div className="ac-range">
      <div><small>Từ</small><div className="ac-dt"><input type="date" aria-label="Từ ngày" value={f.fromDate} disabled={readOnly} onChange={(e) => set('fromDate', e.target.value)} />
        <input type="time" aria-label="Từ giờ" value={f.fromTime} disabled={readOnly} onChange={(e) => set('fromTime', e.target.value)} /></div></div>
      <div><small>Đến</small><div className="ac-dt"><input type="date" aria-label="Đến ngày" value={f.toDate} disabled={readOnly} onChange={(e) => set('toDate', e.target.value)} />
        <input type="time" aria-label="Đến giờ" value={f.toTime} disabled={readOnly} onChange={(e) => set('toTime', e.target.value)} /></div></div>
    </div>
    {err('end_at')}
    <label className="ac-lab" htmlFor="ac-note">Ghi chú</label>
    <textarea id="ac-note" ref={noteRef} className="ac-input area" rows={4} value={f.note} disabled={readOnly} onChange={(e) => set('note', e.target.value)} placeholder="Thêm ghi chú cho hoạt động…" />
    {err('note')}
    <div className="ac-insert">
      <div className="ac-relative">
        <button type="button" className="ac-btn ghost" disabled={readOnly} onClick={() => {
          if (!f.patient) {
            setShowLinks(true);
            setLinksOpen(true);
            return;
          }
          setInsertOpen(!insertOpen);
        }}>＋ Chèn</button>
        {insertOpen && <div className="ac-search-list up">{linkables.map((l) => <button type="button" key={l.token} onClick={() => insert(l.token)}>{l.label}</button>)}
          {!linkables.length && <div className="ac-muted pad">Bệnh nhân chưa có hóa đơn, liệu trình hay lịch hẹn.</div>}</div>}
      </div>
      <span className="ac-muted">Chèn hóa đơn, liệu trình, lịch hẹn của bệnh nhân vào ghi chú.</span>
    </div>
    {tokensIn(f.note).length > 0 && <div className="ac-chips">{tokensIn(f.note).map((tk) => <span className="ac-chip" key={tk}>{labelOf(tk)}
      {!readOnly && <button type="button" onClick={() => set('note', removeToken(f.note, tk))} aria-label="Gỡ liên kết">×</button>}</span>)}</div>}

    <label className="ac-lab" htmlFor="ac-emp">Chọn nhân viên phụ trách</label>
    <select id="ac-emp" className="ac-input" value={f.assigned_to} disabled={readOnly} onChange={(e) => set('assigned_to', e.target.value ? Number(e.target.value) : '')}>
      <option value="">Tôi (người tạo)</option>{(staff.data || []).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role_label}</option>)}</select>
    {err('assigned_to')}
    {(showLinks || edit) && <details ref={linksRef} className="ac-form-links" open={linksOpen} onToggle={(e) => setLinksOpen(e.currentTarget.open)}>
      <summary>Liên kết bệnh nhân hoặc khách tiềm năng</summary>
      <label className="ac-lab">Khách tiềm năng (ca tư vấn)</label>
      <LeadPicker value={f.conversation} onPick={(c) => set('conversation', c)} />
      <label className="ac-lab">Bệnh nhân</label>
      {f.patient ? <div className="ac-picked"><span className="ac-av sm">{initials(f.patient.full_name)}</span><span><b>{f.patient.full_name}</b> <small className="ac-muted">{f.patient.code}</small></span>
        {!readOnly && <button type="button" onClick={() => set('patient', null)} aria-label="Bỏ chọn bệnh nhân">×</button>}</div>
        : <PatientPicker value={null} onPick={(p) => set('patient', p)} />}
      {err('patient')}
    </details>}
  </AcModal>;
}

/* ---------------- ngăn chi tiết bên phải (ảnh 9, 10) ---------------- */
const EV_ICON = { created: '⚡', assign: '☺', status: '⚑', type: '➤', due: '▦', done: '✓', reopen: '↺', note: '✎', title: '✎', link: '⛓' };

export function ActivityDrawer({ id, onClose, onChanged, onEdit }) {
  const l = useLoad(async () => (await api.get(`/clinic/activities/${id}/`)).data, [id]);
  const staff = useLoad(async () => (await api.get('/clinic/activities/assignees/')).data, []);
  const [draft, setDraft] = useState({});
  const [expand, setExpand] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const a = l.data;
  useEffect(() => { setDraft({}); setErr(''); }, [id, a?.status]);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  if (!a) return <aside className="ac-drawer"><div className="ac-drawer-loading">{l.error ? 'Không tải được hoạt động.' : 'Đang tải…'}<button className="ac-x" onClick={onClose}>×</button></div></aside>;
  const state = draft.set_state || a.state, owner = draft.assigned_to ?? a.assigned_to ?? '';
  const events = expand ? a.events : a.events.slice(-3);
  const locked = a.status !== 'pending';
  const call = async (fn, msg, confetti) => {
    setBusy(true); setErr('');
    try { await fn(); if (confetti) fireConfetti(); onChanged(msg); onClose(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const save = () => call(() => (Object.keys(draft).length ? api.patch(`/clinic/activities/${a.id}/`, draft) : Promise.resolve()), 'Đã cập nhật hoạt động.', draft.set_state === 'done');
  return <aside className="ac-drawer" role="dialog" aria-label="Chi tiết hoạt động">
    <header><span className="ac-typetag"><TypeIcon icon={a.type_icon} size={16} />{a.type_name}</span>
      <button className="ac-x" onClick={onClose} aria-label="Đóng">×</button></header>
    <h2 className="ac-drawer-title">{a.title}</h2>
    <div className="ac-drawer-b">
      <dl className="ac-props">
        <dt>Trạng thái</dt><dd><StatusPill state={state} disabled={busy} onChange={(k) => setDraft({ ...draft, set_state: k })} /></dd>
        <dt>Phụ trách</dt><dd><select className="ac-input slim" value={owner} disabled={locked || busy} onChange={(e) => setDraft({ ...draft, assigned_to: e.target.value ? Number(e.target.value) : null })}>
          <option value="">Chưa giao</option>{(staff.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select></dd>
        <dt>Hạn</dt><dd className={a.overdue ? 'ac-red' : ''}>{fmtDue(a.start_at)} — {fmtDue(a.end_at)}{a.overdue && <span className="ac-tag red">QUÁ HẠN</span>}</dd>
        <dt>Khách hàng</dt><dd>{a.patient ? <Link to={`/benh-nhan/${a.patient}`} className="ac-link"><b>{a.patient_name}</b></Link> : <b>{a.conversation_label}</b>}
          {a.patient && <small className="ac-muted"> · {a.patient_code} · {a.patient_phone}</small>}</dd>
      </dl>
      <h6>GHI CHÚ</h6><div className="ac-notebox"><NoteView note={a.note} links={a.links} /><ImplicitLinks links={a.links} /></div>
      {a.outcome && <><h6>KẾT QUẢ</h6><div className="ac-notebox">{a.outcome}</div></>}
      <div className="ac-tl-h"><h6>DÒNG THỜI GIAN</h6>{a.events.length > 3 && <button className="ac-btn ghost sm" onClick={() => setExpand(!expand)}>{expand ? 'Thu gọn ˄' : 'Mở rộng ˅'}</button>}</div>
      <ol className="ac-tl">{events.map((e) => <li key={e.id}><i>{EV_ICON[e.kind] || '•'}</i><div><b>{e.text}</b></div><time>{fmtDue(e.at).replace(/ (\d\d:\d\d) /, ' $1 ')}</time></li>)}</ol>
      {err && <div className="ac-alert">{err}</div>}
    </div>
    <footer>
      {a.status === 'pending'
        ? <button className="ac-btn" disabled={busy} onClick={() => call(() => api.post(`/clinic/activities/${a.id}/complete/`), 'Đã cập nhật hoạt động.', true)}>✓ Đánh dấu hoàn thành</button>
        : <button className="ac-btn" disabled={busy} onClick={() => call(() => api.post(`/clinic/activities/${a.id}/reopen/`), 'Đã mở lại hoạt động.')}>↺ Mở lại</button>}
      <button className="ac-btn ghost" onClick={() => onEdit(a)}>Sửa chi tiết</button>
      <button className="ac-btn primary" disabled={busy} onClick={save}>Lưu &amp; đóng</button>
    </footer>
  </aside>;
}

function NavChip({ link }) {
  const nav = useNavigate();
  return <button className="ac-chip" onClick={() => nav(link.url)} title="Mở hồ sơ liên kết">{link.label}</button>;
}
