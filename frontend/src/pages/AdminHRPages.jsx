import { useEffect, useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';
import AddRounded from '@mui/icons-material/AddRounded';
import BadgeRounded from '@mui/icons-material/BadgeRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import GridViewRounded from '@mui/icons-material/GridViewRounded';
import GroupsRounded from '@mui/icons-material/GroupsRounded';
import MedicalServicesRounded from '@mui/icons-material/MedicalServicesRounded';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import PaymentsRounded from '@mui/icons-material/PaymentsRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import ViewListRounded from '@mui/icons-material/ViewListRounded';
import WorkHistoryRounded from '@mui/icons-material/WorkHistoryRounded';
import api from '../api/client';
import '../styles/hr-management.css';

const money = (value) => `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(value) || 0))}đ`;
const dmy = (value) => value ? new Date(value).toLocaleDateString('vi-VN') : '—';
const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

function useLoad(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const load = async () => {
    setState((prev) => ({ ...prev, loading: true, error: '' }));
    try {
      setState({ loading: false, data: await loader(), error: '' });
    } catch (error) {
      setState({ loading: false, data: null, error: error?.response?.data?.detail || 'Không tải được dữ liệu.' });
    }
  };
  useEffect(() => { load(); }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return { ...state, reload: load };
}

function Toast({ text, onClose }) {
  if (!text) return null;
  return <div className="hr-toast"><CheckCircleRounded /><span>{text}</span><button onClick={onClose}>×</button></div>;
}

function Modal({ open, title, subtitle, onClose, children }) {
  if (!open) return null;
  return <div className="hr-modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="hr-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button className="hr-modal-close" onClick={onClose} aria-label="Đóng"><CloseRounded /></button>
      <span className="hr-eyebrow">HỒ SƠ NGUỒN NHÂN LỰC</span>
      <h2>{title}</h2>
      {subtitle && <p className="hr-modal-subtitle">{subtitle}</p>}
      {children}
    </section>
  </div>;
}

function WorkspaceNav() {
  const links = [
    ['/admin/staff', <BadgeRounded key="i" />, 'Hồ sơ nhân sự'],
    ['/admin/attendance', <WorkHistoryRounded key="i" />, 'Chấm công & nghỉ phép'],
    ['/admin/payroll', <PaymentsRounded key="i" />, 'Bảng lương'],
  ];
  return <nav className="hr-workspace-nav" aria-label="Quản trị nguồn nhân lực">
    {links.map(([to, icon, label]) => <NavLink key={to} to={to} className={({ isActive }) => isActive ? 'active' : ''}>{icon}<span>{label}</span></NavLink>)}
  </nav>;
}

function PageLead({ action }) {
  return action ? <div className="hr-page-action-only">{action}</div> : null;
}

function Kpis({ items }) {
  return <div className="hr-kpis">{items.map((item) => <article key={item.label}>
    <div className="hr-kpi-icon">{item.icon}</div><div><span>{item.label}</span><strong>{item.value}</strong>{item.note && <small>{item.note}</small>}</div>
  </article>)}</div>;
}

function SearchBox({ value, onChange, placeholder = 'Tìm kiếm...' }) {
  return <label className="hr-search"><SearchRounded /><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} /></label>;
}

function StatusPill({ status, children }) {
  return <span className={`hr-status ${status}`}>{children}</span>;
}

function Avatar({ person, large = false }) {
  const [broken, setBroken] = useState(false);
  return <span className={`hr-avatar ${large ? 'large' : ''}`}>
    {person.photo_url && !broken ? <img src={person.photo_url} alt="" onError={() => setBroken(true)} /> : (person.name?.trim()?.[0] || 'N')}
  </span>;
}

const blankStaff = {
  name: '', position: '', phone: '', username: '', email: '', password: '', role: 'staff', service_ids: [],
  is_active: true, rating: 5, experience_years: 0, base_salary: 6000000, bonus: 0,
  manual_deduction: 0, payroll_status: 'draft',
};

export function AdminStaffPage() {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('all');
  const [status, setStatus] = useState('active');
  const [view, setView] = useState('cards');
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState('');
  const request = useLoad(async () => {
    const [staff, services, payroll, bookings] = await Promise.all([
      api.get('/staff/'), api.get('/services/'), api.get('/dashboard/payroll/'), api.get('/bookings/'),
    ]);
    return {
      staff: staff.data.results || staff.data || [], services: services.data.results || services.data || [],
      payroll: payroll.data, bookings: bookings.data.results || bookings.data || [],
    };
  }, []);
  const staff = request.data?.staff || [];
  const today = new Date().toISOString().slice(0, 10);
  const filtered = useMemo(() => staff.filter((person) => {
    const haystack = `${person.name} ${person.position} ${person.phone} ${person.account_email} ${(person.service_names || []).join(' ')}`.toLowerCase();
    return haystack.includes(query.trim().toLowerCase())
      && (role === 'all' || person.account_role === role)
      && (status === 'all' || (status === 'active' ? person.is_active : !person.is_active));
  }), [staff, query, role, status]);
  const save = async (event) => {
    event.preventDefault();
    try {
      const payload = { ...modal.form };
      if (modal.id) {
        delete payload.username;
        if (!payload.password) delete payload.password;
        await api.patch(`/staff/${modal.id}/`, payload);
      } else await api.post('/staff/', payload);
      setToast(modal.id ? 'Đã cập nhật hồ sơ nhân sự.' : 'Đã tạo hồ sơ nhân sự.');
      setModal(null);
      request.reload();
    } catch (error) {
      setToast(error.response?.data?.detail || Object.values(error.response?.data || {})?.[0]?.[0] || 'Không thể lưu hồ sơ.');
    }
  };
  const toggleActive = async (person) => {
    await api.patch(`/staff/${person.id}/`, { is_active: !person.is_active });
    setToast(person.is_active ? 'Đã chuyển nhân sự sang trạng thái tạm ngưng.' : 'Đã kích hoạt lại nhân sự.');
    request.reload();
  };
  const edit = (person) => setModal({ id: person.id, form: { ...blankStaff, ...person, email: person.account_email || '', role: person.account_role || 'staff', service_ids: person.service_ids_current || [], password: '' } });
  const dailyLoad = (person) => (request.data?.bookings || []).filter((booking) => Number(booking.staff) === Number(person.id) && (booking.appointment || '').slice(0, 10) === today && booking.status !== 'cancelled').length;
  return <div className="hr-page">
    <Toast text={toast} onClose={() => setToast('')} />
    <WorkspaceNav />
    <PageLead title="Hồ sơ nhân sự" subtitle="Quản lý tập trung hồ sơ, vai trò, chuyên môn và trạng thái làm việc của đội ngũ phòng khám."
      action={<button className="hr-btn primary" onClick={() => setModal({ form: { ...blankStaff } })}><AddRounded />Thêm nhân sự</button>} />
    {request.error && <div className="hr-alert">{request.error}</div>}
    <Kpis items={[
      { label: 'Tổng nhân sự', value: staff.length, note: `${staff.filter((x) => x.is_active).length} đang hoạt động`, icon: <GroupsRounded /> },
      { label: 'Bác sĩ', value: staff.filter((x) => x.account_role === 'doctor').length, note: 'Hồ sơ chuyên môn', icon: <MedicalServicesRounded /> },
      { label: 'Nhân viên hỗ trợ', value: staff.filter((x) => x.account_role === 'staff').length, note: 'Điều dưỡng / kỹ thuật viên', icon: <BadgeRounded /> },
      { label: 'Quỹ lương dự kiến', value: money(request.data?.payroll?.summary?.payroll || 0), note: 'Thực nhận hiện tại', icon: <PaymentsRounded /> },
    ]} />
    <section className="hr-panel">
      <div className="hr-toolbar">
        <SearchBox value={query} onChange={setQuery} placeholder="Tìm theo tên, chức vụ, chuyên môn..." />
        <div className="hr-filters">
          <select value={role} onChange={(event) => setRole(event.target.value)}><option value="all">Tất cả vai trò</option><option value="doctor">Bác sĩ</option><option value="staff">Nhân viên</option></select>
          <select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">Tất cả trạng thái</option><option value="active">Đang làm việc</option><option value="inactive">Tạm ngưng</option></select>
          <div className="hr-view-switch"><button className={view === 'cards' ? 'active' : ''} onClick={() => setView('cards')} aria-label="Dạng thẻ"><GridViewRounded /></button><button className={view === 'table' ? 'active' : ''} onClick={() => setView('table')} aria-label="Dạng bảng"><ViewListRounded /></button></div>
        </div>
      </div>
      {view === 'cards' ? <div className="hr-directory">{filtered.map((person) => {
        const used = dailyLoad(person); const capacity = Math.min(100, Math.round((used / 4) * 100));
        return <article className="hr-person-card" key={person.id}>
          <div className="hr-person-head"><Avatar person={person} large /><div><h3>{person.name}</h3><p>{person.position || 'Chưa cập nhật chức vụ'}</p></div><StatusPill status={person.is_active ? 'active' : 'inactive'}>{person.is_active ? 'Đang làm việc' : 'Tạm ngưng'}</StatusPill></div>
          <div className="hr-person-meta"><span><BadgeRounded />{person.account_role === 'doctor' ? 'Bác sĩ' : 'Nhân viên'}</span><span><StarRounded />{person.rating}/5</span><span><WorkHistoryRounded />{person.experience_years} năm</span></div>
          <div className="hr-skill-list">{(person.service_names || []).slice(0, 3).map((name) => <span key={name}>{name}</span>)}{!person.service_names?.length && <span>Chưa gán chuyên môn</span>}{person.service_names?.length > 3 && <span>+{person.service_names.length - 3}</span>}</div>
          <div className="hr-load"><div><span>Công suất hôm nay</span><strong>{used}/4 lịch</strong></div><div className="hr-progress"><i style={{ width: `${person.is_active ? capacity : 0}%` }} /></div></div>
          <div className="hr-card-foot"><span>{person.account_email || person.phone || 'Chưa có thông tin liên hệ'}</span><div><button onClick={() => edit(person)}><EditRounded />Sửa</button><button className="muted-action" onClick={() => toggleActive(person)}>{person.is_active ? 'Tạm ngưng' : 'Kích hoạt'}</button></div></div>
        </article>;
      })}</div> : <div className="hr-table-wrap"><table className="hr-table"><thead><tr><th>Nhân sự</th><th>Vai trò</th><th>Chuyên môn</th><th>Kinh nghiệm</th><th>Công suất hôm nay</th><th>Trạng thái</th><th /></tr></thead><tbody>{filtered.map((person) => <tr key={person.id}><td><div className="hr-person-cell"><Avatar person={person} /><div><strong>{person.name}</strong><small>{person.account_email || person.phone || '—'}</small></div></div></td><td>{person.account_role === 'doctor' ? 'Bác sĩ' : 'Nhân viên'}</td><td>{(person.service_names || []).slice(0, 2).join(', ') || 'Chưa gán'}</td><td>{person.experience_years} năm</td><td>{dailyLoad(person)}/4 lịch</td><td><StatusPill status={person.is_active ? 'active' : 'inactive'}>{person.is_active ? 'Đang làm việc' : 'Tạm ngưng'}</StatusPill></td><td className="hr-table-actions"><button onClick={() => edit(person)}><EditRounded />Sửa</button></td></tr>)}</tbody></table></div>}
      {!filtered.length && <div className="hr-empty">Không tìm thấy nhân sự phù hợp.</div>}
    </section>
    <Modal open={!!modal} title={modal?.id ? 'Chỉnh sửa hồ sơ nhân sự' : 'Tạo hồ sơ nhân sự'} subtitle="Thông tin này được dùng cho phân công lịch, chấm công và tính lương." onClose={() => setModal(null)}>
      {modal && <form className="hr-form" onSubmit={save}>
        <div className="hr-form-grid"><label>Họ và tên<input required value={modal.form.name} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, name: e.target.value } }))} /></label><label>Chức vụ<input required value={modal.form.position} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, position: e.target.value } }))} /></label><label>Số điện thoại<input value={modal.form.phone} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, phone: e.target.value } }))} /></label><label>Vai trò<select value={modal.form.role} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, role: e.target.value } }))}><option value="staff">Nhân viên</option><option value="doctor">Bác sĩ</option></select></label></div>
        {!modal.id && <div className="hr-form-grid three"><label>Tên đăng nhập<input required value={modal.form.username} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, username: e.target.value } }))} /></label><label>Email<input type="email" value={modal.form.email} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, email: e.target.value } }))} /></label><label>Mật khẩu tạm<input type="password" minLength="6" required value={modal.form.password} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, password: e.target.value } }))} /></label></div>}
        <div className="hr-form-grid three"><label>Đánh giá<input type="number" min="0" max="5" step="0.1" value={modal.form.rating} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, rating: Number(e.target.value) } }))} /></label><label>Kinh nghiệm (năm)<input type="number" min="0" value={modal.form.experience_years} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, experience_years: Number(e.target.value) } }))} /></label><label>Lương cơ bản<input type="number" min="0" value={modal.form.base_salary} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, base_salary: Number(e.target.value) } }))} /></label></div>
        <fieldset><legend>Chuyên môn / dịch vụ có thể thực hiện</legend><div className="hr-check-grid">{(request.data?.services || []).map((service) => <label key={service.id}><input type="checkbox" checked={modal.form.service_ids.includes(service.id)} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, service_ids: e.target.checked ? [...m.form.service_ids, service.id] : m.form.service_ids.filter((id) => id !== service.id) } }))} /><span>{service.name}</span></label>)}</div></fieldset>
        <label className="hr-check"><input type="checkbox" checked={modal.form.is_active} onChange={(e) => setModal((m) => ({ ...m, form: { ...m.form, is_active: e.target.checked } }))} />Nhân sự đang hoạt động</label>
        <div className="hr-modal-actions"><button type="button" className="hr-btn secondary" onClick={() => setModal(null)}>Hủy</button><button className="hr-btn primary">Lưu hồ sơ</button></div>
      </form>}
    </Modal>
  </div>;
}

