import { useMemo, useState } from 'react';
import AddRounded from '@mui/icons-material/AddRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { MedicineForm, StockModal } from './Pharmacy';
import { Btn, Card, Empty, Field, Loading, Modal, PageHead, Pill, errMsg, fmtDate, fmtDateTime, money, useDebounce, useLoad, useToast } from './ui';

const arr = (d) => d?.results || d || [];
const PO_TONE = { draft: 'gray', ordered: 'blue', partial: 'amber', received: 'green', cancelled: 'red' };
const expiryTone = (d, warningDays = 90) => (d == null ? 'gray' : d < 0 ? 'red' : d <= warningDays ? 'amber' : 'green');
const expiryText = (d) => (d == null ? 'Không HSD' : d < 0 ? `Quá hạn ${-d} ngày` : `Còn ${d} ngày`);

function Kpi({ label, value, hint, tone = '', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={`cl-stat ${tone} ${onClick ? 'clickable' : ''}`}><span>{label}</span><strong>{value}</strong>{hint && <small>{hint}</small>}</Tag>;
}

/* ------------------------------------------------------------------ Tồn kho */
function StockTab({ manager, toast }) {
  const [q, setQ] = useState('');
  const [low, setLow] = useState(false);
  const dq = useDebounce(q, 250);
  const [modal, setModal] = useState(null);
  const l = useLoad(async () => arr((await api.get('/clinic/medicines/', { params: { q: dq.trim() || undefined, low: low ? 1 : undefined } })).data), [dq, low]);
  const rows = l.data || [];
  const done = (msg) => () => { setModal(null); l.reload(true); toast(msg); };
  return <>
    <Card pad={false}>
      <div className="cl-toolbar cl-toolbar-row"><div className="cl-input-icon"><SearchRounded /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên, hoạt chất, mã thuốc…" /></div>
        <label className="cl-check"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Chỉ thuốc sắp hết</label>
        {manager && <Btn kind="primary" size="sm" icon={<AddRounded />} onClick={() => setModal({ t: 'form' })}>Thêm thuốc</Btn>}</div>
      {l.loading && !l.data ? <Loading /> : rows.length ? <div className="cl-table-wrap"><table className="cl-table">
        <thead><tr><th>Mã</th><th>Thuốc / sản phẩm</th><th>Dạng</th><th>Giá bán</th>{manager && <th>Giá vốn</th>}<th>Tồn kho</th>{manager && <th />}</tr></thead>
        <tbody>{rows.map((m) => <tr key={m.id}>
          <td><small className="cl-muted">{m.code}</small></td>
          <td><b>{m.name}</b><small className="cl-sub">{[m.active_ingredient, m.strength].filter(Boolean).join(' · ')}{!m.is_prescription && ' · không kê đơn'}</small></td>
          <td>{m.form || '—'}</td><td>{money(m.price)}<small className="cl-sub">/{m.unit}</small></td>{manager && <td>{money(m.cost)}</td>}
          <td><Pill tone={m.stock <= 0 ? 'red' : m.low_stock ? 'amber' : 'green'} dot>{m.stock} {m.unit}</Pill>{m.low_stock && <small className="cl-sub">Tối thiểu {m.min_stock}</small>}</td>
          {manager && <td className="cl-med-actions"><button className="cl-link" onClick={() => setModal({ t: 'in', m })}>Nhập kho</button>
            <button className="cl-link" onClick={() => setModal({ t: 'form', m })}>Sửa</button></td>}
        </tr>)}</tbody></table></div> : <Empty title="Không có thuốc phù hợp" />}
    </Card>
    {modal?.t === 'form' && <MedicineForm med={modal.m} onClose={() => setModal(null)} onSaved={done('Đã lưu thuốc.')} />}
    {modal?.t === 'in' && <StockModal med={modal.m} mode="in" onClose={() => setModal(null)} onSaved={done('Đã nhập kho.')} />}
  </>;
}

/* ------------------------------------------------------------------ Lô & hạn dùng */
function LotsTab({ manager, toast, warningDays = 90 }) {
  const [view, setView] = useState('all');
  const [scrap, setScrap] = useState(null);
  const l = useLoad(async () => arr((await api.get('/clinic/lots/', { params: view === 'soon' ? { expiring: 'default' } : {} })).data), [view]);
  const rows = l.data || [];
  return <>
    <div className="cl-tabs-pill">{[['all', 'Tất cả lô còn hàng'], ['soon', `Sắp / đã hết hạn (≤ ${warningDays} ngày)`]].map(([k, t]) => <button key={k} className={view === k ? 'on' : ''} onClick={() => setView(k)}>{t}</button>)}</div>
    <Card pad={false}>
      {l.loading && !l.data ? <Loading /> : rows.length ? <div className="cl-table-wrap"><table className="cl-table">
        <thead><tr><th>Thuốc</th><th>Số lô</th><th>Hạn dùng</th><th>Tình trạng</th><th>Còn / nhập</th><th>Giá vốn</th><th>Nhà cung cấp</th><th>Ngày nhập</th>{manager && <th />}</tr></thead>
        <tbody>{rows.map((x) => <tr key={x.id}>
          <td><b>{x.medicine_name}</b><small className="cl-sub">{x.medicine_code}</small></td>
          <td>{x.lot_no || <span className="cl-muted">—</span>}</td><td>{x.expiry_date ? fmtDate(x.expiry_date) : '—'}</td>
          <td><Pill tone={expiryTone(x.days_left, warningDays)} dot>{expiryText(x.days_left)}</Pill></td>
          <td>{x.quantity} / {x.initial_qty} <small className="cl-muted">{x.unit}</small></td><td>{manager ? money(x.unit_cost) : '—'}</td>
          <td>{x.supplier_name || '—'}</td><td>{fmtDate(x.received_at)}</td>
          {manager && <td>{x.quantity > 0 && <button className="cl-link danger" onClick={() => setScrap(x)}>Hủy hàng</button>}</td>}
        </tr>)}</tbody></table></div> : <Empty title="Không có lô nào" hint="Lô được tạo khi nhận hàng từ đơn nhập." />}
    </Card>
    <p className="cl-hint">Hệ thống xuất kho theo nguyên tắc <b>FEFO</b> — lô hết hạn sớm nhất được trừ trước khi kê đơn / xuất bán.</p>
    {scrap && <ScrapModal lot={scrap} onClose={() => setScrap(null)} onDone={() => { setScrap(null); l.reload(true); toast('Đã ghi nhận hủy hàng.'); }} />}
  </>;
}

function ScrapModal({ lot, onClose, onDone }) {
  const [qty, setQty] = useState(lot.quantity);
  const [note, setNote] = useState(lot.days_left != null && lot.days_left < 0 ? 'Hết hạn sử dụng' : '');
  const [err, setErr] = useState('');
  const go = async () => { try { await api.post(`/clinic/lots/${lot.id}/scrap/`, { quantity: Number(qty), note }); onDone(); } catch (e) { setErr(errMsg(e)); } };
  return <Modal open title="Hủy hàng / xuất hủy" subtitle={`${lot.medicine_name} · lô ${lot.lot_no || lot.id}`} onClose={onClose}
    footer={<><Btn onClick={onClose}>Đóng</Btn><Btn kind="primary" disabled={!(Number(qty) > 0)} onClick={go}>Xác nhận hủy</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <div className="cl-form-grid"><Field label={`Số lượng hủy (tối đa ${lot.quantity})`} required><input type="number" min={1} max={lot.quantity} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
      <Field label="Lý do" span="2"><input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Hết hạn, hư hỏng, vỡ…" /></Field></div>
  </Modal>;
}

/* ------------------------------------------------------------------ Đơn nhập hàng */
function POForm({ order, suppliers, meds, onClose, onSaved }) {
  const [sup, setSup] = useState(order?.supplier || '');
  const [exp, setExp] = useState(order?.expected_date || '');
  const [note, setNote] = useState(order?.note || '');
  const [lines, setLines] = useState(order?.lines?.map((x) => ({ medicine: x.medicine, quantity: x.quantity, unit_cost: x.unit_cost })) || [{ medicine: '', quantity: 10, unit_cost: 0 }]);
  const [err, setErr] = useState('');
  const setLine = (i, k, v) => setLines((a) => a.map((x, j) => {
    if (j !== i) return x;
    const n = { ...x, [k]: v };
    if (k === 'medicine') n.unit_cost = meds.find((m) => String(m.id) === String(v))?.cost || 0;
    return n;
  }));
  const total = lines.reduce((s, x) => s + (Number(x.quantity) || 0) * (Number(x.unit_cost) || 0), 0);
  const save = async () => {
    const body = { supplier: sup, expected_date: exp || null, note, lines: lines.filter((x) => x.medicine).map((x) => ({ medicine: x.medicine, quantity: Number(x.quantity), unit_cost: Number(x.unit_cost) })) };
    try { const { data } = order ? await api.put(`/clinic/purchase-orders/${order.id}/`, body) : await api.post('/clinic/purchase-orders/', body); onSaved(data); } catch (e) { setErr(errMsg(e)); }
  };
  return <Modal open wide title={order ? `Sửa đơn ${order.code}` : 'Tạo đơn nhập hàng'} onClose={onClose}
    footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={!sup || !lines.some((x) => x.medicine)} onClick={save}>Lưu nháp</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <div className="cl-form-grid">
      <Field label="Nhà cung cấp" required><select value={sup} onChange={(e) => setSup(e.target.value)}><option value="">— Chọn —</option>{suppliers.filter((s) => s.is_active).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="Ngày dự kiến nhận"><input type="date" value={exp || ''} onChange={(e) => setExp(e.target.value)} /></Field>
      <Field label="Ghi chú" span="2"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </div>
    <h3 className="cl-sec">Danh sách hàng</h3>
    {lines.map((x, i) => <div className="cl-po-row" key={i}>
      <select value={x.medicine} onChange={(e) => setLine(i, 'medicine', e.target.value)}><option value="">— Chọn thuốc / sản phẩm —</option>{meds.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit})</option>)}</select>
      <input type="number" min={1} value={x.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} aria-label="Số lượng" />
      <input type="number" min={0} value={x.unit_cost} onChange={(e) => setLine(i, 'unit_cost', e.target.value)} aria-label="Đơn giá" />
      <b>{money((Number(x.quantity) || 0) * (Number(x.unit_cost) || 0))}</b>
      <button className="cl-icon-btn" onClick={() => setLines((a) => a.filter((_, j) => j !== i))} aria-label="Xóa dòng"><DeleteOutlineRounded /></button>
    </div>)}
    <div className="cl-po-foot"><Btn size="sm" icon={<AddRounded />} onClick={() => setLines((a) => [...a, { medicine: '', quantity: 10, unit_cost: 0 }])}>Thêm dòng</Btn><span>Tổng giá trị đơn: <b>{money(total)}</b></span></div>
  </Modal>;
}

