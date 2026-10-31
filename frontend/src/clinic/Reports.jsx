import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import FileDownloadRounded from '@mui/icons-material/FileDownloadRounded';
import PrintRounded from '@mui/icons-material/PrintRounded';
import DashboardRounded from '@mui/icons-material/DashboardRounded';
import BarChartRounded from '@mui/icons-material/BarChartRounded';
import TableChartRounded from '@mui/icons-material/TableChartRounded';
import ShowChartRounded from '@mui/icons-material/ShowChartRounded';
import DonutLargeRounded from '@mui/icons-material/DonutLargeRounded';
import ViewWeekRounded from '@mui/icons-material/ViewWeekRounded';
import api from '../api/client';
import { Btn, Card, Empty, Loading, PageHead, errMsg, fmtDate, isoDay, money, useLoad, useToast } from './ui';

const TABS = [['revenue', 'Doanh thu'], ['visits', 'Lượt khám & bệnh nhân'], ['receivables', 'Công nợ'], ['inventory', 'Kho & xuất nhập'], ['care', 'Chăm sóc & liệu trình']];
const COLORS = ['#0f7280', '#315f9e', '#587086', '#237453', '#b54747', '#7357b3', '#8a99a8', '#b04470'];
const num = (v) => new Intl.NumberFormat('vi-VN').format(Math.round(v || 0));

const fmt = (v, type) => {
  if (v == null || v === '') return '—';
  switch (type) {
    case 'vnd': return money(v);
    case 'int': return num(v);
    case 'pct': return `${v}%`;
    case 'min': return `${v} phút`;
    case 'date': return fmtDate(v);
    default: return String(v);
  }
};

function presets() {
  const now = new Date();
  const y = now.getFullYear(); const m = now.getMonth();
  const d = (a, b, c) => isoDay(new Date(a, b, c));
  const q = Math.floor(m / 3) * 3;
  return [
    ['Hôm nay', isoDay(), isoDay()],
    ['7 ngày', isoDay(new Date(Date.now() - 6 * 864e5)), isoDay()],
    ['Tháng này', d(y, m, 1), isoDay()],
    ['Tháng trước', d(y, m - 1, 1), d(y, m, 0)],
    ['Quý này', d(y, q, 1), isoDay()],
    ['Năm nay', d(y, 0, 1), isoDay()],
  ];
}

function Chart({ c }) {
  const [mode, setMode] = useState(c.type === 'pie' ? 'pie' : 'bar');
  const [stacked, setStacked] = useState(false);
  const unit = c.unit;
  const f = (v) => (unit === 'vnd' ? (v >= 1e6 ? `${(v / 1e6).toFixed(1).replace('.0', '')}tr` : v >= 1e3 ? `${Math.round(v / 1e3)}k` : v) : v);
  const data = c.x.map((x, i) => ({ x, ...Object.fromEntries(c.series.map((s) => [s.name, s.values[i]])) }));
  const tip = (v) => (unit === 'vnd' ? money(v) : num(v));
  const rows = data.map((r) => ({ name: r.x, value: r[c.series[0].name] })).filter((r) => r.value > 0);
  const tools = <div className="rp-chart-tools" aria-label="Kiểu biểu đồ">
    <button className={mode === 'bar' ? 'on' : ''} onClick={() => setMode('bar')} title="Biểu đồ cột"><BarChartRounded /></button>
    <button className={mode === 'line' ? 'on' : ''} onClick={() => setMode('line')} title="Biểu đồ đường"><ShowChartRounded /></button>
    <button className={mode === 'pie' ? 'on' : ''} disabled={c.series.length > 1} onClick={() => setMode('pie')} title="Biểu đồ tròn"><DonutLargeRounded /></button>
    {c.series.length > 1 && mode === 'bar' && <button className={stacked ? 'on' : ''} onClick={() => setStacked((v) => !v)} title="Cột chồng"><ViewWeekRounded /></button>}
  </div>;
  if (mode === 'pie') {
    return <Card title={c.title} subtitle="Phân bổ theo tỷ trọng" action={tools} className="rp-chart">{rows.length ? <ResponsiveContainer width="100%" height={280}>
      <PieChart><Pie data={rows} dataKey="value" nameKey="name" innerRadius={52} outerRadius={88} paddingAngle={2}>{rows.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie>
        <Tooltip formatter={tip} /><Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 12.5 }} /></PieChart></ResponsiveContainer> : <Empty title="Không có dữ liệu" />}</Card>;
  }
  const many = data.length > 14;
  const axes = <><CartesianGrid vertical={false} stroke="#e8eef3" />
      <XAxis dataKey="x" tick={{ fontSize: 11.5, fill: '#6b7c8d' }} tickLine={false} axisLine={{ stroke: '#e3eaf0' }} interval={many ? 'preserveStartEnd' : 0} angle={c.x.some((x) => String(x).length > 9) ? -20 : 0} textAnchor={c.x.some((x) => String(x).length > 9) ? 'end' : 'middle'} height={c.x.some((x) => String(x).length > 9) ? 56 : 28} />
      <YAxis tick={{ fontSize: 11.5, fill: '#6b7c8d' }} tickLine={false} axisLine={false} tickFormatter={f} width={46} />
      <Tooltip formatter={tip} cursor={{ fill: 'rgba(13,122,138,.06)' }} />
      {c.series.length > 1 && <Legend iconType="circle" wrapperStyle={{ fontSize: 12.5 }} />}</>;
  return <Card title={c.title} subtitle={mode === 'line' ? 'Xu hướng biến động theo kỳ' : 'So sánh theo nhóm dữ liệu'} action={tools} className="rp-chart">{data.length ? <ResponsiveContainer width="100%" height={280}>
    {mode === 'line' ? <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>{axes}
      {c.series.map((s, i) => <Line key={s.name} type="monotone" dataKey={s.name} stroke={COLORS[i % COLORS.length]} strokeWidth={2.4} dot={{ r: 3, fill: '#fff', strokeWidth: 2 }} activeDot={{ r: 5 }} />)}
    </LineChart> : <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>{axes}
      {c.series.map((s, i) => <Bar key={s.name} dataKey={s.name} stackId={stacked ? 'total' : undefined} fill={COLORS[i % COLORS.length]} radius={[4, 4, 0, 0]} maxBarSize={many ? 14 : 36} />)}
    </BarChart>}
  </ResponsiveContainer> : <Empty title="Không có dữ liệu" />}</Card>;
}

