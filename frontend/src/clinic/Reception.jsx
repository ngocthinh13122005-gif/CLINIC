import { useCallback, useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import EventAvailableRounded from '@mui/icons-material/EventAvailableRounded';
import HourglassTopRounded from '@mui/icons-material/HourglassTopRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Avatar, Btn, Card, Empty, Field, Loading, Modal, PageHead, Pill, errMsg, fmtDateTime, fmtTime, genderText, useInterval, useLoad, useToast, visitTone } from './ui';
import { PatientPicker } from './PatientForm';

function DoctorSelect({ doctors, value, onChange, allowNone = true }) {
  return <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
    {allowNone && <option value="">Chưa chỉ định bác sĩ</option>}{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>;
}

function VisitCard({ v, children, tone }) {
  const p = v.patient_detail;
  return <article className={`cl-visit ${tone || ''}`}>
    <header>
      <span className="cl-ticket">#{v.ticket_no}</span>
      <Link to={`/benh-nhan/${p.id}`} className="cl-visit-name"><Avatar name={p.full_name} size={34} /><span><strong>{p.full_name}</strong>
        <small>{genderText(p.gender)}{p.age != null ? `, ${p.age} tuổi` : ''} · {p.code}</small></span></Link>
    </header>
    <div className="cl-visit-meta"><Pill tone="neutral">{v.visit_type_label}</Pill>{v.room_name && <Pill tone="blue">{v.room_name}</Pill>}{v.source === 'appointment' && <Pill tone="teal">Có lịch hẹn</Pill>}
      {v.doctor_name && <Pill tone="blue">{v.doctor_name}</Pill>}</div>
    {v.active_plans?.length > 0 && <div className="cl-visit-plans">
      <span className="cl-visit-plans-label">Liệu trình:</span>
      {v.active_plans.map((plan) => <Link key={plan.id} to={`/benh-nhan/${p.id}`} className="cl-visit-plan">
        <strong>{plan.title}</strong><small>{plan.done}/{plan.total} buổi</small>
      </Link>)}
    </div>}
    {v.reason && <p className="cl-visit-reason">{v.reason}</p>}
    {p.allergies && <p className="cl-allergy"><WarningAmberRounded />Dị ứng: {p.allergies}</p>}
    {children}
  </article>;
}

export default function ReceptionPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const role = user.role;
  const canReception = ['consultant', 'manager', 'doctor'].includes(role);
  const [toast, toastNode] = useToast();
  const board = useLoad(async () => (await api.get('/clinic/visits/board/')).data, []);
  const meta = useLoad(async () => (await api.get('/clinic/meta/')).data, []);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (!location.state?.openCreate) return;
    if (canReception) setAdding(true);
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, canReception, navigate]);
  const [calling, setCalling] = useState(null);
  const refresh = useCallback(() => board.reload(true), [board.reload]);
  useInterval(refresh, 20000);
  const doctors = meta.data?.doctors || [];
  const d = board.data;

  const act = async (fn, okMsg) => { try { await fn(); toast(okMsg); refresh(); } catch (e) { toast(errMsg(e), 'err'); } };
  const complete = (v) => act(() => api.post(`/clinic/visits/${v.id}/complete/`), 'Đã kết thúc lượt khám.');
  const cancel = (v) => { if (window.confirm(`Hủy lượt khám của ${v.patient_detail.full_name}? (bệnh nhân bỏ về / không khám)`)) act(() => api.post(`/clinic/visits/${v.id}/cancel/`), 'Đã hủy lượt khám.'); };
  const checkIn = (b) => act(() => api.post('/clinic/visits/from-booking/', { booking_id: b.id }), `Đã đón ${b.customer_name} — đang chờ ở sảnh.`);

  if (!d) return <Loading />;
  return <>
    <PageHead title={role === 'doctor' ? 'Ca khám hôm nay' : 'Tiếp đón hôm nay'}
      subtitle="Khách đến phòng khám được đón ở sảnh, nhân viên sẽ mời vào tư vấn khi sẵn sàng." />
    {board.error && <div className="cl-alert error">{board.error}</div>}
    <div className="cl-stat-row">
      <div className="cl-stat amber"><span>Đang chờ ở sảnh</span><strong>{d.counts.waiting}</strong></div>
      <div className="cl-stat blue"><span>Đang tư vấn / khám</span><strong>{d.counts.in_consult}</strong></div>
      <div className="cl-stat green"><span>Đã hoàn tất</span><strong>{d.counts.done}</strong></div>
      <div className="cl-stat teal"><span>Lịch hẹn chưa đến</span><strong>{d.counts.upcoming}</strong></div>
    </div>
    <div className="cl-board">
      <section className="cl-col">
        <h2><HourglassTopRounded />Chờ ở sảnh <em>{d.waiting.length}</em></h2>
        {d.waiting.map((v) => <VisitCard key={v.id} v={v} tone="amber">
          <div className="cl-visit-foot"><span className="cl-wait"><b>{v.waiting_minutes}</b> phút · đến {fmtTime(v.check_in_at)}</span>
            {canReception && <div className="cl-row-actions">
              <button className="cl-link danger" onClick={() => cancel(v)}>Bỏ về</button>
              <Btn kind="primary" size="sm" icon={<PlayArrowRounded />} onClick={() => setCalling(v)}>Mời vào</Btn></div>}</div>
        </VisitCard>)}
        {!d.waiting.length && <Empty title="Sảnh đang trống" hint="Khách mới đến sẽ hiện ở đây." />}
      </section>
      <section className="cl-col">
        <h2><span className="cl-live-dot" />Đang tư vấn / khám <em>{d.in_consult.length}</em></h2>
        {d.in_consult.map((v) => <VisitCard key={v.id} v={v} tone="blue">
          <div className="cl-visit-foot"><span className="cl-wait">Vào lúc {fmtTime(v.called_at)}</span>
            <div className="cl-row-actions">
              {role === 'doctor' && <Link className="cl-btn primary sm" to={`/kham/${v.id}`}>{v.record_id ? 'Tiếp tục khám' : 'Vào khám'}</Link>}
              {canReception && !v.doctor && <button className="cl-link" onClick={() => setCalling({ ...v, assignOnly: true })}>Chỉ định BS</button>}
              {canReception && <Btn size="sm" icon={<CheckRounded />} onClick={() => complete(v)}>Kết thúc</Btn>}</div></div>
          {v.record_status === 'draft' && <p className="cl-note-line">Bệnh án đang soạn, chưa ký.</p>}
        </VisitCard>)}
        {!d.in_consult.length && <Empty title="Chưa có ca nào đang khám" />}
      </section>
      <section className="cl-col">
        <h2><EventAvailableRounded />Lịch hẹn hôm nay chưa đến <em>{d.upcoming.length}</em></h2>
        {d.upcoming.map((b) => <article className={`cl-appt ${b.late ? 'late' : ''}`} key={b.id}>
          <div><strong>{b.customer_name}</strong><small>{fmtTime(b.appointment)} · {b.type}{b.doctor ? ` · ${b.doctor}` : ''}</small>
            {b.late && <Pill tone="red">Trễ hẹn</Pill>}
            {canReception && !b.checkin_allowed && <small className="cl-checkin-hint">Có thể đón từ {fmtDateTime(b.checkin_available_at)}</small>}</div>
          {canReception && <Btn size="sm" disabled={!b.checkin_allowed} title={!b.checkin_allowed ? `Check-in mở lúc ${fmtDateTime(b.checkin_available_at)}` : undefined} onClick={() => checkIn(b)}>Đón</Btn>}
        </article>)}
        {!d.upcoming.length && <Empty title="Không còn lịch hẹn chờ đón" />}
        <h2 className="cl-col-sub">Đã xong hôm nay</h2>
        <div className="cl-done-list">
          {d.done.map((v) => <div key={v.id} className="cl-done"><Pill tone={visitTone[v.status]}>{v.status_label}</Pill>
            <Link to={`/benh-nhan/${v.patient}`}>{v.patient_detail.full_name}</Link><small>{fmtTime(v.finished_at)}</small></div>)}
          {!d.done.length && <small className="cl-muted">Chưa có ca nào hoàn tất.</small>}</div>
      </section>
    </div>
    <NewVisitModal open={adding} doctors={doctors} onClose={() => setAdding(false)}
      onDone={(msg) => { setAdding(false); toast(msg); refresh(); }} />
    <CallModal visit={calling} doctors={doctors} role={role} userId={user.id} onClose={() => setCalling(null)}
      onDone={(msg) => { setCalling(null); toast(msg); refresh(); }} />
    {toastNode}
  </>;
}