export function AdminAttendancePage() {
  const [mode, setMode] = useState('attendance');
  const [month, setMonth] = useState(currentMonth());
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [toast, setToast] = useState('');
  const request = useLoad(async () => {
    const [attendance, leaves, staff] = await Promise.all([api.get('/attendance/'), api.get('/leave-requests/'), api.get('/staff/')]);
    return { attendance: attendance.data.results || attendance.data || [], leaves: leaves.data.results || leaves.data || [], staff: staff.data.results || staff.data || [] };
  }, []);
  const monthRows = (request.data?.attendance || []).filter((row) => !month || row.date.startsWith(month));
  const rows = monthRows.filter((row) => `${row.staff_name} ${row.note || ''}`.toLowerCase().includes(query.toLowerCase()) && (status === 'all' || row.status === status));
  const stats = { full_day: 0, late: 0, leave: 0, absent: 0 };
  monthRows.forEach((row) => { if (stats[row.status] !== undefined) stats[row.status] += 1; });
  const pendingLeaves = (request.data?.leaves || []).filter((leave) => leave.status === 'pending').length;
  const update = async (row, patch) => { await api.patch(`/attendance/${row.id}/`, patch); setToast('Đã cập nhật bản ghi chấm công.'); request.reload(); };
  const decide = async (leave, action) => { await api.post(`/leave-requests/${leave.id}/${action}/`); setToast(action === 'approve' ? 'Đã duyệt đơn nghỉ phép.' : 'Đã từ chối đơn nghỉ phép.'); request.reload(); };
  const leaves = (request.data?.leaves || []).filter((leave) => `${leave.staff_name} ${leave.reason}`.toLowerCase().includes(query.toLowerCase()) && (status === 'all' || leave.status === status));
  return <div className="hr-page">
    <Toast text={toast} onClose={() => setToast('')} />
    <WorkspaceNav />
    <PageLead title="Chấm công & nghỉ phép" subtitle="Theo dõi hiện diện, giờ làm, sai lệch và phê duyệt nghỉ phép trong một không gian quản trị." action={<label className="hr-month"><CalendarMonthRounded /><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>} />
    <Kpis items={[
      { label: 'Đủ công', value: stats.full_day, note: 'Bản ghi đạt lịch làm việc', icon: <CheckCircleRounded /> },
      { label: 'Đi trễ', value: stats.late, note: 'Cần kiểm tra sai lệch', icon: <WorkHistoryRounded /> },
      { label: 'Nghỉ phép', value: stats.leave, note: 'Đã ghi nhận trong kỳ', icon: <CalendarMonthRounded /> },
      { label: 'Chờ duyệt', value: pendingLeaves, note: 'Đơn nghỉ cần xử lý', icon: <NotificationsNoneRounded /> },
    ]} />
    <section className="hr-panel">
      <div className="hr-subnav"><button className={mode === 'attendance' ? 'active' : ''} onClick={() => { setMode('attendance'); setStatus('all'); }}>Dữ liệu chấm công</button><button className={mode === 'leave' ? 'active' : ''} onClick={() => { setMode('leave'); setStatus('all'); }}>Đơn nghỉ phép <span>{pendingLeaves}</span></button></div>
      <div className="hr-toolbar compact"><SearchBox value={query} onChange={setQuery} placeholder={mode === 'attendance' ? 'Tìm nhân sự hoặc ghi chú...' : 'Tìm đơn nghỉ phép...'} />
        <div className="hr-filters">{mode === 'attendance' ? <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Tất cả trạng thái</option><option value="full_day">Đủ công</option><option value="late">Đi trễ</option><option value="leave">Nghỉ phép</option><option value="absent">Vắng</option></select> : <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Tất cả trạng thái</option><option value="pending">Chờ duyệt</option><option value="approved">Đã duyệt</option><option value="rejected">Từ chối</option></select>}</div>
      </div>
      {mode === 'attendance' ? <div className="hr-table-wrap"><table className="hr-table"><thead><tr><th>Nhân sự</th><th>Ngày</th><th>Giờ vào – ra</th><th>Thời gian làm</th><th>Trạng thái</th><th>Ghi chú quản lý</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td><strong>{row.staff_name}</strong></td><td>{dmy(`${row.date}T00:00:00`)}</td><td><span className="hr-time">{row.check_in?.slice(0, 5) || '—'} <i>→</i> {row.check_out?.slice(0, 5) || '—'}</span></td><td><div className="hr-hours"><strong>{row.hours || 0} giờ</strong><div><i style={{ width: `${Math.min(100, ((row.hours || 0) / 8) * 100)}%` }} /></div></div></td><td><select className={`hr-status-select ${row.status}`} value={row.status} onChange={(e) => update(row, { status: e.target.value })}><option value="full_day">Đủ công</option><option value="late">Đi trễ</option><option value="leave">Nghỉ phép</option><option value="absent">Vắng</option></select></td><td><input className="hr-note" defaultValue={row.note || ''} placeholder="Thêm ghi chú" onBlur={(e) => { if (e.target.value !== row.note) update(row, { note: e.target.value }); }} /></td></tr>)}</tbody></table>{!rows.length && <div className="hr-empty">Không có dữ liệu chấm công trong kỳ đã chọn.</div>}</div>
        : <div className="hr-leave-grid">{leaves.map((leave) => <article className="hr-leave-card" key={leave.id}><div className="hr-leave-head"><div className="hr-avatar">{leave.staff_name?.[0] || 'N'}</div><div><h3>{leave.staff_name}</h3><p>Gửi ngày {dmy(leave.created_at)}</p></div><StatusPill status={leave.status}>{leave.status === 'approved' ? 'Đã duyệt' : leave.status === 'rejected' ? 'Từ chối' : 'Chờ duyệt'}</StatusPill></div><div className="hr-leave-period"><CalendarMonthRounded /><div><span>Thời gian nghỉ</span><strong>{dmy(`${leave.start_date}T00:00:00`)} – {dmy(`${leave.end_date}T00:00:00`)}</strong><small>{leave.days} ngày · {leave.leave_type === 'paid' ? 'Nghỉ có lương' : 'Nghỉ không lương'}</small></div></div><div className="hr-leave-reason"><span>Lý do</span><p>{leave.reason || 'Không có ghi chú'}</p></div>{leave.status === 'pending' && <div className="hr-leave-actions"><button className="hr-btn secondary danger" onClick={() => decide(leave, 'reject')}>Từ chối</button><button className="hr-btn primary" onClick={() => decide(leave, 'approve')}>Duyệt đơn</button></div>}</article>)}{!leaves.length && <div className="hr-empty">Không có đơn nghỉ phép phù hợp.</div>}</div>}
    </section>
  </div>;
}