function DataTable({ t }) {
  const [sort, setSort] = useState(null);
  const cols = t.columns;
  const num_ = (c) => ['vnd', 'int', 'pct', 'min'].includes(c.type);
  const total = (c) => (['vnd', 'int'].includes(c.type) && /^(amount|qty|count|value|total|debt|paid|billed)/i.test(c.key) ? t.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0) : null);
  const totals = cols.map(total);
  const showTotal = t.rows.length > 1 && totals.some((x) => x != null);
  const rows = sort ? [...t.rows].sort((a, b) => {
    const av = a[sort.key] ?? ''; const bv = b[sort.key] ?? '';
    const result = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv), 'vi');
    return sort.dir === 'asc' ? result : -result;
  }) : t.rows;
  const changeSort = (key) => setSort((s) => s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' });
  return <Card title={t.title} subtitle={`${t.rows.length} dòng · Nhấp tiêu đề cột để sắp xếp`} pad={false} className="rp-table">
    {t.rows.length ? <div className="cl-table-wrap"><table className="cl-table rp">
      <thead><tr>{cols.map((c) => <th key={c.key} className={num_(c) ? 'r' : ''}><button className="rp-sort" onClick={() => changeSort(c.key)}>{c.label}<span>{sort?.key === c.key ? (sort.dir === 'asc' ? '↑' : '↓') : '↕'}</span></button></th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c.key} className={num_(c) ? 'r' : ''}>{fmt(r[c.key], c.type)}</td>)}</tr>)}</tbody>
      {showTotal && <tfoot><tr>{cols.map((c, i) => <td key={c.key} className={num_(c) ? 'r' : ''}>{i === 0 ? 'Tổng cộng' : totals[i] != null ? fmt(totals[i], c.type) : ''}</td>)}</tr></tfoot>}
    </table></div> : <Empty title="Không có dữ liệu trong kỳ này" />}
  </Card>;
}

