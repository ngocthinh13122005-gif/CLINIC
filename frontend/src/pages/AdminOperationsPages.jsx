import { useEffect, useState } from "react";
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import {
  LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';

import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import api from '../api/client';
import { ensureFirebaseAuth, subscribeSystemEvents } from '../services/firebase';
import '../styles/admin-operations.css';

const money = (v) => `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(v) || 0))}đ`;

const dt = (v) => v ? new Date(v).toLocaleString('vi-VN', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
const dmy = (v) => v ? new Date(v).toLocaleDateString('vi-VN') : '—';
const isoDay = (date) => {
  const y=date.getFullYear(); const m=String(date.getMonth()+1).padStart(2,'0'); const d=String(date.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
};
const statusVi = { pending:'Chờ xác nhận', confirmed:'Đã xác nhận', completed:'Hoàn thành', cancelled:'Đã hủy' };

function Toast({ text, kind='ok', onClose }) {
  if (!text) return null;
  return <div className={`adm-toast ${kind}`}><CheckCircleRounded sx={{fontSize:18}}/><span>{text}</span><button onClick={onClose}><span className="ak-icon-glyph">×</span></button></div>;
}

function Modal({ open, title, eyebrow, onClose, children, wide=false }) {
  if (!open) return null;
  return <div className="adm-modal-backdrop" onMouseDown={(e)=>{if(e.target===e.currentTarget) onClose?.();}}>
    <div className={`adm-modal ${wide?'wide':''}`}>
      <button className="adm-modal-close" onClick={onClose} aria-label="Đóng"><CloseRounded/></button>
      {eyebrow && <div className="adm-eyebrow">{eyebrow}</div>}
      <h2>{title}</h2>
      {children}
    </div>
  </div>;
}

function AdminHeader({ action, meta }) {
  // Tiêu đề trang nằm trên thanh trên cùng của ClinicShell; nút thao tác chính được đưa lên đó.
  const [slot, setSlot] = useState(() => document.getElementById('cl-top-actions'));
  useEffect(() => { setSlot(document.getElementById('cl-top-actions')); }, []);
  const act = action && (slot ? createPortal(<div className="cl-pagehead-actions">{action}</div>, slot) : <div className="adm-page-actions">{action}</div>);
  if (!meta && slot) return act || null;
  return <>{act}{meta && <div className="adm-page-head"><div /><div className="adm-page-actions">{meta}</div></div>}</>;
}

function Card({ title, subtitle, action, children, className='' }) {
  return <section className={`adm-card ${className}`}>
    {(title || action) && <div className="adm-card-head"><div><h2>{title}</h2>{subtitle&&<p>{subtitle}</p>}</div>{action}</div>}
    {children}
  </section>;
}

function Empty({ text='Chưa có dữ liệu.' }) { return <div className="adm-empty">{text}</div>; }
function Badge({ status, children }) { return <span className={`adm-badge ${status||''}`}>{children}</span>; }

function useLoad(loader, deps=[]) {
  const [state,setState]=useState({loading:true,data:null,error:''});
  const load=async()=>{setState(s=>({...s,loading:true,error:''}));try{const data=await loader();setState({loading:false,data,error:''});}catch(e){setState({loading:false,data:null,error:e?.response?.data?.detail||'Không tải được dữ liệu.'});}};
  useEffect(()=>{load();},deps);
  return {...state, reload:load};
}

export function AdminOverviewPage(){
  const req=useLoad(async()=> (await api.get('/dashboard/manager/')).data,[]);
  const data=req.data||{summary:{},revenue_growth:[],leaderboard:[],hourly_heatmap:[],feed:[]};
  useEffect(()=>{
    let unsub=()=>{};
    (async()=>{if(await ensureFirebaseAuth()){unsub=subscribeSystemEvents('manager-dashboard',()=>req.reload(),()=>{});}})();
    return()=>unsub();
  },[]);
  const maxHeat=Math.max(1,...(data.hourly_heatmap||[]).map(x=>x.count||0));
  return <>
    <AdminHeader title="Tổng quan vận hành" subtitle="Theo dõi sức khỏe kinh doanh, lịch hẹn và hiệu suất nhân sự theo thời gian thực." meta={<span className="adm-live"><i/> {data.live_date ? dmy(`${data.live_date}T00:00:00`) : 'Hôm nay'} · Dữ liệu trực tiếp</span>}/>
    {req.error&&<div className="alert-box error">{req.error}</div>}
    <div className="adm-kpi-grid">
      <div className="adm-kpi"><span>Tổng doanh thu thuần</span><strong>{money(data.summary.revenue)}</strong><small className={(data.summary.revenue_growth_percent||0)>=0?'positive':'negative'}>{(data.summary.revenue_growth_percent||0)>=0?'↑':'↓'} {Math.abs(data.summary.revenue_growth_percent||0)}% so với tuần trước</small></div>
      <div className="adm-kpi"><span>Lịch hẹn đang hoạt động</span><strong>{data.summary.active_bookings||0} lịch</strong><Link to={{ pathname: '/lich-hen', search: '?view=list&status=pending' }}>{data.summary.pending||0} lịch chờ xác nhận · Xem ngay</Link></div>
      <div className="adm-kpi"><span>Công suất nhân sự</span><strong>{data.summary.roster_capacity||0}%</strong><small className="positive">Mức sử dụng nhân sự hiện tại</small></div>
      <div className="adm-kpi"><span>Ca đã hoàn thành</span><strong>{data.summary.completed_sessions||0} ca</strong><small>{data.summary.cancellation_today||0} lịch hủy hôm nay</small></div>
    </div>
    <div className="adm-dashboard-grid">
      <Card title="Xu hướng tăng trưởng doanh thu" subtitle="So sánh doanh thu đã hoàn thành theo tuần" action={<span className="adm-pill">Theo tuần</span>}>
        <div className="adm-chart"><ResponsiveContainer width="100%" height={300}><LineChart data={data.revenue_growth||[]} margin={{top:10,right:18,left:0,bottom:0}}><CartesianGrid vertical={false} strokeDasharray="4 5"/><XAxis dataKey="name"/><YAxis tickFormatter={(v)=>`${Math.round(v/1000000)}tr`}/><Tooltip formatter={(v)=>money(v)}/><Line type="monotone" dataKey="value" stroke="#24bee1" strokeWidth={3} dot={{r:5,fill:'#fff',stroke:'#24bee1',strokeWidth:2}}/></LineChart></ResponsiveContainer></div>
      </Card>
      <Card title="Bảng xếp hạng nhân sự" subtitle="Doanh thu hoàn thành cao nhất">
        <div className="adm-leaders">{(data.leaderboard||[]).map((x,i)=><div className="adm-leader" key={x.id}><span className="adm-rank">#{i+1}</span><div className="adm-avatar">{x.name?.[0]||'N'}</div><div className="adm-leader-info"><strong>{x.name}</strong><span>{x.position}</span></div><div className="adm-leader-money"><strong>{money(x.value)}</strong><span>{x.appointments_today||0} lịch hôm nay</span></div></div>)}{!data.leaderboard?.length&&<Empty/>}</div>
      </Card>
      <Card title="Mật độ lịch hẹn theo giờ" subtitle="Mức độ bận trong ngày theo từng khung giờ">
        <div className="adm-heatmap">{(data.hourly_heatmap||[]).map(x=>{const level=(x.count||0)/maxHeat;return <div className="adm-heat-cell" key={x.hour} style={{'--heat':Math.max(.08,level)}}><strong>{x.count||0}</strong><span>{x.hour}</span></div>})}</div>
        <div className="adm-heat-legend"><span>Mức thấp</span><i/><i/><i/><span>Cao</span></div>
      </Card>
      <Card title="Luồng vận hành trực tiếp" subtitle="Lịch hẹn mới và thay đổi trạng thái gần nhất">
        <div className="adm-feed">{(data.feed||[]).map(x=><div className="adm-feed-row" key={x.id}><div><strong>{x.title}</strong><span>{dt(x.time)}</span></div><Badge status={x.status}>{x.status_label||statusVi[x.status]}</Badge></div>)}{!data.feed?.length&&<Empty/>}</div>
      </Card>
    </div>
  </>;
}

export function AdminCalendarPage(){
  const [day,setDay]=useState(()=>isoDay(new Date()));
  const [toast,setToast]=useState(''); const [modal,setModal]=useState(null); const [saving,setSaving]=useState(false);
  const req=useLoad(async()=>{const [s,b,r,l,v,w]=await Promise.all([api.get('/staff/'),api.get('/bookings/'),api.get(`/roster-shifts/?date=${day}`),api.get('/leave-requests/'),api.get('/services/'),api.get('/working-hours/')]);return{staff:s.data.results||s.data||[],bookings:b.data.results||b.data||[],shifts:r.data.results||r.data||[],leaves:l.data.results||l.data||[],services:v.data.results||v.data||[],working:w.data.results||w.data||[]};},[day]);
  const slots=['08:00','09:00','10:00','10:30','11:00','13:30','14:00','14:30','15:00','16:00','16:30','17:00'];
  const dayBookings=(req.data?.bookings||[]).filter(b=>(b.appointment||'').slice(0,10)===day);
  const shiftMap=new Map((req.data?.shifts||[]).map(s=>[Number(s.staff),s]));
  const isLeave=(staff)=> (req.data?.leaves||[]).some(l=>l.status==='approved' && Number(l.staff)===Number(staff.user_id) && l.start_date<=day && l.end_date>=day);
  const weekday=(new Date(`${day}T12:00:00`).getDay()+6)%7;
  const workWindows=(staff)=>(req.data?.working||[]).filter(w=>Number(w.staff)===Number(staff.id)&&Number(w.weekday)===weekday);
  const worksAt=(staff,slot)=>workWindows(staff).some(w=>w.start_time.slice(0,5)<=slot&&slot<w.end_time.slice(0,5));
  const isPast=(slot)=> new Date(`${day}T${slot}:00`) < new Date();
  const bookingAt=(staff,slot)=>dayBookings.find(b=>Number(b.staff)===Number(staff.id) && new Date(b.appointment).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})===slot);
  const offDuty=(staff)=> !staff.is_active || !workWindows(staff).length || shiftMap.get(Number(staff.id))?.is_on_duty===false || isLeave(staff);
  const changeDay=(n)=>{const d=new Date(`${day}T12:00:00`);d.setDate(d.getDate()+n);setDay(isoDay(d));};
  const toggle=async(staff)=>{await api.post('/roster-shifts/toggle/',{staff:staff.id,date:day});setToast(`Đã cập nhật ca trực của ${staff.name}`);req.reload();};
  const openSlot=(staff,slot)=>setModal({type:'create',staff,slot,form:{service_ids:[],guest_name:'',guest_phone:'',guest_email:'',note:''}});
  const openBooking=(booking)=>setModal({type:'booking',booking});
  const submitBooking=async(e)=>{e.preventDefault();if(!modal.form.service_ids.length){setToast('Vui lòng chọn ít nhất một dịch vụ.');return;}setSaving(true);try{await api.post('/bookings/',{...modal.form,staff:modal.staff.id,appointment:`${day}T${modal.slot}:00`});setToast('Đã tạo lịch hẹn cho khách hàng.');setModal(null);await req.reload();}catch(err){setToast(err.response?.data?.detail||Object.values(err.response?.data||{})?.[0]?.[0]||'Không thể tạo lịch hẹn.');}finally{setSaving(false)}};
  const actionBooking=async(action)=>{setSaving(true);try{await api.post(`/bookings/${modal.booking.id}/${action}/`);setToast('Đã cập nhật trạng thái lịch hẹn.');setModal(null);await req.reload();}catch(err){setToast(err.response?.data?.detail||'Không thể cập nhật lịch hẹn.');}finally{setSaving(false)}};
  return <>
    <Toast text={toast} onClose={()=>setToast('')}/>
    <AdminHeader title="Lịch nhân sự & lịch hẹn" subtitle="Quản lý lịch trực, trạng thái khung giờ và đặt lịch trực tiếp cho khách hàng." action={<div className="adm-view-tabs"><button className="active">Theo ngày</button><button disabled>Theo tuần</button><button disabled>Theo tháng</button></div>}/>
    <div className="adm-calendar-layout">
      <Card className="adm-calendar-card">
        <div className="adm-calendar-top"><div className="adm-day-nav"><button onClick={()=>changeDay(-1)}><ChevronLeftRounded/></button><strong>{new Date(`${day}T00:00:00`).toLocaleDateString('vi-VN',{weekday:'long',day:'2-digit',month:'2-digit',year:'numeric'})}</strong><button onClick={()=>changeDay(1)}><ChevronRightRounded/></button></div><div className="adm-legend"><span><i className="pending"/>Chờ xác nhận</span><span><i className="confirmed"/>Đã xác nhận</span><span><i className="cancelled"/>Đã hủy</span><span><i className="completed"/>Hoàn thành</span></div></div>
        <div className="adm-roster-scroll"><table className="adm-roster"><thead><tr><th>Khung giờ</th>{(req.data?.staff||[]).map(s=><th key={s.id}><div className="adm-staff-head"><div className="adm-avatar small">{s.name?.[0]}</div><span>{s.name}</span></div></th>)}</tr></thead><tbody>{slots.map(slot=><tr key={slot}><td className="adm-time">{slot}</td>{(req.data?.staff||[]).map(staff=>{const b=bookingAt(staff,slot);let content;if(offDuty(staff)||!worksAt(staff,slot))content=<span className="adm-slot off">Không trực</span>;else if(b)content=<button className={`adm-booking-cell ${b.status}`} onClick={()=>openBooking(b)}><strong>{b.customer_name}</strong><span>{statusVi[b.status]}</span></button>;else if(isPast(slot))content=<span className="adm-slot past">Đã qua</span>;else content=<button className="adm-slot available" onClick={()=>openSlot(staff,slot)}>Còn trống <small>+ Đặt lịch</small></button>;return <td key={staff.id}>{content}</td>})}</tr>)}</tbody></table></div>
      </Card>
      <aside className="adm-shifts"><Card title="Ca trực nhân sự" subtitle="Bật/tắt khả dụng theo ngày">{(req.data?.staff||[]).map(s=>{const on=!offDuty(s);return <div className="adm-shift-row" key={s.id}><div className="adm-avatar">{s.name?.[0]}</div><div><strong>{s.name}</strong><span className={on?'on':'off'}>{on?'Đang trực':'Không trực'}</span></div><button className={`adm-switch ${on?'on':''}`} onClick={()=>toggle(s)} disabled={isLeave(s)}><i/></button></div>})}</Card><div className="adm-sync-note"><strong>Đồng bộ lịch trực</strong><span>Thay đổi ca trực sẽ đồng bộ với khung giờ khả dụng khi khách đặt lịch.</span></div></aside>
    </div>
    <Modal open={modal?.type==='create'} title="Tạo lịch hẹn cho khách hàng" eyebrow="QUẢN TRỊ ĐẶT LỊCH" onClose={()=>setModal(null)}>
      {modal?.type==='create'&&<form className="adm-form" onSubmit={submitBooking}><div className="adm-context-line">{dmy(`${day}T00:00:00`)} · {modal.slot} · {modal.staff.name}</div><label>Dịch vụ</label><div className="adm-check-grid">{(req.data?.services||[]).filter(s=>s.is_active).map(s=><label key={s.id}><input type="checkbox" checked={modal.form.service_ids.includes(s.id)} onChange={e=>setModal(m=>({...m,form:{...m.form,service_ids:e.target.checked?[...m.form.service_ids,s.id]:m.form.service_ids.filter(x=>x!==s.id)}}))}/><span>{s.name}<small>{money(s.price)} · {s.duration} phút</small></span></label>)}</div><div className="adm-form-grid"><div><label>Tên khách hàng</label><input required value={modal.form.guest_name} onChange={e=>setModal(m=>({...m,form:{...m.form,guest_name:e.target.value}}))}/></div><div><label>Số điện thoại</label><input required value={modal.form.guest_phone} onChange={e=>setModal(m=>({...m,form:{...m.form,guest_phone:e.target.value}}))}/></div></div><label>Email</label><input type="email" value={modal.form.guest_email} onChange={e=>setModal(m=>({...m,form:{...m.form,guest_email:e.target.value}}))}/><label>Ghi chú</label><textarea rows="3" value={modal.form.note} onChange={e=>setModal(m=>({...m,form:{...m.form,note:e.target.value}}))}/><div className="adm-modal-actions"><button type="button" className="adm-btn ghost" onClick={()=>setModal(null)}>Hủy</button><button className="adm-btn dark" disabled={saving}>{saving?'Đang lưu...':'Đặt lịch'}</button></div></form>}
    </Modal>
    <Modal open={modal?.type==='booking'} title="Hồ sơ lịch hẹn" eyebrow={modal?.booking?`MÃ LỊCH #${modal.booking.id}`:''} onClose={()=>setModal(null)}>
      {modal?.type==='booking'&&<div className="adm-reservation"><div className="adm-customer-strip"><div className="adm-avatar">{modal.booking.customer_name?.[0]}</div><div><strong>{modal.booking.customer_name}</strong><span>{modal.booking.customer_phone||'—'} · {modal.booking.customer_email||'—'}</span></div></div><div className="adm-detail-grid"><div><small>Dịch vụ</small><strong>{modal.booking.items?.map(i=>i.service_name).join(', ')||'—'}</strong></div><div><small>Chuyên viên</small><strong>{modal.booking.staff_name||'Chưa phân công'}</strong></div><div><small>Ngày & giờ</small><strong>{dt(modal.booking.appointment)}</strong></div><div><small>Tổng thanh toán</small><strong>{money(modal.booking.total)}</strong></div></div><small className="adm-status-label">Cập nhật trạng thái</small><div className="adm-status-actions"><button className="confirm" disabled={saving||modal.booking.status!=='pending'} onClick={()=>actionBooking('confirm')}>Xác nhận lịch</button><button className="complete" disabled={saving||!['checked_in','in_progress'].includes(modal.booking.status)} onClick={()=>actionBooking('complete')}>Hoàn thành lịch</button><button className="hold" disabled={saving||!['pending','confirmed'].includes(modal.booking.status)} onClick={()=>actionBooking('hold')}>Giữ chờ xác nhận</button><button className="cancel" disabled={saving||!['pending','confirmed'].includes(modal.booking.status)} onClick={()=>actionBooking('cancel')}>Hủy lịch</button></div><button className="adm-btn ghost full" onClick={()=>setModal(null)}>Đóng</button></div>}
    </Modal>
  </>;
}
