import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AddRounded from '@mui/icons-material/AddRounded';
import AutoFixHighOutlined from '@mui/icons-material/AutoFixHighOutlined';
import DownloadRounded from '@mui/icons-material/DownloadRounded';
import GridViewOutlined from '@mui/icons-material/GridViewOutlined';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import TableRowsOutlined from '@mui/icons-material/TableRowsOutlined';
import ViewListOutlined from '@mui/icons-material/ViewListOutlined';
import TodayOutlined from '@mui/icons-material/TodayOutlined';
import WarehouseOutlined from '@mui/icons-material/WarehouseOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import EventBusyOutlined from '@mui/icons-material/EventBusyOutlined';
import LocalShippingOutlined from '@mui/icons-material/LocalShippingOutlined';
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Grid, RangePicker, Select, useGrid } from './Money';
import { StockTab, SuppliersTab } from './Inventory';
import { CountsTab, OrdersTab, TransfersTab } from './StockOps';
import { Seg, arr, download, expText, expTone, nf, useLocations } from './StockKit';
import { Modal, Pill, errMsg, fmtDate, fmtDateTime, isoDay, money, useLoad, useToast } from './ui';

const KIND_TONE = { in: 'green', out: 'blue', adjust: 'amber', scrap: 'red', transfer: 'gray' };
const dm = (iso) => { const d = new Date(`${iso}T00:00:00`); return `${d.getDate()}/${d.getMonth() + 1}`; };
const ago = (n) => isoDay(new Date(Date.now() - n * 864e5));

function Kpi({ title, value, hint, icon, tone = 'blue', onClick }) {
  return <div className="pb-kpi" style={onClick ? { cursor: 'pointer' } : undefined} onClick={onClick}><div className="pb-kpi-top"><span>{title}</span><i className={tone}>{icon}</i></div><strong>{value}</strong><small>{hint}</small></div>;
}

/* ------------------------------------------------------------------ Tổng quan */
function Overview({ go }) {
  const [range, setRange] = useState({ from: ago(29), to: isoDay() });
  const l = useLoad(async () => (await api.get('/clinic/stock/overview/', { params: range })).data, [range.from, range.to]);
  const o = l.data;
  if (!o) return <div className="pb-card"><p className="pb-empty">{l.error || 'Đang tải…'}</p></div>;
  const chart = o.days.map((d, i) => ({ d: dm(d), 'Nhập': o.in[i], 'Xuất': o.out[i] }));
  const maxQty = Math.max(1, ...o.locations.map((x) => x.qty));
  return <>
    <div className="pb-kpis">
      <Kpi title="Mặt hàng đang quản lý" value={nf(o.items)} hint={`${nf(o.units)} đơn vị tồn`} icon={<Inventory2Outlined />} />
      <Kpi title="Giá trị tồn kho" value={o.value == null ? '—' : money(o.value)} hint="Theo giá vốn" icon={<PaymentsOutlined />} tone="teal" />
      <Kpi title="Sắp hết hàng" value={o.low} hint={`${o.out_of_stock} mặt hàng đã hết`} icon={<WarningAmberRounded />} tone="amber" onClick={() => go('products')} />
      <Kpi title="Lô sắp hết hạn (≤ 90 ngày)" value={o.expiring} hint={o.expired ? `${o.expired} lô đã quá hạn` : 'Không có lô quá hạn'} icon={<EventBusyOutlined />} tone="purple" onClick={() => go('batches')} />
    </div>
    <div className="pb-kpis">
      <Kpi title="Đơn nhập chờ nhận" value={o.open_orders} hint="Đã đặt / nhận một phần" icon={<ShoppingCartOutlined />} onClick={() => go('orders')} />
      <Kpi title="Phiếu kiểm đang mở" value={o.open_counts} hint="Chưa chốt" icon={<Inventory2Outlined />} tone="teal" onClick={() => go('inventory')} />
      <Kpi title="Chuyển kho chờ nhận" value={o.pending_transfers} hint="Đã gửi, chưa nhận đủ" icon={<LocalShippingOutlined />} tone="amber" onClick={() => go('transfers')} />
    </div>
    <div className="pb-two">
      <section className="pb-card pb-metric"><div className="pb-metric-h"><span>Nhập – xuất kho theo ngày</span><RangePicker value={range} onChange={setRange} align="right" /></div>
        <div className="pb-metric-c"><ResponsiveContainer width="100%" height={230}><BarChart data={chart} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="#edf0f5" /><XAxis dataKey="d" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" /><YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} /><Legend iconType="circle" wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="Nhập" fill="#1d6fd6" radius={[3, 3, 0, 0]} /><Bar dataKey="Xuất" fill="#9bc2f0" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer></div></section>
      <section className="pb-card pb-act"><header><h3>Tồn theo kho</h3><span>{o.locations.length} kho</span></header>
        <div className="st-list">{o.locations.map((x) => <div key={x.id}><span className="grow"><b>{x.name}</b><small>{x.lots} lô{x.value != null ? ` · ${money(x.value)}` : ''}</small><div className="st-bar"><i style={{ width: `${(x.qty / maxQty) * 100}%` }} /></div></span><b>{nf(x.qty)}</b></div>)}</div></section>
    </div>
    <div className="pb-two even">
      <section className="pb-card pb-act"><header><h3>Cần nhập thêm</h3><span>Dưới mức tối thiểu</span></header>
        {o.low_items.length ? <div className="st-list">{o.low_items.map((m) => <div key={m.id}><span className="grow"><b>{m.name}</b><small>{m.code} · tối thiểu {m.min_stock} {m.unit}</small></span><Pill tone={m.stock <= 0 ? 'red' : 'amber'}>{m.stock} {m.unit}</Pill></div>)}</div> : <p className="pb-empty">Tất cả mặt hàng đều đủ tồn.</p>}</section>
      <section className="pb-card pb-act"><header><h3>Lô sắp hết hạn</h3><span>Trong 90 ngày</span></header>
        {o.expiring_lots.length ? <div className="st-list">{o.expiring_lots.map((x) => <div key={x.id}><span className="grow"><b>{x.medicine}</b><small>Lô {x.lot_no || `#${x.id}`} · còn {x.qty} · HSD {fmtDate(x.expiry)}</small></span><Pill tone={expTone(x.days)}>{expText(x.days)}</Pill></div>)}</div> : <p className="pb-empty">Không có lô nào sắp hết hạn.</p>}</section>
    </div>
  </>;
}

