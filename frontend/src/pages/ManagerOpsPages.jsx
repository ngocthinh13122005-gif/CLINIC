import { useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';

export function SignupPage(){
  const { user } = useAuth();
  const [form, setForm] = useState({full_name:'', username:'', phone:'', email:'', password:''});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  if (user) return <Link to="/">Bạn đã đăng nhập.</Link>;
  const submit = async(e)=>{ e.preventDefault(); setError(''); setSuccess(''); try { await api.post('/auth/register/', form); setSuccess('Đăng ký thành công. Bây giờ bạn có thể đăng nhập.'); setForm({full_name:'', username:'', phone:'', email:'', password:''}); } catch(err) { setError(err.response?.data?.detail || 'Không thể đăng ký.'); } };
  return <div className="login-wrap"><div className="login-card"><h1>Đăng ký tài khoản</h1>{error&&<div className="alert-box error">{error}</div>}{success&&<div className="alert-box success">{success}</div>}<form onSubmit={submit}><div className="form-group"><label className="form-label">Họ tên</label><input className="ohio-input" value={form.full_name} onChange={e=>setForm({...form, full_name:e.target.value})}/></div><div className="form-group"><label className="form-label">Tên đăng nhập</label><input className="ohio-input" required value={form.username} onChange={e=>setForm({...form, username:e.target.value})}/></div><div className="form-group"><label className="form-label">Số điện thoại</label><input className="ohio-input" value={form.phone} onChange={e=>setForm({...form, phone:e.target.value})}/></div><div className="form-group"><label className="form-label">Email</label><input className="ohio-input" type="email" value={form.email} onChange={e=>setForm({...form, email:e.target.value})}/></div><div className="form-group"><label className="form-label">Mật khẩu</label><input className="ohio-input" type="password" required value={form.password} onChange={e=>setForm({...form, password:e.target.value})}/></div><button className="ohio-btn ohio-btn-primary" style={{width:'100%'}}>Tạo tài khoản</button></form><div style={{textAlign:'center',marginTop:16,fontSize:'var(--fs-sm)'}}><Link to="/login">Đã có tài khoản? Đăng nhập</Link></div></div></div>;
}
