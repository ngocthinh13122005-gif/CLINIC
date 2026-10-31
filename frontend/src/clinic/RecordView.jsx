import { useEffect, useState } from 'react';
import PrintRounded from '@mui/icons-material/PrintRounded';
import VerifiedRounded from '@mui/icons-material/VerifiedRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import BodyMap from './BodyMap';
import { Btn, Field, Loading, Modal, Pill, errMsg, fmtDate, fmtDateTime } from './ui';

const esc = (s = '') => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])).replace(/\n/g, '<br>');

export function printRecord(r, patient) {
  const w = window.open('', '_blank', 'width=820,height=1000');
  if (!w) return;
  const sec = (t, v) => v ? `<h3>${t}</h3><p>${esc(v)}</p>` : '';
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Bệnh án ${r.code}</title><style>
  body{font-family:Arial,sans-serif;color:#10253a;padding:34px 44px;font-size:14px;line-height:1.55}h1{text-align:center;margin:0 0 4px;font-size:22px;letter-spacing:.02em}
  .sub{text-align:center;color:#5b6b7c;margin-bottom:22px}h3{margin:16px 0 4px;font-size:13px;text-transform:uppercase;color:#0a5f6c;letter-spacing:.05em}p{margin:0}
  table{width:100%;border-collapse:collapse;margin-top:6px}td,th{border:1px solid #d5dee6;padding:6px 8px;text-align:left;font-size:13px}
  .meta{display:grid;grid-template-columns:1fr 1fr;gap:4px 24px;border:1px solid #d5dee6;border-radius:8px;padding:10px 14px}.sign{margin-top:36px;text-align:right}
  .hash{font-size:10px;color:#6b7c8d;word-break:break-all}</style></head><body>
  <h1>BỆNH ÁN DA LIỄU</h1><div class="sub">Số hồ sơ: ${r.code} · Ngày khám: ${fmtDate(r.visit_date)}</div>
  <div class="meta"><div><b>Bệnh nhân:</b> ${esc(patient?.full_name)}</div><div><b>Mã BN:</b> ${esc(patient?.code)}</div>
  <div><b>Tuổi:</b> ${patient?.age ?? '—'}</div><div><b>SĐT:</b> ${esc(patient?.phone)}</div>
  <div style="grid-column:1/3"><b>Dị ứng:</b> ${esc(patient?.allergies) || 'Không ghi nhận'}</div></div>
  ${sec('Lý do khám', r.chief_complaint)}${sec('Bệnh sử', r.history_present)}${sec('Đã điều trị trước đó', r.previous_treatment)}${sec('Khám lâm sàng', r.examination)}
  ${r.marks?.length ? `<h3>Tổn thương</h3><table><tr><th>Vùng</th><th>Loại</th><th>Mức độ</th><th>Mô tả</th></tr>${r.marks.map((m) => `<tr><td>${esc(m.region_label)}</td><td>${esc(m.lesion_label)}</td><td>${m.severity}/3</td><td>${esc(m.note)}</td></tr>`).join('')}</table>` : ''}
  <h3>Chẩn đoán</h3><p><b>${esc(r.diagnosis_code)}</b> ${esc(r.diagnosis_name)}</p>${(r.secondary_diagnoses || []).map((d) => `<p>${esc(d.code)} ${esc(d.name)}</p>`).join('')}
  ${sec('Chẩn đoán phân biệt', r.differential)}${sec('Hướng điều trị', r.treatment_direction)}${sec('Dặn dò', r.advice)}
  ${r.follow_up_date ? `<h3>Hẹn tái khám</h3><p>${fmtDate(r.follow_up_date)}</p>` : ''}
  ${(r.addenda || []).map((a) => `<h3>Bổ sung (${fmtDateTime(a.created_at)} – ${esc(a.author_name)})</h3><p>${esc(a.content)}</p>`).join('')}
  <div class="sign"><div>${r.signed_at ? `Ngày ${fmtDate(r.signed_at)}` : ''}</div><b>Bác sĩ điều trị</b><div style="height:50px"></div><b>${esc(r.signed_by_name || r.doctor_name)}</b>
  ${r.signature_hash ? `<div class="hash">Mã toàn vẹn SHA-256: ${r.signature_hash}</div>` : '<div class="hash">(Bản nháp – chưa ký)</div>'}</div></body></html>`);
  w.document.close(); w.focus(); setTimeout(() => w.print(), 300);
}

export function RecordBody({ r, regions }) {
  const sec = (t, v) => v ? <section><h4>{t}</h4><p>{v}</p></section> : null;
  return <div className="cl-record">
    <div className="cl-record-grid">
      <div>
        {sec('Lý do khám', r.chief_complaint)}{sec('Bệnh sử', r.history_present)}{sec('Đã điều trị trước đó', r.previous_treatment)}{sec('Khám lâm sàng', r.examination)}
        <section><h4>Chẩn đoán</h4><p><b>{r.diagnosis_code}</b> {r.diagnosis_name}</p>{(r.secondary_diagnoses || []).map((d, i) => <p key={i}>{d.code} {d.name}</p>)}</section>
        {sec('Chẩn đoán phân biệt', r.differential)}{sec('Hướng điều trị', r.treatment_direction)}{sec('Dặn dò', r.advice)}
        {r.follow_up_date && sec('Hẹn tái khám', fmtDate(r.follow_up_date))}
      </div>
      <div>
        <h4>Sơ đồ tổn thương</h4>
        {r.marks?.length ? <><BodyMap marks={r.marks} regionsMeta={regions} readOnly />
          <ul className="cl-marklist">{r.marks.map((m) => <li key={m.id}><b>{m.region_label}</b> · {m.lesion_label} · mức {m.severity}/3{m.note ? ` — ${m.note}` : ''}</li>)}</ul></> : <small className="cl-muted">Không đánh dấu tổn thương.</small>}
      </div>
    </div>
    {(r.addenda || []).length > 0 && <section><h4>Bổ sung sau khi ký</h4>{r.addenda.map((a) => <p key={a.id} className="cl-addendum"><b>{a.author_name}</b> · {fmtDateTime(a.created_at)}<br />{a.content}</p>)}</section>}
  </div>;
}

export default function RecordModal({ recordId, patient, regions, onClose, onChanged }) {
  const { user } = useAuth();
  const [r, setR] = useState(null);
  const [err, setErr] = useState('');
  const [unlock, setUnlock] = useState(null);
  useEffect(() => { setR(null); if (recordId) api.get(`/clinic/records/${recordId}/`).then(({ data }) => setR(data)).catch((e) => setErr(errMsg(e))); }, [recordId]);
  if (!recordId) return null;
  const doUnlock = async () => { try { const { data } = await api.post(`/clinic/records/${recordId}/unlock/`, { reason: unlock }); setR(data); setUnlock(null); onChanged?.(); } catch (e) { setErr(errMsg(e)); } };
  return <Modal open wide onClose={onClose} title={r ? `Bệnh án ${r.code}` : 'Bệnh án'} subtitle={r ? `Khám ngày ${fmtDate(r.visit_date)} · ${r.doctor_name}` : ''}
    footer={r && <>{user.role === 'manager' && r.locked && <Btn onClick={() => setUnlock('')}>Mở khóa để sửa</Btn>}<Btn icon={<PrintRounded />} onClick={() => printRecord(r, patient)}>In bệnh án</Btn><Btn kind="primary" onClick={onClose}>Đóng</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    {!r && !err && <Loading />}
    {r && <>
      <div className="cl-sign-line">{r.locked ? <Pill tone="green"><VerifiedRounded sx={{ fontSize: 14 }} /> Đã ký {fmtDateTime(r.signed_at)} · {r.signed_by_name}</Pill> : <Pill tone="amber">Bản nháp — chưa ký</Pill>}
        {r.signature_hash && <code title="Mã toàn vẹn SHA-256">{r.signature_hash.slice(0, 16)}…</code>}</div>
      <RecordBody r={r} regions={regions} />
      {unlock !== null && <div className="cl-unlock"><Field label="Lý do mở khóa (được ghi vào nhật ký)"><input value={unlock} onChange={(e) => setUnlock(e.target.value)} /></Field>
        <Btn kind="primary" onClick={doUnlock}>Xác nhận mở khóa</Btn></div>}
    </>}
  </Modal>;
}
