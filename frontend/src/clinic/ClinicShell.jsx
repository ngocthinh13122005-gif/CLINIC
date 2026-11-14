import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import DashboardRounded from '@mui/icons-material/DashboardRounded';
import MeetingRoomRounded from '@mui/icons-material/MeetingRoomRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import PeopleAltRounded from '@mui/icons-material/PeopleAltRounded';
import MedicalServicesRounded from '@mui/icons-material/MedicalServicesRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import VaccinesRounded from '@mui/icons-material/VaccinesRounded';
import BadgeRounded from '@mui/icons-material/BadgeRounded';
import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded';
import ReceiptLongRounded from '@mui/icons-material/ReceiptLongRounded';
import PointOfSaleRounded from '@mui/icons-material/PointOfSaleRounded';
import MedicationRounded from '@mui/icons-material/MedicationRounded';
import PaymentsRounded from '@mui/icons-material/PaymentsRounded';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import MenuRounded from '@mui/icons-material/MenuRounded';
import KeyboardDoubleArrowLeftRounded from '@mui/icons-material/KeyboardDoubleArrowLeftRounded';
import AssessmentRounded from '@mui/icons-material/AssessmentRounded';
import SupportAgentRounded from '@mui/icons-material/SupportAgentRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import VerifiedUserRounded from '@mui/icons-material/VerifiedUserRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ManageAccountsRounded from '@mui/icons-material/ManageAccountsRounded';
import SettingsRounded from '@mui/icons-material/SettingsRounded';
import HelpOutlineRounded from '@mui/icons-material/HelpOutlineRounded';
import LocalOfferRounded from '@mui/icons-material/LocalOfferRounded';
import MarkEmailReadRounded from '@mui/icons-material/MarkEmailReadRounded';
import { useAuth } from '../context/AuthContext';
import { roleLabel } from '../utils/roles';
import NotificationBell from '../components/NotificationBell';
import api from '../api/client';
import { Avatar, useDebounce } from './ui';
import './clinic.css';
import './unified-tabs.css';
import './pabau.css';