/* ------------------------------------------------------------------ Biến động */
function MovementTab({ locs }) {
  const g = useGrid('stock/movements', {}, { from: ago(29), to: isoDay() });
  const [busy, setBusy] = useState(false); const [toast, toastNode] = useToast();
  const f = g.filters; const set = (k, v) => g.setFilters((x) => ({ ...x, [k]: v || undefined }));
  const exp = async () => { setBusy(true); try { await download('/clinic/stock/movements/', { ...(g.range || {}), ...f }, 'bien-dong-kho.csv'); } catch (e) { toast(errMsg(e), 'err'); } setBusy(false); };
  const columns = [
    { key: 'created_at', label: 'Thời gian', render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{fmtDateTime(r.created_at)}</span>, sort: (r) => r.created_at },
    { key: 'medicine_name', label: 'Sản phẩm', render: (r) => <span className="pb-ellip"><b>{r.medicine_name}</b><small className="pb-code"> {r.code}</small></span> },
    { key: 'kind', label: 'Loại', render: (r) => <Pill tone={KIND_TONE[r.kind]}>{r.kind_label}</Pill> },
    { key: 'quantity', label: 'Số lượng', align: 'r', render: (r) => <b className={r.quantity > 0 ? 'st-diff pos' : 'st-diff neg'}>{r.quantity > 0 ? '+' : ''}{r.quantity} {r.unit}</b> },
    { key: 'balance_after', label: 'Tồn sau', align: 'r' },
    { key: 'lot_no', label: 'Số lô', render: (r) => r.lot_no || '—' },
    { key: 'location', label: 'Kho', render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{r.location || '—'}</span> },
    { key: 'reference', label: 'Chứng từ', render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{r.reference || '—'}</span> },
    { key: 'by', label: 'Người thực hiện' },
  ];
  return <>
    <Grid id="stock-mv" title="Biến động kho" unit="dòng" columns={columns} rows={g.rows} meta={g.meta} loading={g.loading} onPage={g.setPage} onSize={g.setSize}
      toolbar={<>{g.toolbar}<button className="pb-btn sm" disabled={busy} onClick={exp}><DownloadRounded />Xuất CSV</button></>}
      filters={<><Select label="Loại biến động" value={f.kind || ''} onChange={(v) => set('kind', v)} options={[['', 'Tất cả loại'], ['in', 'Nhập kho'], ['out', 'Xuất bán / dùng'], ['adjust', 'Kiểm kê / điều chỉnh'], ['scrap', 'Hủy / hết hạn'], ['transfer', 'Chuyển kho']]} />
        <Select label="Kho" value={f.location || ''} onChange={(v) => set('location', v)} options={[['', 'Tất cả kho'], ...locs.map((x) => [String(x.id), x.name])]} /></>} />
    {toastNode}
  </>;
}

