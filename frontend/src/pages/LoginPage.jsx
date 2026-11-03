import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import '../styles/public.css';

export default function LoginPage() {
  const { user, login } = useAuth();
  const location = useLocation();
  const [form, setForm] = useState({ username: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  if (user) return <PreferredHome user={user} returnTo={location.state?.from}/>;

  const submit = async (event) => {
    event.preventDefault(); setError(''); setBusy(true);
    try { await login(form.username, form.password); }
    catch (requestError) { setError(requestError.response?.data?.detail || 'Không thể đăng nhập.'); }
    finally { setBusy(false); }
  };

  return <div className="login-wrap"><div className="login-card"><h1>Đăng nhập</h1>{error && <div className="alert-box error">{error}</div>}<form onSubmit={submit}><div className="form-group"><label className="form-label">Tên đăng nhập</label><input className="ohio-input" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoFocus/></div><div className="form-group"><label className="form-label">Mật khẩu</label><input className="ohio-input" type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })}/></div><button className="ohio-btn ohio-btn-primary" style={{ width: '100%' }} disabled={busy}>{busy ? 'Đang đăng nhập...' : 'Đăng nhập'}</button></form><div style={{ textAlign: 'center', marginTop: 12, fontSize: 'var(--fs-sm)' }}><Link to="/forgot-password">Quên mật khẩu?</Link></div><div style={{ textAlign: 'center', marginTop: 10, fontSize: 'var(--fs-sm)', color: '#697586' }}>Chưa có tài khoản? <Link to="/signup">Đăng ký</Link> · <Link to="/">Về trang chủ</Link></div></div></div>;
}

function PreferredHome({ user, returnTo }) {
  const [target, setTarget] = useState('');
  useEffect(() => {
    let active = true;
    api.get('/settings/user/').then(({ data }) => {
      const fallback = user.role === 'customer' ? '/' : '/dashboard';
      const allowed = data.definitions?.find((item) => item.key === 'ui.default_route')?.choices || [fallback];
      const preferred = data.values?.['ui.default_route'];
      if (active) setTarget(preferred && allowed.includes(preferred) ? preferred : fallback);
    }).catch(() => { if (active) setTarget(user.role === 'customer' ? '/' : '/dashboard'); });
    return () => { active = false; };
  }, [user.id, user.role]);
  return target ? <Navigate to={returnTo || target} replace/> : null;
}
