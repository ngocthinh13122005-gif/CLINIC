import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import AccountBalanceOutlined from '@mui/icons-material/AccountBalanceOutlined';
import AccountBalanceWalletOutlined from '@mui/icons-material/AccountBalanceWalletOutlined';
import AddRounded from '@mui/icons-material/AddRounded';
import ArrowDownwardRounded from '@mui/icons-material/ArrowDownwardRounded';
import ArrowUpwardRounded from '@mui/icons-material/ArrowUpwardRounded';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import PaymentsOutlined from '@mui/icons-material/PaymentsOutlined';
import SearchRounded from '@mui/icons-material/SearchRounded';
import UnfoldMoreRounded from '@mui/icons-material/UnfoldMoreRounded';
import ViewColumnOutlined from '@mui/icons-material/ViewColumnOutlined';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { invTone } from './Billing';
import { Avatar, Loading, Pill, fmtDate, fmtTime, isoDay, money, useDebounce, useLoad, useToast } from './ui';

const TABS = [['overview', 'Tổng quan'], ['invoices', 'Hóa đơn'], ['payments', 'Thanh toán'], ['lines', 'Lịch sử bán'], ['appointments', 'Lịch hẹn'], ['receivables', 'Công nợ']];
const BLUE = '#1d6fd6'; const GREEN = '#17a34a';
const nf = (v) => new Intl.NumberFormat('vi-VN').format(Math.round(v || 0));
const short = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(1).replace('.0', '')} tỷ` : v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.0', '')}tr` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : v);
const dm = (iso) => { const d = new Date(`${iso}T00:00:00`); return `${d.getDate()}/${d.getMonth() + 1}`; };
const dmy = (iso) => (iso ? fmtDate(`${iso}T00:00:00`) : '');

function presets() {
  const now = new Date(); const y = now.getFullYear(); const m = now.getMonth(); const q = Math.floor(m / 3) * 3;
  const d = (a, b, c) => isoDay(new Date(a, b, c)); const ago = (n) => isoDay(new Date(Date.now() - n * 864e5));
  return [['Hôm nay', isoDay(), isoDay()], ['7 ngày', ago(6), isoDay()], ['30 ngày', ago(29), isoDay()], ['90 ngày', ago(89), isoDay()],
    ['Tháng này', d(y, m, 1), isoDay()], ['Tháng trước', d(y, m - 1, 1), d(y, m, 0)], ['Quý này', d(y, q, 1), isoDay()], ['Năm nay', d(y, 0, 1), isoDay()]];
}

