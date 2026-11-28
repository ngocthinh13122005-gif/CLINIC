import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import DashboardRounded from '@mui/icons-material/DashboardRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import SpaRounded from '@mui/icons-material/SpaRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';

import MenuRounded from '@mui/icons-material/MenuRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';

import LanguageRounded from '@mui/icons-material/LanguageRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';

import ManageAccountsRounded from '@mui/icons-material/ManageAccountsRounded';

import SecurityRounded from '@mui/icons-material/SecurityRounded';
import { useAuth } from '../context/AuthContext';
import { roleLabel } from '../utils/roles';

import NotificationBell from './NotificationBell';

import '../styles/dashboard.css';
import '../styles/public.css';
import '../styles/admin-operations.css';

const roleMenus = {
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

export default function LegacyAppShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try { const v = localStorage.getItem('ohio_sidebar_collapsed'); if (v === '1') return true; if (v === '0') return false; } catch { /* bỏ qua */ }
    return false;
  });
  const toggleCollapsed = () => setCollapsed(v => { const n = !v; try { localStorage.setItem('ohio_sidebar_collapsed', n ? '1' : '0'); } catch { /* bỏ qua */ } return n; });
  const [openGroups, setOpenGroups] = useState(() => new Set(['Giám sát hệ thống']));
  const items = roleMenus.sysadmin;
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