function NewVisitModal({ open, doctors, onClose, onDone }) {
  const [patient, setPatient] = useState(null);
  const [plans, setPlans] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [type, setType] = useState('new');
  const [reason, setReason] = useState('');
  const [doctor, setDoctor] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!patient) { setPlans([]); setSessionId(''); return; }
    api.get('/clinic/plans/', { params: { patient: patient.id, status: 'active' } })
      .then(({ data }) => setPlans(data.results || data || []))
      .catch(() => setPlans([]));
  }, [patient]);
  const close = () => { setPatient(null); setPlans([]); setSessionId(''); setReason(''); setDoctor(''); setErr(''); setType('new'); onClose(); };
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      await api.post('/clinic/visits/', { patient: patient.id, visit_type: type, reason, doctor: doctor || null, treatment_session: sessionId || null });
      const name = patient.full_name; setPatient(null); setReason(''); setDoctor(''); setType('new');
      onDone(`Đã đón ${name} — mời ngồi chờ ở sảnh.`);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return <Modal open={open} title="Đón khách mới" subtitle="Tìm hồ sơ theo SĐT hoặc tên; khách lần đầu thì tạo hồ sơ mới." onClose={close}
    footer={<><Btn onClick={close}>Hủy</Btn><Btn kind="primary" disabled={!patient || busy} onClick={submit}>{busy ? 'Đang lưu…' : 'Xác nhận đón'}</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <PatientPicker value={patient} onPick={setPatient} autoFocus />
    {patient && <div className="cl-form-grid" style={{ marginTop: 16 }}>
      <Field label="Loại lượt khám"><select value={type} onChange={(e) => setType(e.target.value)}>
        <option value="new">Khám mới / tư vấn</option><option value="follow_up">Tái khám</option><option value="procedure">Thủ thuật</option><option value="session">Buổi liệu trình</option></select></Field>
      <Field label="Bác sĩ (nếu khách muốn gặp)"><DoctorSelect doctors={doctors} value={doctor} onChange={setDoctor} /></Field>
      {plans.length > 0 && <Field label="Liệu trình / buổi thực hiện" span="2"><select value={sessionId} onChange={(e) => { setSessionId(e.target.value); if (e.target.value) setType('session'); }}>
        <option value="">— Không chọn buổi liệu trình —</option>
        {plans.flatMap((plan) => (plan.sessions || []).filter((s) => s.status === 'pending').map((s) => <option key={s.id} value={s.id}>{plan.title} · Buổi {s.number}/{plan.total_sessions}</option>))}
      </select></Field>}
      <Field label="Lý do đến khám" span="2"><input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="VD: nổi mụn viêm vùng má, ngứa…" /></Field>
    </div>}
  </Modal>;
}