function useOutside(ref, fn) {
  useEffect(() => { const h = (e) => ref.current && !ref.current.contains(e.target) && fn(); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [ref, fn]);
}

export function RangePicker({ value, onChange, allowAll, align }) {
  const [open, setOpen] = useState(false); const ref = useRef(null); useOutside(ref, () => setOpen(false));
  const ps = presets(); const hit = value && ps.find((p) => p[1] === value.from && p[2] === value.to);
  const label = !value ? 'Tất cả thời gian' : hit ? hit[0] : `${dmy(value.from)} – ${dmy(value.to)}`;
  return <div className="pb-pop" ref={ref}>
    <button type="button" className={`pb-chip ${open ? 'on' : ''}`} onClick={() => setOpen(!open)}><CalendarMonthOutlined />{label}<ExpandMoreRounded /></button>
    {open && <div className={`pb-pop-box ${align === 'right' ? 'r' : ''}`}>
      <div className="pb-presets">{allowAll && <button className={!value ? 'on' : ''} onClick={() => { onChange(null); setOpen(false); }}>Tất cả thời gian</button>}
        {ps.map((p) => <button key={p[0]} className={value && p[1] === value.from && p[2] === value.to ? 'on' : ''} onClick={() => { onChange({ from: p[1], to: p[2] }); setOpen(false); }}>{p[0]}</button>)}</div>
      <div className="pb-dates"><label>Từ<input type="date" value={value?.from || ''} max={value?.to} onChange={(e) => e.target.value && onChange({ from: e.target.value, to: value?.to || isoDay() })} /></label>
        <label>Đến<input type="date" value={value?.to || ''} min={value?.from} onChange={(e) => e.target.value && onChange({ from: value?.from || e.target.value, to: e.target.value })} /></label></div></div>}
  </div>;
}

export function Select({ label, value, onChange, options }) {
  const cur = options.find((o) => o[0] === value);
  return <label className={`pb-chip sel ${value ? 'on' : ''}`}>{value ? cur?.[1] : label}<ExpandMoreRounded />
    <select value={value} onChange={(e) => onChange(e.target.value)}>{options.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>;
}

function Delta({ cur, prev }) {
  if (!prev && !cur) return null;
  if (!prev) return <span className="pb-delta up"><ArrowUpwardRounded />Mới</span>;
  const pct = ((cur - prev) / prev) * 100; const up = pct >= 0;
  return <span className={`pb-delta ${up ? 'up' : 'down'}`}>{up ? <ArrowUpwardRounded /> : <ArrowDownwardRounded />}{Math.abs(pct).toFixed(2)}%</span>;
}

const Client = ({ id, name, avatar = true }) => <span className="pb-client">{avatar && <Avatar name={name} size={22} />}{id ? <Link to={`/benh-nhan/${id}`} onClick={(e) => e.stopPropagation()}>{name}</Link> : name}</span>;

/* ------------------------------------------------------------------ bảng dữ liệu kiểu Pabau */
export function Grid({ id, title, unit, columns, rows, meta, loading, onPage, onSize, onRow, toolbar, filters, foot }) {
  const key = `pb-cols-${id}`;
  const [hidden, setHidden] = useState(() => { try { return JSON.parse(localStorage.getItem(key) || '[]'); } catch { return []; } });
  const [colsOpen, setColsOpen] = useState(false); const ref = useRef(null); useOutside(ref, () => setColsOpen(false));
  const [sort, setSort] = useState(null);
  const setH = (k) => setHidden((h) => { const n = h.includes(k) ? h.filter((x) => x !== k) : [...h, k]; try { localStorage.setItem(key, JSON.stringify(n)); } catch { /* ignore */ } return n; });
  const cols = columns.filter((c) => !hidden.includes(c.key));
  const data = useMemo(() => {
    if (!sort) return rows;
    const c = columns.find((x) => x.key === sort.key); const val = (r) => (c.sort ? c.sort(r) : r[c.key]);
    return [...rows].sort((a, b) => { const x = val(a); const y = val(b); const r = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'vi'); return sort.dir === 'asc' ? r : -r; });
  }, [rows, sort, columns]);
  const { count = 0, page = 1, page_size: size = 50 } = meta || {};
  const pages = Math.max(1, Math.ceil(count / size));
  const from = count ? (page - 1) * size + 1 : 0; const to = Math.min(page * size, count);
  const nums = []; for (let i = Math.max(1, page - 2); i <= Math.min(pages, page + 2); i += 1) nums.push(i);
  return <section className="pb-card pb-grid">
    <header className="pb-grid-head"><h2>{title}</h2><div className="pb-grid-tools"><span className="pb-count">{nf(count)} {unit}</span>{toolbar}</div></header>
    <div className="pb-filters">{filters}<span style={{ flex: 1 }} />
      <div className="pb-pop" ref={ref}><button type="button" className="pb-chip" onClick={() => setColsOpen(!colsOpen)}><ViewColumnOutlined />Cột hiển thị</button>
        {colsOpen && <div className="pb-pop-box r cols">{columns.map((c) => <label key={c.key}><input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => setH(c.key)} />{c.label}</label>)}</div>}</div></div>
    <div className={`pb-table-wrap ${loading ? 'busy' : ''}`}><table className="pb-table"><thead><tr>
      {cols.map((c) => <th key={c.key} className={c.align === 'r' ? 'r' : ''} onClick={() => setSort((s) => (s?.key === c.key ? (s.dir === 'asc' ? { key: c.key, dir: 'desc' } : null) : { key: c.key, dir: 'asc' }))}>
        <span>{c.label}{sort?.key === c.key ? (sort.dir === 'asc' ? <ArrowUpwardRounded /> : <ArrowDownwardRounded />) : <UnfoldMoreRounded className="dim" />}</span></th>)}</tr></thead>
      <tbody>{data.map((r) => <tr key={r.id} className={onRow ? 'click' : ''} onClick={() => onRow?.(r)}>{cols.map((c) => <td key={c.key} className={c.align === 'r' ? 'r' : ''}>{c.render ? c.render(r) : r[c.key]}</td>)}</tr>)}
        {!data.length && !loading && <tr><td className="pb-none" colSpan={cols.length}>Không có dữ liệu trong khoảng này.</td></tr>}</tbody>
      {foot && !!data.length && <tfoot><tr>{cols.map((c, i) => <td key={c.key} className={c.align === 'r' ? 'r' : ''}>{i === 0 ? 'Tổng (toàn bộ kết quả)' : foot[c.key] != null ? foot[c.key] : ''}</td>)}</tr></tfoot>}
    </table>{loading && !rows.length && <Loading />}</div>
    <footer className="pb-grid-foot"><span>Số dòng mỗi trang</span>
      <select value={size} onChange={(e) => onSize(Number(e.target.value))}>{[25, 50, 100].map((n) => <option key={n}>{n}</option>)}</select>
      <span className="pb-range"><b>{from}–{to}</b> trên {nf(count)}</span><span style={{ flex: 1 }} />
      <div className="pb-pager"><button disabled={page <= 1} onClick={() => onPage(1)}>«</button><button disabled={page <= 1} onClick={() => onPage(page - 1)}>‹</button>
        {nums.map((n) => <button key={n} className={n === page ? 'on' : ''} onClick={() => onPage(n)}>{n}</button>)}
        <button disabled={page >= pages} onClick={() => onPage(page + 1)}>›</button><button disabled={page >= pages} onClick={() => onPage(pages)}>»</button></div></footer>
  </section>;
}

