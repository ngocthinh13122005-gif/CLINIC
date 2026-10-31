import { useEffect, useState } from 'react';
import SearchRounded from '@mui/icons-material/SearchRounded';
import PersonAddAltRounded from '@mui/icons-material/PersonAddAltRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Avatar, Btn, Field, Modal, errMsg, genderText, useDebounce } from './ui';

const EMPTY = { full_name: '', gender: 'female', date_of_birth: '', phone: '', email: '', national_id: '', address: '', occupation: '',
  referral_source: '', emergency_contact: '', allergies: '' };

export function PatientFormModal({ open, patient, onClose, onSaved, initial }) {
  const { user } = useAuth();
  const clinical = ['doctor', 'manager'].includes(user?.role);
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState('');
  const [existing, setExisting] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setF({ ...EMPTY, ...(patient || {}), ...(!patient ? initial : {}), date_of_birth: patient?.date_of_birth || '' }); setErr(''); setExisting(null); }
  }, [open, patient, initial]);
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }));
  const save = async () => {
    setBusy(true); setErr(''); setExisting(null);
    const body = { ...f, date_of_birth: f.date_of_birth || null };
    ['code', 'age', 'visit_count', 'last_visit', 'gender_label', 'created_at'].forEach((k) => delete body[k]);
    try {
      const { data } = patient ? await api.patch(`/clinic/patients/${patient.id}/`, body) : await api.post('/clinic/patients/', body);
      onSaved?.(data);
    } catch (e) {
      setErr(errMsg(e));
      if (e.response?.data?.existing_id) setExisting(e.response.data.existing_id);
    } finally { setBusy(false); }
  };
  return <Modal open={open} wide title={patient ? 'Cập nhật hồ sơ bệnh nhân' : 'Thêm bệnh nhân mới'} subtitle={patient ? `${patient.code}` : 'Nhập thông tin hành chính — phần bệnh sử sẽ do bác sĩ cập nhật khi khám.'} onClose={onClose}
    footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={busy || !f.full_name.trim() || !f.phone.trim()} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu hồ sơ'}</Btn></>}>
    {err && <div className="cl-alert error"><span>{err}</span>{existing && <a href={`/benh-nhan/${existing}`}>Mở hồ sơ đã có</a>}</div>}
    <div className="cl-form-grid">
      <Field label="Họ và tên" required span="2"><input value={f.full_name} onChange={set('full_name')} autoFocus placeholder="VD: Nguyễn Thị Lan Anh" /></Field>
      <Field label="Giới tính"><select value={f.gender} onChange={set('gender')}><option value="female">Nữ</option><option value="male">Nam</option><option value="other">Khác</option></select></Field>
      <Field label="Ngày sinh"><input type="date" value={f.date_of_birth || ''} onChange={set('date_of_birth')} max={new Date().toISOString().slice(0, 10)} /></Field>
      <Field label="Số điện thoại" required><input value={f.phone} onChange={set('phone')} inputMode="tel" placeholder="09xx xxx xxx" /></Field>
      <Field label="Email"><input type="email" value={f.email} onChange={set('email')} /></Field>
      <Field label="CCCD / CMND"><input value={f.national_id} onChange={set('national_id')} /></Field>
      <Field label="Nghề nghiệp"><input value={f.occupation} onChange={set('occupation')} /></Field>
      <Field label="Địa chỉ" span="2"><input value={f.address} onChange={set('address')} /></Field>
      <Field label="Nguồn biết đến phòng khám"><select value={f.referral_source} onChange={set('referral_source')}>
        <option value="">— Chọn —</option>{['Facebook', 'Website', 'Google', 'Người quen giới thiệu', 'Đặt lịch online', 'Đi ngang qua', 'Khác'].map((x) => <option key={x}>{x}</option>)}</select></Field>
      <Field label="Người liên hệ khi cần"><input value={f.emergency_contact} onChange={set('emergency_contact')} placeholder="Tên – SĐT" /></Field>
      <Field label="Dị ứng (thuốc, mỹ phẩm, thực phẩm)" span="2" hint="Thông tin an toàn: tất cả nhân viên đều thấy cảnh báo này."><textarea rows={2} value={f.allergies} onChange={set('allergies')} placeholder="VD: Dị ứng Penicillin" /></Field>
    </div>
    {clinical && patient && <p className="cl-hint">Bệnh nền, thuốc đang dùng, tiền sử… chỉnh ở tab “Tiền sử” trong hồ sơ.</p>}
  </Modal>;
}

/** Chọn bệnh nhân có sẵn hoặc tạo nhanh. onPick(patient) */
export function PatientPicker({ value, onPick, autoFocus }) {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [creating, setCreating] = useState(false);
  const dq = useDebounce(q, 250);
  useEffect(() => {
    if (dq.trim().length < 2) { setRows([]); return; }
    api.get('/clinic/patients/', { params: { q: dq.trim(), limit: 8 } }).then(({ data }) => setRows(data)).catch(() => setRows([]));
  }, [dq]);
  if (value) return <div className="cl-picked">
    <Avatar name={value.full_name} /><div><strong>{value.full_name}</strong><small>{value.code} · {value.phone}{value.age != null ? ` · ${value.age} tuổi` : ''}</small>
      {value.allergies && <span className="cl-allergy"><WarningAmberRounded />Dị ứng: {value.allergies}</span>}</div>
    <button className="cl-link" onClick={() => onPick(null)}>Đổi</button></div>;
  const looksPhone = /^[\d\s+]{6,}$/.test(q.trim());
  return <div className="cl-picker">
    <div className="cl-input-icon"><SearchRounded /><input autoFocus={autoFocus} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nhập tên, số điện thoại hoặc mã hồ sơ…" /></div>
    <div className="cl-picker-list">
      {rows.map((p) => <button key={p.id} onClick={() => onPick(p)}><Avatar name={p.full_name} size={32} />
        <span><strong>{p.full_name}</strong><small>{p.code} · {p.phone} · {genderText(p.gender)}{p.age != null ? `, ${p.age} tuổi` : ''}</small></span></button>)}
      {q.trim().length >= 2 && !rows.length && <div className="cl-picker-empty">Chưa có bệnh nhân khớp “{q}”.</div>}
    </div>
    <Btn icon={<PersonAddAltRounded />} onClick={() => setCreating(true)}>Tạo hồ sơ bệnh nhân mới{q.trim() ? ` “${q.trim()}”` : ''}</Btn>
    <PatientFormModal open={creating} initial={looksPhone ? { phone: q.trim() } : { full_name: q.trim() }} onClose={() => setCreating(false)}
      onSaved={(p) => { setCreating(false); onPick(p); }} />
  </div>;
}
