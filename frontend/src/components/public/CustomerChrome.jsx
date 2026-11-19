import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import CallOutlined from '@mui/icons-material/CallOutlined';
import CloseRounded from '@mui/icons-material/CloseRounded';
import EventAvailableOutlined from '@mui/icons-material/EventAvailableOutlined';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import LogoutRounded from '@mui/icons-material/LogoutRounded';
import MenuRounded from '@mui/icons-material/MenuRounded';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded';
import NotificationBell from '../NotificationBell';
import { DEFAULT_HOTLINE, telHref, useClinicProfile } from './usePublic';
import '../../styles/public-theme.css';
import '../../styles/akina.css';

const ACCOUNT_LINKS = [
  { to: '/ho-so-suc-khoe', label: 'Hồ sơ sức khỏe' },
  { to: '/bookings', label: 'Lịch hẹn của tôi' },
  { to: '/my-vouchers', label: 'Voucher & điểm thưởng' },
  { to: '/chat', label: 'Trao đổi với phòng khám' },
  { to: '/profile', label: 'Thông tin tài khoản' },
];
const NAV = [
  { to: '/', label: 'Trang chủ', end: true },
  { to: '/dich-vu', label: 'Dịch vụ' },
  { to: '/gioi-thieu', label: 'Giới thiệu' },
  { to: '/book', label: 'Đặt lịch' },
  { to: '/contact', label: 'Liên hệ' },
];

export function BrandMark({ size = 36 }) {
  return <svg className="pk-mark" width={size} height={size} viewBox="0 0 36 36" aria-hidden="true">
    <rect width="36" height="36" rx="9" fill="#007FA3"/>
    <path d="M18 8.5 10.2 27.5M18 8.5l7.8 19M13 21.5h10" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    <circle cx="26.5" cy="10" r="2.3" fill="#20A8C5"/>
  </svg>;
}