export function useGrid(tab, extra, initialRange, allowAll) {
  const [range, setRange] = useState(initialRange); const [q, setQ] = useState(''); const dq = useDebounce(q, 300);
  const [page, setPage] = useState(1); const [size, setSize] = useState(50); const [filters, setFilters] = useState({});
  useEffect(() => { setPage(1); }, [range?.from, range?.to, dq, size, JSON.stringify(filters)]); // eslint-disable-line react-hooks/exhaustive-deps
  const endpoint = tab.startsWith('stock/') ? `/clinic/${tab}/` : `/clinic/money/${tab}/`;
  const l = useLoad(async () => (await api.get(endpoint, { params: { ...(range || {}), q: dq.trim() || undefined, page, page_size: size, ...filters, ...extra } })).data, [endpoint, range?.from, range?.to, dq, page, size, JSON.stringify(filters)]);
  const search = <label className="pb-search"><SearchRounded /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm kiếm…" /></label>;
  const toolbar = <>{initialRange !== undefined && (initialRange || allowAll) && <RangePicker value={range} onChange={setRange} allowAll={allowAll} />}{search}</>;
  return { l, rows: l.data?.results || [], meta: l.data, loading: l.loading, page, setPage, size, setSize, filters, setFilters, toolbar, search, range };
}

const statusTone = { pending: 'amber', confirmed: 'blue', completed: 'green', cancelled: 'gray' };

/* ------------------------------------------------------------------ các tab */
function InvoicesTab({ openInv, onNew }) {
  const g = useGrid('invoices', {}, null, true);
  const set = (k) => (v) => g.setFilters((f) => ({ ...f, [k]: v || undefined }));
  const t = g.meta?.totals;
  return <Grid id="invoices" title="Hóa đơn" unit="hóa đơn" rows={g.rows} meta={g.meta} loading={g.loading} onPage={g.setPage} onSize={g.setSize} onRow={(r) => openInv(r.id)}
    toolbar={<>{g.toolbar}<button className="pb-btn blue" onClick={onNew}><AddRounded />Tạo hóa đơn</button><Link className="pb-btn" to="/ban-hang"><AddRounded />Bán hàng mới</Link></>}
    filters={<Select label="Trạng thái" value={g.filters.status || ''} onChange={set('status')} options={[['', 'Tất cả hóa đơn'], ['unpaid,partial', 'Còn nợ'], ['paid', 'Đã thanh toán'], ['void', 'Đã hủy']]} />}
    foot={t && { total: money(t.total), paid: money(t.paid), balance: money(t.outstanding) }}
    columns={[
      { key: 'created_at', label: 'Ngày lập', render: (r) => fmtDate(r.created_at) },
      { key: 'code', label: 'Số hóa đơn', render: (r) => <b className="pb-code">{r.code}</b> },
      { key: 'patient_name', label: 'Khách hàng', render: (r) => <Client id={r.patient} name={r.patient_name} /> },
      { key: 'debtor', label: 'Người thanh toán' },
      { key: 'items', label: 'Nội dung', render: (r) => <span className="pb-ellip">{r.items || '—'}</span> },
      { key: 'total', label: 'Tổng tiền', align: 'r', render: (r) => money(r.total) },
      { key: 'paid', label: 'Đã thu', align: 'r', render: (r) => money(r.paid) },
      { key: 'balance', label: 'Còn nợ', align: 'r', render: (r) => <span className={r.balance && r.status !== 'void' ? 'pb-red' : ''}>{r.status === 'void' ? '—' : money(r.balance)}</span> },
      { key: 'status', label: 'Trạng thái', render: (r) => <Pill tone={invTone[r.status]} dot>{r.status_label}</Pill> },
      { key: 'created_by_name', label: 'Người lập' },
    ]} />;
}

