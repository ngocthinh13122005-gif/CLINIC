import { PrescriptionsTab } from './Prescription';
import { ConsentsTab } from './Consents';
import { InvoicesTab } from './Billing';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import AddRounded from '@mui/icons-material/AddRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import CompareRounded from '@mui/icons-material/CompareRounded';
import CloudUploadRounded from '@mui/icons-material/CloudUploadRounded';
import BrokenImageRounded from '@mui/icons-material/BrokenImageRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PatientFormModal } from './PatientForm';
import SmartFilterBar from './SmartFilterBar';
import { PlanCard, PlanFormModal } from './Plans';
import RecordModal from './RecordView';
import { Avatar, Btn, Card, Empty, Field, Loading, Modal, PageHead, Pill, errMsg, fmtDate, fmtDateTime, genderText, isoDay, useDebounce, useLoad, useToast, visitTone } from './ui';

export function PatientsPage() {
  const { user } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState('');
  const [gender, setGender] = useState('');
  const [activity, setActivity] = useState('');
  const [allergy, setAllergy] = useState('');
  const [ageBand, setAgeBand] = useState('');
  const [groupBy, setGroupBy] = useState('');
  const dq = useDebounce(q, 300);
  const [adding, setAdding] = useState(false);
  const [total, setTotal] = useState(0);
  const { data, loading, error } = useLoad(async () => {
    const r = await api.get('/clinic/patients/', { params: { q: dq.trim(), gender: gender || undefined, activity: activity || undefined, allergy: allergy || undefined, age_band: ageBand || undefined, limit: 300 } });
    setTotal(Number(r.headers['x-total-count'] || r.data.length));
    return r.data;
  }, [dq, gender, activity, allergy, ageBand]);
  const rows = data || [];
  const grouped = useMemo(() => {
    if (!groupBy) return [['', rows]];
    const groups = new Map();
    rows.forEach((p) => {
      let key = 'Chưa xác định';
      if (groupBy === 'gender') key = genderText(p.gender) || key;
      if (groupBy === 'activity') key = p.visit_count ? 'Đã từng khám' : 'Chưa có lượt khám';
      if (groupBy === 'referral') key = p.referral_source || 'Không ghi nhận nguồn';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    });
    return [...groups.entries()];
  }, [rows, groupBy]);
  const filters = [
    { key: 'gender', label: 'Giới tính', value: gender, onChange: setGender, options: [{ value: 'female', label: 'Nữ' }, { value: 'male', label: 'Nam' }, { value: 'other', label: 'Khác' }] },
    { key: 'activity', label: 'Lịch sử khám', value: activity, onChange: setActivity, options: [{ value: 'visited', label: 'Đã từng khám' }, { value: 'new', label: 'Chưa có lượt khám' }, { value: 'recent', label: 'Khám trong 30 ngày' }] },
    { key: 'allergy', label: 'Cảnh báo', value: allergy, onChange: setAllergy, options: [{ value: 'yes', label: 'Có ghi nhận dị ứng' }, { value: 'no', label: 'Không ghi nhận dị ứng' }] },
    { key: 'age_band', label: 'Độ tuổi', value: ageBand, onChange: setAgeBand, options: [{ value: 'under18', label: 'Dưới 18' }, { value: '18_30', label: '18–30' }, { value: '31_50', label: '31–50' }, { value: 'over50', label: 'Trên 50' }] },
  ];
  const applyFavorite = (state) => { setQ(state.search || ''); setGender(state.filters?.gender || ''); setActivity(state.filters?.activity || ''); setAllergy(state.filters?.allergy || ''); setAgeBand(state.filters?.age_band || ''); setGroupBy(state.groupBy || ''); };
  const canAdd = ['consultant', 'manager', 'doctor'].includes(user.role);
  return <>
    <PageHead title="Bệnh nhân" subtitle={`${total} hồ sơ đang quản lý`} actions={canAdd && <Btn kind="primary" icon={<AddRounded />} onClick={() => setAdding(true)}>Thêm bệnh nhân</Btn>} />
    <Card pad={false}>
      <SmartFilterBar id="patients" search={q} onSearch={setQ} placeholder="Tìm theo tên, số điện thoại, CCCD hoặc mã hồ sơ…" filters={filters} groupBy={groupBy} onGroupBy={setGroupBy}
        groupOptions={[{ value: 'gender', label: 'Giới tính' }, { value: 'activity', label: 'Lịch sử khám' }, { value: 'referral', label: 'Nguồn khách hàng' }]} onApplyFavorite={applyFavorite}/>
      {error && <div className="cl-alert error" style={{ margin: 16 }}>{error}</div>}
      {loading && !data ? <Loading /> : !rows.length ? <Empty title={q ? 'Không tìm thấy bệnh nhân' : 'Chưa có bệnh nhân'} hint={q ? 'Thử tìm bằng số điện thoại hoặc mã hồ sơ.' : 'Bắt đầu bằng việc thêm bệnh nhân đầu tiên.'} /> :
        <div className="cl-table-wrap"><table className="cl-table">
          <thead><tr><th>Bệnh nhân</th><th>Mã hồ sơ</th><th>Điện thoại</th><th>Lượt khám</th><th>Lần khám gần nhất</th><th>Lưu ý</th></tr></thead>
          <tbody>{grouped.map(([label, items]) => <Fragment key={label || 'all'}>{label && <tr className="sf-group-row"><td colSpan="6"><strong>{label}</strong><span>{items.length}</span></td></tr>}{items.map((p) => <tr key={p.id} onClick={() => nav(`/benh-nhan/${p.id}`)} className="click">
            <td><div className="cl-person"><Avatar name={p.full_name} /><div><strong>{p.full_name}</strong><small>{genderText(p.gender)}{p.age != null ? `, ${p.age} tuổi` : ''}</small></div></div></td>
            <td><code>{p.code}</code></td><td>{p.phone}</td><td>{p.visit_count}</td><td>{p.last_visit ? fmtDate(p.last_visit) : '—'}</td>
            <td>{p.allergies ? <Pill tone="red"><WarningAmberRounded sx={{ fontSize: 13 }} /> Dị ứng</Pill> : <span className="cl-muted">—</span>}</td></tr>)}</Fragment>)}</tbody></table></div>}
    </Card>
    <PatientFormModal open={adding} onClose={() => setAdding(false)} onSaved={(p) => { setAdding(false); nav(`/benh-nhan/${p.id}`); }} />
  </>;
}