function CallModal({ visit, doctors, role, userId, onClose, onDone }) {
  const [doctor, setDoctor] = useState('');
  const [room, setRoom] = useState('');
  const [err, setErr] = useState('');
  const rooms = useLoad(async () => (await api.get('/clinic/rooms/board/')).data, [visit?.id]);
  const open = !!visit;
  const assignOnly = visit?.assignOnly;
  const submit = async () => {
    setErr('');
    try {
      if (assignOnly) await api.post(`/clinic/visits/${visit.id}/assign/`, { doctor });
      else await api.post(`/clinic/visits/${visit.id}/call/`, { doctor: doctor || (role === 'doctor' ? userId : null), room: room || null });
      onDone(assignOnly ? 'Đã chỉ định bác sĩ.' : `Đã mời ${visit.patient_detail.full_name} vào tư vấn.`);
      setDoctor(''); setRoom('');
    } catch (e) { setErr(errMsg(e)); }
  };
  return <Modal open={open} title={assignOnly ? 'Chỉ định bác sĩ' : 'Mời vào tư vấn / khám'}
    subtitle={visit ? `${visit.patient_detail.full_name} · ${visit.visit_type_label}` : ''} onClose={() => { setErr(''); onClose(); }}
    footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={assignOnly && !doctor} onClick={submit}>{assignOnly ? 'Chỉ định' : 'Mời vào'}</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <Field label="Bác sĩ phụ trách" hint={assignOnly ? '' : 'Có thể để trống nếu nhân viên tư vấn trước, chỉ định bác sĩ sau.'}>
      <DoctorSelect doctors={doctors} value={doctor || visit?.doctor || ''} onChange={setDoctor} allowNone={!assignOnly} /></Field>
    {!assignOnly && <div style={{ marginTop: 14 }}><Field label="Phòng / ghế" hint="Phòng đang có khách sẽ không chọn được.">
      <select value={room} onChange={(e) => setRoom(e.target.value)}><option value="">— Chưa chọn phòng —</option>
        {(rooms.data || []).map((r) => <option key={r.id} value={r.id} disabled={!!r.visit}>{r.name} ({r.kind_label}){r.visit ? ` — đang có ${r.visit.patient}` : ''}</option>)}</select></Field></div>}
    {visit?.patient_detail?.allergies && <p className="cl-allergy" style={{ marginTop: 12 }}><WarningAmberRounded />Dị ứng: {visit.patient_detail.allergies}</p>}
  </Modal>;
}