function PaymentsTab({ openInv }) {
  const g = useGrid('payments', {}, { from: presets()[2][1], to: isoDay() });
  const set = (k) => (v) => g.setFilters((f) => ({ ...f, [k]: v || undefined }));
  return <Grid id="payments" title="Thanh toán" unit="giao dịch" rows={g.rows} meta={g.meta} loading={g.loading} onPage={g.setPage} onSize={g.setSize} onRow={(r) => openInv(r.invoice)} toolbar={g.toolbar}
    filters={<Select label="Phương thức" value={g.filters.method || ''} onChange={set('method')} options={[['', 'Mọi phương thức'], ['cash', 'Tiền mặt'], ['transfer', 'Chuyển khoản'], ['card', 'Quẹt thẻ'], ['ewallet', 'Ví điện tử']]} />}
    foot={g.meta?.totals && { amount: money(g.meta.totals.amount) }}
    columns={[
      { key: 'code', label: 'Mã thanh toán', render: (r) => <b className="pb-code">{r.code}</b> },
      { key: 'invoice_code', label: 'Số hóa đơn' },
      { key: 'paid_at', label: 'Thời gian', render: (r) => `${fmtDate(r.paid_at)} ${fmtTime(r.paid_at)}` },
      { key: 'patient_name', label: 'Khách hàng', render: (r) => <Client id={r.patient} name={r.patient_name} /> },
      { key: 'amount', label: 'Số tiền', align: 'r', render: (r) => <b>{money(r.amount)}</b> },
      { key: 'method_label', label: 'Phương thức' },
      { key: 'reference', label: 'Mã giao dịch', render: (r) => r.reference || '—' },
      { key: 'received_by_name', label: 'Người thu' },
    ]} />;
}

function LinesTab({ openInv }) {
  const g = useGrid('lines', {}, { from: presets()[2][1], to: isoDay() });
  const set = (k) => (v) => g.setFilters((f) => ({ ...f, [k]: v || undefined }));
  return <Grid id="lines" title="Lịch sử bán hàng" unit="dòng" rows={g.rows} meta={g.meta} loading={g.loading} onPage={g.setPage} onSize={g.setSize} onRow={(r) => openInv(r.invoice)} toolbar={g.toolbar}
    filters={<Select label="Loại" value={g.filters.kind || ''} onChange={set('kind')} options={[['', 'Tất cả mặt hàng'], ['service', 'Dịch vụ'], ['medicine', 'Thuốc'], ['package', 'Gói liệu trình'], ['other', 'Khác']]} />}
    foot={g.meta?.totals && { amount: money(g.meta.totals.amount) }}
    columns={[
      { key: 'created_at', label: 'Ngày lập', render: (r) => fmtDate(r.created_at) },
      { key: 'name', label: 'Tên hàng / dịch vụ' },
      { key: 'kind_label', label: 'Loại', render: (r) => <Pill tone={r.kind === 'service' || r.kind === 'package' ? 'blue' : r.kind === 'medicine' ? 'green' : 'gray'}>{r.kind_label}</Pill> },
      { key: 'invoice_code', label: 'Số hóa đơn' },
      { key: 'patient_name', label: 'Khách hàng', render: (r) => <Client id={r.patient} name={r.patient_name} /> },
      { key: 'quantity', label: 'SL', align: 'r' },
      { key: 'unit_price', label: 'Đơn giá', align: 'r', render: (r) => money(r.unit_price) },
      { key: 'amount', label: 'Thành tiền', align: 'r', render: (r) => <b>{money(r.amount)}</b> },
      { key: 'created_by_name', label: 'Người lập' },
    ]} />;
}