export default function ReportsPage() {
  const [tab, setTab] = useState('revenue');
  const [view, setView] = useState('overview');
  const ps = presets();
  const [range, setRange] = useState({ from: ps[2][1], to: ps[2][2] });
  const [busy, setBusy] = useState(false);
  const [toast, toastNode] = useToast();
  const l = useLoad(async () => (await api.get(`/clinic/reports/${tab}/`, { params: range })).data, [tab, range.from, range.to]);
  const rep = l.data;
  const exportXlsx = async () => {
    setBusy(true);
    try {
      const res = await api.get(`/clinic/reports/${tab}/`, { params: { ...range, export: 'xlsx' }, responseType: 'blob', timeout: 60000 });
      const a = document.createElement('a'); a.href = URL.createObjectURL(res.data); a.download = `bao-cao-${tab}-${range.from}_${range.to}.xlsx`; document.body.appendChild(a); a.click(); a.remove();
      toast('Đã xuất file Excel.');
    } catch (e) { toast(errMsg(e, 'Không xuất được file.'), 'err'); } finally { setBusy(false); }
  };
  const isPreset = (p) => range.from === p[1] && range.to === p[2];
  return <div className="rp">
    <PageHead actions={<><Btn icon={<PrintRounded />} onClick={() => window.print()}>In báo cáo</Btn><Btn kind="primary" icon={<FileDownloadRounded />} disabled={busy} onClick={exportXlsx}>{busy ? 'Đang xuất…' : 'Xuất Excel'}</Btn></>} />
    <section className="rp-command rp-noprint">
      <nav className="cl-tabs rp-report-tabs" role="tablist">{TABS.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}</nav>
      <div className="rp-filter">
        <div><span className="rp-control-label">Kỳ báo cáo</span><div className="cl-tabs-pill">{ps.map((p) => <button key={p[0]} className={isPreset(p) ? 'on' : ''} onClick={() => setRange({ from: p[1], to: p[2] })}>{p[0]}</button>)}</div></div>
        <div className="rp-dates"><label><span>Từ ngày</span><input type="date" value={range.from} max={range.to} onChange={(e) => e.target.value && setRange((r) => ({ ...r, from: e.target.value }))} /></label>
          <label><span>Đến ngày</span><input type="date" value={range.to} min={range.from} onChange={(e) => e.target.value && setRange((r) => ({ ...r, to: e.target.value }))} /></label></div>
      </div>
      <div className="rp-viewbar"><div><span className="rp-control-label">Chế độ xem</span><p>Chuyển nhanh giữa dashboard, biểu đồ và bảng phân tích.</p></div>
        <div className="rp-view-switch">
          <button className={view === 'overview' ? 'on' : ''} onClick={() => setView('overview')}><DashboardRounded />Tổng quan</button>
          <button className={view === 'charts' ? 'on' : ''} onClick={() => setView('charts')}><BarChartRounded />Biểu đồ</button>
          <button className={view === 'tables' ? 'on' : ''} onClick={() => setView('tables')}><TableChartRounded />Bảng phân tích</button>
        </div></div>
    </section>
    {l.loading && !rep ? <Loading text="Đang lập báo cáo…" /> : l.error && !rep ? <div className="cl-alert error">{l.error}</div> : rep && <div className={l.loading ? 'rp-fade' : ''}>
      <header className="rp-head"><div><small>BÁO CÁO ĐIỀU HÀNH · AkinaClinic</small><h2>{rep.title}</h2><p>Kỳ báo cáo: {fmtDate(rep.period[0])} – {fmtDate(rep.period[1])}</p></div><div className="rp-fresh"><i />Dữ liệu cập nhật lúc {new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}</div></header>
      <div className="cl-stat-row rp-kpis">{rep.kpis.map((k) => <div key={k.label} className={`cl-stat ${k.tone || ''}`}><span>{k.label}</span><strong>{fmt(k.value, k.type)}</strong>{k.hint && <small className={k.hint.startsWith('+') ? 'positive' : k.hint.startsWith('-') ? 'negative' : ''}>{k.hint}</small>}</div>)}</div>
      {view !== 'tables' && rep.charts.length > 0 && <section className="rp-section"><div className="rp-section-head"><div><span>TRỰC QUAN DỮ LIỆU</span><h3>Xu hướng và cơ cấu</h3></div><p>Chọn biểu đồ cột, đường, tròn hoặc cột chồng trên từng khối.</p></div><div className="rp-charts">{rep.charts.map((c) => <Chart key={`${c.id}-${tab}`} c={c} />)}</div></section>}
      {view !== 'charts' && <section className="rp-section"><div className="rp-section-head"><div><span>PHÂN TÍCH CHI TIẾT</span><h3>Bảng dữ liệu theo nghiệp vụ</h3></div><p>Sắp xếp từng cột và xuất toàn bộ dữ liệu sang Excel khi cần đối soát.</p></div><div className="rp-tables">{rep.tables.map((t) => <DataTable key={`${t.id}-${tab}`} t={t} />)}</div></section>}
    </div>}
    {toastNode}
  </div>;
}