const Row = ({ k, v }) => <div className="cl-kv"><dt>{k}</dt><dd>{v || <span className="cl-muted">—</span>}</dd></div>;

export function PatientProfilePage() {
  const { id } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const role = user.role;
  const clinical = ['doctor', 'manager'].includes(role);
  const [tab, setTab] = useState('info');
  const [editing, setEditing] = useState(false);
  const [toast, toastNode] = useToast();
  const p = useLoad(async () => (await api.get(`/clinic/patients/${id}/`)).data, [id]);
  const sum = useLoad(async () => (await api.get(`/clinic/patients/${id}/summary/`)).data, [id]);
  const meta = useLoad(async () => (await api.get('/clinic/meta/')).data, []);
  const patient = p.data;
  if (p.error && !patient) return <div className="cl-alert error">{p.error}</div>;
  if (!patient) return <Loading />;
  const s = sum.data;
  const tabs = [['info', 'Thông tin'], ...(clinical ? [['history', 'Tiền sử']] : []), ['visits', clinical ? 'Lượt khám & bệnh án' : 'Lượt khám'], ['plans', 'Liệu trình'], ...(clinical ? [['rx', 'Đơn thuốc']] : []), ...(['manager', 'consultant', 'doctor'].includes(role) ? [['bill', 'Hóa đơn']] : []), ...(clinical ? [['images', 'Hình ảnh']] : []), ['consent', 'Cam kết']];
  const checkIn = async () => { try { await api.post('/clinic/visits/', { patient: patient.id, visit_type: 'new' }); toast('Đã đón bệnh nhân — đang chờ ở sảnh.'); sum.reload(true); } catch (e) { toast(errMsg(e), 'err'); } };
  const canReception = ['consultant', 'manager', 'doctor'].includes(role);
  return <>
    <Link to="/benh-nhan" className="cl-back"><ArrowBackRounded />Danh sách bệnh nhân</Link>
    <section className="cl-pt-head">
      <Avatar name={patient.full_name} size={64} />
      <div className="cl-pt-id">
        <span className="cl-code">{patient.code}</span>
        <h1>{patient.full_name}</h1>
        <p>{genderText(patient.gender)}{patient.age != null ? ` · ${patient.age} tuổi` : ''} · {patient.phone}{patient.skin_type ? ` · Da Fitzpatrick ${patient.skin_type}` : ''}</p>
        {patient.allergies && <span className="cl-allergy big"><WarningAmberRounded />Dị ứng: {patient.allergies}</span>}
      </div>
      <div className="cl-pt-stats">
        <div><span>Lượt khám</span><strong>{s?.visit_count ?? '—'}</strong></div>
        <div><span>Khám gần nhất</span><strong>{s?.last_visit ? fmtDate(s.last_visit) : '—'}</strong></div>
        <div><span>Liệu trình đang chạy</span><strong>{s?.active_plans?.length ?? '—'}</strong></div>
        <div><span>Lịch hẹn sắp tới</span><strong>{s?.upcoming?.length ?? '—'}</strong></div>
      </div>
      <div className="cl-pt-actions">
        {s?.active_visit ? (role === 'doctor' && s.active_visit.status === 'in_consult'
          ? <Link className="cl-btn primary" to={`/kham/${s.active_visit.id}`}><PlayArrowRounded />Vào khám</Link>
          : <Pill tone={visitTone[s.active_visit.status]} dot>{s.active_visit.status_label}</Pill>)
          : canReception && <Btn kind="primary" icon={<AddRounded />} onClick={checkIn}>Đón khách</Btn>}
        {canReception && <Btn icon={<EditRounded />} onClick={() => setEditing(true)}>Sửa hồ sơ</Btn>}
      </div>
    </section>
    <nav className="cl-tabs" role="tablist">{tabs.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}</nav>
    {tab === 'info' && <div className="cl-two">
      <Card title="Thông tin hành chính"><dl className="cl-kvs">
        <Row k="Họ và tên" v={patient.full_name} /><Row k="Giới tính" v={genderText(patient.gender)} /><Row k="Ngày sinh" v={patient.date_of_birth && fmtDate(patient.date_of_birth)} />
        <Row k="Điện thoại" v={patient.phone} /><Row k="Email" v={patient.email} /><Row k="CCCD / CMND" v={patient.national_id} />
        <Row k="Nghề nghiệp" v={patient.occupation} /><Row k="Địa chỉ" v={patient.address} /><Row k="Nguồn biết đến" v={patient.referral_source} />
        <Row k="Liên hệ khi cần" v={patient.emergency_contact} /><Row k="Ngày tạo hồ sơ" v={fmtDate(patient.created_at)} /></dl></Card>
      <Card title="Lịch hẹn sắp tới">{s?.upcoming?.length ? s.upcoming.map((b) => <div className="cl-li" key={b.id}><strong>{fmtDateTime(b.appointment)}</strong><small>{b.type}{b.doctor ? ` · ${b.doctor}` : ''}</small></div>)
        : <Empty title="Không có lịch hẹn" hint="Đặt lịch từ trang Lịch hẹn." />}</Card>
    </div>}
    {tab === 'history' && clinical && <HistoryTab patient={patient} meta={meta.data} onSaved={() => { p.reload(true); toast('Đã lưu tiền sử.'); }} />}
    {tab === 'visits' && <VisitsTab patientId={id} patient={patient} clinical={clinical} regions={meta.data?.regions || []} />}
    {tab === 'plans' && <PlansTab patient={patient} role={role} onChanged={() => sum.reload(true)} />}
    {tab === 'rx' && clinical && <PrescriptionsTab patient={patient} />}
    {tab === 'bill' && <InvoicesTab patient={patient} canBill={['manager', 'consultant'].includes(role)} />}
    {tab === 'consent' && <ConsentsTab patient={patient} canSign={['manager', 'consultant', 'doctor'].includes(role)} />}
    {tab === 'images' && clinical && <ImagesTab patient={patient} regions={meta.data?.regions || []} canUpload={role === 'doctor'} />}
    <PatientFormModal open={editing} patient={patient} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); p.reload(true); toast('Đã cập nhật hồ sơ.'); }} />
    {toastNode}
  </>;
}

