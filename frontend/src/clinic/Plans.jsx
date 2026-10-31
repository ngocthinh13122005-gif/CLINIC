import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AddRounded from '@mui/icons-material/AddRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Btn, Card, Empty, Field, Loading, Modal, PageHead, Pill, ProgressDots, errMsg, fmtDate, isoDay, money, useLoad, useToast } from './ui';

export const planTone = { draft: 'gray', active: 'blue', completed: 'green', cancelled: 'red' };

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
  return <Modal open={open} wide title={plan ? 'Chỉnh sửa liệu trình' : 'Tạo liệu trình điều trị'} subtitle={patient?.full_name} onClose={onClose}
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
  const [status, setStatus] = useState('done');
  const [err, setErr] = useState('');
  useEffect(() => { setContent(''); setStatus('done'); setErr(''); }, [session]);
  if (!session) return null;
  const submit = async () => {
    try { const { data } = await api.post(`/clinic/plans/${plan.id}/complete-session/`, { session_id: session.id, content, status }); onDone(data); }
    catch (e) { setErr(errMsg(e)); }
  };
  return <Modal open title={`Ghi nhận buổi ${session.number}/${plan.total_sessions}`} subtitle={plan.title} onClose={onClose}
    footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" onClick={submit}>Lưu</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <Field label="Kết quả"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="done">Đã thực hiện</option><option value="skipped">Bỏ qua buổi này</option></select></Field>
    <Field label="Nội dung đã làm / theo dõi sau buổi"><textarea rows={4} value={content} onChange={(e) => setContent(e.target.value)} placeholder="Thông số, đáp ứng của da, phản ứng không mong muốn…" /></Field>
  </Modal>;
}

export function PlanCard({ plan, canEdit, canPerform, onChange, showPatient }) {
  const [editing, setEditing] = useState(false);
  const [sess, setSess] = useState(null);
  const [configuringSessionId, setConfiguringSessionId] = useState(null);
  const [err, setErr] = useState('');
  const { user } = useAuth();
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
  return <article className={`cl-plan ${plan.status}`}>
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
      <Pill tone={planTone[plan.status]} dot>{plan.status_label}</Pill>
    </header>
    <div className="cl-plan-progress">
      <ProgressDots total={plan.total_sessions} done={plan.done_sessions} />
      <span>{plan.done_sessions}/{plan.total_sessions} buổi đã hoàn thành</span>
    </div>
    <div className="cl-plan-meta">
      {next?.planned_date && plan.status === 'active' && <span><small>Buổi tiếp theo</small><b>{fmtDate(next.planned_date)}</b></span>}
      {plan.price > 0 && <span><small>Giá liệu trình</small><b>{money(plan.price)}</b></span>}
    </div>
    {seeContent && plan.diagnosis && <p className="cl-plan-dx"><b>Chẩn đoán:</b> {plan.diagnosis}</p>}
    {seeContent && plan.content && <p className="cl-plan-content"><span>Phác đồ điều trị</span>{plan.content}</p>}
    <details className="cl-plan-details"><summary><span className="cl-plan-details-label">Chi tiết các buổi</span><span>{plan.sessions.length} buổi</span><ExpandMoreRounded className="cl-details-chevron" /></summary>
      <ol className="cl-sessions">{plan.sessions.map((s) => <li key={s.id} className={s.status}>
        <b>Buổi {s.number}</b>
        <span>{s.status === 'pending' ? (s.planned_date ? `Dự kiến ${fmtDate(s.planned_date)}` : 'Chưa lên lịch') : `${s.status === 'done' ? 'Đã làm' : 'Bỏ qua'} ${fmtDate(s.performed_at)}${s.performed_by_name ? ` · ${s.performed_by_name}` : ''}`}</span>
        {s.status === 'pending' && <small>{s.allow_staff_delegation ? 'Bác sĩ cho phép giao nhân sự đủ điều kiện' : 'Bác sĩ phụ trách trực tiếp thực hiện'}</small>}
        {seeContent && s.content && <em>{s.content}</em>}
        {isPlanDoctor && plan.status === 'active' && s.status === 'pending' && !s.has_active_booking && <Btn size="sm" disabled={configuringSessionId === s.id} onClick={() => configureDelegation(s, !s.allow_staff_delegation)}>{configuringSessionId === s.id ? 'Đang lưu…' : s.allow_staff_delegation ? 'Yêu cầu bác sĩ trực tiếp' : 'Cho phép giao nhân sự đủ điều kiện'}</Btn>}
        {mayRecordSession && plan.status === 'active' && s.status === 'pending' && s.id === next?.id && (user.role !== 'staff' || s.allow_staff_delegation) && <Btn size="sm" kind="primary" onClick={() => setSess(s)}>Ghi nhận</Btn>}
      </li>)}</ol></details>
    {err && <div className="cl-alert error">{err}</div>}
    {(canEdit) && plan.status !== 'completed' && plan.status !== 'cancelled' && <footer>
      {plan.status === 'draft' && <Btn kind="primary" size="sm" onClick={() => act('activate')}>Xác nhận bắt đầu</Btn>}
      <Btn size="sm" onClick={() => setEditing(true)}>Chỉnh sửa</Btn>
      <button className="cl-link danger" onClick={() => window.confirm('Hủy liệu trình này?') && act('cancel')}>Hủy liệu trình</button></footer>}
    <PlanFormModal open={editing} plan={plan} patient={{ id: plan.patient, full_name: plan.patient_name }} onClose={() => setEditing(false)} onSaved={(d) => { setEditing(false); onChange(d); }} />
    <SessionModal plan={plan} session={sess} onClose={() => setSess(null)} onDone={(d) => { setSess(null); onChange(d); }} />
  </article>;
}

