import { useEffect, useRef, useState } from 'react';
import AddRounded from '@mui/icons-material/AddRounded';
import PrintRounded from '@mui/icons-material/PrintRounded';
import api from '../api/client';
import { Btn, Card, Empty, Field, Loading, Modal, Pill, errMsg, fmtDate, fmtDateTime, useLoad, useToast } from './ui';

const arr = (d) => d?.results || d || [];
const TONE = { pending: 'amber', signed: 'green', revoked: 'gray' };

function SignaturePad({ onChange }) {
  const ref = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  useEffect(() => {
    const c = ref.current; const r = c.getBoundingClientRect(); const dpr = window.devicePixelRatio || 1;
    c.width = r.width * dpr; c.height = r.height * dpr;
    const x = c.getContext('2d'); x.scale(dpr, dpr); x.lineWidth = 2.4; x.lineCap = 'round'; x.lineJoin = 'round'; x.strokeStyle = '#10253a';
  }, []);
  const pos = (e) => { const r = ref.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const down = (e) => { e.preventDefault(); ref.current.setPointerCapture(e.pointerId); drawing.current = true; last.current = pos(e); };
  const move = (e) => {
    if (!drawing.current) return;
    const p = pos(e); const x = ref.current.getContext('2d');
    x.beginPath(); x.moveTo(last.current.x, last.current.y); x.lineTo(p.x, p.y); x.stroke(); last.current = p;
  };
  const up = () => { if (!drawing.current) return; drawing.current = false; onChange(ref.current.toDataURL('image/png')); };
  const clear = () => { const c = ref.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); onChange(''); };
  return <div className="cl-sig"><canvas ref={ref} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={up} aria-label="Khung ký tên" />
    <div className="cl-sig-foot"><span>Ký tên vào khung trên bằng chuột hoặc ngón tay</span><button type="button" className="cl-link" onClick={clear}>Xóa chữ ký</button></div></div>;
}

function Create({ patient, onClose, onSaved }) {
  const tpl = useLoad(async () => arr((await api.get('/clinic/consents/templates/')).data), []);
  const [kind, setKind] = useState('treatment');
  const [err, setErr] = useState('');
  const t = (tpl.data || []).find((x) => x.kind === kind);
  const save = async () => { try { const { data } = await api.post('/clinic/consents/', { patient: patient.id, kind }); onSaved(data); } catch (e) { setErr(errMsg(e)); } };
  return <Modal open wide title="Tạo phiếu cam kết / đồng ý" subtitle={patient.full_name} onClose={onClose} footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" onClick={save}>Tạo & chuyển sang ký</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <Field label="Loại phiếu"><select value={kind} onChange={(e) => setKind(e.target.value)}>{(tpl.data || []).map((x) => <option key={x.kind} value={x.kind}>{x.title}</option>)}</select></Field>
    {t && <div className="cl-consent-body" style={{ marginTop: 14 }}><h3>{t.title}</h3><p>{t.body}</p></div>}
  </Modal>;
}

function Sign({ c, patient, onClose, onSigned }) {
  const [sig, setSig] = useState('');
  const [name, setName] = useState(patient.full_name);
  const [rel, setRel] = useState('Bản thân');
  const [agree, setAgree] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => { try { const { data } = await api.post(`/clinic/consents/${c.id}/sign/`, { signature: sig, signer_name: name, signer_relation: rel }); onSigned(data); } catch (e) { setErr(errMsg(e)); } };
  return <Modal open wide title={c.title} subtitle={`${c.code} · ${patient.full_name}`} onClose={onClose}
    footer={<><Btn onClick={onClose}>Đóng</Btn><Btn kind="primary" disabled={!sig || !name.trim() || !agree} onClick={go}>Xác nhận ký</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <div className="cl-consent-body"><p>{c.body}</p></div>
    <div className="cl-form-grid" style={{ marginTop: 14 }}>
      <Field label="Họ tên người ký" required><input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Quan hệ với bệnh nhân"><select value={rel} onChange={(e) => setRel(e.target.value)}>{['Bản thân', 'Cha / mẹ', 'Vợ / chồng', 'Người giám hộ', 'Người thân khác'].map((x) => <option key={x}>{x}</option>)}</select></Field>
    </div>
    <label className="cl-check" style={{ margin: '14px 0 10px' }}><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} /> Tôi đã đọc, hiểu và đồng ý với nội dung trên.</label>
    <SignaturePad onChange={setSig} />
  </Modal>;
}

