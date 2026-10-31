import { useState } from 'react';
import AddRounded from '@mui/icons-material/AddRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Btn, Card, Empty, Field, Loading, Modal, PageHead, Pill, errMsg, fmtDateTime, money, useDebounce, useLoad, useToast } from './ui';

const EMPTY = { name: '', active_ingredient: '', strength: '', form: '', unit: 'viên', default_usage: '', price: 0, cost: 0, min_stock: 10, is_prescription: true, is_controlled: false };

export function MedicineForm({ med, onClose, onSaved }) {
  const [f, setF] = useState(med ? { ...med } : { ...EMPTY });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const submit = async () => {
    const body = { ...f, price: Number(f.price) || 0, cost: Number(f.cost) || 0, min_stock: Number(f.min_stock) || 0 };
    try { const { data } = med ? await api.patch(`/clinic/medicines/${med.id}/`, body) : await api.post('/clinic/medicines/', body); onSaved(data); } catch (e) { setErr(errMsg(e)); }
  };
  return <Modal open wide title={med ? 'Sửa thông tin thuốc' : 'Thêm thuốc / sản phẩm'} onClose={onClose}
    footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={!f.name?.trim()} onClick={submit}>Lưu</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <div className="cl-form-grid">
      <Field label="Tên thuốc / sản phẩm" required span="2"><input value={f.name} onChange={set('name')} /></Field>
      <Field label="Hoạt chất"><input value={f.active_ingredient} onChange={set('active_ingredient')} /></Field>
      <Field label="Hàm lượng"><input value={f.strength} onChange={set('strength')} placeholder="VD: 5%, 500mg" /></Field>
      <Field label="Dạng bào chế"><input value={f.form} onChange={set('form')} placeholder="Kem bôi, viên nén…" /></Field>
      <Field label="Đơn vị"><input value={f.unit} onChange={set('unit')} /></Field>
      <Field label="Giá bán (VNĐ)"><input type="number" min={0} value={f.price} onChange={set('price')} /></Field>
      <Field label="Giá nhập (VNĐ)"><input type="number" min={0} value={f.cost} onChange={set('cost')} /></Field>
      <Field label="Tồn tối thiểu (cảnh báo)"><input type="number" min={0} value={f.min_stock} onChange={set('min_stock')} /></Field>
      <Field label="Phân loại"><label className="cl-check"><input type="checkbox" checked={f.is_prescription} onChange={set('is_prescription')} /> Thuốc kê đơn</label></Field>
      <Field label="Kiểm soát đặc biệt" hint="Gây nghiện / hướng thần / tiền chất — hệ thống sẽ không cho kê."><label className="cl-check"><input type="checkbox" checked={!!f.is_controlled} onChange={set('is_controlled')} /> Thuốc kiểm soát đặc biệt</label></Field>
      <Field label="Cách dùng mặc định" span="2"><input value={f.default_usage} onChange={set('default_usage')} /></Field>
    </div>
    {!med && <small className="cl-muted">Tồn kho ban đầu = 0. Dùng nút “Nhập kho” sau khi tạo.</small>}
  </Modal>;
}

export function StockModal({ med, mode, onClose, onSaved }) {
  const [v, setV] = useState('');
  const [note, setNote] = useState('');
  const [cost, setCost] = useState('');
  const [err, setErr] = useState('');
  const submit = async () => {
    try {
      const { data } = mode === 'in'
        ? await api.post(`/clinic/medicines/${med.id}/receive/`, { quantity: Number(v), note, cost: cost || undefined })
        : await api.post(`/clinic/medicines/${med.id}/adjust/`, { actual: Number(v), note });
      onSaved(data);
    } catch (e) { setErr(errMsg(e)); }
  };
  return <Modal open title={mode === 'in' ? 'Nhập kho' : 'Kiểm kê tồn kho'} subtitle={`${med.name} · hiện tồn ${med.stock} ${med.unit}`} onClose={onClose}
    footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={v === ''} onClick={submit}>Xác nhận</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <div className="cl-form-grid">
      <Field label={mode === 'in' ? `Số lượng nhập (${med.unit})` : `Số đếm thực tế (${med.unit})`} required><input type="number" min={mode === 'in' ? 1 : 0} autoFocus value={v} onChange={(e) => setV(e.target.value)} /></Field>
      {mode === 'in' && <Field label="Giá nhập mới (VNĐ)" hint="Để trống nếu không đổi"><input type="number" min={0} value={cost} onChange={(e) => setCost(e.target.value)} /></Field>}
      <Field label="Ghi chú" span="2"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'in' ? 'Nhà cung cấp, số phiếu nhập…' : 'Lý do chênh lệch'} /></Field>
    </div>
  </Modal>;
}

