import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AddRounded from '@mui/icons-material/AddRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import ViewModuleRounded from '@mui/icons-material/ViewModuleRounded';
import ViewListRounded from '@mui/icons-material/ViewListRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import api from '../api/client';
import './plans-view.css';
import { useAuth } from '../context/AuthContext';
import { Btn, Card, Empty, Field, Loading, Modal, PageHead, Pill, ProgressDots, errMsg, fmtDate, isoDay, money, useLoad, useToast } from './ui';

export const planTone = { draft: 'gray', active: 'blue', completed: 'green', cancelled: 'red', expired: 'gray' };

export function PlanFormModal({ open, patient, record, onClose, onSaved, plan }) {
  const services = useLoad(async () => (await api.get('/services/')).data, []);
  const [f, setF] = useState({});
  const [err, setErr] = useState('');
  useEffect(() => {
    if (open) {
      setErr('');
      setF(plan ? { ...plan, service: plan.service || '' } : { title: '', service: '', diagnosis: record ? [record.diagnosis_code, record.diagnosis_name].filter(Boolean).join(' – ') : '',
        content: record?.treatment_direction || '', total_sessions: 4, interval_days: 14, price: 0, start_date: '' });
    }
  }, [open, plan, record]);
  const list = (services.data?.results || services.data || []).filter((s) => s.is_active);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const pickService = (e) => {
    const s = list.find((x) => String(x.id) === e.target.value);
    setF((x) => ({ ...x, service: e.target.value, title: x.title || (s ? `Liệu trình ${s.name}` : ''), price: x.price || (s ? s.price * (x.total_sessions || 1) : 0) }));
  };
  const submit = async () => {
    setErr('');
    const body = { patient: patient.id, record: record?.id || f.record || null, title: f.title, service: f.service || null, diagnosis: f.diagnosis, content: f.content,
      total_sessions: Number(f.total_sessions), interval_days: Number(f.interval_days), price: Number(f.price) || 0, start_date: f.start_date || null, note: f.note || '' };
    try {
      const { data } = plan ? await api.patch(`/clinic/plans/${plan.id}/`, body) : await api.post('/clinic/plans/', body);
      onSaved(data);
    } catch (e) { setErr(errMsg(e)); }
  };
  return <Modal open={open} wide portal className="cl-plan-form-modal" title={plan ? 'Chỉnh sửa liệu trình' : 'Tạo liệu trình điều trị'} subtitle={patient?.full_name} onClose={onClose}
    footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={!f.title?.trim()} onClick={submit}>{plan ? 'Lưu thay đổi' : 'Tạo liệu trình'}</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <div className="cl-form-grid">
      <Field label="Dịch vụ áp dụng" span="2"><select value={f.service || ''} onChange={pickService}><option value="">— Không gắn dịch vụ —</option>
        {list.map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}/buổi</option>)}</select></Field>
      <Field label="Tên liệu trình" required span="2"><input value={f.title || ''} onChange={set('title')} placeholder="VD: Liệu trình peel da y khoa trị mụn" /></Field>
      <Field label="Chẩn đoán" span="2"><input value={f.diagnosis || ''} onChange={set('diagnosis')} /></Field>
      <Field label="Nội dung điều trị" span="2"><textarea rows={3} value={f.content || ''} onChange={set('content')} placeholder="Phác đồ, hoạt chất, thông số…" /></Field>
      <Field label="Số buổi"><input type="number" min={1} max={60} value={f.total_sessions || 1} onChange={set('total_sessions')} /></Field>
      <Field label="Cách nhau (ngày)"><input type="number" min={0} value={f.interval_days ?? 14} onChange={set('interval_days')} /></Field>
      <Field label="Giá trọn liệu trình (VNĐ)"><input type="number" min={0} step={50000} value={f.price || 0} onChange={set('price')} /></Field>
      <Field label="Dự kiến bắt đầu"><input type="date" value={f.start_date || ''} onChange={set('start_date')} /></Field>
    </div>
  </Modal>;
}