function PrintView({ c, onClose }) {
  return <Modal open wide title={c.title} subtitle={c.code} onClose={onClose} footer={<><Btn onClick={onClose}>Đóng</Btn><Btn kind="primary" icon={<PrintRounded />} onClick={() => window.print()}>In phiếu</Btn></>}>
    <div className="cl-print-sheet" id="cl-print-sheet">
      <header><small>PHÒNG KHÁM DA LIỄU AkinaClinic</small><h2>{c.title.toUpperCase()}</h2><p>Số phiếu: {c.code}</p></header>
      <p><b>Bệnh nhân:</b> {c.patient_name} ({c.patient_code})</p>
      <div className="cl-consent-body"><p>{c.body}</p></div>
      {c.status === 'signed' && <div className="cl-sign-box">
        <div><b>Người ký:</b> {c.signer_name} ({c.signer_relation})<br /><b>Thời điểm:</b> {fmtDateTime(c.signed_at)}<br /><b>Người chứng kiến:</b> {c.witness_name || '—'}<br />
          <small>Mã xác thực: {c.content_hash?.slice(0, 24)}…</small></div>
        {c.signature && <img src={c.signature} alt="Chữ ký" />}</div>}
      {c.status !== 'signed' && <p className="cl-muted">Phiếu chưa được ký.</p>}
    </div>
  </Modal>;
}

function DataConsentModal({ patient, onClose, onSaved }) {
  const n = useLoad(async () => (await api.get('/clinic/compliance/notice/')).data, []);
  const [sel, setSel] = useState([]);                                  // không tích sẵn bất kỳ mục nào
  const [name, setName] = useState('');
  const [rel, setRel] = useState('Bản thân');
  const [ok, setOk] = useState(false);
  const [err, setErr] = useState('');
  const toggle = (k) => setSel((a) => (a.includes(k) ? a.filter((x) => x !== k) : [...a, k]));
  const go = async () => { try { await api.post('/clinic/data-consents/', { patient: patient.id, purposes: sel, signer_name: name, signer_relation: rel, confirmed: ok }); onSaved(); } catch (e) { setErr(errMsg(e)); } };
  return <Modal open wide title="Ghi nhận đồng ý xử lý dữ liệu cá nhân" subtitle={patient.full_name} onClose={onClose}
    footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={!sel.includes('care') || !name.trim() || !ok} onClick={go}>Lưu đồng ý</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    {n.loading ? <Loading /> : <>
      <div className="cl-consent-body" style={{ maxHeight: 220 }}><p>{n.data.text}</p></div>
      <h3 className="cl-sec">Bệnh nhân đồng ý với các mục đích sau (chọn từng mục)</h3>
      <div className="cl-check-grid" style={{ gridTemplateColumns: '1fr' }}>{n.data.purposes.map((p) => <label key={p.key} className={sel.includes(p.key) ? 'on' : ''}>
        <input type="checkbox" checked={sel.includes(p.key)} onChange={() => toggle(p.key)} /><span><strong>{p.label}</strong><small>{p.required ? 'Cần thiết để tiếp nhận khám chữa bệnh' : 'Không bắt buộc'}</small></span></label>)}</div>
      <div className="cl-form-grid" style={{ marginTop: 14 }}>
        <Field label="Họ tên người đồng ý" required><input value={name} onChange={(e) => setName(e.target.value)} placeholder={patient.full_name} /></Field>
        <Field label="Quan hệ với bệnh nhân"><select value={rel} onChange={(e) => setRel(e.target.value)}>{['Bản thân', 'Cha / mẹ', 'Người giám hộ', 'Người thân khác'].map((x) => <option key={x}>{x}</option>)}</select></Field></div>
      <label className="cl-check" style={{ marginTop: 12 }}><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Tôi xác nhận đã thông báo đầy đủ nội dung trên và bệnh nhân tự nguyện đồng ý.</label>
    </>}
  </Modal>;
}

function RequestModal({ patient, onClose, onSaved }) {
  const [f, setF] = useState({ kind: 'access', detail: '' });
  const [err, setErr] = useState('');
  const go = async () => { try { await api.post('/clinic/data-requests/', { ...f, patient: patient.id }); onSaved(); } catch (e) { setErr(errMsg(e)); } };
  return <Modal open title="Ghi nhận yêu cầu của bệnh nhân về dữ liệu" subtitle={`${patient.full_name} · xử lý trong 72 giờ`} onClose={onClose} footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" onClick={go}>Ghi nhận</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <div className="cl-form-grid"><Field label="Loại yêu cầu" span="2"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>
      {[['access', 'Xem / sao chép dữ liệu'], ['correct', 'Chỉnh sửa dữ liệu'], ['delete', 'Xóa dữ liệu'], ['restrict', 'Hạn chế xử lý'], ['withdraw', 'Rút lại đồng ý']].map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
      <Field label="Nội dung" span="2"><textarea rows={3} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} /></Field></div></Modal>;
}