function AppointmentsTab() {
  const nav = useNavigate();
  const g = useGrid('appointments', {}, { from: presets()[4][1], to: isoDay(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)) });
  const set = (k) => (v) => g.setFilters((f) => ({ ...f, [k]: v || undefined }));
  return <Grid id="appointments" title="Lịch hẹn" unit="lịch hẹn" rows={g.rows} meta={g.meta} loading={g.loading} onPage={g.setPage} onSize={g.setSize} onRow={(r) => r.patient && nav(`/benh-nhan/${r.patient}`)} toolbar={g.toolbar}
    filters={<Select label="Trạng thái" value={g.filters.status || ''} onChange={set('status')} options={[['', 'Tất cả lịch hẹn'], ['pending', 'Chờ xác nhận'], ['confirmed', 'Đã xác nhận'], ['completed', 'Hoàn thành'], ['cancelled', 'Đã hủy']]} />}
    columns={[
      { key: 'created_at', label: 'Ngày tạo', render: (r) => fmtDate(r.created_at) },
      { key: 'client_name', label: 'Khách hàng', render: (r) => <Client id={r.patient} name={r.client_name} /> },
      { key: 'appointment', label: 'Thời gian hẹn', render: (r) => `${fmtDate(r.appointment)} ${fmtTime(r.appointment)}` },
      { key: 'duration', label: 'Thời lượng', render: (r) => (r.duration ? `${r.duration} phút` : '—') },
      { key: 'services', label: 'Dịch vụ', render: (r) => <span className="pb-ellip">{r.services || r.type}</span> },
      { key: 'staff_name', label: 'Thực hiện', render: (r) => r.staff_name || '—' },
      { key: 'status', label: 'Trạng thái', render: (r) => <Pill tone={statusTone[r.status]} dot>{r.status_label}</Pill> },
      { key: 'total', label: 'Giá trị', align: 'r', render: (r) => money(r.total) },
    ]} />;
}

function ReceivablesTab({ openInv, payInv, toast }) {
  const g = useGrid('receivables', {}, null);
  const remind = (r) => {
    const txt = `Kính gửi ${r.patient_name}, phòng khám Da liễu OHIO xin nhắc hóa đơn ${r.code} còn ${money(r.balance)} chưa thanh toán. Xin cảm ơn quý khách.`;
    navigator.clipboard?.writeText(txt).then(() => toast('Đã sao chép nội dung nhắc nợ.'), () => toast('Không sao chép được, hãy thử lại.', 'err'));
  };
  return <Grid id="receivables" title="Công nợ phải thu" unit="hóa đơn" rows={g.rows} meta={g.meta} loading={g.loading} onPage={g.setPage} onSize={g.setSize} onRow={(r) => openInv(r.id)}
    toolbar={g.search}
    filters={<span className="pb-note">Hạn thanh toán mặc định 7 ngày kể từ ngày lập hóa đơn.</span>}
    foot={g.meta?.totals && { balance: money(g.meta.totals.balance) }}
    columns={[
      { key: 'act', label: 'Thao tác', render: (r) => <span className="pb-acts"><button className="pb-btn blue sm" onClick={(e) => { e.stopPropagation(); payInv(r.id); }}>Thu tiền</button><button className="pb-btn sm" onClick={(e) => { e.stopPropagation(); remind(r); }}><ContentCopyRounded />Nhắc nợ</button></span> },
      { key: 'patient_name', label: 'Khách hàng', render: (r) => <Client id={r.patient} name={r.patient_name} /> },
      { key: 'patient_phone', label: 'Điện thoại' },
      { key: 'balance', label: 'Còn nợ', align: 'r', render: (r) => <b className="pb-red">{money(r.balance)}</b> },
      { key: 'code', label: 'Số hóa đơn', render: (r) => <b className="pb-code">{r.code}</b> },
      { key: 'due_date', label: 'Hạn thanh toán', render: (r) => fmtDate(`${r.due_date}T00:00:00`) },
      { key: 'days_left', label: 'Số ngày còn lại', render: (r) => <span className={`pb-days ${r.days_left < 0 ? 'late' : r.days_left === 0 ? 'zero' : ''}`}>{r.days_left}</span> },
      { key: 'state', label: 'Tình trạng', sort: (r) => r.days_left, render: (r) => (r.days_left < 0 ? <span className="pb-red">Quá hạn</span> : <span className="pb-blue">Chờ thanh toán</span>) },
    ]} />;
}