function ReceiveModal({ order, onClose, onDone }) {
  const [rows, setRows] = useState(order.lines.filter((x) => x.quantity > x.received_qty).map((x) => ({ line_id: x.id, name: x.medicine_name, unit: x.unit, left: x.quantity - x.received_qty, quantity: x.quantity - x.received_qty, lot_no: '', expiry: '' })));
  const [err, setErr] = useState('');
  const set = (i, k, v) => setRows((a) => a.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const go = async () => {
    try { await api.post(`/clinic/purchase-orders/${order.id}/receive/`, { lines: rows.filter((x) => Number(x.quantity) > 0).map((x) => ({ line_id: x.line_id, quantity: Number(x.quantity), lot_no: x.lot_no, expiry: x.expiry || null })) }); onDone(); }
    catch (e) { setErr(errMsg(e)); }
  };
  return <Modal open wide title={`Nhận hàng — ${order.code}`} subtitle={`${order.supplier_name} · nhập số lượng thực nhận, số lô và hạn dùng cho từng dòng (có thể nhận từng phần)`} onClose={onClose}
    footer={<><Btn onClick={onClose}>Đóng</Btn><Btn kind="primary" onClick={go}>Xác nhận nhập kho</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <div className="cl-table-wrap"><table className="cl-table" style={{ minWidth: 640 }}><thead><tr><th>Thuốc</th><th>Còn chờ</th><th>Thực nhận</th><th>Số lô</th><th>Hạn dùng</th></tr></thead>
      <tbody>{rows.map((x, i) => <tr key={x.line_id}><td><b>{x.name}</b></td><td>{x.left} {x.unit}</td>
        <td><input type="number" min={0} max={x.left} value={x.quantity} onChange={(e) => set(i, 'quantity', e.target.value)} style={{ width: 90 }} /></td>
        <td><input type="text" value={x.lot_no} placeholder="VD: LOT2410A" onChange={(e) => set(i, 'lot_no', e.target.value)} style={{ width: 140 }} /></td>
        <td><input type="date" value={x.expiry} onChange={(e) => set(i, 'expiry', e.target.value)} /></td></tr>)}</tbody></table></div>
  </Modal>;
}

function OrdersTab({ toast, suppliers, meds }) {
  const [st, setSt] = useState('');
  const [modal, setModal] = useState(null);
  const l = useLoad(async () => arr((await api.get('/clinic/purchase-orders/', { params: st ? { status: st } : {} })).data), [st]);
  const rows = l.data || [];
  const act = async (o, a, msg) => { try { await api.post(`/clinic/purchase-orders/${o.id}/${a}/`); l.reload(true); toast(msg); } catch (e) { toast(errMsg(e), 'err'); } };
  const after = (msg) => () => { setModal(null); l.reload(true); toast(msg); };
  return <>
    <div className="cl-toolbar-row cl-bar-top">
      <div className="cl-tabs-pill" style={{ margin: 0 }}>{[['', 'Tất cả'], ['draft', 'Nháp'], ['ordered', 'Đã đặt'], ['partial', 'Nhận một phần'], ['received', 'Đã nhận']].map(([k, t]) => <button key={k} className={st === k ? 'on' : ''} onClick={() => setSt(k)}>{t}</button>)}</div>
      <Btn kind="primary" icon={<AddRounded />} onClick={() => setModal({ t: 'form' })}>Tạo đơn nhập</Btn>
    </div>
    <Card pad={false}>
      {l.loading && !l.data ? <Loading /> : rows.length ? <div className="cl-table-wrap"><table className="cl-table">
        <thead><tr><th>Mã đơn</th><th>Nhà cung cấp</th><th>Trạng thái</th><th>Số dòng</th><th>Tổng giá trị</th><th>Dự kiến nhận</th><th>Ngày tạo</th><th /></tr></thead>
        <tbody>{rows.map((o) => <tr key={o.id}>
          <td><b>{o.code}</b></td><td>{o.supplier_name}</td><td><Pill tone={PO_TONE[o.status]} dot>{o.status_label}</Pill></td>
          <td>{o.lines.length}</td><td>{money(o.total)}</td><td>{o.expected_date ? fmtDate(o.expected_date) : '—'}</td><td>{fmtDate(o.created_at)}</td>
          <td className="cl-med-actions">
            <button className="cl-link" onClick={() => setModal({ t: 'view', o })}>Chi tiết</button>
            {o.status === 'draft' && <><button className="cl-link" onClick={() => setModal({ t: 'form', o })}>Sửa</button><button className="cl-link" onClick={() => act(o, 'confirm', 'Đã xác nhận đặt hàng.')}>Xác nhận đặt</button></>}
            {['ordered', 'partial'].includes(o.status) && <button className="cl-link" onClick={() => setModal({ t: 'recv', o })}>Nhận hàng</button>}
            {['draft', 'ordered'].includes(o.status) && <button className="cl-link danger" onClick={() => window.confirm(`Hủy đơn ${o.code}?`) && act(o, 'cancel', 'Đã hủy đơn.')}>Hủy</button>}
          </td></tr>)}</tbody></table></div> : <Empty title="Chưa có đơn nhập hàng" action={<Btn kind="primary" onClick={() => setModal({ t: 'form' })}>Tạo đơn đầu tiên</Btn>} />}
    </Card>
    {modal?.t === 'form' && <POForm order={modal.o} suppliers={suppliers} meds={meds} onClose={() => setModal(null)} onSaved={after('Đã lưu đơn nhập (nháp).')} />}
    {modal?.t === 'recv' && <ReceiveModal order={modal.o} onClose={() => setModal(null)} onDone={after('Đã nhập kho.')} />}
    {modal?.t === 'view' && <Modal open wide title={`Đơn ${modal.o.code}`} subtitle={`${modal.o.supplier_name} · ${modal.o.status_label}${modal.o.created_by_name ? ' · tạo bởi ' + modal.o.created_by_name : ''}`} onClose={() => setModal(null)}>
      <div className="cl-table-wrap"><table className="cl-table" style={{ minWidth: 520 }}><thead><tr><th>Thuốc</th><th>Đặt</th><th>Đã nhận</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
        <tbody>{modal.o.lines.map((x) => <tr key={x.id}><td>{x.medicine_name}</td><td>{x.quantity} {x.unit}</td><td>{x.received_qty}</td><td>{money(x.unit_cost)}</td><td>{money(x.quantity * x.unit_cost)}</td></tr>)}</tbody></table></div>
      <p className="cl-po-foot" style={{ justifyContent: 'flex-end' }}>Tổng: <b>{money(modal.o.total)}</b></p>{modal.o.note && <p className="cl-hint">Ghi chú: {modal.o.note}</p>}
    </Modal>}
  </>;
}

/* ------------------------------------------------------------------ Kiểm kho */
function CountDetail({ id, onClose, onChanged, toast }) {
  const l = useLoad(async () => (await api.get(`/clinic/stock-counts/${id}/`)).data, [id]);
  const [vals, setVals] = useState({});
  const [busy, setBusy] = useState(false);
  const c = l.data;
  const draft = c?.status === 'draft';
  const payload = () => Object.entries(vals).map(([lid, v]) => ({ id: Number(lid), counted_qty: v }));
  const save = async () => { await api.post(`/clinic/stock-counts/${id}/lines/`, { lines: payload() }); setVals({}); await l.reload(true); };
  const validate = async () => {
    if (!window.confirm('Chốt phiếu kiểm và điều chỉnh tồn kho theo số đếm? Thao tác này không hoàn tác.')) return;
    setBusy(true);
    try { if (Object.keys(vals).length) await save(); await api.post(`/clinic/stock-counts/${id}/validate/`); toast('Đã chốt phiếu kiểm và điều chỉnh tồn kho.'); onChanged(); onClose(); }
    catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(false); }
  };
  const cancel = async () => { if (!window.confirm('Hủy phiếu kiểm này?')) return; try { await api.post(`/clinic/stock-counts/${id}/cancel/`); onChanged(); onClose(); } catch (e) { toast(errMsg(e), 'err'); } };
  const cur = (x) => (x.id in vals ? vals[x.id] : x.counted_qty ?? '');
  return <Modal open wide title={c ? `Phiếu kiểm ${c.code}` : 'Phiếu kiểm kho'} subtitle={c ? `${c.status_label}${c.validated_at ? ' · chốt ' + fmtDateTime(c.validated_at) : ''}` : ''} onClose={onClose}
    footer={c && draft ? <><Btn onClick={cancel}>Hủy phiếu</Btn><Btn onClick={async () => { await save(); toast('Đã lưu số đếm.'); }}>Lưu tạm</Btn><Btn kind="primary" disabled={busy} onClick={validate}>Chốt & điều chỉnh tồn</Btn></> : null}>
    {l.loading && !c ? <Loading /> : c && <div className="cl-table-wrap"><table className="cl-table" style={{ minWidth: 620 }}>
      <thead><tr><th>Thuốc</th><th>Lô</th><th>Hạn</th><th>Hệ thống</th><th>Đếm thực tế</th><th>Chênh lệch</th></tr></thead>
      <tbody>{c.lines.map((x) => { const v = cur(x); const diff = v === '' || v == null ? null : Number(v) - x.expected_qty; return <tr key={x.id}>
        <td><b>{x.medicine_name}</b></td><td>{x.lot_no || <span className="cl-muted">chưa theo lô</span>}</td><td>{x.expiry_date ? fmtDate(x.expiry_date) : '—'}</td><td>{x.expected_qty} {x.unit}</td>
        <td>{draft ? <input type="number" min={0} value={v} onChange={(e) => setVals((s) => ({ ...s, [x.id]: e.target.value }))} style={{ width: 90 }} /> : (x.counted_qty ?? '—')}</td>
        <td>{diff == null ? '—' : <Pill tone={diff === 0 ? 'green' : 'red'}>{diff > 0 ? '+' : ''}{diff}</Pill>}</td></tr>; })}</tbody></table></div>}
  </Modal>;
}

function CountsTab({ toast }) {
  const [open, setOpen] = useState(null);
  const l = useLoad(async () => arr((await api.get('/clinic/stock-counts/')).data), []);
  const rows = l.data || [];
  const start = async () => { try { const { data } = await api.post('/clinic/stock-counts/', {}); l.reload(true); setOpen(data.id); } catch (e) { toast(errMsg(e), 'err'); } };
  return <>
    <div className="cl-toolbar-row cl-bar-top"><p className="cl-muted" style={{ margin: 0 }}>Kiểm kê định kỳ: tạo phiếu → đếm thực tế → chốt để hệ thống tự điều chỉnh tồn và ghi vào thẻ kho.</p>
      <Btn kind="primary" icon={<AddRounded />} onClick={start}>Tạo phiếu kiểm kho</Btn></div>
    <Card pad={false}>
      {l.loading && !l.data ? <Loading /> : rows.length ? <div className="cl-table-wrap"><table className="cl-table">
        <thead><tr><th>Mã phiếu</th><th>Trạng thái</th><th>Số dòng</th><th>Dòng lệch</th><th>Tạo</th><th>Chốt bởi</th><th /></tr></thead>
        <tbody>{rows.map((c) => <tr key={c.id}><td><b>{c.code}</b></td><td><Pill tone={c.status === 'validated' ? 'green' : c.status === 'draft' ? 'amber' : 'gray'} dot>{c.status_label}</Pill></td>
          <td>{c.line_count}</td><td>{c.diff_count ? <b style={{ color: '#c2410c' }}>{c.diff_count}</b> : 0}</td><td>{fmtDateTime(c.created_at)}<small className="cl-sub">{c.created_by_name}</small></td>
          <td>{c.validated_by_name || '—'}</td><td><button className="cl-link" onClick={() => setOpen(c.id)}>{c.status === 'draft' ? 'Tiếp tục đếm' : 'Xem'}</button></td></tr>)}</tbody></table></div> : <Empty title="Chưa có phiếu kiểm kho" />}
    </Card>
    {open && <CountDetail id={open} onClose={() => setOpen(null)} onChanged={() => l.reload(true)} toast={toast} />}
  </>;
}

/* ------------------------------------------------------------------ Thẻ kho */
function CardTab({ meds }) {
  const [med, setMed] = useState('');
  const [kind, setKind] = useState('');
  const l = useLoad(async () => (await api.get('/clinic/stock-card/', { params: { medicine: med || undefined, kind: kind || undefined } })).data, [med, kind]);
  const rows = l.data || [];
  return <>
    <div className="cl-toolbar-row cl-bar-top">
      <select className="cl-sel" value={med} onChange={(e) => setMed(e.target.value)}><option value="">Tất cả thuốc</option>{meds.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
      <select className="cl-sel" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">Mọi loại phát sinh</option>
        {[['in', 'Nhập'], ['out', 'Xuất'], ['adjust', 'Điều chỉnh'], ['scrap', 'Hủy']].map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
    </div>
    <Card pad={false}>
      {l.loading && !l.data ? <Loading /> : rows.length ? <div className="cl-table-wrap"><table className="cl-table">
        <thead><tr><th>Thời gian</th>{!med && <th>Thuốc</th>}<th>Loại</th><th>SL</th><th>Tồn sau</th><th>Lô</th><th>Chứng từ</th><th>Người thao tác</th></tr></thead>
        <tbody>{rows.map((m) => <tr key={m.id}><td>{fmtDateTime(m.at)}</td>{!med && <td>{m.medicine_name}</td>}<td>{m.kind_label}</td>
          <td style={{ color: m.quantity < 0 ? '#c2410c' : '#15803d', fontWeight: 700 }}>{m.quantity > 0 ? '+' : ''}{m.quantity}</td><td>{m.balance_after}</td>
          <td>{m.lot_no || '—'}</td><td>{m.reference}{m.note ? <small className="cl-sub">{m.note}</small> : null}</td><td>{m.by}</td></tr>)}</tbody></table></div> : <Empty title="Chưa có phát sinh" />}
    </Card>
    <p className="cl-hint">Hiển thị tối đa 300 phát sinh gần nhất. Dùng mục Báo cáo → Kho để xuất file Excel đầy đủ.</p>
  </>;
}

/* ------------------------------------------------------------------ Nhà cung cấp */
function SupplierForm({ s, onClose, onSaved }) {
  const [f, setF] = useState(s ? { ...s } : { name: '', contact: '', phone: '', email: '', address: '', tax_code: '', note: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = async () => { try { s ? await api.patch(`/clinic/suppliers/${s.id}/`, f) : await api.post('/clinic/suppliers/', f); onSaved(); } catch (e) { setErr(errMsg(e)); } };
  return <Modal open title={s ? 'Sửa nhà cung cấp' : 'Thêm nhà cung cấp'} onClose={onClose} footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={!f.name.trim()} onClick={save}>Lưu</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <div className="cl-form-grid">
      <Field label="Tên nhà cung cấp" required span="2"><input value={f.name} onChange={set('name')} /></Field>
      <Field label="Người liên hệ"><input value={f.contact} onChange={set('contact')} /></Field><Field label="Điện thoại"><input value={f.phone} onChange={set('phone')} /></Field>
      <Field label="Email"><input value={f.email} onChange={set('email')} /></Field><Field label="Mã số thuế"><input value={f.tax_code} onChange={set('tax_code')} /></Field>
      <Field label="Địa chỉ" span="2"><input value={f.address} onChange={set('address')} /></Field><Field label="Ghi chú" span="2"><input value={f.note} onChange={set('note')} /></Field>
    </div>
  </Modal>;
}

function SuppliersTab({ toast, suppliers, reload }) {
  const [m, setM] = useState(null);
  return <>
    <div className="cl-toolbar-row cl-bar-top"><span /><Btn kind="primary" icon={<AddRounded />} onClick={() => setM({})}>Thêm nhà cung cấp</Btn></div>
    <Card pad={false}>{suppliers.length ? <div className="cl-table-wrap"><table className="cl-table">
      <thead><tr><th>Mã</th><th>Nhà cung cấp</th><th>Liên hệ</th><th>Mã số thuế</th><th>Số đơn</th><th>Trạng thái</th><th /></tr></thead>
      <tbody>{suppliers.map((s) => <tr key={s.id}><td><small className="cl-muted">{s.code}</small></td><td><b>{s.name}</b><small className="cl-sub">{s.address}</small></td>
        <td>{s.contact || '—'}<small className="cl-sub">{[s.phone, s.email].filter(Boolean).join(' · ')}</small></td><td>{s.tax_code || '—'}</td><td>{s.order_count}</td>
        <td><Pill tone={s.is_active ? 'green' : 'gray'} dot>{s.is_active ? 'Đang hợp tác' : 'Ngừng'}</Pill></td><td><button className="cl-link" onClick={() => setM(s)}>Sửa</button></td></tr>)}</tbody></table></div> : <Empty title="Chưa có nhà cung cấp" />}</Card>
    {m && <SupplierForm s={m.id ? m : null} onClose={() => setM(null)} onSaved={() => { setM(null); reload(); toast('Đã lưu nhà cung cấp.'); }} />}
  </>;
}

/* ------------------------------------------------------------------ Trang chính */
export default function InventoryPage() {
  const { user } = useAuth();
  const manager = user.role === 'manager';
  const [tab, setTab] = useState('stock');
  const [toast, toastNode] = useToast();
  const ov = useLoad(async () => (await api.get('/clinic/inventory/overview/')).data, [tab]);
  const sup = useLoad(async () => (manager ? arr((await api.get('/clinic/suppliers/')).data) : []), [manager]);
  const medL = useLoad(async () => arr((await api.get('/clinic/medicines/', { params: { limit: 500 } })).data), []);
  const meds = useMemo(() => medL.data || [], [medL.data]);
  const o = ov.data;
  const tabs = [['stock', 'Tồn kho'], ['lots', 'Lô & hạn dùng'], ['card', 'Thẻ kho'], ...(manager ? [['orders', 'Đơn mua & nhận hàng'], ['counts', 'Kiểm kho'], ['sup', 'Nhà cung cấp']] : [])];
  return <>
    <PageHead />
    {o && <div className="cl-stat-row">
      <Kpi label="Mặt hàng đang quản lý" value={o.items} hint={`${o.low} mặt hàng dưới mức tối thiểu`} tone={o.low ? 'amber' : ''} onClick={() => setTab('stock')} />
      {o.value != null ? <Kpi label="Giá trị tồn kho (giá vốn)" value={money(o.value)} onClick={() => setTab('card')} /> : <Kpi label="Đơn nhập đang chờ" value={o.open_orders} />}
      <Kpi label={`Lô sắp hết hạn (≤ ${o.expiry_warning_days || 90} ngày)`} value={o.expiring} hint={o.expired ? `${o.expired} lô đã quá hạn — cần xử lý` : 'Không có lô quá hạn'} tone={o.expired ? 'red' : o.expiring ? 'amber' : 'green'} onClick={() => setTab('lots')} />
      <Kpi label={manager ? 'Đơn mua chờ nhận' : 'Phiếu kiểm đang mở'} value={manager ? o.open_orders : o.open_counts} hint={manager ? `${o.open_counts} phiếu kiểm đang mở` : ''} tone="blue" onClick={() => setTab(manager ? 'orders' : 'stock')} />
    </div>}
    {manager && <div className="cl-inventory-flow" aria-label="Quy trình quản lý kho"><span>Quy trình kho</span><ol><li>Nhu cầu mua</li><li>Đơn mua</li><li>Nhận theo lô</li><li>Kiểm kê</li><li>Xuất FEFO</li></ol><small>Ưu tiên lô hết hạn trước khi cấp phát.</small></div>}
    <nav className="cl-tabs" role="tablist">{tabs.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}</nav>
    {tab === 'stock' && <StockTab manager={manager} toast={toast} />}
    {tab === 'lots' && <LotsTab manager={manager} toast={toast} warningDays={o?.expiry_warning_days || 90} />}
    {tab === 'card' && <CardTab meds={meds} />}
    {tab === 'orders' && manager && <OrdersTab toast={toast} suppliers={sup.data || []} meds={meds} />}
    {tab === 'counts' && manager && <CountsTab toast={toast} />}
    {tab === 'sup' && manager && <SuppliersTab toast={toast} suppliers={sup.data || []} reload={() => sup.reload(true)} />}
    {toastNode}
  </>;
}