function DataConsentPanel({ patient, toast }) {
  const l = useLoad(async () => arr((await api.get('/clinic/data-consents/', { params: { patient: patient.id } })).data), [patient.id]);
  const [m, setM] = useState(null);
  const rows = l.data || [];
  const active = rows.filter((c) => c.status === 'granted');
  const hasCare = active.some((c) => c.purpose === 'care');
  const withdraw = async (c) => { if (!window.confirm('Ghi nhận bệnh nhân rút lại đồng ý này?')) return; try { await api.post(`/clinic/data-consents/${c.id}/withdraw/`, {}); l.reload(true); } catch (e) { toast(errMsg(e), 'err'); } };
  return <Card title="Đồng ý xử lý dữ liệu cá nhân" subtitle="Dữ liệu sức khỏe là dữ liệu nhạy cảm — phải có sự đồng ý rõ ràng, lưu được bằng chứng."
    action={<div className="cl-actions-row" style={{ margin: 0 }}><Btn size="sm" onClick={() => setM('req')}>Yêu cầu của bệnh nhân</Btn><Btn size="sm" kind="primary" onClick={() => setM('new')}>{hasCare ? 'Cập nhật đồng ý' : 'Ghi nhận đồng ý'}</Btn></div>}>
    {l.loading && !l.data ? <Loading /> : <>
      {!hasCare && <div className="cl-alert warn"><span>Chưa có sự đồng ý xử lý dữ liệu của bệnh nhân này. Hãy thông báo và ghi nhận trước khi khám.</span></div>}
      <div className="cl-chips">{active.map((c) => <span key={c.id} className="cl-chip">{c.purpose_label}<small>{fmtDate(c.given_at)}</small><button title="Rút lại đồng ý" onClick={() => withdraw(c)}>×</button></span>)}</div>
      {!!rows.filter((c) => c.status !== 'granted').length && <small className="cl-muted">Đã rút / thay thế: {rows.filter((c) => c.status !== 'granted').length} bản ghi (vẫn được lưu để chứng minh).</small>}
    </>}
    {m === 'new' && <DataConsentModal patient={patient} onClose={() => setM(null)} onSaved={() => { setM(null); l.reload(true); toast('Đã ghi nhận đồng ý.'); }} />}
    {m === 'req' && <RequestModal patient={patient} onClose={() => setM(null)} onSaved={() => { setM(null); toast('Đã ghi nhận yêu cầu — xử lý trong 72 giờ.'); }} />}
  </Card>;
}

export function ConsentsTab({ patient, canSign }) {
  const l = useLoad(async () => arr((await api.get('/clinic/consents/', { params: { patient: patient.id } })).data), [patient.id]);
  const [modal, setModal] = useState(null);
  const [toast, toastNode] = useToast();
  const rows = l.data || [];
  const revoke = async (c) => { if (!window.confirm('Thu hồi phiếu này?')) return; try { await api.post(`/clinic/consents/${c.id}/revoke/`); l.reload(true); } catch (e) { toast(errMsg(e), 'err'); } };
  return <>
    {canSign && <div style={{ marginBottom: 16 }}><DataConsentPanel patient={patient} toast={toast} /></div>}
    <div className="cl-actions-row">{canSign && <Btn kind="primary" icon={<AddRounded />} onClick={() => setModal({ t: 'new' })}>Tạo phiếu cam kết</Btn>}
      <small className="cl-muted">Phiếu đã ký được khóa nội dung và gắn mã xác thực; không thể chỉnh sửa.</small></div>
    <Card pad={false}>{l.loading && !l.data ? <Loading /> : rows.length ? <div className="cl-table-wrap"><table className="cl-table">
      <thead><tr><th>Số phiếu</th><th>Loại</th><th>Trạng thái</th><th>Người ký</th><th>Ngày ký</th><th /></tr></thead>
      <tbody>{rows.map((c) => <tr key={c.id}><td><b>{c.code}</b></td><td>{c.title}<small className="cl-sub">{c.plan_title}</small></td><td><Pill tone={TONE[c.status]} dot>{c.status_label}</Pill></td>
        <td>{c.signer_name ? `${c.signer_name} (${c.signer_relation})` : '—'}</td><td>{c.signed_at ? fmtDate(c.signed_at) : '—'}</td>
        <td className="cl-med-actions">{c.status === 'pending' && canSign && <button className="cl-link" onClick={() => setModal({ t: 'sign', c })}>Ký ngay</button>}
          <button className="cl-link" onClick={() => setModal({ t: 'print', c })}>Xem / in</button>
          {c.status === 'signed' && canSign && <button className="cl-link danger" onClick={() => revoke(c)}>Thu hồi</button>}</td></tr>)}</tbody></table></div>
      : <Empty title="Chưa có phiếu cam kết" hint="Tạo phiếu đồng ý điều trị, cam kết laser/peel, bảo hành hoặc đồng ý chụp ảnh." />}</Card>
    {modal?.t === 'new' && <Create patient={patient} onClose={() => setModal(null)} onSaved={(c) => { l.reload(true); setModal({ t: 'sign', c }); }} />}
    {modal?.t === 'sign' && <Sign c={modal.c} patient={patient} onClose={() => setModal(null)} onSigned={(c) => { l.reload(true); toast('Đã ký phiếu.'); setModal({ t: 'print', c }); }} />}
    {modal?.t === 'print' && <PrintView c={modal.c} onClose={() => setModal(null)} />}
    {toastNode}
  </>;
}
