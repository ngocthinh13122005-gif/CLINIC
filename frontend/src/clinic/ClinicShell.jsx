import { useEffect, useRef, useState } from 'react';
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
import MedicationRounded from '@mui/icons-material/MedicationRounded';
import PaymentsRounded from '@mui/icons-material/PaymentsRounded';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import MenuRounded from '@mui/icons-material/MenuRounded';
import KeyboardDoubleArrowLeftRounded from '@mui/icons-material/KeyboardDoubleArrowLeftRounded';
import AssessmentRounded from '@mui/icons-material/AssessmentRounded';
import SupportAgentRounded from '@mui/icons-material/SupportAgentRounded';
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
    { section: 'Tài chính & vật tư' },
    { label: 'Thu ngân & công nợ', to: '/thu-ngan', icon: ReceiptLongRounded },
    { label: 'Kho thuốc', to: '/kho-thuoc', icon: MedicationRounded },
    { section: 'Quản trị & kiểm soát' },
    { label: 'Báo cáo điều hành', to: '/bao-cao', icon: AssessmentRounded },
    { label: 'Dịch vụ & bảng giá', to: '/admin/services', icon: MedicalServicesRounded },
    { label: 'Nhân sự & ca làm', icon: BadgeRounded, children: [
      { label: 'Danh bạ nhân sự', to: '/admin/staff', icon: BadgeRounded },
      { label: 'Chấm công & nghỉ phép', to: '/admin/attendance', icon: AccessTimeRounded },
      { label: 'Bảng lương', to: '/admin/payroll', icon: PaymentsRounded },
    ] },
    { label: 'Tuân thủ & bảo mật', to: '/tuan-thu', icon: VerifiedUserRounded },
    { label: 'Nhật ký hệ thống', to: '/nhat-ky', icon: ShieldRounded },
    { section: 'Khách hàng & tăng trưởng' },
    { label: 'Khách hàng thành viên', to: '/admin/crm', icon: ManageAccountsRounded },
    { label: 'Ưu đãi & voucher', to: '/admin/vouchers', icon: LocalOfferRounded },
    { label: 'Email Marketing', to: '/admin/email-marketing', icon: MarkEmailReadRounded },
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
  ],
};

const TITLES = [['/dashboard', 'Tổng quan'], ['/tiep-don', 'Tiếp đón'], ['/lich-hen', 'Lịch hẹn'], ['/benh-nhan', 'Bệnh nhân'], ['/kham', 'Khám bệnh'], ['/lieu-trinh', 'Liệu trình'],
  ['/thu-ngan', 'Thu ngân & công nợ'], ['/kho-thuoc', 'Kho & nhập hàng'], ['/cham-soc', 'Chăm sóc sau điều trị'], ['/bao-cao', 'Báo cáo quản trị'], ['/nhat-ky', 'Nhật ký hệ thống'], ['/tuan-thu', 'Tuân thủ & bảo mật'], ['/admin/services', 'Dịch vụ & bảng giá'], ['/admin/staff', 'Nhân sự'], ['/admin/attendance', 'Chấm công'],
  ['/admin/payroll', 'Bảng lương'], ['/admin/crm', 'Khách hàng thành viên'], ['/admin/vouchers', 'Ưu đãi & voucher'], ['/admin/email-marketing', 'Email Marketing'], ['/admin/conversations', 'Hộp thư tư vấn'], ['/cskh', 'Hộp thư tư vấn'], ['/bac-si/tu-van', 'Tư vấn'], ['/settings', 'Cài đặt'], ['/profile', 'Hồ sơ cá nhân'], ['/change-password', 'Đổi mật khẩu']];
const titleOf = (path) => (TITLES.find(([p]) => path === p || path.startsWith(p + '/')) || [])[1] || '';