/* ------------------------------------------------------------------ Lô (Batches) */
function BatchesTab({ locs, manager, toast }) {
  const [view, setView] = useState('table'); const [setup, setSetup] = useState(false); const [exp, setExp] = useState(''); const [busy, setBusy] = useState(false);
  const g = useGrid('stock/batches', {}, undefined);
  const f = g.filters; const set = (k, v) => g.setFilters((x) => ({ ...x, [k]: v || undefined }));
  const rows = g.rows;
  const doExport = async () => { setBusy(true); try { await download('/clinic/stock/batches/', f, 'lo-hang.csv'); } catch (e) { toast(errMsg(e), 'err'); } setBusy(false); };
  const mgr = rows.some((r) => r.unit_cost != null);
  const columns = [
    { key: 'medicine_name', label: 'Sản phẩm', render: (r) => <span className="pb-ellip"><b>{r.medicine_name}</b><small className="pb-code"> {r.code}</small></span> },
    { key: 'lot_no', label: 'Số lô', render: (r) => r.lot_no || `#${r.id}` },
    { key: 'expiry_date', label: 'Hạn dùng', render: (r) => <span>{r.expiry_date ? fmtDate(r.expiry_date) : '—'} <Pill tone={expTone(r.days)}>{expText(r.days)}</Pill></span>, sort: (r) => r.expiry_date || '9999' },
    { key: 'quantity', label: 'Còn lại', align: 'r', render: (r) => `${nf(r.quantity)} / ${nf(r.initial_qty)} ${r.unit}`, sort: (r) => r.quantity },
    { key: 'location', label: 'Kho' },
    { key: 'supplier', label: 'Nhà cung cấp', render: (r) => r.supplier || '—' },
    { key: 'received_at', label: 'Ngày nhập', render: (r) => fmtDate(r.received_at), sort: (r) => r.received_at },
    ...(mgr ? [{ key: 'value', label: 'Giá trị', align: 'r', render: (r) => money(r.value) }] : []),
  ];
  const toolbar = <>{g.search}
    <Seg value={view} onChange={setView} options={[['cards', 'Thẻ', <GridViewOutlined key="a" />], ['table', 'Bảng', <TableRowsOutlined key="b" />], ['list', 'Danh sách', <ViewListOutlined key="c" />], ['daily', 'Theo ngày', <TodayOutlined key="d" />]]} />
    <button className="pb-btn sm" onClick={() => g.l.reload()}><RefreshRounded />Làm mới</button>
    <button className="pb-btn sm" disabled={busy} onClick={doExport}><DownloadRounded />Xuất CSV</button>
    {manager && <button className="pb-btn sm blue" onClick={() => setSetup(true)}><AutoFixHighOutlined />Thiết lập nhanh</button>}</>;
  const filters = <><Select label="Hạn dùng" value={f.expiry || ''} onChange={(v) => set('expiry', v)} options={[['', 'Mọi hạn dùng'], ['expired', 'Đã quá hạn'], ['30', 'Hết hạn ≤ 30 ngày'], ['60', 'Hết hạn ≤ 60 ngày'], ['90', 'Hết hạn ≤ 90 ngày'], ['valid', 'Còn hạn'], ['none', 'Không có HSD']]} />
    <Select label="Kho" value={f.location || ''} onChange={(v) => set('location', v)} options={[['', 'Tất cả kho'], ...locs.map((x) => [String(x.id), x.name])]} />
    <Select label="Hiển thị" value={f.show || ''} onChange={(v) => set('show', v)} options={[['', 'Lô còn hàng'], ['all', 'Cả lô đã hết']]} /></>;
  const exTone = (r) => <Pill tone={expTone(r.days)}>{expText(r.days)}</Pill>;
  let body;
  if (view === 'table') body = null;
  else if (view === 'cards') body = <div className="st-cards">{rows.map((r) => <div className="st-card" key={r.id}><div className="row"><h4>{r.medicine_name}</h4>{exTone(r)}</div><small>Lô {r.lot_no || `#${r.id}`} · {r.location}</small>
    <div className="row"><strong>{nf(r.quantity)} <small>{r.unit}</small></strong><small>HSD {r.expiry_date ? fmtDate(r.expiry_date) : '—'}</small></div></div>)}</div>;
  else if (view === 'list') body = <div className="st-list">{rows.map((r) => <div key={r.id}><span className="grow"><b>{r.medicine_name}</b><small>Lô {r.lot_no || `#${r.id}`} · {r.location} · {r.supplier || 'Không rõ NCC'}</small></span><span>HSD {r.expiry_date ? fmtDate(r.expiry_date) : '—'}</span>{exTone(r)}<b style={{ minWidth: 70, textAlign: 'right' }}>{nf(r.quantity)} {r.unit}</b></div>)}</div>;
  else {
    const days = {}; rows.forEach((r) => { const k = fmtDate(r.received_at); (days[k] = days[k] || []).push(r); });
    body = <div>{Object.entries(days).map(([d, list]) => <div key={d}><div className="st-day"><span>Nhập ngày {d}</span><span>{list.length} lô · {nf(list.reduce((s, x) => s + x.quantity, 0))} đơn vị</span></div>
      <div className="st-list">{list.map((r) => <div key={r.id}><span className="grow"><b>{r.medicine_name}</b><small>Lô {r.lot_no || `#${r.id}`} · {r.location}</small></span>{exTone(r)}<b>{nf(r.quantity)} {r.unit}</b></div>)}</div></div>)}</div>;
  }
  return <>
    {view === 'table'
      ? <Grid id="stock-batches" title="Lô hàng" unit="lô" columns={columns} rows={rows} meta={g.meta} loading={g.loading} onPage={g.setPage} onSize={g.setSize} toolbar={toolbar} filters={filters} />
      : <section className="pb-card pb-grid"><header className="pb-grid-head"><h2>Lô hàng</h2><div className="pb-grid-tools"><span className="pb-count">{nf(g.meta?.count)} lô</span>{toolbar}</div></header>
        <div className="pb-filters">{filters}</div>{rows.length ? body : <p className="pb-none" style={{ padding: 20 }}>Không có lô nào.</p>}
        <footer className="pb-grid-foot"><span className="pb-range">Hiển thị {rows.length} / {nf(g.meta?.count)} lô</span><span style={{ flex: 1 }} />
          <div className="pb-pager"><button disabled={g.page <= 1} onClick={() => g.setPage(g.page - 1)}>‹</button><button className="on">{g.page}</button><button disabled={g.page * (g.meta?.page_size || 50) >= (g.meta?.count || 0)} onClick={() => g.setPage(g.page + 1)}>›</button></div></footer></section>}
    <Modal open={setup} title="Thiết lập nhanh lô hàng" subtitle="Biến phần tồn chưa theo lô thành một lô “Tồn đầu kỳ”" onClose={() => setSetup(false)}
      footer={<><button className="pb-btn" onClick={() => setSetup(false)}>Hủy</button><button className="pb-btn blue" onClick={async () => { try { const { data } = await api.post('/clinic/stock/quick-setup/', { expiry: exp || null }); toast(data.created ? `Đã tạo ${data.created} lô tồn đầu kỳ.` : 'Mọi mặt hàng đã được theo dõi theo lô.'); setSetup(false); g.l.reload(); } catch (e) { toast(errMsg(e), 'err'); } }}>Thiết lập</button></>}>
      <p style={{ fontSize: 'var(--fs)', marginBottom: 10 }}>Hệ thống sẽ tạo lô <b>TON-DAU</b> cho các sản phẩm còn tồn nhưng chưa gắn số lô, đặt ở kho mặc định. Bạn có thể nhập hạn dùng chung (tuỳ chọn) cho các lô này.</p>
      <label style={{ fontSize: 'var(--fs-sm)' }}>Hạn dùng chung (tuỳ chọn)<input className="st-in" type="date" value={exp} onChange={(e) => setExp(e.target.value)} /></label>
    </Modal>
  </>;
}

