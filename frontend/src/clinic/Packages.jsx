import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import AddRounded from '@mui/icons-material/AddRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import EditNoteRounded from '@mui/icons-material/EditNoteRounded';
import GridViewRounded from '@mui/icons-material/GridViewRounded';
import LinkRounded from '@mui/icons-material/LinkRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import SellOutlined from '@mui/icons-material/SellOutlined';
import ViewListRounded from '@mui/icons-material/ViewListRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Avatar, Btn, Card, Empty, Loading, errMsg, fmtDate, fmtTime, isoDay, money, useDebounce, useLoad } from './ui';
import { PlanFormModal, SessionModal } from './Plans';
import './packages.css';

const arr = (d) => d?.results || d || [];
const EXTEND_STOPS = [1, 3, 6, 12, 24];
export function addMonths(iso, n) {
  const [y, m, d] = iso.split('-').map(Number); const t = m - 1 + n; const yy = y + Math.floor(t / 12); const mm = ((t % 12) + 12) % 12;
  const last = new Date(yy, mm + 1, 0).getDate();
  return `${yy}-${String(mm + 1).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`;
}
const dmy = (iso) => (iso ? fmtDate(`${iso}T00:00:00`) : 'Không giới hạn');

function Ring({ done, total, size = 52, stroke = 4, track = 'rgba(255,255,255,.22)', color = '#f1dfcc', label = true }) {
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r; const f = total ? Math.min(done / total, 1) : 0;
  return <span className="pk-ring" style={{ width: size, height: size }}>
    <svg width={size} height={size}><circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={track} strokeWidth={stroke} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} /></svg>
    {label && <span><b>{done}</b>/{total}<small>ĐÃ DÙNG</small></span>}
  </span>;
}

function Dots({ sessions, dark }) {
  return <div className={`pk-dots ${dark ? 'dark' : ''}`}>{sessions.map((s) => <span key={s.id} title={`Buổi ${s.number}`} className={s.status}>{s.status === 'done' ? <CheckRounded fontSize="inherit" /> : s.status === 'skipped' ? '–' : ''}</span>)}</div>;
}

const STATUS_CLS = { active: 'active', draft: 'draft', expired: 'expired', completed: 'completed', cancelled: 'cancelled' };

