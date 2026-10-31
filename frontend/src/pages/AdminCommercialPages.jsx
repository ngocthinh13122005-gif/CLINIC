import { useEffect, useMemo, useState } from 'react';
import AddRounded from '@mui/icons-material/AddRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import MedicalServicesRounded from '@mui/icons-material/MedicalServicesRounded';
import PaymentsRounded from '@mui/icons-material/PaymentsRounded';
import PriceChangeRounded from '@mui/icons-material/PriceChangeRounded';
import PrintRounded from '@mui/icons-material/PrintRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import ToggleOnRounded from '@mui/icons-material/ToggleOnRounded';
import api from '../api/client';
import '../styles/commercial-management.css';

const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(value) || 0))}đ`;
const pct = (value) => `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 }).format(Number(value) || 0)}%`;

function useLoad(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const load = async () => {
    setState((old) => ({ ...old, loading: true, error: '' }));
    try { setState({ loading: false, data: await loader(), error: '' }); }
    catch (error) { setState({ loading: false, data: null, error: error?.response?.data?.detail || 'Không tải được dữ liệu.' }); }
  };
  useEffect(() => { load(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: load };
}

function Toast({ text, onClose }) {
  return text ? <div className="cm-toast"><CheckCircleRounded /><span>{text}</span><button onClick={onClose}>×</button></div> : null;
}

function Modal({ title, onClose, children }) {
  return <div className="cm-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="cm-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button className="cm-modal-close" onClick={onClose} aria-label="Đóng"><CloseRounded /></button>
      <h2>{title}</h2><p>Thông tin này được dùng thống nhất khi đặt lịch, lập hóa đơn và tính doanh thu.</p>
      {children}
    </section>
  </div>;
}

function Kpis({ services, payroll }) {
  const active = services.filter((item) => item.is_active);
  const categories = new Set(active.map((item) => item.category)).size;
  const avgPrice = active.length ? active.reduce((sum, item) => sum + Number(item.price || 0), 0) / active.length : 0;
  const commission = (payroll?.rows || []).reduce((sum, row) => sum + Number(row.commission || 0), 0);
  return <div className="cm-kpis">
    <article><MedicalServicesRounded /><span>Dịch vụ đang bán<strong>{active.length}</strong><small>{services.length - active.length} dịch vụ tạm ngưng</small></span></article>
    <article><PriceChangeRounded /><span>Giá bán bình quân<strong>{money(avgPrice)}</strong><small>{categories} nhóm dịch vụ</small></span></article>
    <article><PaymentsRounded /><span>Hoa hồng kỳ này<strong>{money(commission)}</strong><small>Theo doanh thu đã hoàn thành</small></span></article>
  </div>;
}

function ServiceForm({ service, categories, onClose, onSaved }) {
  const blank = { name: '', category: '', description: '', price: 0, duration: 60, booking_policy: 'assessment', is_active: true };
  const [form, setForm] = useState(service ? { ...service } : blank);
  const [error, setError] = useState('');
  const set = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.type === 'checkbox' ? event.target.checked : event.target.value }));
  const submit = async (event) => {
    event.preventDefault(); setError('');
    const payload = { ...form, category: Number(form.category), price: Number(form.price), duration: Number(form.duration) };
    try { service ? await api.patch(`/services/${service.id}/`, payload) : await api.post('/services/', payload); onSaved(); }
    catch (err) { setError(err?.response?.data?.detail || Object.values(err?.response?.data || {})?.flat()?.[0] || 'Không thể lưu dịch vụ.'); }
  };
  return <Modal title={service ? 'Chỉnh sửa dịch vụ' : 'Thêm dịch vụ'} onClose={onClose}>
    <form className="cm-form" onSubmit={submit}>
      {error && <div className="cm-alert">{error}</div>}
      <label className="span2">Tên dịch vụ<input required value={form.name} onChange={set('name')} /></label>
      <label>Nhóm dịch vụ<select required value={form.category} onChange={set('category')}><option value="">Chọn nhóm</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <label>Thời lượng chuẩn (phút)<input required min="15" step="5" type="number" value={form.duration} onChange={set('duration')} /></label>
      <label className="span2">Giá niêm yết (VNĐ)<input required min="0" step="1000" type="number" value={form.price} onChange={set('price')} /></label>
      <label className="span2">Chính sách đặt lịch<select value={form.booking_policy || 'assessment'} onChange={set('booking_policy')}><option value="direct">Có thể yêu cầu đặt trực tiếp</option><option value="assessment">Cần bác sĩ tư vấn hoặc đánh giá trước</option><option value="indicated">Chỉ thực hiện khi đã có chỉ định</option><option value="plan_only">Chỉ đặt trong liệu trình hiện có</option></select></label>
      <label className="span2">Mô tả<textarea rows="3" value={form.description || ''} onChange={set('description')} /></label>
      <label className="cm-check span2"><input type="checkbox" checked={form.is_active} onChange={set('is_active')} /> Đang cung cấp và cho phép đặt lịch</label>
      <div className="cm-modal-actions span2"><button type="button" onClick={onClose}>Hủy</button><button className="primary">Lưu dịch vụ</button></div>
    </form>
  </Modal>;
}

function Catalog({ services, categories, reload, notify }) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [status, setStatus] = useState('active');
  const [edit, setEdit] = useState(null);
  const rows = services.filter((item) => `${item.name} ${item.category_name}`.toLowerCase().includes(query.toLowerCase())
    && (category === 'all' || String(item.category) === category)
    && (status === 'all' || item.is_active === (status === 'active')));
  const toggle = async (item) => { await api.patch(`/services/${item.id}/`, { is_active: !item.is_active }); notify(item.is_active ? 'Đã tạm ngưng dịch vụ.' : 'Đã mở lại dịch vụ.'); reload(); };
  return <>
    <div className="cm-toolbar">
      <label className="cm-search"><SearchRounded /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên hoặc nhóm dịch vụ…" /></label>
      <select value={category} onChange={(event) => setCategory(event.target.value)}><option value="all">Tất cả nhóm</option>{categories.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
      <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Đang cung cấp</option><option value="inactive">Tạm ngưng</option><option value="all">Tất cả trạng thái</option></select>
      <button className="cm-btn primary" onClick={() => setEdit({})}><AddRounded />Thêm dịch vụ</button>
    </div>
    <div className="cm-table-wrap"><table className="cm-table"><thead><tr><th>Dịch vụ</th><th>Nhóm</th><th>Chính sách đặt lịch</th><th>Thời lượng</th><th>Giá niêm yết</th><th>Trạng thái</th><th /></tr></thead>
      <tbody>{rows.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.description || 'Chưa có mô tả'}</small></td><td>{item.category_name}</td><td>{({direct:'Đặt trực tiếp',assessment:'Cần tư vấn',indicated:'Cần chỉ định',plan_only:'Theo liệu trình'})[item.booking_policy]||'Cần tư vấn'}</td><td>{item.duration} phút</td><td><b>{money(item.price)}</b></td><td><span className={`cm-status ${item.is_active ? 'active' : ''}`}>{item.is_active ? 'Đang cung cấp' : 'Tạm ngưng'}</span></td><td><div className="cm-actions"><button onClick={() => setEdit(item)}><EditRounded />Sửa</button><button onClick={() => toggle(item)}><ToggleOnRounded />{item.is_active ? 'Tạm ngưng' : 'Mở lại'}</button></div></td></tr>)}</tbody></table>{!rows.length && <div className="cm-empty">Không có dịch vụ phù hợp bộ lọc.</div>}</div>
    {edit && <ServiceForm service={edit.id ? edit : null} categories={categories} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); notify(edit.id ? 'Đã cập nhật dịch vụ.' : 'Đã thêm dịch vụ.'); reload(); }} />}
  </>;
}

function PriceList({ services }) {
  const groups = useMemo(() => services.filter((item) => item.is_active).reduce((map, item) => {
    const key = item.category_name || 'Khác'; if (!map[key]) map[key] = []; map[key].push(item); return map;
  }, {}), [services]);
  return <><div className="cm-view-head"><div><strong>Bảng giá đang áp dụng</strong><span>Chỉ hiển thị dịch vụ đang cung cấp. Giá này được dùng mặc định khi đặt lịch và lập hóa đơn.</span></div><button className="cm-btn" onClick={() => window.print()}><PrintRounded />In bảng giá</button></div>
    <div className="cm-price-groups">{Object.entries(groups).map(([name, items]) => <section key={name}><header><h3>{name}</h3><span>{items.length} dịch vụ</span></header>{items.sort((a, b) => a.name.localeCompare(b.name, 'vi')).map((item) => <div className="cm-price-row" key={item.id}><span><strong>{item.name}</strong><small>{item.description || `${item.duration} phút`}</small></span><span>{item.duration} phút</span><b>{money(item.price)}</b></div>)}</section>)}</div></>;
}

function Commissions({ payroll, reload, notify }) {
  const rows = payroll?.rows || [];
  const totalBase = rows.reduce((sum, row) => sum + Number(row.commission_base || 0), 0);
  const total = rows.reduce((sum, row) => sum + Number(row.commission || 0), 0);
  const saveRate = async (row, value) => {
    const rate = Math.max(0, Math.min(100, Number(value) || 0));
    if (rate === Number(row.commission_rate)) return;
    await api.patch(`/staff/${row.id}/`, { commission_rate: rate }); notify(`Đã cập nhật tỷ lệ cho ${row.name}.`); reload();
  };
  return <>
    <div className="cm-policy"><div><span>CHÍNH SÁCH ĐANG ÁP DỤNG</span><strong>Hoa hồng theo thành tích cá nhân</strong><p>Căn cứ: tổng giá trị lịch hẹn đã hoàn thành. Tỷ lệ được cấu hình riêng theo từng nhân sự và được cộng vào bảng lương.</p></div><dl><div><dt>Doanh thu tính hoa hồng</dt><dd>{money(totalBase)}</dd></div><div><dt>Hoa hồng dự kiến</dt><dd>{money(total)}</dd></div></dl></div>
    <div className="cm-table-wrap"><table className="cm-table"><thead><tr><th>Nhân sự</th><th>Vai trò</th><th>Doanh thu hoàn thành</th><th>Tỷ lệ</th><th>Hoa hồng dự kiến</th><th>Trạng thái bảng lương</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.name}</strong></td><td>{row.role === 'doctor' ? 'Bác sĩ' : 'Nhân viên'}</td><td>{money(row.commission_base)}</td><td><label className="cm-rate"><input type="number" min="0" max="100" step="0.25" defaultValue={Number(row.commission_rate)} onBlur={(event) => saveRate(row, event.target.value)} /><span>%</span></label></td><td><b>{money(row.commission)}</b></td><td><span className={`cm-status ${row.status !== 'draft' ? 'active' : ''}`}>{row.status === 'paid' ? 'Đã thanh toán' : row.status === 'approved' ? 'Đã duyệt' : 'Nháp'}</span></td></tr>)}</tbody></table>{!rows.length && <div className="cm-empty">Chưa có dữ liệu hoa hồng.</div>}</div>
    <p className="cm-footnote">Số liệu là dự kiến cho kỳ hiện tại; duyệt và thanh toán được thực hiện tại mục Bảng lương.</p>
  </>;
}

export function AdminServicesPage() {
  const [tab, setTab] = useState('catalog');
  const [toast, setToast] = useState('');
  const request = useLoad(async () => {
    const [services, categories, payroll] = await Promise.all([api.get('/services/'), api.get('/categories/'), api.get('/dashboard/payroll/')]);
    return { services: services.data.results || services.data || [], categories: categories.data.results || categories.data || [], payroll: payroll.data };
  }, []);
  const data = request.data || { services: [], categories: [], payroll: { rows: [] } };
  return <div className="cm-page">
    <Toast text={toast} onClose={() => setToast('')} />
    <nav className="cm-nav" aria-label="Quản trị dịch vụ và doanh thu">{[['catalog', 'Danh mục dịch vụ'], ['prices', 'Bảng giá'], ['commission', 'Hoa hồng']].map(([key, label]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => setTab(key)}>{label}</button>)}</nav>
    {request.error && <div className="cm-alert">{request.error}</div>}
    <Kpis services={data.services} payroll={data.payroll} />
    <section className="cm-panel">
      {request.loading && !request.data ? <div className="cm-empty">Đang tải dữ liệu…</div> : tab === 'catalog' ? <Catalog services={data.services} categories={data.categories} reload={request.reload} notify={setToast} /> : tab === 'prices' ? <PriceList services={data.services} /> : <Commissions payroll={data.payroll} reload={request.reload} notify={setToast} />}
    </section>
  </div>;
}