const MENUS = {
  manager: [
    { label: 'Tổng quan', to: '/dashboard', icon: DashboardRounded },
    { section: 'Vận hành hằng ngày' },
    { label: 'Tiếp đón hôm nay', to: '/tiep-don', icon: MeetingRoomRounded },
    { label: 'Lịch hẹn', to: '/lich-hen', icon: CalendarMonthRounded },
    { label: 'Hộp thư tư vấn', to: '/admin/conversations', icon: ForumRounded },
    { section: 'Hồ sơ & điều trị' },
    { label: 'Bệnh nhân', to: '/benh-nhan', icon: PeopleAltRounded },
    { label: 'Liệu trình', to: '/lieu-trinh', icon: VaccinesRounded },
    { label: 'Chăm sóc sau điều trị', to: '/cham-soc', icon: SupportAgentRounded },
    { label: 'Hoạt động', to: '/hoat-dong', icon: TaskAltRounded },
    { section: 'Tài chính & vật tư' },
    { label: 'Thu ngân & công nợ', to: '/thu-ngan', icon: ReceiptLongRounded },
    { label: 'Kho thuốc', to: '/kho-thuoc', icon: MedicationRounded },
    { section: 'Quản trị & kiểm soát' },
    { label: 'Báo cáo điều hành', to: '/bao-cao', icon: AssessmentRounded },
    { label: 'Dịch vụ & bảng giá', icon: MedicalServicesRounded, children: [
      { label: 'Dịch vụ & bảng giá', to: '/admin/services', icon: MedicalServicesRounded },
      { label: 'Bán hàng', to: '/ban-hang', icon: PointOfSaleRounded },
    ] },
    { label: 'Nhân sự & ca làm', icon: BadgeRounded, children: [
      { label: 'Danh bạ nhân sự', to: '/admin/staff', icon: BadgeRounded },
      { label: 'Chấm công & nghỉ phép', to: '/admin/attendance', icon: AccessTimeRounded },
      { label: 'Bảng lương', to: '/admin/payroll', icon: PaymentsRounded },
    ] },
  ],
  doctor: [
    { label: 'Tổng quan', to: '/dashboard', icon: DashboardRounded },
    { section: 'Vận hành hằng ngày' },
    { label: 'Ca khám hôm nay', to: '/tiep-don', icon: MeetingRoomRounded },
    { label: 'Lịch hẹn của tôi', to: '/lich-hen', icon: CalendarMonthRounded },
    { label: 'Tư vấn được chuyển', to: '/bac-si/tu-van/', icon: ForumRounded },
    { section: 'Chuyên môn & điều trị' },
    { label: 'Bệnh nhân', to: '/benh-nhan', icon: PeopleAltRounded },
    { label: 'Liệu trình', to: '/lieu-trinh', icon: VaccinesRounded },
    { label: 'Chăm sóc sau điều trị', to: '/cham-soc', icon: SupportAgentRounded },
    { label: 'Hoạt động', to: '/hoat-dong', icon: TaskAltRounded },
    { section: 'Vật tư' },
    { label: 'Kho thuốc', to: '/kho-thuoc', icon: MedicationRounded },
  ],
  consultant: [
    { label: 'Tổng quan', to: '/dashboard', icon: DashboardRounded },
    { section: 'Vận hành hằng ngày' },
    { label: 'Tiếp đón hôm nay', to: '/tiep-don', icon: MeetingRoomRounded },
    { label: 'Lịch hẹn', to: '/lich-hen', icon: CalendarMonthRounded },
    { label: 'Hộp thư tư vấn', to: '/cskh/', icon: ForumRounded },
    { section: 'Hồ sơ & chăm sóc' },
    { label: 'Bệnh nhân', to: '/benh-nhan', icon: PeopleAltRounded },
    { label: 'Liệu trình', to: '/lieu-trinh', icon: VaccinesRounded },
    { label: 'Chăm sóc sau điều trị', to: '/cham-soc', icon: SupportAgentRounded },
    { label: 'Hoạt động', to: '/hoat-dong', icon: TaskAltRounded },
    { section: 'Tài chính & vật tư' },
    { label: 'Thu ngân & công nợ', to: '/thu-ngan', icon: ReceiptLongRounded },
    { label: 'Kho thuốc', to: '/kho-thuoc', icon: MedicationRounded },
  ],
  staff: [
    { label: 'Tổng quan', to: '/dashboard', icon: DashboardRounded },
    { section: 'Vận hành hằng ngày' },
    { label: 'Lịch hẹn', to: '/lich-hen', icon: CalendarMonthRounded },
    { section: 'Hồ sơ & điều trị' },
    { label: 'Bệnh nhân', to: '/benh-nhan', icon: PeopleAltRounded },
    { label: 'Buổi liệu trình', to: '/lieu-trinh', icon: VaccinesRounded },
    { label: 'Hoạt động', to: '/hoat-dong', icon: TaskAltRounded },
  ],
};

const TITLES = [['/dashboard', 'Tổng quan'], ['/tiep-don', 'Tiếp đón'], ['/lich-hen', 'Lịch hẹn'], ['/lich-hom-nay', 'Lịch hôm nay'], ['/benh-nhan', 'Bệnh nhân'], ['/kham', 'Khám bệnh'], ['/lieu-trinh', 'Liệu trình'], ['/ban-hang', 'Bán hàng'], ['/hoa-don', 'Hóa đơn'],
  ['/thu-ngan', 'Thu ngân & công nợ'], ['/kho-thuoc', 'Kho & nhập hàng'], ['/cham-soc', 'Chăm sóc sau điều trị'], ['/hoat-dong', 'Hoạt động'], ['/bao-cao', 'Báo cáo quản trị'], ['/nhat-ky', 'Nhật ký hệ thống'], ['/tuan-thu', 'Tuân thủ & bảo mật'], ['/admin/services', 'Dịch vụ & bảng giá'], ['/admin/staff', 'Nhân sự'], ['/admin/attendance', 'Chấm công'],
  ['/admin/payroll', 'Bảng lương'], ['/admin/crm', 'Khách hàng thành viên'], ['/admin/vouchers', 'Ưu đãi & voucher'], ['/admin/email-marketing', 'Email Marketing'], ['/admin/conversations', 'Hộp thư tư vấn'], ['/cskh', 'Hộp thư tư vấn'], ['/bac-si/tu-van', 'Tư vấn'], ['/settings', 'Cài đặt'], ['/profile', 'Hồ sơ cá nhân'], ['/change-password', 'Đổi mật khẩu']];