export function CustomerHeader({ user, onLogout }) {
  const clinic = useClinicProfile();
  const [open, setOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const accountRef = useRef(null);
  const location = useLocation();
  const customer = user?.role === 'customer';
  const hotline = clinic?.hotline || DEFAULT_HOTLINE;
  const brand = 'AkinaClinic';
  const displayName = (user?.full_name || user?.username || '').trim();
  const closeAll = () => { setOpen(false); setAccountOpen(false); };

  useEffect(() => {
    if (!accountOpen) return undefined;
    const outside = (e) => { if (!accountRef.current?.contains(e.target)) setAccountOpen(false); };
    const esc = (e) => { if (e.key === 'Escape') setAccountOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', esc); };
  }, [accountOpen]);
  useEffect(() => { closeAll(); }, [location.pathname]);
  useEffect(() => {
    document.body.classList.toggle('pk-lock', open);
    if (!open) return undefined;
    const esc = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('keydown', esc);
    return () => { document.body.classList.remove('pk-lock'); document.removeEventListener('keydown', esc); };
  }, [open]);

  const navLinks = (cls) => NAV.map((n) => <NavLink key={n.to} to={n.to} end={n.end} onClick={closeAll} className={({ isActive }) => `${cls}${isActive ? ' active' : ''}`}>{n.label}</NavLink>);

  return <header className="pk-header">
    <div className="pk-utility"><div className="pk-wrap">
      <span>Phòng khám Da liễu &amp; Thẩm mỹ</span>
      <a href={telHref(hotline)}><CallOutlined/>Hotline tư vấn: <strong>{hotline}</strong></a>
    </div></div>
    <div className="pk-bar"><div className="pk-wrap pk-bar-in">
      <Link to="/" className="pk-brand" onClick={closeAll} aria-label={`${brand} - trang chủ`}>
        <BrandMark/><span className="pk-brand-t"><strong>{brand}</strong><small>Da liễu &amp; Thẩm mỹ</small></span>
      </Link>
      <nav className="pk-nav" aria-label="Điều hướng chính">{navLinks('pk-nav-link')}</nav>
      <div className="pk-actions">
        {user ? <>
          <NotificationBell user={user}/>
          <div className="pk-account" ref={accountRef}>
            <button type="button" className={`pk-account-btn${accountOpen ? ' open' : ''}`} aria-expanded={accountOpen} aria-haspopup="menu" onClick={() => setAccountOpen((v) => !v)}>
              <span className="pk-avatar">{(displayName.slice(0, 1) || 'A').toUpperCase()}</span>
              <span className="pk-account-name">{displayName.split(/\s+/).slice(-1)[0] || 'Tài khoản'}</span>
              <ExpandMoreRounded className="pk-chev"/>
            </button>
            {accountOpen && <div className="pk-menu" role="menu">
              <div className="pk-menu-head"><strong>{displayName}</strong><span>{customer ? 'Tài khoản khách hàng' : 'Tài khoản nhân sự'}</span></div>
              {!customer && <Link to="/dashboard" role="menuitem" className="pk-menu-item" onClick={closeAll}>Khu vực làm việc</Link>}
              {customer ? ACCOUNT_LINKS.map(({ to, label }) => <NavLink key={to} to={to} role="menuitem" className={({ isActive }) => `pk-menu-item${isActive ? ' active' : ''}`} onClick={closeAll}>{label}</NavLink>)
                : <Link to="/profile" role="menuitem" className="pk-menu-item" onClick={closeAll}>Thông tin tài khoản</Link>}
              <button type="button" role="menuitem" className="pk-menu-item out" onClick={() => { closeAll(); onLogout(); }}><LogoutRounded/>Đăng xuất</button>
            </div>}
          </div>
        </> : <Link to="/login" className="pk-login" onClick={closeAll}><PersonOutlineRounded/><span>Đăng nhập</span></Link>}
        <Link to="/book" className="pk-cta" onClick={closeAll}><EventAvailableOutlined/><span>Đặt lịch ngay</span></Link>
        <button type="button" className="pk-burger" aria-label={open ? 'Đóng menu' : 'Mở menu'} aria-expanded={open} aria-controls="pk-drawer" onClick={() => setOpen((v) => !v)}>{open ? <CloseRounded/> : <MenuRounded/>}</button>
      </div>
    </div></div>
    {open && <div className="pk-drawer" id="pk-drawer">
      <nav aria-label="Điều hướng di động">
        {navLinks('pk-d-link')}
        {customer && <div className="pk-d-sep">Tài khoản</div>}
        {customer && ACCOUNT_LINKS.map(({ to, label }) => <NavLink key={to} to={to} onClick={closeAll} className={({ isActive }) => `pk-d-link sub${isActive ? ' active' : ''}`}>{label}</NavLink>)}
        {user && !customer && <Link to="/dashboard" onClick={closeAll} className="pk-d-link">Khu vực làm việc</Link>}
      </nav>
      <div className="pk-d-foot">
        <Link to="/book" className="pk-cta block" onClick={closeAll}><EventAvailableOutlined/>Đặt lịch ngay</Link>
        <a className="pk-btn-line block" href={telHref(hotline)}><CallOutlined/>Gọi {hotline}</a>
        {user ? <button type="button" className="pk-d-out" onClick={() => { closeAll(); onLogout(); }}><LogoutRounded/>Đăng xuất</button> : <Link to="/login" className="pk-d-out" onClick={closeAll}><PersonOutlineRounded/>Đăng nhập / Đăng ký</Link>}
      </div>
    </div>}
  </header>;
}

export function CustomerFooter() {
  const clinic = useClinicProfile();
  const hotline = clinic?.hotline || DEFAULT_HOTLINE;
  const brand = 'AkinaClinic';
  const real = (v) => (v && !/^\[.*\]$/.test(String(v).trim()) ? String(v).trim() : '');
  const address = real(clinic?.address); const email = real(clinic?.email);
  return <footer className="pk-footer">
    <div className="pk-wrap pk-foot-grid">
      <div className="pk-foot-brand">
        <Link to="/" className="pk-brand light"><BrandMark/><span className="pk-brand-t"><strong>{brand}</strong><small>Da liễu &amp; Thẩm mỹ</small></span></Link>
        <p>Thăm khám, tư vấn và theo dõi điều trị da liễu – thẩm mỹ theo quy trình rõ ràng, lấy người bệnh làm trung tâm.</p>
      </div>
      <div><h3>Khám phá</h3><ul>
        <li><Link to="/dich-vu">Dịch vụ</Link></li><li><Link to="/gioi-thieu">Giới thiệu</Link></li><li><Link to="/book">Đặt lịch</Link></li><li><Link to="/contact">Liên hệ</Link></li>
      </ul></div>
      <div><h3>Tài khoản</h3><ul>
        <li><Link to="/login">Đăng nhập</Link></li><li><Link to="/signup">Đăng ký</Link></li><li><Link to="/bookings">Lịch hẹn của tôi</Link></li><li><Link to="/ho-so-suc-khoe">Hồ sơ sức khỏe</Link></li>
      </ul></div>
      <div><h3>Liên hệ</h3><ul className="pk-foot-contact">
        <li><CallOutlined/><a href={telHref(hotline)}>{hotline}</a></li>
        {email && <li><MailOutlineRounded/><a href={`mailto:${email}`}>{email}</a></li>}
        {address && <li><PlaceOutlined/><span>{address}</span></li>}
      </ul></div>
    </div>
    <div className="pk-foot-bottom"><div className="pk-wrap"><span>© {new Date().getFullYear()} {brand}. Mọi quyền được bảo lưu.</span><span>Thông tin trên website mang tính tham khảo, không thay thế chẩn đoán của bác sĩ.</span></div></div>
  </footer>;
}