function HistoryTab({ patient, meta, onSaved }) {
  const { user } = useAuth();
  const [f, setF] = useState({});
  const [err, setErr] = useState('');
  const canEdit = user.role === 'doctor' || user.role === 'manager';
  useEffect(() => setF({ ...patient }), [patient]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => {
    try { const b = {}; ['skin_type', 'allergies', 'chronic_conditions', 'current_medications', 'family_history', 'skin_history', 'pregnancy_status', 'clinical_notes'].forEach((k) => { b[k] = f[k] || ''; }); await api.patch(`/clinic/patients/${patient.id}/`, b); onSaved(); }
    catch (e) { setErr(errMsg(e)); }
  };
  return <Card title="Tiền sử & thông tin chuyên môn" subtitle="Chỉ bác sĩ và quản lý xem được phần này." action={canEdit && <Btn kind="primary" onClick={save}>Lưu thay đổi</Btn>}>
    {err && <div className="cl-alert error">{err}</div>}
    <div className="cl-form-grid">
      <Field label="Phân loại da (Fitzpatrick)"><select value={f.skin_type || ''} onChange={set('skin_type')} disabled={!canEdit}><option value="">— Chưa đánh giá —</option>{(meta?.fitzpatrick || []).map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}</select></Field>
      <Field label="Thai kỳ / cho con bú"><input value={f.pregnancy_status || ''} onChange={set('pregnancy_status')} disabled={!canEdit} placeholder="VD: Không / Đang mang thai 12 tuần" /></Field>
      <Field label="Dị ứng" span="2"><textarea rows={2} value={f.allergies || ''} onChange={set('allergies')} disabled={!canEdit} /></Field>
      <Field label="Bệnh nền / bệnh mạn tính"><textarea rows={3} value={f.chronic_conditions || ''} onChange={set('chronic_conditions')} disabled={!canEdit} /></Field>
      <Field label="Thuốc đang dùng"><textarea rows={3} value={f.current_medications || ''} onChange={set('current_medications')} disabled={!canEdit} /></Field>
      <Field label="Tiền sử bệnh da"><textarea rows={3} value={f.skin_history || ''} onChange={set('skin_history')} disabled={!canEdit} /></Field>
      <Field label="Tiền sử gia đình"><textarea rows={3} value={f.family_history || ''} onChange={set('family_history')} disabled={!canEdit} /></Field>
      <Field label="Ghi chú chuyên môn" span="2"><textarea rows={3} value={f.clinical_notes || ''} onChange={set('clinical_notes')} disabled={!canEdit} /></Field>
    </div></Card>;
}

function VisitsTab({ patientId, patient, clinical, regions }) {
  const { data, loading } = useLoad(async () => (await api.get(`/clinic/patients/${patientId}/history/`)).data, [patientId]);
  const [open, setOpen] = useState(null);
  if (loading && !data) return <Loading />;
  const rows = data || [];
  if (!rows.length) return <Card><Empty title="Chưa có lượt khám" hint="Lượt khám sẽ xuất hiện sau khi bệnh nhân được đón tại phòng khám." /></Card>;
  return <div className="cl-timeline">{rows.map((v) => <article key={v.id} className="cl-tl-item">
    <div className="cl-tl-dot" />
    <div className="cl-tl-card">
      <header><strong>{fmtDateTime(v.check_in_at)}</strong><span><Pill tone={visitTone[v.status]}>{v.status_label}</Pill> <Pill>{v.visit_type_label}</Pill></span></header>
      <p className="cl-muted">{v.doctor_name ? `BS. ${v.doctor_name.replace(/^BS\.?\s*/i, '')}` : 'Chưa phân công bác sĩ'}{v.reason ? ` · ${v.reason}` : ''}</p>
      {clinical && v.record && <div className="cl-tl-dx"><div><b>{v.record.diagnosis_code}</b> {v.record.diagnosis_name || <em>Chưa có chẩn đoán</em>}
        {v.record.status === 'draft' && <Pill tone="amber">Nháp</Pill>}</div>
        <Btn size="sm" onClick={() => setOpen(v.record.id)}>Xem bệnh án</Btn></div>}
    </div></article>)}
    <RecordModal recordId={open} patient={patient} regions={regions} onClose={() => setOpen(null)} />
  </div>;
}

function PlansTab({ patient, role, onChanged }) {
  const { data, loading, reload } = useLoad(async () => (await api.get('/clinic/plans/', { params: { patient: patient.id } })).data, [patient.id]);
  const [creating, setCreating] = useState(false);
  const rows = data?.results || data || [];
  return <>
    {role === 'doctor' && <div className="cl-actions-row"><Btn kind="primary" icon={<AddRounded />} onClick={() => setCreating(true)}>Tạo liệu trình</Btn></div>}
    {loading && !data ? <Loading /> : !rows.length ? <Card><Empty title="Chưa có liệu trình" hint="Bác sĩ tạo liệu trình sau khi chẩn đoán." /></Card> :
      <div className="cl-plan-grid">{rows.map((pl) => <PlanCard key={pl.id} plan={pl} canEdit={role === 'doctor'} canPerform={['doctor', 'staff'].includes(role)} onChange={() => { reload(true); onChanged?.(); }} />)}</div>}
    <PlanFormModal open={creating} patient={patient} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); reload(true); onChanged?.(); }} />
  </>;
}