export function SessionModal({ plan, session, onClose, onDone }) {
  const [content, setContent] = useState('');
  const [procedures, setProcedures] = useState('');
  const [parameters, setParameters] = useState('');
  const [patientResponse, setPatientResponse] = useState('');
  const [adverseReactions, setAdverseReactions] = useState('');
  const [outcome, setOutcome] = useState('');
  const [status, setStatus] = useState('done');
  const [err, setErr] = useState('');
  useEffect(() => {
    setContent(session?.content || ''); setProcedures(session?.procedures || ''); setParameters(session?.parameters || '');
    setPatientResponse(session?.patient_response || ''); setAdverseReactions(session?.adverse_reactions || '');
    setOutcome(session?.outcome || ''); setStatus('done'); setErr('');
  }, [session]);
  if (!session) return null;
  const submit = async () => {
    try {
      const { data } = await api.post(`/clinic/plans/${plan.id}/complete-session/`, {
        session_id: session.id, content, procedures, parameters, patient_response: patientResponse,
        adverse_reactions: adverseReactions, outcome, status,
      });
      onDone(data);
    }
    catch (e) { setErr(errMsg(e)); }
  };
  return <Modal open wide portal className="cl-session-record-modal" title={`Ghi nhận buổi ${session.number}/${plan.total_sessions}`} subtitle={`${plan.patient_name || 'Khách hàng'} · ${plan.title}`} onClose={onClose}
    footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" onClick={submit}>Lưu</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <div className="cl-session-context">
      <div className="cl-session-context-primary">
        <span><small>Bệnh nhân</small><b>{plan.patient_name || '—'}</b></span>
        <span><small>Buổi liệu trình</small><b>{session.number}/{plan.total_sessions}</b></span>
        <span><small>Người thực hiện</small><b>Người đang đăng nhập</b></span>
      </div>
      <div className="cl-session-context-links">
        {session.visit_id ? <Link to={`/kham/${session.visit_id}`}>Mở lượt khám</Link> : <span>Chưa có lượt khám</span>}
        {session.record_id ? <Link to={`/benh-nhan/${plan.patient}`}>Xem bệnh án ({session.record_code || `#${session.record_id}`})</Link> : <span>Chưa liên kết bệnh án</span>}
      </div>
    </div>
    <Field label="Kết quả"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="done">Đã thực hiện</option><option value="skipped">Bỏ qua buổi này</option></select></Field>
    <div className="cl-form-grid">
      <Field label="Thủ thuật thực hiện"><textarea rows={3} value={procedures} onChange={(e) => setProcedures(e.target.value)} /></Field>
      <Field label="Thông số điều trị"><textarea rows={3} value={parameters} onChange={(e) => setParameters(e.target.value)} /></Field>
      <Field label="Đáp ứng của khách"><textarea rows={3} value={patientResponse} onChange={(e) => setPatientResponse(e.target.value)} /></Field>
      <Field label="Phản ứng bất lợi"><textarea rows={3} value={adverseReactions} onChange={(e) => setAdverseReactions(e.target.value)} /></Field>
      <Field label="Kết quả buổi" span="2"><input value={outcome} onChange={(e) => setOutcome(e.target.value)} placeholder="Ví dụ: Đáp ứng tốt, hẹn buổi tiếp theo" /></Field>
      <Field label="Ghi chú thực hiện / theo dõi sau buổi" span="2"><textarea rows={3} value={content} onChange={(e) => setContent(e.target.value)} /></Field>
    </div>
  </Modal>;
}

