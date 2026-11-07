import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import DrawRounded from '@mui/icons-material/DrawRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import BodyMap from './BodyMap';
import RecordModal, { RecordBody, printRecord } from './RecordView';
import { PlanCard, PlanFormModal } from './Plans';
import { PrescriptionCard } from './Prescription';
import { Avatar, Btn, Card, Field, Loading, Pill, errMsg, fmtDate, fmtTime, genderText, useDebounce, useLoad, useToast } from './ui';

function IcdPicker({ onPick, placeholder }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const dq = useDebounce(q, 200);
  useEffect(() => { if (open) api.get('/clinic/icd10/', { params: { q: dq.trim() } }).then(({ data }) => setRows(data)).catch(() => setRows([])); }, [dq, open]);
  return <div className="cl-icd">
    <input value={q} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)} />
    {open && <div className="cl-icd-pop">{rows.map((r) => <button key={r.id} onMouseDown={() => { onPick(r); setQ(''); setOpen(false); }}><b>{r.code}</b><span>{r.name}</span></button>)}
      {!rows.length && <div className="cl-picker-empty">Không có mã phù hợp — có thể nhập chẩn đoán tự do.</div>}</div>}
  </div>;
}

const LABEL = { chief_complaint: 'Lý do khám', history_present: 'Bệnh sử', previous_treatment: 'Đã điều trị trước đó', examination: 'Khám lâm sàng' };

