import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import DashboardRounded from '@mui/icons-material/DashboardRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import SpaRounded from '@mui/icons-material/SpaRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import MenuRounded from '@mui/icons-material/MenuRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import WorkOutlineRounded from '@mui/icons-material/WorkOutlineRounded';
import HeadsetMicOutlined from '@mui/icons-material/HeadsetMicOutlined';
import LanguageRounded from '@mui/icons-material/LanguageRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded';
import ManageAccountsRounded from '@mui/icons-material/ManageAccountsRounded';
import BadgeRounded from '@mui/icons-material/BadgeRounded';
import SecurityRounded from '@mui/icons-material/SecurityRounded';
import { useAuth } from '../context/AuthContext';
import { roleLabel } from '../utils/roles';
import ClinicShell from '../clinic/ClinicShell';
import ChatbotWidget from './chatbot/ChatbotWidget';
import NotificationBell from './NotificationBell';
import { CustomerFooter, CustomerHeader } from './public/CustomerChrome';
import '../styles/dashboard.css';
import '../styles/public.css';
import '../styles/admin-operations.css';

function CustomerShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const doLogout = async () => { await logout(); navigate('/'); };
  return <div className="public-shell">
    <CustomerHeader user={user} onLogout={doLogout}/>
    <main><Outlet/></main>
    <div className="floating-contact"><ChatbotWidget/></div>
    <CustomerFooter/>
  </div>;
}

const roleMenus = {
  manager: [
    { label: 'Tổng quan', to: '/manager-dashboard', icon: DashboardRounded },
    { group: 'Quản lý vận hành', icon: WorkOutlineRounded, children: [
      { label: 'Lịch nhân sự & lịch hẹn', to: '/roster', icon: CalendarMonthRounded },
      { label: 'Lịch hẹn', to: '/bookings', icon: CalendarMonthRounded },
      { label: 'Dịch vụ', to: '/services', icon: SpaRounded },
      { label: 'Nhân sự', to: '/staff-directory', icon: BadgeRounded },
      { label: 'Chấm công & nghỉ phép', to: '/attendance-leave', icon: AccessTimeRounded },
      { label: 'Bảng lương', to: '/payroll', icon: ManageAccountsRounded },
      { label: 'CRM khách hàng', to: '/crm', icon: HeadsetMicOutlined },
      { label: 'Voucher', to: '/vouchers', icon: AutoAwesomeRounded },
    ]},
    { group: 'Tư vấn khách hàng', icon: HeadsetMicOutlined, children: [
      { label: 'Hộp thư tư vấn', to: '/admin/conversations', icon: ForumRounded },
    ]},
    { divider: true },
    { label: 'Hồ sơ cá nhân', to: '/profile', icon: PersonOutlineRounded },
  ],
  consultant: [
    { label: 'Tổng quan', to: '/dashboard', icon: DashboardRounded },
    { label: 'Hộp thư tư vấn', to: '/cskh/', icon: ForumRounded },
    { label: 'Lịch hẹn', to: '/bookings', icon: CalendarMonthRounded },
    { divider: true },
    { label: 'Hồ sơ cá nhân', to: '/profile', icon: PersonOutlineRounded },
  ],
  staff: [
    { label: 'Tổng quan', to: '/dashboard', icon: DashboardRounded },
    { label: 'Lịch được phân công', to: '/bookings', icon: CalendarMonthRounded },
    { label: 'Chấm công', to: '/dashboard#attendance', icon: AccessTimeRounded, hashOnly: true },
    { label: 'Dịch vụ', to: '/services', icon: SpaRounded },
    { divider: true },
    { label: 'Hồ sơ cá nhân', to: '/profile', icon: PersonOutlineRounded },
  ],
  doctor: [
    { label: 'Tổng quan', to: '/dashboard', icon: DashboardRounded },
    { label: 'Lịch được phân công', to: '/bookings', icon: CalendarMonthRounded },
    { label: 'Tư vấn được chuyển', to: '/bac-si/tu-van/', icon: ForumRounded },
    { divider: true },
    { label: 'Hồ sơ cá nhân', to: '/profile', icon: PersonOutlineRounded },
  ],
  sysadmin: [
    { label: 'Tổng quan hệ thống', to: '/dashboard', icon: DashboardRounded },
    { group: 'Giám sát hệ thống', icon: SecurityRounded, children: [
      { label: 'Lịch hẹn', to: '/bookings', icon: CalendarMonthRounded },
      { label: 'Dịch vụ', to: '/services', icon: SpaRounded },
      { label: 'Hội thoại', to: '/chat', icon: ForumRounded },
    ]},
    { divider: true },
    { label: 'Hồ sơ cá nhân', to: '/profile', icon: ManageAccountsRounded },
  ],
};


function ManagerAdminShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const doLogout = async () => { await logout(); navigate('/login'); };
  const links = [
    ['Tổng quan', '/admin/dashboard', DashboardRounded],
    ['Lịch nhân sự & lịch hẹn', '/admin/calendar', CalendarMonthRounded],
    ['Danh mục dịch vụ', '/admin/services', SpaRounded],
    ['Danh bạ nhân sự', '/admin/staff', BadgeRounded],
    ['Chấm công & nghỉ phép', '/admin/attendance', AccessTimeRounded],
    ['Bảng lương', '/admin/payroll', ManageAccountsRounded],
    ['CRM khách hàng', '/admin/crm', HeadsetMicOutlined],
    ['Voucher', '/admin/vouchers', AutoAwesomeRounded],
    ['Hộp thư tư vấn', '/admin/conversations', ForumRounded],
  ];
  return <div className="adm-shell">
    <header className="adm-shell-top">
      <div className="adm-shell-brand"><NavLink to="/admin/dashboard">AkinaClinic</NavLink><span className="adm-portal-badge">CỔNG<br/>QUẢN TRỊ</span><span className="adm-workspace">KHÔNG GIAN VẬN HÀNH</span></div>
      <div className="adm-shell-actions"><NotificationBell user={user}/><NavLink to="/" className="adm-web-link"><LanguageRounded sx={{fontSize:16}}/> Xem website</NavLink><NavLink to="/profile" className="adm-shell-avatar" title="Hồ sơ cá nhân">{(user?.full_name||user?.username||'O').slice(0,1).toUpperCase()}</NavLink></div>
      <button className="adm-shell-mobile" onClick={()=>setMobileOpen(v=>!v)}><MenuRounded/></button>
    </header>
    <aside className={`adm-shell-side ${mobileOpen?'open':''}`}>
      <div className="adm-shell-caption"><span>QUẢN TRỊ AkinaClinic</span><strong>Vận hành</strong></div>
      <nav>{links.map(([label,to,Icon])=><NavLink key={to} to={to} onClick={()=>setMobileOpen(false)} className={({isActive})=>isActive?'active':''}><Icon/><span>{label}</span></NavLink>)}</nav>
      <div className="adm-shell-user"><span>ĐANG ĐĂNG NHẬP</span><strong>{user?.full_name||user?.username}</strong><button onClick={doLogout}><LogoutRounded/></button></div>
    </aside>
    <main className="adm-shell-main"><Outlet/></main>
  </div>;
}

export default function AppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const defaultCollapsed = ['consultant', 'doctor'].includes(user?.role); // như Zalo: mặc định thu gọn, vẫn có nút mở
  const [collapsed, setCollapsed] = useState(() => {
    try { const v = localStorage.getItem('ohio_sidebar_collapsed'); if (v === '1') return true; if (v === '0') return false; } catch { /* bỏ qua */ }
    return defaultCollapsed;
  });
  const toggleCollapsed = () => setCollapsed(v => { const n = !v; try { localStorage.setItem('ohio_sidebar_collapsed', n ? '1' : '0'); } catch { /* bỏ qua */ } return n; });
  const [openGroups, setOpenGroups] = useState(() => new Set(['Quản lý vận hành','Tư vấn khách hàng','Chatbot & tự động hóa','Giám sát hệ thống']));
  if (['manager','doctor','consultant','staff'].includes(user?.role)) return <ClinicShell/>;
  if (user?.role === 'customer') return <CustomerShell/>;
  const items = roleMenus[user?.role] || roleMenus.staff;
  const doLogout = async () => { await logout(); navigate('/login'); };
  return <div className={collapsed ? 'sidebar-collapsed' : ''}>
    <div className="ap-shell">
      <aside className={`ap-sidebar ${mobileOpen ? 'mobile-open' : ''}`}>
        <NavLink to="/dashboard" className="ap-brand text-decoration-none" onClick={() => setMobileOpen(false)}>
          <div className="ap-brand-logo brand-text-mark">A</div>
          <div className="ap-brand-text"><strong>AkinaClinic</strong><span>Hệ thống quản lý</span></div>
        </NavLink>
        <nav className="ap-nav">
          {items.map((item, idx) => {
            if (item.divider) return <div className="ap-divider" key={`divider-${idx}`}/>;
            if (item.group) {
              const opened = openGroups.has(item.group);
              return <div className={`ap-group ${opened ? 'open' : ''}`} key={item.group}>
                <button className="ap-group-toggle" type="button" title={item.group} onClick={() => setOpenGroups(prev => { const next=new Set(prev); opened?next.delete(item.group):next.add(item.group); return next; })}>
                  <item.icon/><span>{item.group}</span><ChevronRightRounded className="ap-group-arrow"/>
                </button>
                <div className="ap-submenu">{item.children.map(child => <NavLink key={child.to} to={child.to} title={child.label} onClick={() => setMobileOpen(false)} className={({isActive}) => `ap-link ${isActive ? 'active' : ''}`}><child.icon/><span>{child.label}</span></NavLink>)}</div>
              </div>;
            }
            return <NavLink key={item.to} to={item.to} title={item.label} end={item.to === '/dashboard'} onClick={() => setMobileOpen(false)} className={({isActive}) => `ap-link ${!item.hashOnly && isActive ? 'active' : ''}`}><item.icon/><span>{item.label}</span></NavLink>;
          })}
        </nav>
      </aside>
      <section className="ap-main">
        <header className="ap-topbar">
          <div className="ap-top-left">
            <button className="ap-icon-btn ap-mobile-toggle" onClick={() => setMobileOpen(true)} aria-label="Mở menu"><MenuRounded/></button>
            <button className="ap-icon-btn ap-desktop-toggle" onClick={toggleCollapsed} aria-label={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'} title={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}><MenuRounded/></button>
            <span className="ap-top-title">Hệ thống quản lý AkinaClinic</span>
          </div>
          <div className="ap-top-actions">
            <NotificationBell user={user}/>
            <NavLink to="/" className="ap-view-web"><LanguageRounded sx={{fontSize:17}}/><span>Xem web</span></NavLink>
            <NavLink to="/profile" className="ap-user-link">
              <div className="ap-avatar">{(user?.full_name || user?.username || 'O').slice(0,1).toUpperCase()}</div>
              <div className="ap-user-meta"><strong>{user?.full_name || user?.username}</strong><span>{roleLabel(user?.role)}</span></div>
            </NavLink>
            <button className="ap-logout-btn" onClick={doLogout}><LogoutRounded sx={{fontSize:17}}/><span>Đăng xuất</span></button>
          </div>
        </header>
        <main className="ap-content"><div className="ap-content-inner"><Outlet/></div></main>
      </section>
    </div>
  </div>;
}