export function PlanCard({ plan, canEdit, canPerform, onChange, showPatient }) {
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [sess, setSess] = useState(null);
  const [configuringSessionId, setConfiguringSessionId] = useState(null);
  const [err, setErr] = useState('');
  const { user } = useAuth();
  const effectiveStatus = plan.display_status || plan.status;
  const canSellPackage = ['manager', 'consultant'].includes(user.role);
  const next = plan.sessions.find((s) => s.status === 'pending');
  const act = async (path) => { try { const { data } = await api.post(`/clinic/plans/${plan.id}/${path}/`); onChange(data); } catch (e) { setErr(errMsg(e)); } };
  const configureDelegation = async (session, allowStaffDelegation) => {
    setErr('');
    setConfiguringSessionId(session.id);
    try {
      const { data } = await api.post(`/clinic/plans/${plan.id}/configure-session/`, {
        session_id: session.id,
        allow_staff_delegation: allowStaffDelegation,
      });
      onChange(data);
    } catch (e) {
      setErr(errMsg(e));
    } finally {
      setConfiguringSessionId(null);
    }
  };
  const seeContent = user.role !== 'consultant';
  const isPlanDoctor = user.role === 'doctor' && plan.doctor === user.id;
  const mayRecordSession = canPerform && (user.role === 'staff'
    ? plan.sessions.some((session) => session.allow_staff_delegation)
    : isPlanDoctor);
  return <article className={`cl-plan ${effectiveStatus}`}>
    <header className="cl-plan-header">
      <div className="cl-plan-heading">
        <h3>{plan.title}</h3>
        <p>
          {showPatient && <Link to={`/benh-nhan/${plan.patient}`}>{plan.patient_name}</Link>}
          {showPatient && plan.service_name && <span className="cl-plan-separator"> · </span>}
          <span>{plan.service_name || 'Liệu trình'}</span>
          {plan.doctor_name && <span className="cl-plan-doctor">{plan.doctor_name}</span>}
        </p>
      </div>
      <Pill tone={planTone[effectiveStatus]} dot>{plan.display_status_label || plan.status_label}</Pill>
    </header>
    <div className="cl-plan-progress">
      <ProgressDots total={plan.total_sessions} done={plan.done_sessions} />
      <span>{plan.done_sessions}/{plan.total_sessions} buổi đã hoàn thành</span>
    </div>
    <div className="cl-plan-meta">
      {plan.code && <span><small>Mã gói</small><b>{plan.code}</b></span>}
      {next?.planned_date && effectiveStatus === 'active' && <span><small>Buổi tiếp theo</small><b>{fmtDate(next.planned_date)}</b></span>}
      {plan.expires_at && <span><small>Hết hạn</small><b>{fmtDate(plan.expires_at)}</b></span>}
      {plan.price > 0 && <span><small>Giá liệu trình</small><b>{money(plan.price)}</b></span>}
    </div>
    {plan.price > 0 && <div className="cl-plan-billing">
      {plan.package_invoice ? <>
        <span>Gói {plan.package_invoice.status === 'paid' ? 'đã thanh toán' : plan.package_invoice.status === 'partial' ? 'đã thu một phần' : 'chưa thanh toán'} · {plan.package_invoice.code}</span>
        {canSellPackage && plan.package_invoice.balance > 0 && <Btn size="sm" kind="primary" onClick={() => navigate(`/ban-hang/thu-tien/${plan.package_invoice.id}`)}>Thu phần còn lại · {money(plan.package_invoice.balance)}</Btn>}
      </> : <>
        <span>Chưa bán trọn gói · thu theo từng buổi</span>
        {canSellPackage && !['completed', 'cancelled', 'expired'].includes(effectiveStatus) && <Btn size="sm" kind="primary" onClick={() => navigate(`/ban-hang?patient=${plan.patient}&plan=${plan.id}`)}>Bán trọn gói</Btn>}
      </>}
    </div>}
    {seeContent && plan.diagnosis && <p className="cl-plan-dx"><b>Chẩn đoán:</b> {plan.diagnosis}</p>}
    {seeContent && plan.content && <p className="cl-plan-content"><span>Phác đồ điều trị</span>{plan.content}</p>}
    <details className="cl-plan-details"><summary><span className="cl-plan-details-label">Chi tiết các buổi</span><span>{plan.sessions.length} buổi</span><ExpandMoreRounded className="cl-details-chevron" /></summary>
      <ol className="cl-sessions">{plan.sessions.map((s) => <li key={s.id} className={s.status}>
        <b>Buổi {s.number}</b>
        <span>{s.status === 'pending' ? (s.planned_date ? `Dự kiến ${fmtDate(s.planned_date)}` : 'Chưa lên lịch') : `${s.status === 'done' ? 'Đã làm' : 'Bỏ qua'} ${fmtDate(s.performed_at)}${s.performed_by_name ? ` · ${s.performed_by_name}` : ''}`}</span>
        {s.status === 'pending' && <small>{s.allow_staff_delegation ? 'Bác sĩ cho phép giao nhân sự đủ điều kiện' : 'Bác sĩ phụ trách trực tiếp thực hiện'}</small>}
        {seeContent && s.content && <em>{s.content}</em>}
        {isPlanDoctor && effectiveStatus === 'active' && s.status === 'pending' && !s.has_active_booking && <Btn size="sm" disabled={configuringSessionId === s.id} onClick={() => configureDelegation(s, !s.allow_staff_delegation)}>{configuringSessionId === s.id ? 'Đang lưu…' : s.allow_staff_delegation ? 'Yêu cầu bác sĩ trực tiếp' : 'Cho phép giao nhân sự đủ điều kiện'}</Btn>}
        {mayRecordSession && effectiveStatus === 'active' && s.status === 'pending' && s.id === next?.id && (user.role !== 'staff' || s.allow_staff_delegation) && <Btn size="sm" kind="primary" onClick={() => setSess(s)}>Ghi nhận</Btn>}
      </li>)}</ol></details>
    {err && <div className="cl-alert error">{err}</div>}
    {(canEdit) && !['completed', 'cancelled', 'expired'].includes(effectiveStatus) && <footer>
      {effectiveStatus === 'draft' && <Btn kind="primary" size="sm" onClick={() => act('activate')}>Xác nhận bắt đầu</Btn>}
      <Btn size="sm" onClick={() => setEditing(true)}>Chỉnh sửa</Btn>
      <button className="cl-link danger" onClick={() => window.confirm('Hủy liệu trình này?') && act('cancel')}>Hủy liệu trình</button></footer>}
    <PlanFormModal open={editing} plan={plan} patient={{ id: plan.patient, full_name: plan.patient_name }} onClose={() => setEditing(false)} onSaved={(d) => { setEditing(false); onChange(d); }} />
    <SessionModal plan={plan} session={sess} onClose={() => setSess(null)} onDone={(d) => { setSess(null); onChange(d); }} />
  </article>;
}