function PatientImageCard({ image, selected, onPick, onView }) {
  const [broken, setBroken] = useState(false);
  return <figure className={selected ? 'picked' : ''}>
    {broken || !image.url
      ? <div className="cl-image-missing"><BrokenImageRounded /><span>Không tải được ảnh</span></div>
      : <img src={image.url} alt={image.caption || image.kind_label} loading="lazy" onError={() => setBroken(true)} onClick={() => onView(image)} />}
    <label className="cl-pick"><input type="checkbox" checked={selected} onChange={() => onPick(image)} /></label>
    <figcaption><Pill tone={image.kind === 'before' ? 'amber' : image.kind === 'after' ? 'green' : 'neutral'}>{image.kind_label}</Pill>{image.region_label && <small>{image.region_label}</small>}</figcaption>
  </figure>;
}

function ImagesTab({ patient, regions, canUpload }) {
  const { data, loading, reload } = useLoad(async () => (await api.get('/clinic/images/', { params: { patient: patient.id } })).data, [patient.id]);
  const [up, setUp] = useState(null);
  const [view, setView] = useState(null);
  const [picked, setPicked] = useState([]);
  const [compare, setCompare] = useState(false);
  const [err, setErr] = useState('');
  const rows = data || [];
  const groups = rows.reduce((m, i) => { (m[i.taken_at] = m[i.taken_at] || []).push(i); return m; }, {});
  const toggle = (img) => setPicked((p) => p.find((x) => x.id === img.id) ? p.filter((x) => x.id !== img.id) : [...p.slice(-1), img]);
  const upload = async () => {
    const fd = new FormData();
    fd.append('patient', patient.id); fd.append('image', up.file); fd.append('kind', up.kind); fd.append('taken_at', up.taken_at);
    if (up.region) fd.append('region', up.region); if (up.caption) fd.append('caption', up.caption);
    try { await api.post('/clinic/images/', fd); setUp(null); setErr(''); reload(true); } catch (e) { setErr(errMsg(e)); }
  };
  return <>
    <div className="cl-actions-row">
      {canUpload && <label className="cl-btn primary"><CloudUploadRounded />Tải ảnh lên<input type="file" accept="image/*" hidden onChange={(e) => e.target.files[0] && setUp({ file: e.target.files[0], kind: 'lesion', region: '', caption: '', taken_at: isoDay() })} /></label>}
      <Btn icon={<CompareRounded />} disabled={picked.length !== 2} onClick={() => setCompare(true)}>So sánh trước / sau {picked.length ? `(${picked.length}/2)` : ''}</Btn>
      <small className="cl-muted">Chọn 2 ảnh để đặt cạnh nhau.</small>
    </div>
    {loading && !data ? <Loading /> : !rows.length ? <Card><Empty title="Chưa có hình ảnh" hint="Bác sĩ có thể tải ảnh tổn thương để theo dõi diễn tiến." /></Card> :
      Object.entries(groups).map(([day, imgs]) => <section key={day} className="cl-gallery-day"><h3>{fmtDate(day)}</h3>
        <div className="cl-gallery">{imgs.map((i) => <PatientImageCard key={i.id} image={i} selected={!!picked.find((x) => x.id === i.id)} onPick={toggle} onView={setView} />)}</div></section>)}
    <Modal open={!!up} title="Tải ảnh lên" subtitle={up?.file?.name} onClose={() => setUp(null)} footer={<><Btn onClick={() => setUp(null)}>Hủy</Btn><Btn kind="primary" onClick={upload}>Lưu ảnh</Btn></>}>
      {err && <div className="cl-alert error">{err}</div>}
      {up && <div className="cl-form-grid">
        <Field label="Loại ảnh"><select value={up.kind} onChange={(e) => setUp({ ...up, kind: e.target.value })}><option value="lesion">Tổn thương</option><option value="before">Trước điều trị</option><option value="after">Sau điều trị</option><option value="other">Khác</option></select></Field>
        <Field label="Ngày chụp"><input type="date" value={up.taken_at} onChange={(e) => setUp({ ...up, taken_at: e.target.value })} /></Field>
        <Field label="Vùng da"><select value={up.region} onChange={(e) => setUp({ ...up, region: e.target.value })}><option value="">— Không chọn —</option>{regions.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></Field>
        <Field label="Chú thích"><input value={up.caption} onChange={(e) => setUp({ ...up, caption: e.target.value })} /></Field></div>}
    </Modal>
    <Modal open={!!view} wide title={view?.caption || view?.kind_label} subtitle={view && `${fmtDate(view.taken_at)}${view.region_label ? ' · ' + view.region_label : ''}`} onClose={() => setView(null)}>
      {view && <img className="cl-bigimg" src={view.url} alt="" />}</Modal>
    <Modal open={compare} wide title="So sánh hình ảnh" onClose={() => setCompare(false)}>
      <div className="cl-compare">{[...picked].sort((a, b) => a.taken_at.localeCompare(b.taken_at)).map((i) => <figure key={i.id}><img src={i.url} alt="" /><figcaption><b>{fmtDate(i.taken_at)}</b> · {i.kind_label}{i.region_label ? ` · ${i.region_label}` : ''}</figcaption></figure>)}</div></Modal>
  </>;
}