export function AdminPayrollPage() {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState(null);
  const [toast, setToast] = useState('');
  const request = useLoad(async () => (await api.get('/dashboard/payroll/')).data, []);
  const rows = request.data?.rows || [];
  useEffect(() => { if (!selectedId && rows.length) setSelectedId(rows[0].id); }, [rows, selectedId]);
  const filtered = rows.filter((row) => row.name.toLowerCase().includes(query.toLowerCase()) && (status === 'all' || row.status === status));
  const selected = rows.find((row) => row.id === selectedId) || null;
  const patchStaff = async (row, patch, message = 'Đã cập nhật bảng lương.') => { await api.patch(`/staff/${row.id}/`, patch); setToast(message); await request.reload(); };
  const notify = async (row) => { await api.post(`/staff/${row.id}/notify_payroll/`); setToast(`Đã gửi thông báo bảng lương cho ${row.name}.`); };
  const paid = rows.filter((row) => row.status === 'paid').length;
  const approved = rows.filter((row) => row.status === 'approved').length;
  const average = rows.length ? rows.reduce((sum, row) => sum + Number(row.net_pay || 0), 0) / rows.length : 0;
  return <div className="hr-page">
    <Toast text={toast} onClose={() => setToast('')} />
    <WorkspaceNav />
    <PageLead title="Bảng lương" subtitle="Đối soát ngày công, thu nhập, khấu trừ và phát hành bảng lương theo quy trình kiểm soát." />
    <Kpis items={[
      { label: 'Tổng thực nhận', value: money(request.data?.summary?.payroll || 0), note: `${rows.length} bảng lương`, icon: <PaymentsRounded /> },
      { label: 'Chờ duyệt', value: rows.filter((row) => row.status === 'draft').length, note: 'Cần quản lý kiểm tra', icon: <WorkHistoryRounded /> },
      { label: 'Đã duyệt / đã trả', value: `${approved} / ${paid}`, note: 'Tiến độ xử lý', icon: <CheckCircleRounded /> },
      { label: 'Thực nhận bình quân', value: money(average), note: 'Trên mỗi nhân sự', icon: <GroupsRounded /> },
    ]} />
    <div className="hr-payroll-layout">
      <section className="hr-panel">
        <div className="hr-toolbar compact"><SearchBox value={query} onChange={setQuery} placeholder="Tìm nhân sự..." /><div className="hr-filters"><select value={status} onChange={(e) => setStatus(e.target.value)}><option value="all">Tất cả trạng thái</option><option value="draft">Nháp</option><option value="approved">Đã duyệt</option><option value="paid">Đã thanh toán</option></select></div></div>
        <div className="hr-table-wrap"><table className="hr-table payroll-summary"><thead><tr><th>Nhân sự</th><th>Ngày công</th><th>Tổng thu nhập</th><th>Khấu trừ</th><th>Thực nhận</th><th>Trạng thái</th></tr></thead><tbody>{filtered.map((row) => <tr key={row.id} className={row.id === selectedId ? 'selected' : ''} onClick={() => setSelectedId(row.id)}><td><strong>{row.name}</strong><small>{row.role === 'doctor' ? 'Bác sĩ' : 'Nhân viên'}</small></td><td><strong>{row.workdays} ngày</strong><small>{row.leave_days} ngày nghỉ</small></td><td>{money(Number(row.base_salary) + Number(row.commission) + Number(row.bonus))}</td><td className="negative">{money(row.deductions)}</td><td><strong>{money(row.net_pay)}</strong></td><td><StatusPill status={row.status}>{row.status === 'paid' ? 'Đã thanh toán' : row.status === 'approved' ? 'Đã duyệt' : 'Nháp'}</StatusPill></td></tr>)}</tbody></table>{!filtered.length && <div className="hr-empty">Không có bảng lương phù hợp.</div>}</div>
      </section>
      <aside className="hr-payroll-detail">{selected ? <>
        <div className="hr-payroll-person"><div className="hr-avatar large">{selected.name?.[0] || 'N'}</div><div><span>PHIẾU LƯƠNG</span><h2>{selected.name}</h2><p>{selected.role === 'doctor' ? 'Bác sĩ' : 'Nhân viên'} · {selected.workdays} ngày công</p></div></div>
        <div className="hr-pay-lines"><div><span>Lương cơ bản</span><strong>{money(selected.base_salary)}</strong></div><div><span>Hoa hồng</span><strong className="positive">+ {money(selected.commission)}</strong></div><label><span>Thưởng</span><input type="number" defaultValue={selected.bonus} onBlur={(e) => { const value = Number(e.target.value); if (value !== selected.bonus) patchStaff(selected, { bonus: value }); }} /></label><div className="separator" /><div><span>Khấu trừ tự động</span><strong className="negative">− {money(selected.auto_deduction)}</strong></div><label><span>Khấu trừ thủ công</span><input type="number" defaultValue={selected.manual_deduction} onBlur={(e) => { const value = Number(e.target.value); if (value !== selected.manual_deduction) patchStaff(selected, { manual_deduction: value }); }} /></label><small>{selected.unpaid_days ? `${selected.unpaid_days} ngày nghỉ không lương` : selected.late_minutes ? `${selected.late_minutes} phút đi trễ` : 'Không có sai lệch tự động'}</small></div>
        <div className="hr-net"><span>THỰC NHẬN</span><strong>{money(selected.net_pay)}</strong></div>
        <label className="hr-pay-status">Trạng thái<select value={selected.status} onChange={(e) => patchStaff(selected, { payroll_status: e.target.value }, 'Đã cập nhật trạng thái bảng lương.')}><option value="draft">Nháp</option><option value="approved">Đã duyệt</option><option value="paid">Đã thanh toán</option></select></label>
        <button className="hr-btn primary full" onClick={() => notify(selected)}><NotificationsNoneRounded />Gửi thông báo bảng lương</button>
      </> : <div className="hr-empty">Chọn một nhân sự để xem phiếu lương.</div>}</aside>
    </div>
  </div>;
}