const titleOf = (path) => (TITLES.find(([p]) => path === p || path.startsWith(p + '/')) || [])[1] || '';

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const dq = useDebounce(q, 250);
  const box = useRef(null);
  const input = useRef(null);
  const nav = useNavigate();
  useEffect(() => {
    if (dq.trim().length < 2) { setRows([]); setLoading(false); return undefined; }
    let current = true;
    setLoading(true);
    api.get('/clinic/patients/', { params: { q: dq.trim(), limit: 6 } })
      .then(({ data }) => { if (current) setRows(data); })
      .catch(() => { if (current) setRows([]); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [dq]);
  useEffect(() => {
    const fn = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);
  useEffect(() => {
    const onShortcut = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onShortcut);
    return () => window.removeEventListener('keydown', onShortcut);
  }, []);
  const go = (id) => { setOpen(false); setQ(''); nav(`/benh-nhan/${id}`); };
  return <div className="cl-search" ref={box}>
    <SearchRounded />
    <input ref={input} value={q} placeholder="Tìm bệnh nhân theo tên, SĐT hoặc mã hồ sơ…" onFocus={() => setOpen(true)}
      onChange={(e) => { setQ(e.target.value); setOpen(true); }} aria-label="Tìm bệnh nhân" aria-keyshortcuts="Control+K Meta+K" title="Tìm hồ sơ nhanh · Ctrl+K" />
    <kbd className="cl-search-shortcut">Ctrl K</kbd>
    {open && q.trim().length >= 2 && <div className="cl-search-pop">
      {rows.map((p) => <button key={p.id} onClick={() => go(p.id)}><Avatar name={p.full_name} size={30} />
        <span><strong>{p.full_name}</strong><small>{p.code} · {p.phone}</small></span></button>)}
      {loading && <div className="cl-search-empty">Đang tìm hồ sơ…</div>}
      {!loading && !rows.length && <div className="cl-search-empty">Không tìm thấy bệnh nhân.</div>}
    </div>}
  </div>;
}

export default function ClinicShell() {
  const { user, logout } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [mini, setMini] = useState(false);
  const [showDate, setShowDate] = useState(true);
  const [closedGroups, setClosedGroups] = useState({ 'Nhân sự & ca làm': true, 'Dịch vụ & bảng giá': true });
  const [navTooltip, setNavTooltip] = useState(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [unconfirmedBookings, setUnconfirmedBookings] = useState(0);
  const toggleMini = () => setMini((v) => !v);
  const showNavTooltip = (event, label) => {
    if (!mini) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setNavTooltip({ label, top: rect.top + rect.height / 2, left: rect.right + 8 });
  };
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => setAccountOpen(false), [loc.pathname]);
  useEffect(() => setCreateOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!accountOpen) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') setAccountOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [accountOpen]);
  useEffect(() => {
    if (!createOpen) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') setCreateOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [createOpen]);
  useEffect(() => {
    let live = true;
    if (user?.id) api.get('/settings/user/').then(({ data }) => {
      if (!live) return;
      setMini(Boolean(data.values['ui.compact_sidebar']));
      setShowDate(data.values['ui.show_date'] !== false);
    }).catch(() => {});
    return () => { live = false; };
  }, [user?.id]);
  useEffect(() => {
    if (!user?.id) { setUnconfirmedBookings(0); return undefined; }
    let live = true;
    const refresh = () => api.get('/bookings/unconfirmed-count/')
      .then(({ data }) => { if (live) setUnconfirmedBookings(Math.max(0, Number(data?.count) || 0)); })
      .catch(() => { if (live) setUnconfirmedBookings(0); });
    refresh();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 10000);
    window.addEventListener('ohio:realtime', refresh);
    window.addEventListener('akina:booking-updated', refresh);
    window.addEventListener('focus', refresh);
    const onVisibility = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      live = false;
      window.clearInterval(interval);
      window.removeEventListener('ohio:realtime', refresh);
      window.removeEventListener('akina:booking-updated', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [user?.id]);
  useEffect(() => {
    if (loc.pathname.startsWith('/lich-hen') && user?.id) {
      api.get('/bookings/unconfirmed-count/')
        .then(({ data }) => setUnconfirmedBookings(Math.max(0, Number(data?.count) || 0)))
        .catch(() => {});
    }
  }, [loc.pathname, user?.id]);
  useEffect(() => { const sync = (e) => { if (typeof e.detail?.compactNav === 'boolean') setMini(e.detail.compactNav); if (typeof e.detail?.showDate === 'boolean') setShowDate(e.detail.showDate); }; window.addEventListener('akina-settings-updated', sync); return () => window.removeEventListener('akina-settings-updated', sync); }, []);
  const items = MENUS[user?.role] || MENUS.staff;
  const bookings = loc.pathname.startsWith('/lich-hen');
  return <div className={`cl-app ${mini ? 'mini' : ''}`}>
    <aside className={`cl-side ${open ? 'open' : ''}`}>
      <NavLink to="/dashboard" className="cl-brand"><span className="cl-brand-mark">A</span><span><strong>AkinaClinic</strong><small>Phòng khám da liễu</small></span></NavLink>
      <nav>
        {items.map((it, i) => {
          if (it.section) return <div className="cl-nav-section" key={`section-${it.section}`} aria-hidden="true" />;
          if (it.children) {
            const active = it.children.some((child) => loc.pathname === child.to || loc.pathname.startsWith(`${child.to}/`));
            const expanded = !closedGroups[it.label];
            return <div className={`cl-nav-group ${active ? 'active' : ''}`} key={it.label}>
              <button type="button" className="cl-nav-group-toggle" aria-label={it.label}
                onMouseEnter={(event) => showNavTooltip(event, it.label)} onMouseLeave={() => setNavTooltip(null)}
                onFocus={(event) => showNavTooltip(event, it.label)} onBlur={() => setNavTooltip(null)}
                aria-expanded={expanded} onClick={() => setClosedGroups((prev) => ({ ...prev, [it.label]: expanded }))}>
                <it.icon /><span>{it.label}</span><ExpandMoreRounded className={`cl-nav-chevron ${expanded ? 'open' : ''}`} />
              </button>
              <div className={`cl-nav-children ${expanded ? 'open' : ''}`}>
                {it.children.map((child) => <NavLink key={child.to} to={child.to}
                  onMouseEnter={(event) => showNavTooltip(event, child.label)} onMouseLeave={() => setNavTooltip(null)}
                  onFocus={(event) => showNavTooltip(event, child.label)} onBlur={() => setNavTooltip(null)}
                  className={({ isActive }) => `cl-nav cl-nav-child ${isActive ? 'active' : ''}`}><child.icon /><span>{child.label}</span></NavLink>)}
              </div>
            </div>;
          }
          return <NavLink key={it.to || `${it.label}-${i}`} to={it.to} end={it.to === '/dashboard'}
            onMouseEnter={(event) => showNavTooltip(event, it.label)} onMouseLeave={() => setNavTooltip(null)}
            onFocus={(event) => showNavTooltip(event, it.label)} onBlur={() => setNavTooltip(null)}
            className={({ isActive }) => `cl-nav ${isActive ? 'active' : ''}${it.to === '/lich-hen' && unconfirmedBookings > 0 ? ' has-badge' : ''}`}><it.icon /><span>{it.label}</span>{it.to === '/lich-hen' && unconfirmedBookings > 0 && <span className="cl-nav-badge" aria-label={`${unconfirmedBookings} lịch hẹn chưa xác nhận`}>{unconfirmedBookings > 99 ? '99+' : unconfirmedBookings}</span>}</NavLink>;
        })}
      </nav>
      <div className="cl-side-foot">
        <NavLink to="/profile" className="cl-me"><Avatar name={user?.full_name || user?.username} size={34} />
          <span><strong>{user?.full_name || user?.username}</strong><small>{roleLabel(user?.role)}</small></span></NavLink>
        <button className="cl-icon-btn" title="Đăng xuất" onClick={async () => { await logout(); nav('/login'); }}><LogoutRounded /></button>
      </div>
    </aside>
    {open && <div className="cl-scrim" onClick={() => setOpen(false)} />}
    <div className="cl-main-wrap">
      <header className={`cl-top ${accountOpen ? 'has-account-menu' : ''}`}>
        <button className="cl-icon-btn cl-burger" onClick={() => setOpen(true)} aria-label="Mở menu"><MenuRounded /></button>
        <button className={`cl-icon-btn cl-collapse ${mini ? 'is-collapsed' : ''}`} onClick={toggleMini} aria-label={mini ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'} title={mini ? 'Mở rộng thanh bên' : 'Thu gọn thanh bên'}>
          <KeyboardDoubleArrowLeftRounded />
        </button>
        <h1 className="cl-top-title">{titleOf(loc.pathname)}</h1>
        <GlobalSearch />
        <div id="cl-top-actions" className="cl-top-actions" />
        <div className="cl-top-right">
          {['manager', 'consultant', 'doctor', 'staff'].includes(user?.role) && <button type="button" className="cl-icon-btn cl-top-quick" aria-label="Lịch hôm nay" title="Lịch hôm nay" onClick={() => nav(['manager', 'consultant', 'doctor'].includes(user?.role) ? '/lich-hom-nay' : '/lich-hen')}><CalendarMonthRounded /></button>}
          {['manager', 'consultant', 'doctor'].includes(user?.role) && <div className="cl-create-wrap">
            <button type="button" className="cl-create-trigger" aria-expanded={createOpen} aria-controls="cl-create-menu" onClick={() => setCreateOpen((value) => !value)}><AddRounded/><span>Tạo mới</span><ExpandMoreRounded/></button>
            {createOpen && <><button type="button" className="cl-create-dismiss" aria-label="Đóng menu tạo mới" onClick={() => setCreateOpen(false)} /><div id="cl-create-menu" className="cl-create-menu" role="menu" aria-label="Tạo mới">
              <button type="button" role="menuitem" onClick={() => { setCreateOpen(false); nav('/lich-hen', { state: { openCreate: true } }); }}><CalendarMonthRounded/><span><strong>Lịch hẹn</strong><small>Chọn bệnh nhân, dịch vụ và giờ</small></span></button>
              <button type="button" role="menuitem" onClick={() => { setCreateOpen(false); nav('/benh-nhan', { state: { openCreate: true } }); }}><PeopleAltRounded/><span><strong>Hồ sơ bệnh nhân</strong><small>Tạo hồ sơ hành chính mới</small></span></button>
              <button type="button" role="menuitem" onClick={() => { setCreateOpen(false); nav('/ban-hang'); }}><PointOfSaleRounded/><span><strong>Bán hàng mới</strong><small>Lập hóa đơn bán hàng mới</small></span></button>
              {['manager', 'consultant'].includes(user?.role) && <button type="button" role="menuitem" onClick={() => { setCreateOpen(false); nav('/tiep-don', { state: { openCreate: true } }); }}><MeetingRoomRounded/><span><strong>Tiếp đón khách</strong><small>Ghi nhận khách đang chờ</small></span></button>}
            </div></>}
          </div>}
          {showDate && <span className="cl-today">{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</span>}
          <NotificationBell user={user} />
          <div className="cl-account-wrap">
            <button className={`cl-icon-btn cl-account-trigger ${accountOpen ? 'active' : ''}`} onClick={() => setAccountOpen(v => !v)} aria-label="Mở menu tài khoản" aria-expanded={accountOpen} aria-controls="cl-account-menu">
              <Avatar name={user?.full_name || user?.username} size={28} /><ExpandMoreRounded className="cl-account-chevron" />
            </button>
            {accountOpen && <><button className="cl-account-dismiss" aria-label="Đóng menu tài khoản" onClick={() => setAccountOpen(false)} /><section id="cl-account-menu" className="cl-account-menu" aria-label="Menu tài khoản">
              <NavLink to="/profile"><PersonOutlineRounded/> Hồ sơ cá nhân</NavLink>
              <NavLink to="/settings?scope=personal"><SettingsRounded/> Cài đặt cá nhân</NavLink>
              {user?.role === 'manager' && <NavLink to="/settings?scope=clinic"><MedicalServicesRounded/> Cài đặt phòng khám</NavLink>}
              <div className="cl-account-divider"/><a href="mailto:support@akinaclinic.vn"><HelpOutlineRounded/> Trợ giúp</a>
              <button onClick={async () => { await logout(); nav('/login'); }}><LogoutRounded/> Đăng xuất</button>
            </section></>}
          </div>
        </div>
      </header>
      <main className={`cl-main ${bookings ? 'full' : ''} ${loc.pathname.startsWith('/admin') || loc.pathname.includes('/tu-van') || loc.pathname.startsWith('/cskh') ? 'cl-legacy' : ''}`}><Outlet /></main>
    </div>
    {navTooltip && mini && createPortal(<div className="cl-nav-tooltip" role="tooltip" style={{ top: navTooltip.top, left: navTooltip.left }}>{navTooltip.label}</div>, document.body)}
  </div>;
}