function GlobalSearch() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState([]);
  const [open, setOpen] = useState(false);
  const dq = useDebounce(q, 250);
  const box = useRef(null);
  const nav = useNavigate();
  useEffect(() => {
    if (dq.trim().length < 2) { setRows([]); return; }
    api.get('/clinic/patients/', { params: { q: dq.trim(), limit: 6 } }).then(({ data }) => setRows(data)).catch(() => setRows([]));
  }, [dq]);
  useEffect(() => {
    const fn = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);
  const go = (id) => { setOpen(false); setQ(''); nav(`/benh-nhan/${id}`); };
  return <div className="cl-search" ref={box}>
    <SearchRounded />
    <input value={q} placeholder="Tìm bệnh nhân theo tên, SĐT hoặc mã hồ sơ…" onFocus={() => setOpen(true)}
      onChange={(e) => { setQ(e.target.value); setOpen(true); }} aria-label="Tìm bệnh nhân" />
    {open && q.trim().length >= 2 && <div className="cl-search-pop">
      {rows.map((p) => <button key={p.id} onClick={() => go(p.id)}><Avatar name={p.full_name} size={30} />
        <span><strong>{p.full_name}</strong><small>{p.code} · {p.phone}</small></span></button>)}
      {!rows.length && <div className="cl-search-empty">Không tìm thấy bệnh nhân.</div>}
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
  const [closedGroups, setClosedGroups] = useState({});
  const [accountOpen, setAccountOpen] = useState(false);
  const toggleMini = () => setMini((v) => !v);
  useEffect(() => setOpen(false), [loc.pathname]);
  useEffect(() => setAccountOpen(false), [loc.pathname]);
  useEffect(() => {
    if (!accountOpen) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') setAccountOpen(false); };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [accountOpen]);
  useEffect(() => {
    let live = true;
    if (user?.id) api.get('/settings/user/').then(({ data }) => {
      if (!live) return;
      setMini(Boolean(data.values['ui.compact_sidebar']));
      setShowDate(data.values['ui.show_date'] !== false);
    }).catch(() => {});
    return () => { live = false; };
  }, [user?.id]);
  useEffect(() => { const sync = (e) => { if (typeof e.detail?.compactNav === 'boolean') setMini(e.detail.compactNav); if (typeof e.detail?.showDate === 'boolean') setShowDate(e.detail.showDate); }; window.addEventListener('akina-settings-updated', sync); return () => window.removeEventListener('akina-settings-updated', sync); }, []);
  const items = MENUS[user?.role] || MENUS.staff;
  const bookings = loc.pathname.startsWith('/lich-hen');
  return <div className={`cl-app ${mini ? 'mini' : ''}`}>
    <aside className={`cl-side ${open ? 'open' : ''}`}>
      <NavLink to="/dashboard" className="cl-brand"><span className="cl-brand-mark">A</span><span><strong>AkinaClinic</strong><small>Phòng khám da liễu</small></span></NavLink>
      <nav>
        {items.map((it, i) => {
          if (it.section) return <div className="cl-nav-section" key={`section-${it.section}`}>{it.section}</div>;
          if (it.children) {
            const active = it.children.some((child) => loc.pathname === child.to || loc.pathname.startsWith(`${child.to}/`));
            const expanded = !closedGroups[it.label] || active;
            return <div className={`cl-nav-group ${active ? 'active' : ''}`} key={it.label}>
              <button type="button" className="cl-nav-group-toggle" title={mini ? it.label : undefined}
                aria-expanded={expanded} onClick={() => setClosedGroups((prev) => ({ ...prev, [it.label]: expanded }))}>
                <it.icon /><span>{it.label}</span><ExpandMoreRounded className={`cl-nav-chevron ${expanded ? 'open' : ''}`} />
              </button>
              <div className={`cl-nav-children ${expanded ? 'open' : ''}`}>
                {it.children.map((child) => <NavLink key={child.to} to={child.to} title={mini ? child.label : undefined}
                  className={({ isActive }) => `cl-nav cl-nav-child ${isActive ? 'active' : ''}`}><child.icon /><span>{child.label}</span></NavLink>)}
              </div>
            </div>;
          }
          return <NavLink key={it.to || `${it.label}-${i}`} to={it.to} end={it.to === '/dashboard'} title={mini ? it.label : undefined}
            className={({ isActive }) => `cl-nav ${isActive ? 'active' : ''}`}><it.icon /><span>{it.label}</span></NavLink>;
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
          {showDate && <span className="cl-today">{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}</span>}
          <NotificationBell user={user} />
          <div className="cl-account-wrap">
            <button className={`cl-icon-btn cl-account-trigger ${accountOpen ? 'active' : ''}`} onClick={() => setAccountOpen(v => !v)} aria-label="Mở menu tài khoản" aria-expanded={accountOpen} aria-controls="cl-account-menu">
              <Avatar name={user?.full_name || user?.username} size={28} /><ExpandMoreRounded className="cl-account-chevron" />
            </button>
            {accountOpen && <><button className="cl-account-dismiss" aria-label="Đóng menu tài khoản" onClick={() => setAccountOpen(false)} /><section id="cl-account-menu" className="cl-account-menu" aria-label="Menu tài khoản">
              <div className="cl-account-identity"><Avatar name={user?.full_name || user?.username} size={38}/><span><strong>{user?.full_name || user?.username}</strong><small>{roleLabel(user?.role)} · AkinaClinic</small></span></div>
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
  </div>;
}
