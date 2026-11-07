import { useMemo, useState } from 'react';
import AddRounded from '@mui/icons-material/AddRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import api from '../api/client';
import { Select } from './Money';
import { LGrid, ProductPicker, Seg, StatusTabs, arr, nf, useMeds } from './StockKit';
import { Avatar, Modal, Pill, errMsg, fmtDate, fmtDateTime, isoDay, money, useLoad } from './ui';

const cnt = (rows, key = 'status') => rows.reduce((a, r) => ({ ...a, [r[key]]: (a[r[key]] || 0) + 1, all: (a.all || 0) + 1 }), {});
const ST_TONE = { draft: 'gray', ordered: 'blue', pending: 'blue', planned: 'blue', partial: 'amber', received: 'green', validated: 'green', done: 'green', cancelled: 'red' };
const Back = ({ onClick, children }) => <button className="pb-back" onClick={onClick}><ArrowBackRounded />{children}</button>;

/* ================================================================== KIỂM KHO */
function CountWizard({ locs, onClose, onCreated, toast }) {
  const [step, setStep] = useState(1); const meds = useMeds();
  const [f, setF] = useState({ name: `Kiểm kho ${fmtDate(new Date())}`, location: '', note: '' });
  const [all, setAll] = useState(true); const [pick, setPick] = useState([]); const [q, setQ] = useState(''); const [busy, setBusy] = useState(false);
  const shown = meds.list.filter((m) => !q.trim() || m.name.toLowerCase().includes(q.trim().toLowerCase()));
  const toggle = (id) => setPick((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const loc = locs.find((x) => String(x.id) === String(f.location));
  const create = async () => {
    setBusy(true);
    try { const { data } = await api.post('/clinic/stock-counts/', { name: f.name, note: f.note, location: f.location || null, medicine_ids: all ? undefined : pick }); toast('Đã tạo phiếu kiểm kho.'); onCreated(data.id); }
    catch (e) { toast(errMsg(e), 'err'); setBusy(false); }
  };
  const next = step < 3 ? <button className="pb-btn blue" disabled={(step === 1 && !f.name.trim()) || (step === 2 && !all && !pick.length)} onClick={() => setStep(step + 1)}>Tiếp tục</button>
    : <button className="pb-btn blue" disabled={busy} onClick={create}>Bắt đầu kiểm kho</button>;
  return <Modal open wide title="Kiểm kho mới" onClose={onClose}
    footer={<>{step > 1 ? <button className="pb-btn" onClick={() => setStep(step - 1)}>Quay lại</button> : <button className="pb-btn" onClick={onClose}>Hủy</button>}{next}</>}>
    <div className="st-wiz">{['1. Thông tin', '2. Chọn sản phẩm', '3. Xem lại'].map((t, i) => <span key={t} className={step === i + 1 ? 'on' : step > i + 1 ? 'done' : ''}>{t}</span>)}</div>
    {step === 1 && <div className="st-form"><label className="s2">Tên đợt kiểm<input className="st-in" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
      <label className="s2">Kho cần kiểm<select className="st-in" value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}><option value="">Toàn bộ kho</option>{locs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label className="s2" style={{ gridColumn: 'span 4' }}>Ghi chú<input className="st-in" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ví dụ: kiểm định kỳ cuối tháng" /></label></div>}
    {step === 2 && <>
      <Seg value={all ? 'all' : 'pick'} onChange={(v) => setAll(v === 'all')} options={[['all', 'Tất cả sản phẩm'], ['pick', 'Chọn sản phẩm']]} />
      {!all && <><label className="pb-search" style={{ margin: '10px 0' }}><SearchRounded /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm sản phẩm…" /></label>
        <div className="st-list" style={{ maxHeight: 280, overflow: 'auto', border: '1px solid var(--line)', borderRadius: 8 }}>
          <div><input type="checkbox" checked={shown.length > 0 && shown.every((m) => pick.includes(m.id))} onChange={(e) => setPick((p) => (e.target.checked ? [...new Set([...p, ...shown.map((m) => m.id)])] : p.filter((id) => !shown.some((m) => m.id === id))))} /><b>Chọn tất cả ({shown.length})</b></div>
          {shown.map((m) => <div key={m.id}><input type="checkbox" checked={pick.includes(m.id)} onChange={() => toggle(m.id)} /><span className="grow"><b>{m.name}</b><small>{m.code} · tồn {m.stock} {m.unit}</small></span></div>)}</div></>}
      {all && <p style={{ marginTop: 12, fontSize: 'var(--fs)' }}>Phiếu kiểm sẽ gồm mọi sản phẩm đang kinh doanh{loc ? ` có hàng tại “${loc.name}”` : ''}.</p>}</>}
    {step === 3 && <div className="st-list" style={{ border: '1px solid var(--line)', borderRadius: 8 }}>
      <div><span className="grow"><small>Tên đợt kiểm</small><b>{f.name}</b></span></div><div><span className="grow"><small>Kho</small><b>{loc?.name || 'Toàn bộ kho'}</b></span></div>
      <div><span className="grow"><small>Phạm vi</small><b>{all ? 'Tất cả sản phẩm' : `${pick.length} sản phẩm đã chọn`}</b></span></div>{f.note && <div><span className="grow"><small>Ghi chú</small><b>{f.note}</b></span></div>}</div>}
  </Modal>;
}

function CountDetail({ id, onBack, toast }) {
  const l = useLoad(async () => (await api.get(`/clinic/stock-counts/${id}/`)).data, [id]);
  const [vals, setVals] = useState({}); const [q, setQ] = useState(''); const [busy, setBusy] = useState(false);
  const c = l.data;
  if (!c) return <div className="pb-card"><p className="pb-empty">{l.error || 'Đang tải…'}</p></div>;
  const open = c.status === 'draft';
  const val = (r) => (r.id in vals ? vals[r.id] : r.counted_qty ?? '');
  const lines = c.lines.filter((r) => !q.trim() || r.medicine_name.toLowerCase().includes(q.trim().toLowerCase()) || (r.lot_no || '').toLowerCase().includes(q.trim().toLowerCase()));
  const payload = () => Object.entries(vals).map(([k, v]) => ({ id: Number(k), counted_qty: v === '' ? null : Number(v) }));
  const save = async () => { await api.post(`/clinic/stock-counts/${id}/lines/`, { lines: payload() }); setVals({}); await l.reload(true); };
  const run = async (fn, msg) => { setBusy(true); try { await fn(); if (msg) toast(msg); } catch (e) { toast(errMsg(e), 'err'); } setBusy(false); };
  const diffOf = (r) => { const v = val(r); return v === '' ? null : Number(v) - r.expected_qty; };
  const filled = c.lines.filter((r) => val(r) !== '').length; const diffs = c.lines.filter((r) => diffOf(r)).length;
  return <div className="st-page">
    <header><div><Back onClick={onBack}>Danh sách kiểm kho</Back><h2>{c.name || c.code} <small>· {c.code}</small></h2><small>{c.location_name || 'Toàn bộ kho'} · tạo {fmtDateTime(c.created_at)} bởi {c.created_by_name}</small></div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Pill tone={ST_TONE[c.status]}>{c.status_label}</Pill>
        {open && <><label className="pb-search"><SearchRounded /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm sản phẩm / lô…" /></label>
          <button className="pb-btn" onClick={() => setVals((v) => ({ ...v, ...Object.fromEntries(c.lines.filter((r) => val(r) === '').map((r) => [r.id, r.expected_qty])) }))}>Điền số hệ thống cho dòng trống</button></>}</div></header>
    <div style={{ padding: 0, overflow: 'auto' }}><table className="st-lines"><thead><tr><th>Sản phẩm</th><th>Số lô</th><th>Hạn dùng</th><th className="r">Tồn hệ thống</th><th className="r">Đếm thực tế</th><th className="r">Chênh lệch</th></tr></thead>
      <tbody>{lines.map((r) => { const d = diffOf(r); return <tr key={r.id}><td><b>{r.medicine_name}</b> <small className="pb-code">{r.medicine_code}</small></td><td>{r.lot_no}</td><td>{r.expiry_date ? fmtDate(r.expiry_date) : '—'}</td>
        <td className="r">{r.expected_qty} {r.unit}</td><td className="r">{open ? <input className="st-in num" type="number" min={0} value={val(r)} onChange={(e) => setVals((v) => ({ ...v, [r.id]: e.target.value }))} /> : r.counted_qty}</td>
        <td className="r">{d == null ? '—' : <span className={`st-diff ${d > 0 ? 'pos' : d < 0 ? 'neg' : ''}`}>{d > 0 ? '+' : ''}{d}</span>}</td></tr>; })}</tbody></table></div>
    <footer><span className="st-sum" style={{ marginRight: 'auto', marginTop: 0 }}><span>Đã đếm <b>{filled}/{c.lines.length}</b></span><span>Có chênh lệch <b>{diffs}</b></span></span>
      {open ? <><button className="pb-btn" disabled={busy} onClick={() => window.confirm('Hủy phiếu kiểm này?') && run(async () => { await api.post(`/clinic/stock-counts/${id}/cancel/`); onBack(true); })}>Hủy phiếu</button>
        <button className="pb-btn" disabled={busy || !Object.keys(vals).length} onClick={() => run(save, 'Đã lưu số đếm.')}>Lưu tạm</button>
        <button className="pb-btn blue" disabled={busy || filled < c.lines.length} title={filled < c.lines.length ? 'Cần nhập đủ số đếm cho mọi dòng' : ''}
          onClick={() => window.confirm(`Chốt kiểm kho? ${diffs} dòng chênh lệch sẽ được điều chỉnh vào tồn kho.`) && run(async () => { if (Object.keys(vals).length) await save(); await api.post(`/clinic/stock-counts/${id}/validate/`); onBack(true); }, 'Đã chốt kiểm kho và điều chỉnh tồn.')}>Chốt kiểm kho</button></>
        : <button className="pb-btn" onClick={() => onBack()}>Đóng</button>}</footer>
  </div>;
}

export function CountsTab({ toast, locs }) {
  const [view, setView] = useState(null); const [wiz, setWiz] = useState(false); const [st, setSt] = useState('');
  const l = useLoad(async () => arr((await api.get('/clinic/stock-counts/')).data), []);
  const rows = l.data || []; const shown = st ? rows.filter((r) => r.status === st) : rows;
  if (view) return <CountDetail id={view} toast={toast} onBack={(r) => { setView(null); if (r) l.reload(true); }} />;
  const columns = [
    { key: 'name', label: 'Đợt kiểm', render: (r) => <span><b>{r.name || 'Kiểm kho'}</b> <small className="pb-code">{r.code}</small></span> },
    { key: 'location_name', label: 'Kho', render: (r) => r.location_name || 'Toàn bộ kho' },
    { key: 'status', label: 'Trạng thái', render: (r) => <Pill tone={ST_TONE[r.status]}>{r.status_label}</Pill> },
    { key: 'counted', label: 'Tiến độ', render: (r) => <span className="st-prog"><span className="st-bar"><i style={{ width: `${r.line_count ? (r.counted / r.line_count) * 100 : 0}%` }} /></span>{r.counted}/{r.line_count}</span>, sort: (r) => r.counted },
    { key: 'diff_count', label: 'Chênh lệch', align: 'r' },
    { key: 'created_at', label: 'Ngày tạo', render: (r) => fmtDateTime(r.created_at), sort: (r) => r.created_at },
    { key: 'created_by_name', label: 'Người tạo', render: (r) => <span className="pb-client"><Avatar name={r.created_by_name} size={20} />{r.created_by_name}</span> },
  ];
  return <>
    <StatusTabs value={st} onChange={setSt} counts={cnt(rows)} options={[['', 'Tất cả'], ['draft', 'Đang kiểm'], ['validated', 'Đã chốt'], ['cancelled', 'Đã hủy']]} />
    <LGrid id="stock-counts" title="Kiểm kho" unit="phiếu" columns={columns} rows={shown} loading={l.loading} onRow={(r) => setView(r.id)}
      toolbar={<button className="pb-btn sm blue" onClick={() => setWiz(true)}><AddRounded />Kiểm kho mới</button>} />
    {wiz && <CountWizard locs={locs} toast={toast} onClose={() => setWiz(false)} onCreated={(id) => { setWiz(false); l.reload(true); setView(id); }} />}
  </>;
}

/* ================================================================== ĐƠN HÀNG */
function OrderEditor({ order, suppliers, locs, meds, onBack, onSaved, toast }) {
  const status = order?.status || 'draft'; const editable = status === 'draft'; const receiving = status === 'ordered' || status === 'partial';
  const [f, setF] = useState({ supplier: order?.supplier || '', location: order?.location || '', supplier_ref: order?.supplier_ref || '', expected_date: order?.expected_date || '', note: order?.note || '' });
  const [lines, setLines] = useState(order?.lines?.map((x) => ({ medicine: x.medicine, quantity: x.quantity, unit_cost: x.unit_cost })) || [{ medicine: '', quantity: 10, unit_cost: 0 }]);
  const [recv, setRecv] = useState(() => (order?.lines || []).map((x) => ({ line_id: x.id, quantity: x.quantity - x.received_qty, lot_no: '', expiry: '' })));
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const setLine = (i, k, v) => setLines((a) => a.map((x, j) => { if (j !== i) return x; const n = { ...x, [k]: v }; if (k === 'medicine') n.unit_cost = meds.find((m) => String(m.id) === String(v))?.cost || 0; return n; }));
  const total = (editable ? lines : order?.lines || []).reduce((s, x) => s + (Number(x.quantity) || 0) * (Number(x.unit_cost) || 0), 0);
  const body = () => ({ ...f, supplier: f.supplier, location: f.location || null, expected_date: f.expected_date || null, lines: lines.filter((x) => x.medicine).map((x) => ({ medicine: x.medicine, quantity: Number(x.quantity), unit_cost: Number(x.unit_cost) })) });
  const run = async (fn, msg) => { setBusy(true); setErr(''); try { await fn(); if (msg) toast(msg); } catch (e) { setErr(errMsg(e)); } setBusy(false); };
  const save = async () => (order ? (await api.put(`/clinic/purchase-orders/${order.id}/`, body())).data : (await api.post('/clinic/purchase-orders/', body())).data);
  const post = (a, data) => api.post(`/clinic/purchase-orders/${order.id}/${a}/`, data);
  return <div className="st-page">
    <header><div><Back onClick={() => onBack()}>Danh sách đơn hàng</Back><h2>{order ? `Đơn nhập ${order.code}` : 'Đơn nhập hàng mới'}</h2>{order && <small>Tạo {fmtDateTime(order.created_at)} · {order.created_by_name}</small>}</div>{order && <Pill tone={ST_TONE[status]}>{order.status_label}</Pill>}</header>
    <div>{err && <div className="st-warn red">{err}</div>}
      <div className="st-form">
        <label className="s2">Nhà cung cấp<select className="st-in" disabled={!editable} value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })}><option value="">— Chọn —</option>{suppliers.filter((s) => s.is_active || s.id === f.supplier).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label className="s2">Nhập về kho<select className="st-in" disabled={!editable} value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}><option value="">Kho mặc định</option>{locs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <label>Số chứng từ NCC<input className="st-in" disabled={!editable} value={f.supplier_ref} onChange={(e) => setF({ ...f, supplier_ref: e.target.value })} /></label>
        <label>Ngày dự kiến nhận<input className="st-in" type="date" disabled={!editable} value={f.expected_date || ''} onChange={(e) => setF({ ...f, expected_date: e.target.value })} /></label>
        <label className="s2">Ghi chú<input className="st-in" disabled={!editable} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label></div>
      {editable && <table className="st-lines"><thead><tr><th>Sản phẩm</th><th className="r">Số lượng</th><th className="r">Đơn giá nhập</th><th className="r">Thành tiền</th><th /></tr></thead><tbody>
        {lines.map((x, i) => <tr key={i}><td style={{ width: '48%' }}><ProductPicker meds={meds} value={x.medicine} onChange={(v) => setLine(i, 'medicine', v)} /></td>
          <td className="r"><input className="st-in num" type="number" min={1} value={x.quantity} onChange={(e) => setLine(i, 'quantity', e.target.value)} /></td>
          <td className="r"><input className="st-in num" style={{ width: 110 }} type="number" min={0} value={x.unit_cost} onChange={(e) => setLine(i, 'unit_cost', e.target.value)} /></td>
          <td className="r"><b>{money((Number(x.quantity) || 0) * (Number(x.unit_cost) || 0))}</b></td>
          <td><button className="cl-icon-btn" onClick={() => setLines((a) => a.filter((_, j) => j !== i))} aria-label="Xóa dòng"><DeleteOutlineRounded /></button></td></tr>)}</tbody></table>}
      {editable && <button className="pb-btn sm" style={{ marginTop: 8 }} onClick={() => setLines((a) => [...a, { medicine: '', quantity: 10, unit_cost: 0 }])}><AddRounded />Thêm sản phẩm</button>}
      {!editable && <table className="st-lines"><thead><tr><th>Sản phẩm</th><th className="r">Đã đặt</th><th className="r">Đã nhận</th><th className="r">Đơn giá</th>{receiving && <><th className="r">Nhận lần này</th><th>Số lô</th><th>Hạn dùng</th></>}</tr></thead><tbody>
        {order.lines.map((x, i) => { const left = x.quantity - x.received_qty; return <tr key={x.id}><td><b>{x.medicine_name}</b></td><td className="r">{x.quantity} {x.unit}</td><td className="r">{x.received_qty}</td><td className="r">{money(x.unit_cost)}</td>
          {receiving && <><td className="r">{left > 0 ? <input className="st-in num" type="number" min={0} max={left} value={recv[i].quantity} onChange={(e) => setRecv((a) => a.map((r, j) => (j === i ? { ...r, quantity: e.target.value } : r)))} /> : '—'}</td>
            <td>{left > 0 && <input className="st-in" style={{ width: 110 }} value={recv[i].lot_no} onChange={(e) => setRecv((a) => a.map((r, j) => (j === i ? { ...r, lot_no: e.target.value } : r)))} placeholder="Số lô" />}</td>
            <td>{left > 0 && <input className="st-in" style={{ width: 130 }} type="date" value={recv[i].expiry} onChange={(e) => setRecv((a) => a.map((r, j) => (j === i ? { ...r, expiry: e.target.value } : r)))} />}</td></>}</tr>; })}</tbody></table>}
      <div className="st-sum"><span>Tổng giá trị đơn <b>{money(total)}</b></span>{order?.location_name && <span>Nhập về <b>{order.location_name}</b></span>}</div></div>
    <footer>
      {!order && <button className="pb-btn blue" disabled={busy || !f.supplier || !lines.some((x) => x.medicine)} onClick={() => run(async () => { const d = await save(); onSaved(d.id); }, 'Đã lưu đơn nháp.')}>Lưu nháp</button>}
      {order && editable && <><button className="pb-btn" disabled={busy} onClick={() => run(async () => { await save(); onSaved(order.id); }, 'Đã lưu.')}>Lưu nháp</button>
        <button className="pb-btn blue" disabled={busy || !f.supplier} onClick={() => run(async () => { await save(); await post('confirm'); onSaved(order.id); }, 'Đã xác nhận đặt hàng.')}>Xác nhận đặt hàng</button></>}
      {order && receiving && <button className="pb-btn blue" disabled={busy} onClick={() => run(async () => { await post('receive', { lines: recv.filter((r) => Number(r.quantity) > 0).map((r) => ({ ...r, quantity: Number(r.quantity), expiry: r.expiry || null })) }); onSaved(order.id); }, 'Đã nhập hàng vào kho.')}>Nhận hàng vào kho</button>}
      {order && (editable || (receiving && !order.lines.some((x) => x.received_qty))) && <button className="pb-btn" disabled={busy} onClick={() => window.confirm('Hủy đơn nhập này?') && run(async () => { await post('cancel'); onSaved(order.id); }, 'Đã hủy đơn.')}>Hủy đơn</button>}
    </footer>
  </div>;
}

export function OrdersTab({ toast, locs, suppliers }) {
  const [view, setView] = useState(undefined); const [st, setSt] = useState(''); const meds = useMeds();
  const l = useLoad(async () => arr((await api.get('/clinic/purchase-orders/')).data), []);
  const rows = l.data || []; const shown = st ? rows.filter((r) => r.status === st) : rows;
  const one = useLoad(async () => (view ? (await api.get(`/clinic/purchase-orders/${view}/`)).data : null), [view]);
  if (view !== undefined) {
    if (view && !one.data) return <div className="pb-card"><p className="pb-empty">{one.error || 'Đang tải…'}</p></div>;
    return <OrderEditor key={`${view}-${one.data?.status}-${one.data?.lines?.map((x) => x.received_qty).join(',')}`} order={view ? one.data : null} suppliers={suppliers} locs={locs} meds={meds.list} toast={toast}
      onBack={() => { setView(undefined); l.reload(true); }} onSaved={(id) => { l.reload(true); if (id === view) one.reload(true); else setView(id); }} />;
  }
  const columns = [
    { key: 'code', label: 'Số đơn', render: (r) => <span><b>{r.code}</b>{r.supplier_ref && <small className="pb-code"> {r.supplier_ref}</small>}</span> },
    { key: 'supplier_name', label: 'Nhà cung cấp' },
    { key: 'status', label: 'Trạng thái', render: (r) => <Pill tone={ST_TONE[r.status]}>{r.status_label}</Pill> },
    { key: 'items', label: 'Sản phẩm', align: 'r', render: (r) => `${r.lines.length}`, sort: (r) => r.lines.length },
    { key: 'recv', label: 'Đã nhận', render: (r) => { const a = r.lines.reduce((s, x) => s + x.quantity, 0); const b = r.lines.reduce((s, x) => s + x.received_qty, 0); return <span className="st-prog"><span className="st-bar"><i style={{ width: `${a ? (b / a) * 100 : 0}%` }} /></span>{b}/{a}</span>; }, sort: (r) => r.lines.reduce((s, x) => s + x.received_qty, 0) },
    { key: 'location_name', label: 'Nhập về', render: (r) => r.location_name || 'Kho mặc định' },
    { key: 'total', label: 'Giá trị', align: 'r', render: (r) => money(r.total) },
    { key: 'expected_date', label: 'Dự kiến', render: (r) => (r.expected_date ? fmtDate(r.expected_date) : '—') },
    { key: 'created_at', label: 'Ngày tạo', render: (r) => fmtDate(r.created_at), sort: (r) => r.created_at },
  ];
  return <>
    <StatusTabs value={st} onChange={setSt} counts={cnt(rows)} options={[['', 'Tất cả'], ['draft', 'Nháp'], ['ordered', 'Đã đặt'], ['partial', 'Nhận một phần'], ['received', 'Đã nhận đủ'], ['cancelled', 'Đã hủy']]} />
    <LGrid id="stock-orders" title="Đơn nhập hàng" unit="đơn" columns={columns} rows={shown} loading={l.loading} onRow={(r) => setView(r.id)}
      toolbar={<button className="pb-btn sm blue" onClick={() => setView(null)}><AddRounded />Đơn mới</button>} />
  </>;
}

/* ================================================================== CHUYỂN KHO */
function TransferForm({ t, locs, meds, onClose, onSaved, toast }) {
  const [f, setF] = useState({ from_location: t?.from_location || locs.find((x) => x.is_default)?.id || '', to_location: t?.to_location || '', note: t?.note || '' });
  const [lines, setLines] = useState(t?.lines?.map((x) => ({ medicine: x.medicine, quantity: x.quantity })) || [{ medicine: '', quantity: 1 }]);
  const [err, setErr] = useState('');
  const save = async (send) => {
    try {
      const body = { ...f, lines: lines.filter((x) => x.medicine).map((x) => ({ medicine: x.medicine, quantity: Number(x.quantity) })) };
      const { data } = t ? await api.put(`/clinic/stock/transfers/${t.id}/`, body) : await api.post('/clinic/stock/transfers/', body);
      if (send) await api.post(`/clinic/stock/transfers/${data.id}/send/`);
      toast(send ? 'Đã gửi phiếu chuyển kho.' : 'Đã lưu phiếu nháp.'); onSaved();
    } catch (e) { setErr(errMsg(e)); }
  };
  const ok = f.from_location && f.to_location && String(f.from_location) !== String(f.to_location) && lines.some((x) => x.medicine && Number(x.quantity) > 0);
  return <Modal open wide title={t ? `Sửa phiếu ${t.code}` : 'Chuyển kho mới'} onClose={onClose}
    footer={<><button className="pb-btn" onClick={onClose}>Hủy</button><button className="pb-btn" disabled={!ok} onClick={() => save(false)}>Lưu nháp</button><button className="pb-btn blue" disabled={!ok} onClick={() => save(true)}>Lưu & gửi</button></>}>
    {err && <div className="st-warn red">{err}</div>}
    <div className="st-form"><label className="s2">Từ kho<select className="st-in" value={f.from_location} onChange={(e) => setF({ ...f, from_location: Number(e.target.value) })}><option value="">— Chọn —</option>{locs.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label className="s2">Đến kho<select className="st-in" value={f.to_location} onChange={(e) => setF({ ...f, to_location: Number(e.target.value) })}><option value="">— Chọn —</option>{locs.filter((x) => x.id !== f.from_location).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <label style={{ gridColumn: 'span 4' }}>Ghi chú<input className="st-in" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label></div>
    <table className="st-lines"><thead><tr><th>Sản phẩm</th><th className="r">Số lượng chuyển</th><th /></tr></thead><tbody>
      {lines.map((x, i) => <tr key={i}><td style={{ width: '65%' }}><ProductPicker meds={meds} value={x.medicine} onChange={(v) => setLines((a) => a.map((y, j) => (j === i ? { ...y, medicine: v } : y)))} /></td>
        <td className="r"><input className="st-in num" type="number" min={1} value={x.quantity} onChange={(e) => setLines((a) => a.map((y, j) => (j === i ? { ...y, quantity: e.target.value } : y)))} /></td>
        <td><button className="cl-icon-btn" onClick={() => setLines((a) => a.filter((_, j) => j !== i))}><DeleteOutlineRounded /></button></td></tr>)}</tbody></table>
    <button className="pb-btn sm" style={{ marginTop: 8 }} onClick={() => setLines((a) => [...a, { medicine: '', quantity: 1 }])}><AddRounded />Thêm sản phẩm</button>
  </Modal>;
}

function TransferPreview({ id, onClose, onChanged, onEdit, toast }) {
  const l = useLoad(async () => (await api.get(`/clinic/stock/transfers/${id}/`)).data, [id]);
  const [rows, setRows] = useState(null); const [busy, setBusy] = useState(false);
  const t = l.data;
  if (!t) return <Modal open title="Phiếu chuyển kho" onClose={onClose}><p className="pb-empty">{l.error || 'Đang tải…'}</p></Modal>;
  const waiting = t.status === 'pending' || t.status === 'partial';
  const run = async (fn, msg) => { setBusy(true); try { await fn(); toast(msg); onChanged(); await l.reload(true); setRows(null); } catch (e) { toast(errMsg(e), 'err'); } setBusy(false); };
  const act = (a, data) => api.post(`/clinic/stock/transfers/${id}/${a}/`, data);
  return <Modal open wide title={`Phiếu chuyển ${t.code}`} subtitle={`${t.from_name} → ${t.to_name} · ${fmtDateTime(t.created_at)} · ${t.created_by_name}`} onClose={onClose}
    footer={<>{t.status === 'draft' && <><button className="pb-btn" disabled={busy} onClick={() => window.confirm('Hủy phiếu này?') && run(() => act('cancel'), 'Đã hủy phiếu.')}>Hủy phiếu</button><button className="pb-btn" onClick={() => onEdit(t)}>Sửa</button><button className="pb-btn blue" disabled={busy} onClick={() => run(() => act('send'), 'Đã gửi phiếu chuyển kho.')}>Gửi đi</button></>}
      {waiting && <>{!t.lines.some((x) => x.received_qty) && <button className="pb-btn" disabled={busy} onClick={() => window.confirm('Hủy phiếu này?') && run(() => act('cancel'), 'Đã hủy phiếu.')}>Hủy phiếu</button>}
        {rows ? <button className="pb-btn blue" disabled={busy} onClick={() => run(() => act('receive', { lines: t.lines.map((x) => ({ line_id: x.id, quantity: Number(rows[x.id] ?? 0) })) }), 'Đã nhận hàng.')}>Xác nhận nhận hàng</button>
          : <><button className="pb-btn" onClick={() => setRows(Object.fromEntries(t.lines.map((x) => [x.id, x.quantity - x.received_qty])))}>Nhận một phần</button><button className="pb-btn blue" disabled={busy} onClick={() => run(() => act('receive', {}), 'Đã nhận đủ hàng.')}>Nhận hết</button></>}</>}
      {!waiting && t.status !== 'draft' && <button className="pb-btn" onClick={onClose}>Đóng</button>}</>}>
    <div style={{ marginBottom: 10 }}><Pill tone={ST_TONE[t.status]}>{t.status_label}</Pill>{t.note && <span style={{ marginLeft: 10, fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>{t.note}</span>}</div>
    {t.short.length > 0 && <div className="st-warn red">Kho nguồn không đủ hàng: {t.short.map((s) => `${s.medicine} (cần ${s.need}, còn ${s.have})`).join('; ')}.</div>}
    <table className="st-lines"><thead><tr><th>Sản phẩm</th><th className="r">Số lượng chuyển</th><th className="r">Đã nhận</th>{rows && <th className="r">Nhận lần này</th>}</tr></thead><tbody>
      {t.lines.map((x) => <tr key={x.id}><td><b>{x.medicine_name}</b> <small className="pb-code">{x.code}</small></td><td className="r">{x.quantity} {x.unit}</td><td className="r">{x.received_qty}</td>
        {rows && <td className="r"><input className="st-in num" type="number" min={0} max={x.quantity - x.received_qty} value={rows[x.id]} onChange={(e) => setRows({ ...rows, [x.id]: e.target.value })} /></td>}</tr>)}</tbody></table>
    <p style={{ marginTop: 10, fontSize: 'var(--fs-sm)', color: 'var(--muted)' }}>Tồn kho chỉ thay đổi vị trí khi kho nhận xác nhận nhận hàng; lô được giữ nguyên số lô, hạn dùng và giá vốn.</p>
  </Modal>;
}

export function TransfersTab({ toast, locs }) {
  const [st, setSt] = useState(''); const [form, setForm] = useState(null); const [open, setOpen] = useState(null); const meds = useMeds();
  const l = useLoad(async () => arr((await api.get('/clinic/stock/transfers/')).data), []);
  const rows = l.data || []; const shown = st ? rows.filter((r) => r.status === st) : rows;
  const columns = [
    { key: 'code', label: 'Số phiếu', render: (r) => <b>{r.code}</b> },
    { key: 'route', label: 'Tuyến chuyển', render: (r) => `${r.from_name} → ${r.to_name}`, sort: (r) => r.from_name },
    { key: 'status', label: 'Trạng thái', render: (r) => <Pill tone={ST_TONE[r.status]}>{r.status_label}</Pill> },
    { key: 'lines', label: 'Sản phẩm', align: 'r', render: (r) => r.lines.length, sort: (r) => r.lines.length },
    { key: 'total_qty', label: 'Tổng SL', align: 'r', render: (r) => nf(r.total_qty) },
    { key: 'created_at', label: 'Ngày tạo', render: (r) => fmtDateTime(r.created_at), sort: (r) => r.created_at },
    { key: 'received_at', label: 'Ngày nhận', render: (r) => (r.received_at ? fmtDate(r.received_at) : '—') },
    { key: 'created_by_name', label: 'Người tạo' },
  ];
  return <>
    <StatusTabs value={st} onChange={setSt} counts={cnt(rows)} options={[['', 'Tất cả'], ['draft', 'Nháp'], ['pending', 'Chờ nhận'], ['partial', 'Nhận một phần'], ['received', 'Đã nhận'], ['cancelled', 'Đã hủy']]} />
    <LGrid id="stock-transfers" title="Chuyển kho" unit="phiếu" columns={columns} rows={shown} loading={l.loading} onRow={(r) => setOpen(r.id)}
      toolbar={<button className="pb-btn sm blue" onClick={() => setForm({})}><AddRounded />Chuyển kho mới</button>} />
    {form && <TransferForm t={form.id ? form : null} locs={locs} meds={meds.list} toast={toast} onClose={() => setForm(null)} onSaved={() => { setForm(null); l.reload(true); }} />}
    {open && <TransferPreview id={open} toast={toast} onClose={() => setOpen(null)} onChanged={() => l.reload(true)} onEdit={(t) => { setOpen(null); setForm(t); }} />}
  </>;
}
