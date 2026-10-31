import { useEffect, useMemo, useState } from 'react';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import PrintRounded from '@mui/icons-material/PrintRounded';
import api from '../api/client';
import { CLINIC } from './clinicInfo';
import { Btn, Card, Empty, Field, Loading, Pill, errMsg, fmtDate, fmtDateTime, money, useLoad } from './ui';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export function printHtml(title, body, css = '') {
  const w = window.open('', '_blank', 'width=820,height=1000');
  if (!w) return;
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>
  body{font-family:Arial,sans-serif;color:#10253a;padding:34px 44px;font-size:14px;line-height:1.55}h1{text-align:center;margin:0 0 4px;font-size:22px}
  .sub{text-align:center;color:#5b6b7c;margin-bottom:20px}h3{margin:16px 0 4px;font-size:13px;text-transform:uppercase;color:#0a5f6c;letter-spacing:.05em}
  table{width:100%;border-collapse:collapse;margin-top:6px}td,th{border:1px solid #d5dee6;padding:6px 8px;text-align:left;font-size:13px}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;border:1px solid #d5dee6;border-radius:8px;padding:10px 14px}.r{text-align:right}
  .lh{text-align:center;font-size:12px;color:#34495e;border-bottom:2px solid #0a5f6c;padding-bottom:8px;margin-bottom:14px}.lh b{font-size:15px;color:#0a5f6c;letter-spacing:.04em}
  .sign{margin-top:36px;text-align:right}.tot td{font-weight:700;background:#f4f8fa}${css}</style></head><body><div class="lh"><b>${esc(CLINIC.name)}</b><br>${esc(CLINIC.address)} · ĐT: ${esc(CLINIC.phone)}<br>Giấy phép HĐ: ${esc(CLINIC.license)}</div>${body}</body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

export function printPrescription(rx, patient) {
  printHtml(`Đơn thuốc ${rx.code}`, `<h1>ĐƠN THUỐC</h1><div class="sub">Số: ${rx.code} · Ngày ${fmtDate(rx.issued_at || rx.created_at)}</div>
  <div class="meta"><div><b>Bệnh nhân:</b> ${esc(patient?.full_name || rx.patient_name)}</div><div><b>Mã BN:</b> ${esc(patient?.code || rx.patient_code)}</div>
  <div><b>Tuổi:</b> ${rx.age_months != null ? rx.age_months + ' tháng' : (patient?.age ?? '—')}</div><div><b>SĐT:</b> ${esc(patient?.phone)}</div>
  <div><b>CCCD/Định danh:</b> ${esc(rx.patient_national_id) || '—'}</div><div><b>Cân nặng:</b> ${rx.weight_kg ? rx.weight_kg + ' kg' : '—'}</div>
  <div style="grid-column:1/3"><b>Nơi cư trú:</b> ${esc(rx.patient_address) || '—'}</div>
  ${rx.guardian_name ? `<div style="grid-column:1/3"><b>Người đi cùng:</b> ${esc(rx.guardian_name)}</div>` : ''}
  <div style="grid-column:1/3"><b>Chẩn đoán:</b> ${esc(rx.diagnosis) || '—'}</div>
  <div style="grid-column:1/3"><b>Dị ứng:</b> ${esc(patient?.allergies) || 'Không ghi nhận'}</div></div>
  <table><tr><th>#</th><th>Thuốc</th><th>SL</th><th>Liều dùng</th><th>Cách dùng</th></tr>
  ${rx.items.map((i, n) => `<tr><td>${n + 1}</td><td><b>${esc(i.medicine_name)}</b> ${esc(i.strength)}</td><td>${i.quantity} ${esc(i.unit)}</td><td>${esc(i.dosage)}${i.days ? ` (${i.days} ngày)` : ''}</td><td>${esc(i.usage)}</td></tr>`).join('')}</table>
  ${rx.advice ? `<h3>Lời dặn</h3><p>${esc(rx.advice)}</p>` : ''}
  <p style="margin-top:14px;font-size:12px;color:#5b6b7c">Thuốc dùng đúng liều, đúng thời gian. Khám lại khi có dấu hiệu bất thường. Nhận thuốc trong vòng 05 ngày kể từ ngày kê đơn.${rx.national_code ? ` Mã đơn thuốc quốc gia: <b>${esc(rx.national_code)}</b>.` : ''}</p>
  <div class="sign"><b>Bác sĩ kê đơn</b><div style="height:50px"></div><b>${esc(rx.doctor_name)}</b></div>`);
}

export function useMedicines() {
  return useLoad(async () => { const { data } = await api.get('/clinic/medicines/'); return data.results || data; }, []);
}

export function MedPicker({ meds, onPick, placeholder = 'Tìm thuốc theo tên, hoạt chất…', exclude = [] }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const rows = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (meds || []).filter((m) => !m.is_controlled && !exclude.includes(m.id) && (!t || `${m.name} ${m.active_ingredient} ${m.code}`.toLowerCase().includes(t))).slice(0, 12);
  }, [meds, q, exclude]);
  return <div className="cl-icd">
    <input value={q} placeholder={placeholder} onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} onBlur={() => setTimeout(() => setOpen(false), 150)} />
    {open && <div className="cl-icd-pop">{rows.map((m) => <button key={m.id} onMouseDown={() => { onPick(m); setQ(''); setOpen(false); }}>
      <b>{m.name}</b><span>{m.strength} · {money(m.price)}/{m.unit}</span><em className={m.stock <= 0 ? 'out' : m.low_stock ? 'low' : ''}>Tồn {m.stock}</em></button>)}
      {!rows.length && <div className="cl-picker-empty">Không có thuốc phù hợp trong kho.</div>}</div>}
  </div>;
}

const blank = (m) => ({ medicine: m.id, medicine_name: m.name, unit: m.unit, strength: m.strength, stock: m.stock, quantity: 1, dosage: '', usage: m.default_usage || '', days: 0 });

/** Thẻ kê đơn trong màn khám của bác sĩ. */
export function PrescriptionCard({ visit, patient, onToast }) {
  const meds = useMedicines();
  const [rx, setRx] = useState(null);
  const [items, setItems] = useState([]);
  const [advice, setAdvice] = useState('');
  const [dx, setDx] = useState('');
  const [weight, setWeight] = useState('');
  const [guardian, setGuardian] = useState('');
  const [state, setState] = useState({ loading: true, dirty: false, err: '' });
  const readOnly = visit.status !== 'in_consult';

  useEffect(() => {
    api.get('/clinic/prescriptions/', { params: { visit: visit.id } }).then(({ data }) => {
      const r = (data.results || data)[0];
      if (r) { setRx(r); setItems(r.items); setAdvice(r.advice); setDx(r.diagnosis); setWeight(r.weight_kg || ''); setGuardian(r.guardian_name || ''); }
      setState({ loading: false, dirty: false, err: '' });
    }).catch((e) => setState({ loading: false, dirty: false, err: errMsg(e) }));
  }, [visit.id]);

  const upd = (i, patch) => { setItems((a) => a.map((x, j) => (j === i ? { ...x, ...patch } : x))); setState((s) => ({ ...s, dirty: true })); };
  const save = async (issue) => {
    try {
      const { data } = await api.post('/clinic/prescriptions/save/', { visit: visit.id, issue, diagnosis: dx, advice, items, weight_kg: weight || null, guardian_name: guardian });
      setRx(data); setItems(data.items); setState({ loading: false, dirty: false, err: '' });
      onToast?.(issue ? 'Đã kê đơn thuốc.' : 'Đã lưu nháp đơn thuốc.');
    } catch (e) { setState((s) => ({ ...s, err: errMsg(e) })); }
  };
  const cancel = async () => {
    if (!window.confirm('Hủy đơn thuốc này?')) return;
    try { const { data } = await api.post(`/clinic/prescriptions/${rx.id}/cancel/`); setRx(data); onToast?.('Đã hủy đơn.'); } catch (e) { setState((s) => ({ ...s, err: errMsg(e) })); }
  };
  const dob = patient?.date_of_birth ? new Date(patient.date_of_birth) : null;
  const now = new Date();
  const months = dob ? (now.getFullYear() - dob.getFullYear()) * 12 + now.getMonth() - dob.getMonth() - (now.getDate() < dob.getDate() ? 1 : 0) : null;
  const child = months != null && months < 72;
  const missing = [!patient?.address && 'nơi cư trú', !dob && 'ngày sinh'].filter(Boolean);
  const total = items.reduce((s, i) => s + i.quantity * (i.unit_price ?? meds.data?.find((m) => m.id === i.medicine)?.price ?? 0), 0);
  const tone = { draft: 'amber', issued: 'green', cancelled: 'gray' }[rx?.status] || 'gray';

  return <Card title="5 · Đơn thuốc" subtitle="Mỗi thuốc tối đa 30 ngày; bắt buộc có số ngày dùng. Thuốc kiểm soát đặc biệt không kê trên hệ thống."
    action={rx && <Pill tone={tone} dot>{{ draft: 'Nháp', issued: 'Đã kê', cancelled: 'Đã hủy' }[rx.status]} · {rx.code}</Pill>}>
    {state.err && <div className="cl-alert error">{state.err}</div>}
    {state.loading ? <Loading /> : <>
      {!!rx?.allergy_warnings?.length && <div className="cl-alert warn"><WarningAmberRounded /><span><b>Cảnh báo dị ứng:</b> {rx.allergy_warnings.map((w) => w.medicine).join(', ')} có thể trùng với dị ứng đã ghi nhận ({rx.allergy_warnings[0].allergies}). Hãy kiểm tra lại.</span></div>}
      {!!missing.length && !readOnly && <div className="cl-alert warn"><WarningAmberRounded /><span>Hồ sơ bệnh nhân còn thiếu <b>{missing.join(', ')}</b> — bắt buộc để kê đơn. Hãy cập nhật trong hồ sơ bệnh nhân.</span></div>}
      {rx?.status === 'issued' && <div className="cl-alert ok-soft"><span>Liên thông đơn thuốc quốc gia: <b>{{ none: 'Chưa gửi', pending: 'Chờ gửi', sent: `Đã gửi (${rx.national_code})`, error: 'Lỗi' }[rx.national_status]}</b></span></div>}
      {child && <div className="cl-legalbox"><b>Trẻ dưới 72 tháng tuổi ({months} tháng)</b> — bắt buộc ghi cân nặng và người đi cùng.
        <div className="cl-form-grid" style={{ marginTop: 10 }}>
          <Field label="Cân nặng (kg)" required><input type="number" step="0.1" min={0} value={weight} disabled={readOnly} onChange={(e) => { setWeight(e.target.value); setState((s) => ({ ...s, dirty: true })); }} /></Field>
          <Field label="Người đi cùng / giám hộ" required><input value={guardian} disabled={readOnly} onChange={(e) => { setGuardian(e.target.value); setState((s) => ({ ...s, dirty: true })); }} /></Field></div></div>}
      {items.length ? <div className="cl-rx">{items.map((it, i) => <div className="cl-rx-row" key={it.medicine}>
        <div className="cl-rx-name"><b>{it.medicine_name}</b><small>{it.strength} · tồn {it.stock} {it.unit}{it.quantity > it.stock && <em className="out"> · vượt tồn kho</em>}</small></div>
        <input className="cl-rx-qty" type="number" min={1} value={it.quantity} disabled={readOnly} onChange={(e) => upd(i, { quantity: Number(e.target.value) })} aria-label="Số lượng" />
        <span className="cl-rx-unit">{it.unit}</span>
        <input placeholder="Liều dùng — VD: 1 viên x 2 lần/ngày" value={it.dosage} disabled={readOnly} onChange={(e) => upd(i, { dosage: e.target.value })} />
        <input placeholder="Cách dùng — VD: sau ăn no" value={it.usage} disabled={readOnly} onChange={(e) => upd(i, { usage: e.target.value })} />
        <input className="cl-rx-days" type="number" min={1} max={30} placeholder="Ngày" value={it.days || ''} disabled={readOnly} style={!readOnly && !it.days ? { borderColor: 'var(--amber)' } : undefined} onChange={(e) => upd(i, { days: Math.min(30, Number(e.target.value)) })} aria-label="Số ngày" />
        {!readOnly && <button className="cl-icon-btn" aria-label="Xóa thuốc" onClick={() => { setItems((a) => a.filter((_, j) => j !== i)); setState((s) => ({ ...s, dirty: true })); }}><DeleteOutlineRounded /></button>}
      </div>)}</div> : <small className="cl-muted">Chưa có thuốc nào trong đơn.</small>}
      {!readOnly && <div style={{ marginTop: 12 }}><MedPicker meds={meds.data} exclude={items.map((i) => i.medicine)} placeholder="+ Thêm thuốc: gõ tên hoặc hoạt chất…"
        onPick={(m) => { setItems((a) => [...a, blank(m)]); setState((s) => ({ ...s, dirty: true })); }} /></div>}
      <div className="cl-form-grid" style={{ marginTop: 14 }}>
        <Field label="Chẩn đoán ghi trên đơn" span="2"><input value={dx} disabled={readOnly} onChange={(e) => { setDx(e.target.value); setState((s) => ({ ...s, dirty: true })); }} placeholder="Mặc định lấy từ bệnh án" /></Field>
        <Field label="Lời dặn" span="2"><textarea rows={2} value={advice} disabled={readOnly} onChange={(e) => { setAdvice(e.target.value); setState((s) => ({ ...s, dirty: true })); }} /></Field>
      </div>
      <div className="cl-actions-row">
        <strong>Tạm tính: {money(total)}</strong>
        <span style={{ flex: 1 }} />
        {rx?.status === 'issued' && <Btn icon={<PrintRounded />} onClick={() => printPrescription(rx, patient)}>In đơn</Btn>}
        {!readOnly && rx && rx.status !== 'cancelled' && <Btn onClick={cancel}>Hủy đơn</Btn>}
        {!readOnly && <Btn onClick={() => save(false)} disabled={!state.dirty && !!rx}>Lưu nháp</Btn>}
        {!readOnly && <Btn kind="primary" icon={<AddRounded />} disabled={!items.length} onClick={() => save(true)}>{rx?.status === 'issued' ? 'Cập nhật đơn' : 'Kê đơn'}</Btn>}
      </div>
    </>}
  </Card>;
}

/** Tab "Đơn thuốc" trong hồ sơ bệnh nhân (bác sĩ / quản lý). */
export function PrescriptionsTab({ patient }) {
  const l = useLoad(async () => { const { data } = await api.get('/clinic/prescriptions/', { params: { patient: patient.id } }); return data.results || data; }, [patient.id]);
  if (l.loading) return <Loading />;
  const rows = (l.data || []).filter((r) => r.status !== 'draft');
  if (!rows.length) return <Card><Empty title="Chưa có đơn thuốc" hint="Đơn thuốc xuất hiện sau khi bác sĩ kê trong lượt khám." /></Card>;
  return <>{rows.map((r) => <Card key={r.id} title={`${r.code} · ${fmtDate(r.issued_at || r.created_at)}`} subtitle={`${r.doctor_name}${r.diagnosis ? ' · ' + r.diagnosis : ''}`}
    action={<><Pill tone={r.status === 'issued' ? 'green' : 'gray'}>{r.status === 'issued' ? 'Đã kê' : 'Đã hủy'}</Pill> <Btn size="sm" icon={<PrintRounded />} onClick={() => printPrescription(r, patient)}>In</Btn></>}>
    <table className="cl-table" style={{ minWidth: 0 }}><thead><tr><th>Thuốc</th><th>SL</th><th>Liều dùng</th><th>Cách dùng</th></tr></thead>
      <tbody>{r.items.map((i) => <tr key={i.id}><td><b>{i.medicine_name}</b> <small className="cl-muted">{i.strength}</small></td><td>{i.quantity} {i.unit}</td><td>{i.dosage}{i.days ? ` · ${i.days} ngày` : ''}</td><td>{i.usage}</td></tr>)}</tbody></table>
    {r.advice && <p className="cl-muted" style={{ marginTop: 10 }}>Lời dặn: {r.advice}</p>}
  </Card>)}</>;
}