/* ------------------------------------------------------------------ Kho / vị trí */
function WarehouseModal({ onClose, toast, onChanged }) {
  const l = useLoad(async () => arr((await api.get('/clinic/stock/locations/')).data), []);
  const [f, setF] = useState(null);
  const save = async () => {
    try { f.id ? await api.patch(`/clinic/stock/locations/${f.id}/`, f) : await api.post('/clinic/stock/locations/', f); toast('Đã lưu kho.'); setF(null); l.reload(true); onChanged(); } catch (e) { toast(errMsg(e), 'err'); }
  };
  const del = async (x) => { if (!window.confirm(`Ngừng sử dụng kho "${x.name}"?`)) return; try { await api.delete(`/clinic/stock/locations/${x.id}/`); l.reload(true); onChanged(); } catch (e) { toast(errMsg(e), 'err'); } };
  return <Modal open wide title="Kho & vị trí lưu trữ" subtitle="Phòng khám có một chi nhánh — kho là các khu vực lưu trữ trong chi nhánh" onClose={onClose}
    footer={f ? <><button className="pb-btn" onClick={() => setF(null)}>Quay lại</button><button className="pb-btn blue" disabled={!f.name?.trim()} onClick={save}>Lưu kho</button></> : <><button className="pb-btn" onClick={onClose}>Đóng</button><button className="pb-btn blue" onClick={() => setF({ name: '', note: '', is_default: false, is_active: true })}><AddRounded />Thêm kho</button></>}>
    {f ? <div className="st-form"><label className="s2">Tên kho<input className="st-in" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></label>
      <label className="s2">Ghi chú<input className="st-in" value={f.note || ''} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
      <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><input type="checkbox" checked={!!f.is_default} onChange={(e) => setF({ ...f, is_default: e.target.checked })} />Kho mặc định</label></div>
      : <div className="st-list">{(l.data || []).filter((x) => x.is_active).map((x) => <div key={x.id}><WarehouseOutlined /><span className="grow"><b>{x.name}</b> {x.is_default && <Pill tone="blue">Mặc định</Pill>}<small>{x.code} · {x.items} mặt hàng · {nf(x.qty)} đơn vị{x.note ? ` · ${x.note}` : ''}</small></span>
        <button className="pb-btn sm" onClick={() => setF(x)}>Sửa</button>{!x.is_default && <button className="pb-btn sm" onClick={() => del(x)}>Ngừng dùng</button>}</div>)}</div>}
  </Modal>;
}

