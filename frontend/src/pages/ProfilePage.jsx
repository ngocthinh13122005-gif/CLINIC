import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PersonRounded from '@mui/icons-material/PersonRounded';
import PhotoCameraRounded from '@mui/icons-material/PhotoCameraRounded';
import PageHeader from '../components/PageHeader';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { roleLabel } from '../utils/roles';
import './profile-page.css';

export default function ProfilePage() {
  const { user, updateSession } = useAuth();
  const customer = user?.role === 'customer';
  const [form, setForm] = useState({ full_name: '', email: '', phone: '', date_of_birth: '' });
  const [avatar, setAvatar] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setForm({ full_name: user?.full_name || '', email: user?.email || '', phone: user?.phone || '', date_of_birth: user?.date_of_birth || '' });
    setPreview(user?.avatar_url || '');
  }, [user]);

  const save = async (event) => {
    event.preventDefault();
    setBusy(true); setError(''); setSuccess('');
    try {
      const data = new FormData();
      Object.entries(form).forEach(([key, value]) => data.append(key, value || ''));
      if (avatar) data.append('avatar', avatar);
      const response = await api.patch('/auth/me/', data);
      updateSession(response.data);
      setPreview(response.data.avatar_url || preview);
      setAvatar(null);
      setSuccess('Đã cập nhật hồ sơ.');
    } catch (err) {
      setError(err.response?.data?.detail || 'Không thể cập nhật hồ sơ.');
    } finally { setBusy(false); }
  };

  const chooseAvatar = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setAvatar(file);
    setPreview(URL.createObjectURL(file));
  };

  return <div className={`pf-page ${customer ? 'customer' : 'staff'}`}>
    {customer ? <div className="cp-title"><div><h1>Thông tin cá nhân</h1><p>Quản lý ảnh đại diện, thông tin liên hệ và bảo mật tài khoản.</p></div></div>
      : <PageHeader title="Hồ sơ cá nhân" subtitle="Cập nhật thông tin liên hệ và ảnh đại diện trong hệ thống."/>}
    <form onSubmit={save} className="pf-card">
      <aside className="pf-identity">
        <div className="pf-avatar">{preview ? <img src={preview} alt="Ảnh đại diện"/> : <PersonRounded/>}</div>
        <label className="pf-upload"><PhotoCameraRounded/><span>Chọn ảnh</span><input type="file" accept="image/*" onChange={chooseAvatar}/></label>
        <strong className="pf-name">{user?.full_name || user?.username}</strong>
        <span className="pf-role">{roleLabel(user?.role)}</span>
      </aside>
      <section className="pf-details">
        <div className="pf-section-title"><h2>Thông tin tài khoản</h2><p>{customer ? 'Thông tin dùng để liên hệ và hỗ trợ đặt lịch.' : 'Thông tin cá nhân dùng trong hồ sơ nhân sự và liên hệ nội bộ.'}</p></div>
        {error && <div className="pf-alert error" role="alert">{error}</div>}{success && <div className="pf-alert success" role="status">{success}</div>}
        <div className="pf-fields">
          <Field label="Tên đăng nhập" value={user?.username} readOnly/>
          <Field label="Họ và tên" value={form.full_name} onChange={value => setForm({ ...form, full_name: value })} required/>
          <Field label="Email" type="email" value={form.email} onChange={value => setForm({ ...form, email: value })}/>
          <Field label="Số điện thoại" value={form.phone} onChange={value => setForm({ ...form, phone: value })}/>
          <Field label="Ngày sinh" type="date" value={form.date_of_birth} onChange={value => setForm({ ...form, date_of_birth: value })}/>
          {!customer && <Field label="Vai trò trong hệ thống" value={roleLabel(user?.role)} readOnly/>}
        </div>
        {customer && <div className="pf-security"><div><h3>Bảo mật</h3><p>Thay đổi mật khẩu đăng nhập cổng bệnh nhân.</p></div><Link to="/change-password" className="cp-btn">Đổi mật khẩu</Link></div>}
        <footer className="pf-actions"><span>Ảnh đại diện và thông tin được cập nhật cho tài khoản này.</span><button type="submit" disabled={busy}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button></footer>
      </section>
    </form>
  </div>;
}

function Field({ label, value, onChange, readOnly = false, required = false, type = 'text' }) {
  return <label className="pf-field"><span>{label}</span><input type={type} value={value || ''} readOnly={readOnly} required={required} onChange={event => onChange?.(event.target.value)}/></label>;
}