export default function ExamPage() {
  const { visitId } = useParams();
  const { user } = useAuth();
  const nav = useNavigate();
  const [toast, toastNode] = useToast();
  const [visit, setVisit] = useState(null);
  const [rec, setRec] = useState(null);
  const [err, setErr] = useState('');
  const [saved, setSaved] = useState('');
  const [dirty, setDirty] = useState(false);
  const [selRegion, setSelRegion] = useState(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [past, setPast] = useState(null);
  const [addendum, setAddendum] = useState('');
  const meta = useLoad(async () => (await api.get('/clinic/meta/')).data, []);
  const patientRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const v = (await api.get(`/clinic/visits/${visitId}/`)).data;
        setVisit(v);
        const r = (await api.post(`/clinic/visits/${visitId}/record/`)).data;
        setRec(r);
      } catch (e) { setErr(errMsg(e)); }
    })();
  }, [visitId]);
  const pid = visit?.patient;
  const patient = useLoad(async () => (pid ? (await api.get(`/clinic/patients/${pid}/`)).data : null), [pid]);
  const plans = useLoad(async () => (pid ? (await api.get('/clinic/plans/', { params: { patient: pid, status: 'active,draft' } })).data : []), [pid]);
  const history = useLoad(async () => (pid ? (await api.get(`/clinic/patients/${pid}/history/`)).data : []), [pid]);
  patientRef.current = patient.data;

  const locked = rec?.locked;
  const set = (k, v) => { setRec((r) => ({ ...r, [k]: v })); setDirty(true); };
  const payload = (r) => ({ chief_complaint: r.chief_complaint, history_present: r.history_present, previous_treatment: r.previous_treatment, examination: r.examination,
    diagnosis_code: r.diagnosis_code, diagnosis_name: r.diagnosis_name, secondary_diagnoses: r.secondary_diagnoses, differential: r.differential,
    treatment_direction: r.treatment_direction, advice: r.advice, follow_up_date: r.follow_up_date || null,
    marks: (r.marks || []).map(({ region, lesion_type, severity, note }) => ({ region, lesion_type, severity, note: note || '' })) });
  const save = async (silent) => {
    if (!rec || locked) return true;
    try { await api.patch(`/clinic/records/${rec.id}/`, payload(rec)); setDirty(false); setSaved(`Đã lưu lúc ${fmtTime(new Date())}`); if (!silent) toast('Đã lưu bản nháp.'); return true; }
    catch (e) { setSaved(''); toast(errMsg(e), 'err'); return false; }
  };
  const dRec = useDebounce(rec, 1500);
  useEffect(() => { if (dirty && dRec && !locked) save(true); }, [dRec]); // eslint-disable-line react-hooks/exhaustive-deps

  const sign = async () => {
    if (!window.confirm('Ký và khóa bệnh án? Sau khi ký chỉ có thể bổ sung phụ lục.')) return;
    if (!(await save(true))) return;
    try { const { data } = await api.post(`/clinic/records/${rec.id}/sign/`); setRec(data); toast('Đã ký bệnh án.'); history.reload(true); }
    catch (e) { toast(errMsg(e), 'err'); }
  };
  const finish = async () => {
    try { await api.post(`/clinic/visits/${visitId}/complete/`); toast('Đã kết thúc lượt khám.'); setTimeout(() => nav('/tiep-don'), 700); }
    catch (e) { toast(errMsg(e), 'err'); }
  };
  const sendAddendum = async () => {
    try { const { data } = await api.post(`/clinic/records/${rec.id}/addendum/`, { content: addendum }); setRec(data); setAddendum(''); toast('Đã thêm phụ lục.'); }
    catch (e) { toast(errMsg(e), 'err'); }
  };

  // sơ đồ tổn thương
  const marks = rec?.marks || [];
  const regions = meta.data?.regions || [];
  const lesionTypes = meta.data?.lesion_types || [];
  const regionLabel = (k) => regions.find((r) => r.key === k)?.label || k;
  const addMark = () => { set('marks', [...marks, { id: `n${Date.now()}`, region: selRegion, lesion_type: 'papule', severity: 1, note: '', region_label: regionLabel(selRegion) }]); };
  const updMark = (id, patch) => set('marks', marks.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  const delMark = (id) => set('marks', marks.filter((m) => m.id !== id));

  if (err) return <><Link to="/tiep-don" className="cl-back"><ArrowBackRounded />Quay lại</Link><div className="cl-alert error">{err}</div></>;
  if (!rec || !visit) return <Loading text="Đang mở bệnh án…" />;
  const p = patient.data;
  const prev = (history.data || []).filter((v) => v.record && String(v.id) !== String(visitId));

  return <div className="cl-exam">
    <div className="cl-exam-top">
      <Link to="/tiep-don" className="cl-back"><ArrowBackRounded />Ca khám hôm nay</Link>
      <div className="cl-exam-title"><Avatar name={visit.patient_detail.full_name} size={46} />
        <div><h1>{visit.patient_detail.full_name}</h1>
          <p>{genderText(visit.patient_detail.gender)}{visit.patient_detail.age != null ? ` · ${visit.patient_detail.age} tuổi` : ''} · {visit.patient_detail.code} · {visit.visit_type_label} · Đến lúc {fmtTime(visit.check_in_at)}</p></div>
        <Pill tone={locked ? 'green' : 'amber'} dot>{locked ? 'Đã ký' : 'Đang soạn'}</Pill></div>
    </div>
    {visit.patient_detail.allergies && <div className="cl-alert warn"><WarningAmberRounded /><span><b>Dị ứng:</b> {visit.patient_detail.allergies}</span></div>}
    <div className="cl-exam-body">
      <aside className="cl-exam-side">
        <Card title="Tóm tắt bệnh nhân">
          {p ? <dl className="cl-kvs compact">
            <div className="cl-kv"><dt>Phân loại da</dt><dd>{p.skin_type ? `Fitzpatrick ${p.skin_type}` : '—'}</dd></div>
            <div className="cl-kv"><dt>Bệnh nền</dt><dd>{p.chronic_conditions || '—'}</dd></div>
            <div className="cl-kv"><dt>Thuốc đang dùng</dt><dd>{p.current_medications || '—'}</dd></div>
            <div className="cl-kv"><dt>Tiền sử bệnh da</dt><dd>{p.skin_history || '—'}</dd></div>
            <div className="cl-kv"><dt>Gia đình</dt><dd>{p.family_history || '—'}</dd></div>
            <div className="cl-kv"><dt>Thai kỳ</dt><dd>{p.pregnancy_status || '—'}</dd></div>
          </dl> : <Loading />}
          <Link className="cl-link" to={`/benh-nhan/${pid}`}>Mở hồ sơ đầy đủ →</Link>
        </Card>
        <Card title="Các lần khám trước" subtitle={`${prev.length} lần`}>
          {prev.length ? prev.slice(0, 6).map((v) => <button key={v.id} className="cl-prev" onClick={() => setPast(v.record.id)}>
            <strong>{fmtDate(v.check_in_at)}</strong><span>{v.record.diagnosis_code} {v.record.diagnosis_name || 'Chưa có chẩn đoán'}</span></button>) : <small className="cl-muted">Bệnh nhân khám lần đầu.</small>}
        </Card>
        <Card title="Liệu trình của khách" subtitle="Mở và ghi nhận buổi ngay trong ca khám">
          {(plans.data?.results || plans.data || []).length
            ? <div className="cl-plan-stack">{(plans.data?.results || plans.data || []).map((plan) => <PlanCard key={plan.id} plan={plan}
              canEdit={false} canPerform={user?.role === 'doctor'} onChange={() => plans.reload(true)} />)}</div>
            : <><p className="cl-muted">Khách chưa có liệu trình đang thực hiện.</p><Btn size="sm" icon={<AddRounded />} onClick={async () => { if (!locked && !(await save(true))) return; setPlanOpen(true); }}>Tạo liệu trình mới</Btn></>}
        </Card>
      </aside>

      <div className="cl-exam-main">
        <Card title="1 · Lý do & bệnh sử">
          <div className="cl-form-grid">
            {['chief_complaint', 'history_present', 'previous_treatment'].map((k) => <Field key={k} label={LABEL[k]} span="2">
              <textarea rows={k === 'chief_complaint' ? 2 : 3} value={rec[k] || ''} disabled={locked} onChange={(e) => set(k, e.target.value)}
                placeholder={k === 'history_present' ? 'Khởi phát khi nào, diễn tiến, triệu chứng kèm theo (ngứa, đau, rát), yếu tố làm nặng/giảm…' : ''} /></Field>)}
          </div>
        </Card>

        <Card title="2 · Khám lâm sàng & sơ đồ tổn thương" subtitle="Chọn vùng da trên sơ đồ để ghi nhận tổn thương.">
          <Field label={LABEL.examination}><textarea rows={3} value={rec.examination || ''} disabled={locked} onChange={(e) => set('examination', e.target.value)} placeholder="Mô tả tổn thương cơ bản: dát, sẩn, mụn mủ, mảng, vảy…, vị trí, kích thước, ranh giới, màu sắc" /></Field>
          <div className="cl-map-wrap">
            <BodyMap marks={marks} selected={selRegion} onSelect={setSelRegion} regionsMeta={regions} readOnly={locked} />
            <div className="cl-map-panel">
              {!locked && <div className="cl-map-add">{selRegion
                ? <><div><small>Vùng đang chọn</small><strong>{regionLabel(selRegion)}</strong></div><Btn kind="primary" size="sm" icon={<AddRounded />} onClick={addMark}>Ghi nhận tổn thương</Btn></>
                : <small className="cl-muted">Bấm vào một vùng trên sơ đồ để bắt đầu.</small>}</div>}
              <ul className="cl-marks">{marks.map((m) => <li key={m.id}>
                <b>{m.region_label || regionLabel(m.region)}</b>
                <select value={m.lesion_type} disabled={locked} onChange={(e) => updMark(m.id, { lesion_type: e.target.value })}>{lesionTypes.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</select>
                <select value={m.severity} disabled={locked} onChange={(e) => updMark(m.id, { severity: Number(e.target.value) })}><option value={1}>Nhẹ</option><option value={2}>Vừa</option><option value={3}>Nặng</option></select>
                <input value={m.note || ''} disabled={locked} placeholder="Mô tả ngắn" onChange={(e) => updMark(m.id, { note: e.target.value })} />
                {!locked && <button className="cl-icon-btn" aria-label="Xóa" onClick={() => delMark(m.id)}><DeleteOutlineRounded /></button>}</li>)}
                {!marks.length && <small className="cl-muted">Chưa ghi nhận tổn thương nào.</small>}</ul>
            </div>
          </div>
        </Card>

        <Card title="3 · Chẩn đoán (ICD-10)">
          <div className="cl-form-grid">
            <Field label="Chẩn đoán chính" span="2">
              {rec.diagnosis_name || rec.diagnosis_code
                ? <div className="cl-dx"><b>{rec.diagnosis_code}</b><input value={rec.diagnosis_name || ''} disabled={locked} onChange={(e) => set('diagnosis_name', e.target.value)} />
                  {!locked && <button className="cl-link danger" onClick={() => { set('diagnosis_code', ''); set('diagnosis_name', ''); }}>Xóa</button>}</div>
                : <IcdPicker placeholder="Gõ mã hoặc tên bệnh: L70, mụn trứng cá, nám…" onPick={(r) => { set('diagnosis_code', r.code); set('diagnosis_name', r.name); }} />}
            </Field>
            {!locked && !rec.diagnosis_name && <Field label="…hoặc nhập chẩn đoán tự do" span="2"><input onBlur={(e) => e.target.value && set('diagnosis_name', e.target.value)} placeholder="Nhập rồi bấm ra ngoài để lưu" /></Field>}
            <Field label="Chẩn đoán kèm theo" span="2">
              <div className="cl-chips">{(rec.secondary_diagnoses || []).map((d, i) => <span key={i} className="cl-chip"><b>{d.code}</b> {d.name}
                {!locked && <button onClick={() => set('secondary_diagnoses', rec.secondary_diagnoses.filter((_, j) => j !== i))} aria-label="Xóa">×</button>}</span>)}</div>
              {!locked && <IcdPicker placeholder="Thêm chẩn đoán kèm theo…" onPick={(r) => set('secondary_diagnoses', [...(rec.secondary_diagnoses || []), { code: r.code, name: r.name }])} />}
            </Field>
            <Field label="Chẩn đoán phân biệt" span="2"><textarea rows={2} value={rec.differential || ''} disabled={locked} onChange={(e) => set('differential', e.target.value)} /></Field>
          </div>
        </Card>

        <Card title="4 · Hướng điều trị & dặn dò">
          <div className="cl-form-grid">
            <Field label="Hướng điều trị" span="2"><textarea rows={3} value={rec.treatment_direction || ''} disabled={locked} onChange={(e) => set('treatment_direction', e.target.value)} /></Field>
            <Field label="Dặn dò bệnh nhân" span="2"><textarea rows={3} value={rec.advice || ''} disabled={locked} onChange={(e) => set('advice', e.target.value)} /></Field>
            <Field label="Hẹn tái khám"><input type="date" value={rec.follow_up_date || ''} disabled={locked} onChange={(e) => set('follow_up_date', e.target.value)} /></Field>
          </div>
          <div className="cl-actions-row"><Btn icon={<AddRounded />} onClick={async () => { if (!locked && !(await save(true))) return; setPlanOpen(true); }}>Tạo liệu trình điều trị</Btn>
            <small className="cl-muted">Liệu trình sẽ lấy chẩn đoán và hướng điều trị ở trên làm gợi ý.</small></div>
        </Card>

        <PrescriptionCard visit={visit} patient={p} onToast={toast} />

        {locked && <Card title="Bổ sung sau khi ký">
          {(rec.addenda || []).map((a) => <p key={a.id} className="cl-addendum"><b>{a.author_name}</b> · {fmtDate(a.created_at)} {fmtTime(a.created_at)}<br />{a.content}</p>)}
          <div className="cl-addendum-form"><textarea rows={2} value={addendum} onChange={(e) => setAddendum(e.target.value)} placeholder="Thêm ghi chú bổ sung (không thay đổi nội dung đã ký)" />
            <Btn disabled={!addendum.trim()} onClick={sendAddendum}>Thêm phụ lục</Btn></div>
        </Card>}
      </div>
    </div>

    <footer className="cl-exam-bar">
      <span className="cl-muted">{locked ? `Đã ký · ${rec.signature_hash.slice(0, 12)}…` : saved || (dirty ? 'Có thay đổi chưa lưu…' : 'Tự động lưu bản nháp')}</span>
      <div>
        {locked && <Btn onClick={() => printRecord(rec, p)}>In bệnh án</Btn>}
        {!locked && <Btn onClick={() => save(false)}>Lưu nháp</Btn>}
        {!locked && <Btn kind="primary" icon={<DrawRounded />} onClick={sign}>Ký & khóa bệnh án</Btn>}
        {visit.status !== 'completed' && <Btn kind={locked ? 'primary' : 'secondary'} disabled={!locked} onClick={finish} title={locked ? '' : 'Cần ký bệnh án trước'}>Kết thúc lượt khám</Btn>}
      </div>
    </footer>
    <PlanFormModal open={planOpen} patient={p || { id: pid, full_name: visit.patient_detail.full_name }} record={rec} onClose={() => setPlanOpen(false)} onSaved={() => { setPlanOpen(false); toast('Đã tạo liệu trình (chưa xác nhận) — xem trong hồ sơ bệnh nhân.'); }} />
    <RecordModal recordId={past} patient={p} regions={regions} onClose={() => setPast(null)} />
    {toastNode}
  </div>;
}