/** Trang tổng hợp liệu trình của phòng khám */
export default function PlansPage() {
  const { user } = useAuth();
  const [filter, setFilter] = useState('active,draft');
  const [page, setPage] = useState(1);
  const [toast, node] = useToast();
  const { data, loading, error, reload } = useLoad(async () => (await api.get('/clinic/plans/', { params: { status: filter } })).data, [filter]);
  const rows = data?.results || data || [];
  const pageSize = 6;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageRows = rows.slice((page - 1) * pageSize, page * pageSize);
  useEffect(() => setPage(1), [filter]);
  useEffect(() => { if (page > totalPages) setPage(totalPages); }, [page, totalPages]);
  const canEdit = user.role === 'doctor';
  const canPerform = ['doctor', 'staff'].includes(user.role);
  return <>
    <PageHead title="Liệu trình điều trị" subtitle="Theo dõi tiến độ các liệu trình đang thực hiện của toàn phòng khám." />
    <div className="cl-tabs-pill">{[['active,draft', 'Đang thực hiện'], ['completed', 'Hoàn thành'], ['cancelled', 'Đã hủy']].map(([k, t]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{t}</button>)}</div>
    {error && <div className="cl-alert error">{error}</div>}
    {loading && !data ? <Loading /> : !rows.length ? <Card><Empty title="Chưa có liệu trình nào" hint="Bác sĩ tạo liệu trình từ màn khám hoặc từ hồ sơ bệnh nhân." /></Card> :
      <><div className="cl-plan-grid">{pageRows.map((p) => <PlanCard key={p.id} plan={p} showPatient canEdit={canEdit} canPerform={canPerform}
        onChange={() => { toast('Đã cập nhật liệu trình.'); reload(true); }} />)}</div>
      {rows.length > pageSize && <nav className="cl-pagination" aria-label="Phân trang liệu trình">
        <div><button aria-label="Trang trước" disabled={page === 1} onClick={() => setPage((p) => p - 1)}><ChevronLeftRounded /></button>
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((n) => <button key={n} className={n === page ? 'on' : ''} aria-current={n === page ? 'page' : undefined} onClick={() => setPage(n)}>{n}</button>)}
          <button aria-label="Trang sau" disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}><ChevronRightRounded /></button></div>
      </nav>}</>}
    {node}
  </>;
}