/* ------------------------------------------------------------------ tab Liệu trình trong hồ sơ khách */
export function PackagesTab({ patient, role, rows, loading, reload, onChanged, openCreate }) {
  const [sub, setSub] = useState('active'); const [view, setView] = useState('grid'); const [openId, setOpenId] = useState(null); const [creating, setCreating] = useState(false);
  const [ext, setExt] = useState(null); const [xfer, setXfer] = useState(null); const [msg, setMsg] = useState('');
  useEffect(() => { if (openCreate) setCreating(true); }, [openCreate]);
  const active = rows.filter((p) => ['active', 'draft'].includes(p.display_status)); const ended = rows.filter((p) => !['active', 'draft'].includes(p.display_status));
  const shown = sub === 'active' ? active : ended;
  const refresh = () => { reload(true); onChanged?.(); };
  const canCreate = ['doctor', 'manager'].includes(role);
  const act = async (plan, path, body, ok) => { setMsg(''); try { await api.post(`/clinic/plans/${plan.id}/${path}/`, body || {}); refresh(); if (ok) setMsg(ok); } catch (e) { setMsg(errMsg(e)); } };
  const menu = (p) => [
    ['Xem chi tiết', () => setOpenId(p.id)],
    ...(['doctor', 'manager', 'consultant'].includes(role) && !['completed', 'cancelled'].includes(p.status) ? [['Đổi thời hạn gói', () => setExt(p)]] : []),
    ...(role === 'manager' && !['completed', 'cancelled'].includes(p.status) ? [['Chuyển gói cho khách khác', () => setXfer(p)]] : []),
    ...(role === 'manager' && ['active', 'draft'].includes(p.status) ? [['Cho hết hạn', () => window.confirm(`Cho gói ${p.code} hết hạn ngay? Các buổi còn lại sẽ không dùng được nữa.`) && act(p, 'expire', {}, 'Đã cho gói hết hạn.')]] : []),
  ];
  const open = rows.find((p) => p.id === openId);
  return <div className="pk">
    <div className="pk-bar">
      <div className="pk-pills"><button className={sub === 'active' ? 'on' : ''} onClick={() => setSub('active')}>Đang hiệu lực ({active.length})</button><button className={sub === 'ended' ? 'on' : ''} onClick={() => setSub('ended')}>Hết hạn / kết thúc ({ended.length})</button></div>
      <span className="sp" />
      {canCreate && <button className="pk-new" onClick={() => setCreating(true)}><AddRounded fontSize="small" />Tạo liệu trình</button>}
      <div className="pk-view"><button className={view === 'grid' ? 'on' : ''} aria-label="Dạng thẻ" onClick={() => setView('grid')}><GridViewRounded fontSize="small" /></button><button className={view === 'list' ? 'on' : ''} aria-label="Dạng danh sách" onClick={() => setView('list')}><ViewListRounded fontSize="small" /></button></div>
    </div>
    {msg && <div className="pk-msg" onClick={() => setMsg('')}>{msg}</div>}
    {loading && !rows.length ? <Loading /> : !shown.length ? <Card><Empty title={sub === 'active' ? 'Chưa có liệu trình đang hiệu lực' : 'Chưa có gói hết hạn hoặc kết thúc'} hint={sub === 'active' ? 'Bán gói liệu trình ở màn Bán hàng, hoặc bác sĩ tạo thủ công.' : ''} /></Card>
      : view === 'grid' ? <div className="pk-grid">{shown.map((p) => <PackageCard key={p.id} p={p} menu={menu(p)} onOpen={() => setOpenId(p.id)} />)}</div>
        : <section className="pk-list"><table><thead><tr><th>Mã</th><th>Tên gói</th><th>Đã dùng</th><th>Giá trị / buổi</th><th>Kích hoạt</th><th>Hết hạn</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>{shown.map((p) => <tr key={p.id} onClick={() => setOpenId(p.id)}><td><b>#{p.code}</b></td><td>{p.title}</td><td>{p.done_sessions}/{p.total_sessions}</td><td>{money(p.value_each)}</td><td>{dmy(p.start_date)}</td><td>{dmy(p.expires_at)}</td>
            <td><span className={`pk-st ${STATUS_CLS[p.display_status]}`}>{p.display_status_label}</span></td><td><button className="pk-link" onClick={() => setOpenId(p.id)}>Chi tiết</button></td></tr>)}</tbody></table></section>}
    {open && <PackageDetail plan={open} role={role} onClose={() => setOpenId(null)} onChanged={refresh} onExtend={() => setExt(open)} />}
    {ext && <ExtendModal plan={ext} onClose={() => setExt(null)} onDone={() => { setExt(null); refresh(); setMsg('Đã đổi thời hạn gói.'); }} />}
    {xfer && <TransferModal plan={xfer} onClose={() => setXfer(null)} onDone={() => { setXfer(null); setOpenId(null); refresh(); setMsg('Đã chuyển gói cho khách hàng mới.'); }} />}
    <PlanFormModal open={creating} patient={patient} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); refresh(); }} />
  </div>;
}

