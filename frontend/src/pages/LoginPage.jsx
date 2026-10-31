import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import '../styles/public.css';
export default function LoginPage(){
  const {user,login}=useAuth(); const navigate=useNavigate(); const location=useLocation();
  const [form,setForm]=useState({username:'',password:''}); const [error,setError]=useState(''); const [busy,setBusy]=useState(false);
  if(user) return <Navigate to={user.role==='customer'?'/' : '/dashboard'} replace/>;
  const submit=async(e)=>{e.preventDefault();setError('');setBusy(true);try{const u=await login(form.username,form.password);const next=location.state?.from || (u.role==='customer'?'/' : '/dashboard');navigate(next,{replace:true});}catch(err){setError(err.response?.data?.detail||'Không thể đăng nhập.');}finally{setBusy(false)}};
  return <div className="login-wrap"><div className="login-card"><h1>Đăng nhập</h1>{error&&<div className="alert-box error">{error}</div>}<form onSubmit={submit}><div className="form-group"><label className="form-label">Tên đăng nhập</label><input className="ohio-input" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} autoFocus/></div><div className="form-group"><label className="form-label">Mật khẩu</label><input className="ohio-input" type="password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></div><button className="ohio-btn ohio-btn-primary" style={{width:'100%'}} disabled={busy}>{busy?'Đang đăng nhập...':'Đăng nhập'}</button></form><div style={{textAlign:'center',marginTop:12,fontSize:'var(--fs-sm)'}}><Link to="/forgot-password">Quên mật khẩu?</Link></div><div style={{textAlign:'center',marginTop:10,fontSize:'var(--fs-sm)',color:'#697586'}}>Chưa có tài khoản? <Link to="/signup">Đăng ký</Link> · <Link to="/">Về trang chủ</Link></div></div></div>;
}