const TABS = [
  ['active', 'Đang thực hiện', ['active', 'draft']],
  ['completed', 'Hoàn thành', ['completed']],
  ['expired', 'Hết hạn', ['expired']],
  ['cancelled', 'Đã hủy', ['cancelled']],
];
const statusOf = (p) => p.display_status || p.status;
const norm = (v) => String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').toLowerCase();
const loadView = () => { try { return localStorage.getItem('plans-view') === 'list' ? 'list' : 'grid'; } catch { return 'grid'; } };

function Ring({ done, total }) {
  const r = 22, c = 2 * Math.PI * r, pct = total ? Math.min(1, done / total) : 0;
  return <span className="pv-ring" aria-label={`${done}/${total} buổi`}>
    <svg viewBox="0 0 56 56"><circle cx="28" cy="28" r={r} className="bg" /><circle cx="28" cy="28" r={r} className="fg" strokeDasharray={`${c * pct} ${c}`} transform="rotate(-90 28 28)" /></svg>
    <b>{done}<small>/{total}</small></b>
  </span>;
}

function PlanTile({ plan, onOpen }) {
  const st = statusOf(plan);
  const left = Math.max(0, plan.total_sessions - plan.done_sessions);
  const next = plan.sessions?.find((s) => s.status === 'pending');
  return <button type="button" className={`pv-tile ${st}`} onClick={() => onOpen(plan.id)}>
    <span className="pv-tile-top">
      <Ring done={plan.done_sessions} total={plan.total_sessions} />
      <span className="pv-tile-title">
        <small>{plan.code || `LT-${plan.id}`}</small>
        <strong>{plan.title}</strong>
      </span>
      <Pill tone={planTone[st]} dot>{plan.display_status_label || plan.status_label}</Pill>
    </span>
    <span className="pv-tile-body">
      <span className="pv-sessions"><small>BUỔI</small><em>{st === 'active' || st === 'draft' ? `còn ${left} buổi` : `${plan.done_sessions}/${plan.total_sessions} đã làm`}</em></span>
      <span className="pv-dots">{Array.from({ length: plan.total_sessions }, (_, i) => <i key={i} className={i < plan.done_sessions ? 'on' : ''} />)}</span>
      <span className="pv-facts">
        <span><small>Giá gói</small><b>{plan.price > 0 ? money(plan.price) : '—'}</b></span>
        <span><small>Buổi tiếp theo</small><b>{next?.planned_date && ['active', 'draft'].includes(st) ? fmtDate(next.planned_date) : '—'}</b></span>
        <span><small>Hết hạn</small><b>{plan.expires_at ? fmtDate(plan.expires_at) : '—'}</b></span>
      </span>
    </span>
    <span className="pv-tile-foot"><b>{plan.patient_name}</b><small>{plan.doctor_name ? `BS. ${String(plan.doctor_name).replace(/^BS\.?\s*/i, '')}` : plan.service_name || ''}</small></span>
  </button>;
}