/* ------------------------------------------------------------------ tổng quan */
function Kpi({ title, value, hint, icon, tone }) {
  return <div className="pb-kpi"><div className="pb-kpi-top"><span>{title}</span><i className={tone}>{icon}</i></div><strong>{value}</strong><small>{hint}</small></div>;
}

function Spark({ title, value, prev, cur, data, keyA, keyB, color, fmt, compare, kind = 'line' }) {
  const rows = data.dates.map((d, i) => ({ d: dm(d), a: data[keyA][i], b: data[keyB]?.[i] }));
  const Chart = kind === 'area' ? AreaChart : LineChart;
  return <div className="pb-card pb-metric"><div className="pb-metric-h"><span>{title}</span></div>
    <div className="pb-metric-v"><strong>{value}</strong><Delta cur={cur} prev={prev} /></div>
    <small className="pb-prev">{compare ? `${fmt(prev)} kỳ trước` : ' '}</small>
    <div className="pb-metric-c"><ResponsiveContainer width="100%" height={150}><Chart data={rows} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}><CartesianGrid vertical={false} stroke="#edf0f5" />
      <XAxis dataKey="d" tick={{ fontSize: 10.5, fill: '#7a8798' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={28} />
      <YAxis tick={{ fontSize: 10.5, fill: '#7a8798' }} tickLine={false} axisLine={false} width={40} tickFormatter={fmt === money ? short : undefined} allowDecimals={false} />
      <Tooltip formatter={(v) => fmt(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
      {compare && <Line type="monotone" dataKey="b" stroke="#a5afbd" strokeDasharray="4 4" dot={false} strokeWidth={1.4} />}
      {kind === 'area' ? <Area type="monotone" dataKey="a" stroke={color} fill={color} fillOpacity={0.1} strokeWidth={1.8} dot={false} /> : <Line type="monotone" dataKey="a" stroke={color} dot={false} strokeWidth={1.8} />}
    </Chart></ResponsiveContainer></div>
    <footer><span>Cập nhật vừa xong</span></footer></div>;
}

const MCOL = { cash: '#17a34a', transfer: '#1d6fd6', card: '#e0a028', ewallet: '#7c5cd6' };

function Overview({ openInv, canReport, pendingNode }) {
  const [range, setRange] = useState({ from: presets()[2][1], to: isoDay() });
  const [compare, setCompare] = useState(true);
  const l = useLoad(async () => (await api.get('/clinic/money/overview/', { params: range })).data, [range.from, range.to]);
  const recent = useLoad(async () => (await api.get('/clinic/money/payments/', { params: { page_size: 6, from: isoDay(new Date(Date.now() - 90 * 864e5)), to: isoDay() } })).data, []);
  const d = l.data; const ps = presets();
  if (!d) return l.error ? <div className="cl-alert error">{l.error}</div> : <Loading text="Đang tổng hợp số liệu…" />;
  const k = d.kpis; const s = d.series; const mTotal = d.methods.reduce((a, b) => a + b.amount, 0);
  const cash = d.methods.find((m) => m.method === 'cash')?.amount || 0;
  const days = Math.round((new Date(range.to) - new Date(range.from)) / 864e5) + 1;
  const sum = d.summary;
  return <div className={l.loading ? 'pb-fade' : ''}>
    <div className="pb-seg-row">{[['7 ngày', 7], ['30 ngày', 30], ['90 ngày', 90]].map(([t, n]) => <button key={n} className={days === n && range.to === isoDay() ? 'on' : ''} onClick={() => setRange({ from: isoDay(new Date(Date.now() - (n - 1) * 864e5)), to: isoDay() })}>{t}</button>)}</div>
    <div className="pb-kpis">
      <Kpi title="Thu trong kỳ" value={money(k.gross)} hint={`${nf(k.payments)} giao dịch · ${dmy(range.from)} – ${dmy(range.to)}`} icon={<AccountBalanceWalletOutlined />} tone="blue" />
      <Kpi title="Chuyển khoản / thẻ / ví" value={money(mTotal - cash)} hint={`Tiền mặt tại quầy: ${money(cash)}`} icon={<AccountBalanceOutlined />} tone="teal" />
      <Kpi title="Công nợ phải thu" value={money(k.unpaid_balance)} hint={`${nf(k.unpaid_count)} hóa đơn chưa thu đủ, tính đến hôm nay`} icon={<ReceiptLongOutlined />} tone="purple" />
      <Kpi title="Giá trị hóa đơn lập trong kỳ" value={money(k.billed_total)} hint={`${nf(k.invoices)} hóa đơn · ${k.due_today} chưa thu hôm nay`} icon={<PaymentsOutlined />} tone="amber" />
    </div>
    <div className="pb-two">
      <section className="pb-card pb-big"><header><div><h3>Doanh thu thực thu</h3><strong>{money(k.net)}</strong></div><span>{days} ngày gần nhất</span></header>
        <ResponsiveContainer width="100%" height={210}><AreaChart data={s.dates.map((x, i) => ({ d: dm(x), v: s.gross[i] }))} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs><linearGradient id="gA" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={GREEN} stopOpacity={0.25} /><stop offset="100%" stopColor={GREEN} stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid vertical={false} stroke="#edf0f5" /><XAxis dataKey="d" tick={{ fontSize: 10.5, fill: '#7a8798' }} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={30} />
          <YAxis tick={{ fontSize: 10.5, fill: '#7a8798' }} tickLine={false} axisLine={false} width={44} tickFormatter={short} />
          <Tooltip formatter={(v) => money(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} /><Area type="monotone" dataKey="v" stroke={GREEN} strokeWidth={1.8} fill="url(#gA)" dot={false} /></AreaChart></ResponsiveContainer></section>
      <section className="pb-card pb-sum"><header><h3>Tóm tắt tài chính</h3><span>{days} ngày gần nhất</span></header>
        <dl>{[['Tiền đã thu', sum.received], ['Hoàn tiền', -sum.refunds], ['Phí giao dịch', -sum.fees], ['Chargeback', -sum.chargebacks]].map(([a, b]) => <div key={a}><dt>{a}</dt><dd>{b < 0 ? '-' : ''}{money(Math.abs(b))}</dd></div>)}</dl>
        <div className="pb-sum-net"><dt>Doanh thu thuần</dt><dd>{money(sum.net)}</dd></div>
        {canReport && <Link to="/bao-cao" className="pb-link">Xem báo cáo đầy đủ</Link>}</section>
    </div>
    <div className="pb-two even">
      <section className="pb-card pb-act"><header><h3>Hoạt động thanh toán</h3><span>Gần đây</span></header>
        {recent.data?.results?.length ? <ul>{recent.data.results.map((p) => <li key={p.id} onClick={() => openInv(p.invoice)}><Avatar name={p.patient_name} size={26} /><span><b>{p.patient_name}</b><small>{p.invoice_code} · {fmtDate(p.paid_at)} {fmtTime(p.paid_at)} · {p.method_label}</small></span><strong>{money(p.amount)}</strong></li>)}</ul> : <p className="pb-empty">Chưa có thanh toán nào.</p>}</section>
      {pendingNode}
    </div>
    <div className="pb-sec-head"><h2>Tổng quan chi tiết</h2></div>
    <div className="pb-ov-bar"><RangePicker value={range} onChange={(v) => v && setRange(v)} />
      <span className="pb-chip static">Theo ngày</span>
      <button type="button" className={`pb-chip ${compare ? 'on' : ''}`} onClick={() => setCompare(!compare)}>So sánh · {compare ? 'Kỳ trước' : 'Tắt'}</button>
      <span style={{ flex: 1 }} /><span className="pb-note">{dmy(d.previous[0])} – {dmy(d.previous[1])} là kỳ trước</span></div>
    <div className="pb-metrics">
      <Spark title="Tổng thu (gộp)" value={money(k.gross)} cur={k.gross} prev={k.gross_prev} data={s} keyA="gross" keyB="gross_prev" color={BLUE} fmt={money} compare={compare} />
      <Spark title="Doanh thu thuần" value={money(k.net)} cur={k.net} prev={k.net_prev} data={s} keyA="gross" keyB="gross_prev" color={GREEN} fmt={money} compare={compare} kind="area" />
      <Spark title="Khách hàng mới" value={nf(k.new_clients)} cur={k.new_clients} prev={k.new_clients_prev} data={s} keyA="new_clients" keyB="new_clients_prev" color={BLUE} fmt={nf} compare={compare} kind="area" />
      <Spark title="Số giao dịch" value={nf(k.payments)} cur={k.payments} prev={k.payments_prev} data={s} keyA="payments" keyB="payments_prev" color={BLUE} fmt={nf} compare={compare} kind="area" />
      <div className="pb-card pb-metric"><div className="pb-metric-h"><span>Phương thức thanh toán</span></div><div className="pb-metric-v"><strong>{money(mTotal)}</strong></div><small className="pb-prev"> </small>
        <div className="pb-stack">{d.methods.map((m) => <i key={m.method} style={{ flex: m.amount, background: MCOL[m.method] || '#8a99a8' }} />)}</div>
        <ul className="pb-mlist">{d.methods.map((m) => <li key={m.method}><i style={{ background: MCOL[m.method] || '#8a99a8' }} />{m.label}<b>{money(m.amount)}</b></li>)}{!d.methods.length && <li className="pb-empty">Chưa có giao dịch.</li>}</ul>
        {!!d.top_items.length && <><h4>Bán chạy nhất</h4><ul className="pb-mlist">{d.top_items.slice(0, 4).map((t) => <li key={t.name}><span className="pb-ellip">{t.name}</span><b>{money(t.amount)}</b></li>)}</ul></>}</div>
      <Spark title="Chi tiêu trung bình mỗi lần" value={money(k.avg_sale)} cur={k.avg_sale} prev={k.avg_sale_prev} data={s} keyA="avg" keyB="avg_prev" color={GREEN} fmt={money} compare={compare} />
    </div>
  </div>;
}

/* ------------------------------------------------------------------ trang */
export default function MoneyPage() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const nav = useNavigate();
  const tab = TABS.some((t) => t[0] === sp.get('tab')) ? sp.get('tab') : 'overview';
  const [rev, setRev] = useState(0); const [toast, toastNode] = useToast();
  const today = isoDay();
  const visits = useLoad(async () => { const { data } = await api.get('/clinic/visits/', { params: { date: today, status: 'completed,in_consult' } }); return data.results || data; }, [rev]);
  const todayInv = useLoad(async () => { const { data } = await api.get('/clinic/invoices/', { params: { date: today } }); return data.results || data; }, [rev]);
  const billed = new Set((todayInv.data || []).filter((i) => i.status !== 'void').map((i) => i.visit));
  const pending = (visits.data || []).filter((v) => !billed.has(v.id));
  const refresh = () => setRev((x) => x + 1);
  const go = (t) => setSp(t === 'overview' ? {} : { tab: t });
  const pendingNode = <section className="pb-card pb-act"><header><h3>Khách chờ lập hóa đơn hôm nay</h3><span>{pending.length} lượt khám</span></header>
    {pending.length ? <ul>{pending.map((v) => <li key={v.id} onClick={() => nav(`/ban-hang?patient=${v.patient}&visit=${v.id}`)}><Avatar name={v.patient_detail.full_name} size={26} />
      <span><b>{v.patient_detail.full_name}</b><small>#{v.ticket_no} · {fmtTime(v.check_in_at)} · {v.status === 'completed' ? 'Đã khám xong' : 'Đang khám'}</small></span><button className="pb-btn sm blue">Lập hóa đơn</button></li>)}</ul> : <p className="pb-empty">Không có khách nào đang chờ thanh toán.</p>}</section>;
  const openInv = (id) => nav(`/hoa-don/${id}`);
  const payInv = (id) => nav(`/ban-hang/thu-tien/${id}`);
  const body = { overview: <Overview key={rev} openInv={openInv} canReport={user.role === 'manager'} pendingNode={pendingNode} />,
    invoices: <InvoicesTab key={rev} openInv={openInv} onNew={() => nav('/ban-hang')} />, payments: <PaymentsTab key={rev} openInv={openInv} />, lines: <LinesTab key={rev} openInv={openInv} />,
    appointments: <AppointmentsTab />, receivables: <ReceivablesTab key={rev} openInv={openInv} payInv={payInv} toast={toast} /> }[tab];
  return <div className="pb">
    <div className="pb-head"><p>Hóa đơn, thanh toán, doanh số và lịch hẹn — tất cả ở một nơi.</p>
      <div><button className="pb-btn" onClick={() => go('receivables')}>Công nợ</button><button className="pb-btn dark" onClick={() => nav('/ban-hang')}><AddRounded />Bán hàng mới</button><button className="pb-btn" onClick={() => nav('/ban-hang')}><AddRounded />Lập hóa đơn</button></div></div>
    <nav className="pb-tabs" role="tablist">{TABS.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => go(k)}>{t}</button>)}</nav>
    {body}
    {toastNode}
  </div>;
}
