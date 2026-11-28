import { useEffect, useRef, useState } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import EventNoteOutlined from '@mui/icons-material/EventNoteOutlined';
import ExpandLessRounded from '@mui/icons-material/ExpandLessRounded';
import ForumOutlined from '@mui/icons-material/ForumOutlined';
import HomeOutlined from '@mui/icons-material/HomeOutlined';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import MedicationOutlined from '@mui/icons-material/MedicationOutlined';
import MenuRounded from '@mui/icons-material/MenuRounded';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import AssignmentTurnedInOutlined from '@mui/icons-material/AssignmentTurnedInOutlined';
import SpaOutlined from '@mui/icons-material/SpaOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import WalletOutlined from '@mui/icons-material/AccountBalanceWalletOutlined';
import { useAuth } from '../../context/AuthContext';
import ChatbotWidget from '../chatbot/ChatbotWidget';
import NotificationBell from '../NotificationBell';
import { BrandMark } from '../public/CustomerChrome';
import '../../styles/client-portal.css';

const GROUPS = [
  { title: 'Tài khoản', items: [
    { to: '/dashboard', label: 'Tổng quan', icon: DashboardOutlined, end: true },
    { to: '/thanh-toan', label: 'Thanh toán', icon: WalletOutlined },
    { to: '/profile', label: 'Thông tin cá nhân', icon: PersonOutlineRounded },
  ] },
  { title: 'Hồ sơ lâm sàng', items: [
    { to: '/bookings', label: 'Lịch hẹn', icon: CalendarMonthRounded },
    { to: '/ho-so-suc-khoe?tab=visits', label: 'Lịch sử khám', icon: HistoryOutlined, tab: 'visits' },
    { to: '/ho-so-suc-khoe?tab=plans', label: 'Liệu trình', icon: EventNoteOutlined, tab: 'plans' },
    { to: '/ho-so-suc-khoe?tab=prescriptions', label: 'Đơn thuốc', icon: MedicationOutlined, tab: 'prescriptions' },
    { to: '/ho-so-suc-khoe?tab=care', label: 'Hướng dẫn chăm sóc', icon: SpaOutlined, tab: 'care' },
    { to: '/bieu-mau', label: 'Phiếu cam kết', icon: AssignmentTurnedInOutlined },
    { to: '/chat', label: 'Trao đổi với phòng khám', icon: ForumOutlined },
  ] },
];

function SideNav({ onNavigate }) {
  const { pathname, search } = useLocation();
  const tab = new URLSearchParams(search).get('tab') || 'visits';
  const active = (it) => (it.tab ? pathname === '/ho-so-suc-khoe' && tab === it.tab
    : it.end ? pathname === it.to : pathname === it.to || pathname.startsWith(`${it.to}/`));
  return <nav className="cp-nav" aria-label="Cổng bệnh nhân">
    {GROUPS.map((g) => <div key={g.title} className="cp-group">
      <div className="cp-group-t">{g.title}</div>
      {g.items.map((it) => <Link key={it.to} to={it.to} onClick={onNavigate} aria-current={active(it) ? 'page' : undefined}
        className={`cp-link${active(it) ? ' on' : ''}`}><it.icon/><span>{it.label}</span></Link>)}
    </div>)}
  </nav>;
}

export default function CustomerShell() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);
  const drawer = useRef(null);
  const name = (user?.full_name || user?.username || '').trim();
  useEffect(() => { setOpen(false); setMenu(false); window.scrollTo(0, 0); }, [pathname, search]);
  useEffect(() => {
    if (!open) return undefined;
    const previous = document.activeElement;
    const focusable = () => Array.from(drawer.current?.querySelectorAll('a[href],button:not([disabled])') || []).filter((node) => node.offsetParent !== null);
    focusable()[0]?.focus();
    const keys = (event) => {
      if (event.key === 'Escape') { setOpen(false); setMenu(false); }
      if (event.key === 'Tab') {
        const nodes = focusable();
        if (!nodes.length) return;
        if (event.shiftKey && document.activeElement === nodes[0]) { event.preventDefault(); nodes.at(-1).focus(); }
        else if (!event.shiftKey && document.activeElement === nodes.at(-1)) { event.preventDefault(); nodes[0].focus(); }
      }
    };
    document.addEventListener('keydown', keys);
    return () => { document.removeEventListener('keydown', keys); previous?.focus?.(); };
  }, [open]);
  useEffect(() => {
    if (!menu) return undefined;
    const f = (e) => { if (!ref.current?.contains(e.target)) setMenu(false); };
    document.addEventListener('pointerdown', f); return () => document.removeEventListener('pointerdown', f);
  }, [menu]);
  const out = async () => { await logout(); navigate('/'); };

  const side = (mobile) => <>
    <div className="cp-brand"><Link to="/" aria-label="AkinaClinic - trang chủ"><BrandMark size={34}/><span><strong>AkinaClinic</strong><small>CỔNG BỆNH NHÂN</small></span></Link>
      {mobile && <button type="button" className="cp-x" onClick={() => setOpen(false)} aria-label="Đóng menu"><CloseRounded/></button>}</div>
    <Link to="/book" className="cp-book" onClick={() => setOpen(false)}><CalendarMonthRounded/>Đặt lịch ngay</Link>
    <SideNav onNavigate={() => setOpen(false)}/>
    <div className="cp-user" ref={ref}>
      {menu && <div className="cp-user-menu" role="menu">
        <Link to="/profile" role="menuitem"><PersonOutlineRounded/>Thông tin cá nhân</Link>
        <Link to="/" role="menuitem"><HomeOutlined/>Về trang chủ</Link>
        <button type="button" role="menuitem" onClick={out}><LogoutRounded/>Đăng xuất</button>
      </div>}
      <button type="button" className="cp-user-btn" aria-label="Mở menu tài khoản" aria-expanded={menu} onKeyDown={(event) => { if (event.key === 'Escape') setMenu(false); }} onClick={() => setMenu((v) => !v)}>
        <span className="cp-av">{user?.avatar_url ? <img src={user.avatar_url} alt=""/> : (name.slice(0, 1) || 'A').toUpperCase()}</span>
        <span className="cp-user-t"><strong>{name || 'Tài khoản'}</strong><small>Bệnh nhân</small></span><ExpandLessRounded/>
      </button>
    </div>
  </>;

  return <div className="cp-shell">
    <aside className="cp-side">{side(false)}</aside>
    <header className="cp-top"><button type="button" className="cp-burger" onClick={() => setOpen(true)} aria-label="Mở menu"><MenuRounded/></button>
      <Link to="/dashboard" className="cp-top-brand"><BrandMark size={30}/><strong>AkinaClinic</strong></Link><span style={{ width: 40 }}/></header>
    {open && <div className="cp-overlay" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}><aside className="cp-drawer" ref={drawer} role="dialog" aria-modal="true" aria-label="Điều hướng cổng bệnh nhân">{side(true)}</aside></div>}
    <main className="cp-main"><div className="cp-content"><div className="cp-toolbar"><Link to="/" className="cp-btn cp-back-home"><HomeOutlined/>Về trang chủ</Link><NotificationBell user={user}/></div><Outlet/></div></main>
    <div className="floating-contact"><ChatbotWidget/></div>
  </div>;
}
