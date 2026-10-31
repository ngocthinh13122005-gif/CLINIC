import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import AccountCircleOutlined from '@mui/icons-material/AccountCircleOutlined';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import FavoriteBorderRounded from '@mui/icons-material/FavoriteBorderRounded';
import HeadsetMicOutlined from '@mui/icons-material/HeadsetMicOutlined';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import MenuRounded from '@mui/icons-material/MenuRounded';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import SpaOutlined from '@mui/icons-material/SpaOutlined';
import NotificationBell from '../NotificationBell';

const ACCOUNT_LINKS = [
  { to: '/ho-so-suc-khoe', label: 'Hồ sơ sức khỏe' },
  { to: '/bookings', label: 'Lịch hẹn của tôi' },
  { to: '/my-vouchers', label: 'Voucher & điểm thưởng' },
  { to: '/profile', label: 'Thông tin tài khoản' },
];

export function CustomerHeader({ user, onLogout }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);
  const location = useLocation();
  const customer = user?.role === 'customer';
  const firstName = (user?.full_name || user?.username || '').trim().split(/\s+/).slice(-1)[0] || 'Tài khoản';
  const closeMenus = () => { setMobileOpen(false); setAccountOpen(false); };
  const active = (path) => location.pathname === path ? 'ak-nav-link active' : 'ak-nav-link';

  useEffect(() => {
    if (!accountOpen) return undefined;
    const closeOutside = (event) => {
      if (!accountRef.current?.contains(event.target)) setAccountOpen(false);
    };
    const closeEscape = (event) => {
      if (event.key === 'Escape') setAccountOpen(false);
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeEscape);
    };
  }, [accountOpen]);

  useEffect(() => { closeMenus(); }, [location.pathname]);

  return <header className={`ak-header ${mobileOpen ? 'mobile-open' : ''}`}>
    <div className="ak-utility">
      <div className="ak-header-inner">
        <span><SpaOutlined/> Phòng khám Da liễu &amp; Thẩm mỹ chuẩn y khoa</span>
        <a href="tel:0919005523"><HeadsetMicOutlined/> Tư vấn: <strong>0919 005 523</strong></a>
      </div>
    </div>
    <div className="ak-mainbar">
      <div className="ak-header-inner">
        <Link to="/" className="ak-brand" onClick={closeMenus} aria-label="AkinaClinic - trang chủ">
          <span className="ak-brand-mark">A</span>
          <span className="ak-brand-copy"><strong>AkinaClinic</strong><small>DA LIỄU &amp; THẨM MỸ</small></span>
        </Link>
        <button className="ak-mobile-toggle" type="button" onClick={() => setMobileOpen((value) => !value)}
          aria-label={mobileOpen ? 'Đóng menu' : 'Mở menu'} aria-expanded={mobileOpen}>
          <MenuRounded/>
        </button>
        <nav className="ak-nav" aria-label="Điều hướng chính">
          <NavLink to="/" end onClick={closeMenus} className={({ isActive }) => `ak-nav-link${isActive ? ' active' : ''}`}>Trang chủ</NavLink>
          <NavLink to="/dich-vu" onClick={closeMenus} className={({ isActive }) => `ak-nav-link${isActive ? ' active' : ''}`}>Dịch vụ</NavLink>
          <Link to="/#bac-si" onClick={closeMenus} className="ak-nav-link">Đội ngũ bác sĩ</Link>
          <NavLink to="/chat" onClick={closeMenus} className={({ isActive }) => `ak-nav-link${isActive ? ' active' : ''}`}>Liên hệ</NavLink>
        </nav>
        <div className="ak-actions">
          {user ? <>
            <NotificationBell user={user}/>
            {!customer && <Link to="/dashboard" className="ak-work-link">Khu vực làm việc</Link>}
            <div className="ak-account" ref={accountRef}>
              <button type="button" className={`ak-account-trigger${accountOpen ? ' open' : ''}`}
                onClick={() => setAccountOpen((value) => !value)} aria-expanded={accountOpen} aria-haspopup="menu">
                <span className="ak-account-avatar">{firstName.slice(0, 1).toUpperCase()}</span>
                <span className="ak-account-label">{customer ? 'Tài khoản' : firstName}</span>
                <ExpandMoreRounded className="ak-account-chevron"/>
              </button>
              {accountOpen && <div className="ak-account-menu" role="menu">
                <div className="ak-account-summary"><strong>{user.full_name || user.username}</strong><span>{customer ? 'Cổng khách hàng' : 'Tài khoản nhân sự'}</span></div>
                {customer ? ACCOUNT_LINKS.map(({ to, label }) => <NavLink key={to} to={to} role="menuitem" className={({ isActive }) => `ak-account-item${isActive ? ' active' : ''}`} onClick={closeMenus}>{label}</NavLink>) : <Link to="/profile" role="menuitem" className="ak-account-item" onClick={closeMenus}>Thông tin tài khoản</Link>}
                <button type="button" role="menuitem" className="ak-account-item logout" onClick={() => { closeMenus(); onLogout(); }}>Đăng xuất</button>
              </div>}
            </div>
          </> : <>
            <Link to="/login" className="ak-login-link" onClick={closeMenus}><AccountCircleOutlined/> Đăng nhập</Link>
            <Link to="/book" className="ak-book-cta" onClick={closeMenus}><FavoriteBorderRounded/> Đặt lịch tư vấn</Link>
          </>}
        </div>
      </div>
    </div>
    {mobileOpen && <div className="ak-mobile-panel">
      <nav aria-label="Điều hướng di động">
        <NavLink to="/" end onClick={closeMenus} className={active('/')}>Trang chủ</NavLink>
        <NavLink to="/dich-vu" onClick={closeMenus} className={active('/dich-vu')}>Dịch vụ</NavLink>
        <Link to="/#bac-si" onClick={closeMenus} className="ak-nav-link">Đội ngũ bác sĩ</Link>
        <NavLink to="/chat" onClick={closeMenus} className={active('/chat')}>Liên hệ</NavLink>
        {customer && ACCOUNT_LINKS.map(({ to, label }) => <NavLink key={to} to={to} onClick={closeMenus} className={active(to)}>{label}</NavLink>)}
      </nav>
      <div className="ak-mobile-actions">
        {user ? <button type="button" onClick={() => { closeMenus(); onLogout(); }}><LogoutRounded/>Đăng xuất</button> : <Link to="/login" onClick={closeMenus}><AccountCircleOutlined/>Đăng nhập</Link>}
        {!user && <Link to="/book" className="ak-book-cta" onClick={closeMenus}><FavoriteBorderRounded/>Đặt lịch tư vấn</Link>}
      </div>
    </div>}
  </header>;
}

export function CustomerFooter() {
  return <footer className="ak-footer">
    <div className="ak-footer-main">
      <Link to="/" className="ak-footer-brand"><span className="ak-brand-mark">A</span><strong>AkinaClinic</strong></Link>
      <p>Chăm sóc da liễu chuẩn y khoa, đồng hành cùng vẻ đẹp khỏe mạnh và bền vững.</p>
      <a href="tel:0919005523" className="ak-footer-hotline"><HeadsetMicOutlined/>0919 005 523</a>
    </div>
    <div className="ak-footer-bottom"><span>© AkinaClinic · Phòng khám da liễu &amp; thẩm mỹ</span><span>An toàn · Chất lượng · Tận tâm</span></div>
  </footer>;
}