function PlanTable({ rows, onOpen }) {
  return <div className="pv-table-wrap"><table className="pv-table">
    <thead><tr><th>Liệu trình</th><th>Bệnh nhân</th><th>Tiến độ</th><th>Buổi tiếp theo</th><th>Hết hạn</th><th className="r">Giá gói</th><th>Trạng thái</th></tr></thead>
    <tbody>{rows.map((p) => {
      const st = statusOf(p); const next = p.sessions?.find((s) => s.status === 'pending');
      return <tr key={p.id} tabIndex={0} onClick={() => onOpen(p.id)} onKeyDown={(e) => e.key === 'Enter' && onOpen(p.id)}>
        <td><b>{p.title}</b><small>{p.code || `LT-${p.id}`}{p.service_name ? ` · ${p.service_name}` : ''}</small></td>
        <td><b>{p.patient_name}</b><small>{p.doctor_name}</small></td>
        <td><span className="pv-bar"><i style={{ width: `${p.total_sessions ? (p.done_sessions / p.total_sessions) * 100 : 0}%` }} /></span><small>{p.done_sessions}/{p.total_sessions} buổi</small></td>
        <td>{next?.planned_date && ['active', 'draft'].includes(st) ? fmtDate(next.planned_date) : '—'}</td>
        <td>{p.expires_at ? fmtDate(p.expires_at) : '—'}</td>
        <td className="r">{p.price > 0 ? money(p.price) : '—'}</td>
        <td><Pill tone={planTone[st]} dot>{p.display_status_label || p.status_label}</Pill></td>
      </tr>;
    })}</tbody></table></div>;
}

/** Trang tổng hợp liệu trình của phòng khám: 2 cách xem (thẻ / danh sách) */
export default function PlansPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('active');
  const [view, setView] = useState(loadView);
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const [toast, node] = useToast();
  const { data, loading, error, reload } = useLoad(async () => (await api.get('/clinic/plans/')).data, []);
  const all = data?.results || data || [];
  const canEdit = user.role === 'doctor';
  const canPerform = ['doctor', 'staff'].includes(user.role);
  const counts = Object.fromEntries(TABS.map(([k, , sts]) => [k, all.filter((p) => sts.includes(statusOf(p))).length]));
  const sts = TABS.find(([k]) => k === tab)[2];
  const nq = norm(q.trim());
  const rows = all.filter((p) => sts.includes(statusOf(p)) && (!nq || norm(`${p.patient_name} ${p.title} ${p.code} ${p.service_name}`).includes(nq)));
  const chooseView = (v) => { setView(v); try { localStorage.setItem('plans-view', v); } catch { /* bỏ qua */ } };
  const opened = all.find((p) => p.id === openId);
  return <>
    <PageHead title="Liệu trình điều trị" subtitle="Theo dõi tiến độ các liệu trình của toàn phòng khám." />
    <div className="pv-bar-top">
      <div className="pv-tabs" role="tablist">{TABS.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}<b>{counts[k]}</b></button>)}</div>
      <label className="pv-search"><SearchRounded /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm bệnh nhân, tên liệu trình, mã gói…" /></label>
      <div className="pv-toggle" role="group" aria-label="Cách xem">
        <button className={view === 'grid' ? 'on' : ''} aria-label="Xem dạng thẻ" title="Dạng thẻ" onClick={() => chooseView('grid')}><ViewModuleRounded /></button>
        <button className={view === 'list' ? 'on' : ''} aria-label="Xem dạng danh sách" title="Dạng danh sách" onClick={() => chooseView('list')}><ViewListRounded /></button>
      </div>
    </div>
    {error && <div className="cl-alert error">{error}</div>}
    {loading && !data ? <Loading /> : !rows.length ? <Card><Empty title={nq ? 'Không tìm thấy liệu trình phù hợp' : 'Chưa có liệu trình nào'} hint={nq ? 'Thử từ khóa khác hoặc đổi tab trạng thái.' : 'Bác sĩ tạo liệu trình từ màn khám hoặc từ hồ sơ bệnh nhân.'} /></Card>
      : view === 'grid' ? <div className="pv-grid">{rows.map((p) => <PlanTile key={p.id} plan={p} onOpen={setOpenId} />)}</div>
      : <PlanTable rows={rows} onOpen={setOpenId} />}
    <Modal open={!!opened} wide portal className="pv-detail-modal" title="Chi tiết liệu trình" subtitle={opened?.patient_name} onClose={() => setOpenId(null)}>
      {opened && <PlanCard plan={opened} showPatient canEdit={canEdit} canPerform={canPerform} onChange={() => { toast('Đã cập nhật liệu trình.'); reload(true); }} />}
    </Modal>
    {node}
  </>;
}