function Movements({ med, onClose }) {
  const l = useLoad(async () => (await api.get('/clinic/medicines/movements/', { params: med ? { medicine: med.id } : {} })).data, [med?.id]);
  return <Modal open wide title="Sổ kho" subtitle={med ? med.name : 'Tất cả thuốc — 200 phát sinh gần nhất'} onClose={onClose}>
    {l.loading ? <Loading /> : <div className="cl-table-wrap"><table className="cl-table" style={{ minWidth: 560 }}>
      <thead><tr><th>Thời gian</th>{!med && <th>Thuốc</th>}<th>Loại</th><th>SL</th><th>Tồn sau</th><th>Chứng từ</th><th>Người thao tác</th></tr></thead>
      <tbody>{(l.data || []).map((m) => <tr key={m.id}><td>{fmtDateTime(m.created_at)}</td>{!med && <td>{m.medicine_name}</td>}<td>{m.kind_label}</td>
        <td style={{ color: m.quantity < 0 ? '#c2410c' : '#15803d', fontWeight: 700 }}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td><td>{m.balance_after}</td><td>{m.reference}{m.note ? ` · ${m.note}` : ''}</td><td>{m.by_name}</td></tr>)}</tbody></table>
      {!l.data?.length && <Empty title="Chưa có phát sinh" />}</div>}
  </Modal>;
}

export default function PharmacyPage() {
  const { user } = useAuth();
  const manager = user.role === 'manager';
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const dq = useDebounce(q, 250);
  const [modal, setModal] = useState(null);
  const [toast, toastNode] = useToast();
  const l = useLoad(async () => { const { data } = await api.get('/clinic/medicines/', { params: { q: dq.trim() || undefined, low: low ? 1 : undefined } }); return data.results || data; }, [dq, low]);
  const rows = l.data || [];
  const done = (msg) => (m) => { setModal(null); l.reload(true); toast(msg); };
  return <>
    <PageHead title="Kho thuốc" subtitle={manager ? 'Danh mục thuốc, tồn kho và sổ nhập – xuất.' : 'Tra cứu thuốc và tồn kho (chỉ xem).'}
      actions={manager && <><Btn onClick={() => setModal({ t: 'moves' })}>Sổ kho</Btn><Btn kind="primary" icon={<AddRounded />} onClick={() => setModal({ t: 'form' })}>Thêm thuốc</Btn></>} />
    <Card pad={false}>
      <div className="cl-toolbar cl-toolbar-row"><div className="cl-input-icon"><SearchRounded /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, hoạt chất, mã thuốc…" /></div>
        <label className="cl-check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Chỉ thuốc sắp hết</label></div>
      {l.loading && !l.data ? <Loading /> : rows.length ? <div className="cl-table-wrap"><table className="cl-table">
        <thead><tr><th>Mã</th><th>Thuốc</th><th>Dạng</th><th>Giá bán</th>{manager && <th>Giá nhập</th>}<th>Tồn kho</th>{manager && <th />}</tr></thead>
        <tbody>{rows.map((m) => <tr key={m.id}>
          <td><small className="cl-muted">{m.code}</small></td>
          <td><b>{m.name}</b><small className="cl-sub">{[m.active_ingredient, m.strength].filter(Boolean).join(' · ')}{!m.is_prescription && ' · không kê đơn'}</small></td>
          <td>{m.form || '—'}</td><td>{money(m.price)}<small className="cl-sub">/{m.unit}</small></td>{manager && <td>{money(m.cost)}</td>}
          <td><Pill tone={m.stock <= 0 ? 'red' : m.low_stock ? 'amber' : 'green'} dot>{m.stock} {m.unit}</Pill>{m.low_stock && <small className="cl-sub">Tối thiểu {m.min_stock}</small>}</td>
          {manager && <td className="cl-med-actions"><button className="cl-link" onClick={() => setModal({ t: 'in', m })}>Nhập kho</button><button className="cl-link" onClick={() => setModal({ t: 'adj', m })}>Kiểm kê</button>
            <button className="cl-link" onClick={() => setModal({ t: 'moves', m })}>Sổ kho</button><button className="cl-link" onClick={() => setModal({ t: 'form', m })}>Sửa</button></td>}
        </tr>)}</tbody></table></div> : <Empty title="Không có thuốc phù hợp" />}
    </Card>
    {modal?.t === 'form' && <MedicineForm med={modal.m} onClose={() => setModal(null)} onSaved={done('Đã lưu thuốc.')} />}
    {modal?.t === 'in' && <StockModal med={modal.m} mode="in" onClose={() => setModal(null)} onSaved={done('Đã nhập kho.')} />}
    {modal?.t === 'adj' && <StockModal med={modal.m} mode="adj" onClose={() => setModal(null)} onSaved={done('Đã cập nhật tồn kho.')} />}
    {modal?.t === 'moves' && <Movements med={modal.m} onClose={() => setModal(null)} />}
    {toastNode}
  </>;
}