/* ------------------------------------------------------------------ Trang chính */
export default function StockPage() {
  const { user } = useAuth(); const manager = user.role === 'manager';
  const [sp, setSp] = useSearchParams(); const [toast, toastNode] = useToast(); const [wh, setWh] = useState(false);
  const locs = useLocations();
  const sup = useLoad(async () => (manager ? arr((await api.get('/clinic/suppliers/')).data) : []), [manager]);
  const TABS = [['overview', 'Tổng quan'], ...(manager ? [['inventory', 'Kiểm kho']] : []), ['movement', 'Biến động'], ['batches', 'Lô hàng'], ...(manager ? [['orders', 'Đơn hàng'], ['transfers', 'Chuyển kho']] : []), ['products', 'Sản phẩm'], ...(manager ? [['suppliers', 'Nhà cung cấp']] : [])];
  const tab = TABS.some((t) => t[0] === sp.get('tab')) ? sp.get('tab') : 'overview';
  const go = (t) => setSp(t === 'overview' ? {} : { tab: t });
  const body = {
    overview: <Overview go={go} />, inventory: <CountsTab toast={toast} locs={locs.list} />, movement: <MovementTab locs={locs.list} />,
    batches: <BatchesTab locs={locs.list} manager={manager} toast={toast} />,
    orders: <OrdersTab toast={toast} locs={locs.list} suppliers={sup.data || []} />, transfers: <TransfersTab toast={toast} locs={locs.list} />,
    products: <StockTab manager={manager} toast={toast} />, suppliers: <SuppliersTab toast={toast} suppliers={sup.data || []} reload={() => sup.reload(true)} />,
  }[tab];
  return <div className="pb">
    <div className="pb-head"><p>Tồn kho, lô & hạn dùng, nhập hàng, chuyển kho và sản xuất tại phòng khám.</p>
      <div><button className="pb-btn" onClick={() => setWh(true)}><WarehouseOutlined />Kho / vị trí</button></div></div>
    <nav className="pb-tabs" role="tablist">{TABS.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>{t}</button>)}</nav>
    {body}
    {wh && <WarehouseModal onClose={() => setWh(false)} toast={toast} onChanged={() => locs.reload(true)} />}
    {toastNode}
  </div>;
}