function PackageCard({ p, menu, onOpen }) {
  const [open, setOpen] = useState(false); const ref = useRef(null);
  useEffect(() => { const h = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const remaining = p.total_sessions - p.done_sessions;
  return <article className={`pk-card ${STATUS_CLS[p.display_status]}`}>
    <header onClick={onOpen}>
      <Ring done={p.done_sessions} total={p.total_sessions} />
      <div className="t"><span className="code"><SellOutlined fontSize="inherit" />#{p.code}</span><h3>{p.title}</h3></div>
      <span className="tag">{p.display_status_label}</span>
      <div className="kb" ref={ref} onClick={(e) => e.stopPropagation()}>
        <button aria-label="Tùy chọn" onClick={() => setOpen(!open)}><MoreVertRounded fontSize="small" /></button>
        {open && <div className="pk-menu">{menu.map(([t, fn]) => <button key={t} onClick={() => { setOpen(false); fn(); }}>{t}</button>)}</div>}
      </div>
    </header>
    <div className="body" onClick={onOpen}>
      <div className="row"><span className="lab">CÁC BUỔI</span><span className="rem">còn {remaining} buổi</span></div>
      <Dots sessions={p.sessions} />
      <div className="facts"><div><small>Giá trị / buổi</small><b>{money(p.value_each)}</b></div><div><small>Ngày kích hoạt</small><b>{dmy(p.start_date)}</b></div><div><small>Ngày hết hạn</small><b>{dmy(p.expires_at)}</b></div></div>
    </div>
    <footer><span><Avatar name={p.doctor_name || 'PK'} size={24} />{p.doctor_name || 'Bán tại quầy'}</span><span className="inv">{p.invoice ? `#${p.invoice_code}` : 'Tạo thủ công'}</span></footer>
  </article>;
}

/* ------------------------------------------------------------------ chi tiết gói + lịch sử sử dụng */
function PackageDetail({ plan, role, onClose, onChanged, onExtend }) {
  const [sess, setSess] = useState(null); const [editing, setEditing] = useState(false); const [err, setErr] = useState(''); const [link, setLink] = useState(null);
  const canExtend = ['doctor', 'manager', 'consultant'].includes(role); const canPerform = ['doctor', 'manager', 'staff'].includes(role);
  const next = plan.sessions.find((s) => s.status === 'pending');
  const usable = plan.status === 'active' && plan.display_status === 'active';
  const post = async (path, body) => { setErr(''); try { await api.post(`/clinic/plans/${plan.id}/${path}/`, body || {}); onChanged(); } catch (e) { setErr(errMsg(e)); } };
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  return <div className="pk-ov" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="pk-dlg" role="dialog" aria-label="Chi tiết gói liệu trình">
      <header>
        <button className="x" onClick={onClose} aria-label="Đóng"><CloseRounded /></button>
        <Ring done={plan.done_sessions} total={plan.total_sessions} size={64} stroke={5} track="rgba(255,255,255,.18)" color="#3ddc97" />
        <div className="t"><small>{plan.display_status_label.toUpperCase()} · MÃ GÓI {plan.code}</small><h2>{plan.title}</h2>
          <p>{money(plan.value_each)} / buổi · Kích hoạt {dmy(plan.start_date)} · Hết hạn {dmy(plan.expires_at)}{plan.invoice && <> · Hóa đơn <Link to={`/hoa-don/${plan.invoice}`}>#{plan.invoice_code}</Link></>}</p>
          <Dots sessions={plan.sessions} dark /></div>
      </header>
      <div className="bd">
        <div className="pk-info"><div><small>Ngày kích hoạt</small><b>{dmy(plan.start_date)}</b></div>
          <div><small>Ngày hết hạn</small><b>{dmy(plan.expires_at)}</b>{canExtend && !['completed', 'cancelled'].includes(plan.status) && <button aria-label="Đổi thời hạn" onClick={onExtend}><EditOutlined fontSize="small" /></button>}</div>
          <div><small>Giá trị mỗi buổi</small><b>{money(plan.value_each)}</b></div></div>
        {role !== 'consultant' && (plan.diagnosis || plan.content) && <div className="pk-clin">{plan.diagnosis && <p><b>Chẩn đoán:</b> {plan.diagnosis}</p>}{plan.content && <p><b>Nội dung điều trị:</b> {plan.content}</p>}</div>}
        <div className="pk-h"><h3>Lịch sử sử dụng</h3><span>đã dùng {plan.done_sessions} / {plan.total_sessions} buổi</span></div>
        {err && <div className="pk-msg err">{err}</div>}
        <div className="pk-tw"><table><thead><tr><th /><th>Ngày</th><th>Lịch hẹn</th><th>Người thực hiện</th><th>Giá trị</th><th>Thanh toán</th><th>Trạng thái</th><th /></tr></thead>
          <tbody>{plan.sessions.map((s) => <tr key={s.id}>
            <td className="n">#{s.number}</td>
            <td>{s.status === 'pending' ? <span className="mut">{s.planned_date ? `Dự kiến ${fmtDate(s.planned_date)}` : '—'}</span> : <>{fmtDate(s.performed_at)}<small>{fmtTime(s.performed_at)}</small></>}</td>
            <td>{s.booking ? <>{s.booking_label || 'Lịch hẹn'}<small>{fmtDate(s.booking_at)} {fmtTime(s.booking_at)}</small></> : <span className="mut">—</span>}</td>
            <td>{s.performed_by_name ? <span className="who"><Avatar name={s.performed_by_name} size={24} />{s.performed_by_name}</span> : <span className="mut">—</span>}</td>
            <td><b>{money(plan.value_each)}</b></td>
            <td>{s.status !== 'pending' && plan.invoice ? <Link className="inv" to={`/hoa-don/${plan.invoice}`}>#{plan.invoice_code}</Link> : <span className="mut">—</span>}</td>
            <td><span className={`pk-ss ${s.status}`}>{s.status === 'done' ? 'Đã dùng' : s.status === 'skipped' ? 'Bỏ qua' : 'Chờ dùng'}</span></td>
            <td className="act">
              {s.status === 'pending' && canPerform && usable && s.id === next?.id && <button className="pk-b pri" onClick={() => setSess(s)}>Ghi nhận</button>}
              {s.status === 'pending' && canExtend && plan.status !== 'cancelled' && <button className="pk-b" onClick={(e) => setLink({ s, rect: e.currentTarget.getBoundingClientRect() })}><LinkRounded fontSize="inherit" />Liên kết</button>}
              {s.status !== 'pending' && role === 'manager' && <button className="pk-b dng" onClick={() => window.confirm(`Hoàn tác buổi ${s.number}? Buổi sẽ trở về trạng thái chờ dùng.`) && post('void-session', { session_id: s.id })}>Hoàn tác</button>}
              {s.status !== 'pending' && !s.booking && canExtend && <button className="pk-b" onClick={(e) => setLink({ s, rect: e.currentTarget.getBoundingClientRect() })}><LinkRounded fontSize="inherit" />Liên kết</button>}
            </td></tr>)}</tbody></table></div>
        {(role === 'doctor' || role === 'manager') && !['completed', 'cancelled'].includes(plan.status) && <div className="pk-foot">
          {plan.status === 'draft' && <Btn kind="primary" size="sm" onClick={() => post('activate')}>Xác nhận bắt đầu</Btn>}
          <Btn size="sm" onClick={() => setEditing(true)}>Chỉnh sửa</Btn>
          <button className="pk-link dng" onClick={() => window.confirm('Hủy liệu trình này?') && post('cancel')}>Hủy liệu trình</button></div>}
      </div>
    </div>
    {link && <LinkPopover plan={plan} s={link.s} rect={link.rect} onClose={() => setLink(null)} onPick={async (b) => { setLink(null); await post('link-session', { session_id: link.s.id, booking: b }); }} />}
    {sess && <SessionModal plan={plan} session={sess} onClose={() => setSess(null)} onDone={() => { setSess(null); onChanged(); }} />}
    <PlanFormModal open={editing} plan={plan} patient={{ id: plan.patient, full_name: plan.patient_name }} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); onChanged(); }} />
  </div>;
}

function LinkPopover({ plan, s, rect, onClose, onPick }) {
  const [q, setQ] = useState(''); const dq = useDebounce(q, 120); const ref = useRef(null);
  const l = useLoad(async () => (await api.get(`/clinic/patients/${plan.patient}/appointments/`)).data, [plan.patient]);
  useEffect(() => { const h = (e) => ref.current && !ref.current.contains(e.target) && onClose(); const t = setTimeout(() => document.addEventListener('mousedown', h), 0); return () => { clearTimeout(t); document.removeEventListener('mousedown', h); }; }, [onClose]);
  const rows = (l.data || []).filter((b) => b.status !== 'cancelled' && (!dq.trim() || `${b.services.join(' ')} ${b.type} ${fmtDate(b.appointment)}`.toLowerCase().includes(dq.trim().toLowerCase())));
  const left = Math.max(12, Math.min(rect.right - 360, window.innerWidth - 372)); const top = Math.min(rect.bottom + 8, window.innerHeight - 380);
  return <div className="pk-pop" ref={ref} style={{ left, top }}>
    <div className="h">LIÊN KẾT BUỔI {s.number} VỚI LỊCH HẸN</div>
    <label className="sr"><SearchRounded fontSize="small" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm lịch hẹn" /></label>
    <div className="ls">{l.loading && !l.data ? <p>Đang tải…</p> : rows.map((b) => <button key={b.id} onClick={() => onPick(b.id)}><b>{b.services.join(', ') || b.type}</b><small>{fmtDate(b.appointment)} · {fmtTime(b.appointment)}</small></button>)}
      {!l.loading && !rows.length && <p>Không có lịch hẹn phù hợp.</p>}</div>
    {s.booking && <button className="un" onClick={() => onPick(null)}>Bỏ liên kết lịch hẹn</button>}
  </div>;
}

/* ------------------------------------------------------------------ đổi thời hạn */
function ExtendModal({ plan, onClose, onDone }) {
  const [mode, setMode] = useState('quick'); const [idx, setIdx] = useState(1); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const today = isoDay(); const base = plan.expires_at && plan.expires_at >= today ? plan.expires_at : today;
  const months = EXTEND_STOPS[idx]; const next = addMonths(base, months);
  const [start, setStart] = useState(plan.start_date || today); const [end, setEnd] = useState(plan.expires_at || addMonths(today, 12));
  const save = async () => {
    setErr(''); setBusy(true);
    try { await api.post(`/clinic/plans/${plan.id}/extend/`, mode === 'quick' ? { months } : { start_date: start, expires_at: end }); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return <div className="pk-ov top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="pk-mini" role="dialog" aria-label="Đổi thời hạn gói">
      <header><h3>Đổi thời hạn gói</h3><button onClick={onClose} aria-label="Đóng"><CloseRounded fontSize="small" /></button></header>
      <div className="seg"><button className={mode === 'quick' ? 'on' : ''} onClick={() => setMode('quick')}>Gia hạn nhanh</button><button className={mode === 'custom' ? 'on' : ''} onClick={() => setMode('custom')}>Chọn ngày</button></div>
      {err && <div className="pk-msg err">{err}</div>}
      {mode === 'quick' ? <>
        <div className="cmp"><div><small>HẠN HIỆN TẠI</small><b>{dmy(plan.expires_at)}</b></div><span>→</span><div className="r"><small>HẠN MỚI</small><b>{dmy(next)}</b></div></div>
        <div className="ext"><b>Gia hạn thêm</b><em>{months} tháng</em></div>
        <input className="rng" type="range" min={0} max={EXTEND_STOPS.length - 1} step={1} value={idx} onChange={(e) => setIdx(Number(e.target.value))} aria-label="Số tháng gia hạn"
          style={{ background: `linear-gradient(to right,#0b66c3 ${(idx / (EXTEND_STOPS.length - 1)) * 100}%,#dfe5ee ${(idx / (EXTEND_STOPS.length - 1)) * 100}%)` }} />
        <div className="stops">{EXTEND_STOPS.map((m, i) => <span key={m} className={i === idx ? 'on' : ''}>{m} tháng</span>)}</div>
        <p className="hint">Ngày kích hoạt giữ nguyên là <b>{dmy(plan.start_date)}</b>. Dùng “Chọn ngày” để đổi cả hai ngày.</p></>
        : <div className="cust"><label>Ngày kích hoạt<input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label><label>Ngày hết hạn<input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label></div>}
      <footer><button className="pk-b" onClick={onClose}>Hủy</button><button className="pk-b pri big" disabled={busy || (mode === 'custom' && (!end || end < start))} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu'}</button></footer>
    </div></div>;
}

/* ------------------------------------------------------------------ chuyển gói */
function TransferModal({ plan, onClose, onDone }) {
  const [q, setQ] = useState(''); const dq = useDebounce(q, 250); const [rows, setRows] = useState([]); const [to, setTo] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { if (dq.trim().length < 2) { setRows([]); return; } api.get('/clinic/patients/', { params: { q: dq.trim(), limit: 8 } }).then(({ data }) => setRows(arr(data).filter((p) => p.id !== plan.patient))).catch(() => setRows([])); }, [dq, plan.patient]);
  const go = async () => { setErr(''); setBusy(true); try { await api.post(`/clinic/plans/${plan.id}/transfer/`, { patient: to.id }); onDone(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  return <div className="pk-ov top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="pk-mini" role="dialog" aria-label="Chuyển gói">
      <header><h3>Chuyển gói {plan.code}</h3><button onClick={onClose} aria-label="Đóng"><CloseRounded fontSize="small" /></button></header>
      <p className="hint" style={{ marginTop: 0 }}>Toàn bộ gói <b>{plan.title}</b> ({plan.total_sessions - plan.done_sessions} buổi còn lại) sẽ chuyển sang khách hàng được chọn. Liên kết lịch hẹn của các buổi sẽ được gỡ.</p>
      {err && <div className="pk-msg err">{err}</div>}
      {to ? <div className="pk-to"><Avatar name={to.full_name} size={36} /><span><b>{to.full_name}</b><small>{to.code} · {to.phone}</small></span><button className="pk-link" onClick={() => setTo(null)}>Đổi</button></div>
        : <><label className="pk-s"><SearchRounded fontSize="small" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm khách nhận gói (tên, SĐT, mã)" /></label>
          <div className="pk-fl">{rows.map((p) => <button key={p.id} onClick={() => setTo(p)}><Avatar name={p.full_name} size={30} /><span><b>{p.full_name}</b><small>{p.code} · {p.phone}</small></span></button>)}
            {q.trim().length >= 2 && !rows.length && <p>Không tìm thấy khách.</p>}</div></>}
      <footer><button className="pk-b" onClick={onClose}>Hủy</button><button className="pk-b pri big" disabled={!to || busy} onClick={go}>{busy ? 'Đang chuyển…' : 'Chuyển gói'}</button></footer>
    </div></div>;
}

/* ------------------------------------------------------------------ ghi chú khách hàng */
export function NotesModal({ patient, onClose, onChanged }) {
  const { user } = useAuth();
  const l = useLoad(async () => (await api.get(`/clinic/patients/${patient.id}/notes/`)).data, [patient.id]);
  const [tab, setTab] = useState('client'); const [text, setText] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const d = l.data || { client: [], appointments: [] };
  useEffect(() => { const h = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', h); return () => window.removeEventListener('keydown', h); }, [onClose]);
  const add = async () => { setErr(''); setBusy(true); try { await api.post(`/clinic/patients/${patient.id}/notes/`, { text }); setText(''); await l.reload(true); onChanged?.(); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); } };
  const del = async (n) => { if (!window.confirm('Xóa ghi chú này?')) return; try { await api.delete(`/clinic/patients/${patient.id}/notes/${n.id}/`); await l.reload(true); onChanged?.(); } catch (e) { setErr(errMsg(e)); } };
  return <div className="pk-ov top" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="pk-notes" role="dialog" aria-label="Ghi chú khách hàng">
      <header><span className="ic"><EditNoteRounded /></span><div><small>GHI CHÚ</small><h2>{d.client.length} ghi chú khách hàng</h2><p>Thông tin nội bộ cho đội ngũ — chỉ nhân viên phòng khám xem được.</p></div><button onClick={onClose} aria-label="Đóng"><CloseRounded /></button></header>
      <div className="seg2"><button className={tab === 'client' ? 'on' : ''} onClick={() => setTab('client')}>Ghi chú khách hàng <i>{d.client.length}</i></button><button className={tab === 'appt' ? 'on' : ''} onClick={() => setTab('appt')}>Ghi chú lịch hẹn <i>{d.appointments.length}</i></button></div>
      <div className="list">{l.loading && !l.data ? <Loading /> : tab === 'client'
        ? (d.client.length ? d.client.map((n) => <article key={n.id}><p>{n.text}</p><footer><span>{n.author} · {fmtDate(n.created_at)} {fmtTime(n.created_at)}</span>{(n.mine || user.role === 'manager') && <button onClick={() => del(n)}>Xóa</button>}</footer></article> ) : <p className="empty">Chưa có ghi chú khách hàng.</p>)
        : (d.appointments.length ? d.appointments.map((n) => <article key={n.id}><p>{n.text}</p><footer><span>Lịch hẹn {n.code} · {fmtDate(n.appointment)} {fmtTime(n.appointment)}</span></footer></article>) : <p className="empty">Chưa có ghi chú lịch hẹn.</p>)}</div>
      {tab === 'client' && <div className="add"><small>THÊM GHI CHÚ</small>{err && <div className="pk-msg err">{err}</div>}
        <textarea value={text} maxLength={2000} onChange={(e) => setText(e.target.value)} placeholder="Đội ngũ cần biết điều gì về khách này?" />
        <div><button className="pk-b pri big" disabled={!text.trim() || busy} onClick={add}><AddRounded fontSize="small" />Thêm ghi chú</button></div></div>}
    </div></div>;
}
