import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import EventAvailableRounded from '@mui/icons-material/EventAvailableRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import PageHeader from '../components/PageHeader';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
const money=(v)=>new Intl.NumberFormat('vi-VN').format(v||0)+'đ';
const fmt=(v)=>new Date(v).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
const localDate=(value)=>{const date=new Date(value);return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;};
const CUSTOMER_CHANGE_NOTICE_MS=24*60*60*1000;
const canCustomerChangeBooking=(booking)=>['pending','confirmed'].includes(booking?.status)&&new Date(booking.appointment).getTime()-Date.now()>=CUSTOMER_CHANGE_NOTICE_MS;
export default function BookingsPage(){
  const {user}=useAuth();
  return user?.role==='customer'?<CustomerBookings/>:<BookingsPageContent/>;
}
function BookingsPageContent(){
  const {user}=useAuth(); const [rows,setRows]=useState([]); const [error,setError]=useState(''); const [busy,setBusy]=useState(''); const [tab,setTab]=useState('upcoming'); const [rescheduling,setRescheduling]=useState(null); const [newDate,setNewDate]=useState(''); const [newTime,setNewTime]=useState(''); const [rescheduleError,setRescheduleError]=useState('');
  const load=()=>api.get('/bookings/').then(({data})=>setRows(data.results||data)).catch(()=>setError('Không tải được lịch hẹn.'));
  useEffect(()=>{load();const fn=()=>load();window.addEventListener('ohio:realtime',fn);return()=>window.removeEventListener('ohio:realtime',fn);},[]);
  const act=async(id,type)=>{setBusy(`${id}-${type}`);try{const {data}=await api.post(`/bookings/${id}/${type}/`);if(type==='cancel')setRows(current=>current.map(row=>row.id===id?{...row,status:data.status,status_label:data.status_label}:row));await load();}catch(e){setError(e.response?.data?.detail||'Không thể cập nhật lịch hẹn.');}finally{setBusy('');}};
  const customer=user?.role==='customer';
  const filteredRows=useMemo(()=>!customer?rows:rows.filter(r=>{
    if(tab==='pending')return r.status==='pending';
    if(tab==='history')return ['completed','no_show'].includes(r.status);
    if(tab==='cancelled')return r.status==='cancelled';
    return ['confirmed','checked_in','in_progress'].includes(r.status);
  }),[rows,customer,tab]);
  useEffect(()=>{if(!rescheduling)return;const latest=rows.find(row=>row.id===rescheduling.id);if(!latest||!canCustomerChangeBooking(latest))setRescheduling(null);else if(latest!==rescheduling)setRescheduling(latest);},[rows,rescheduling]);
  const openReschedule=(booking)=>{if(!customer||!canCustomerChangeBooking(booking))return;const date=new Date(booking.appointment);setRescheduling(booking);setNewDate(localDate(booking.appointment));setNewTime(`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`);setRescheduleError('');};
  const closeReschedule=()=>{if(busy!==`${rescheduling?.id}-reschedule`){setRescheduling(null);setRescheduleError('');}};
  const reschedule=async()=>{if(!rescheduling||!canCustomerChangeBooking(rescheduling)||!newDate||!newTime)return;const appointment=new Date(`${newDate}T${newTime}`);if(Number.isNaN(appointment.getTime())||appointment<=new Date()){setRescheduleError('Vui lòng chọn ngày và giờ trong tương lai.');return;}setBusy(`${rescheduling.id}-reschedule`);setRescheduleError('');try{await api.post(`/bookings/${rescheduling.id}/reschedule/`,{appointment:appointment.toISOString(),reason:'Khách hàng yêu cầu đổi lịch'});setRescheduling(null);await load();}catch(e){setRescheduleError(e.response?.data?.detail||'Không thể đổi lịch. Vui lòng chọn khung giờ khác.');}finally{setBusy('');}};
  const content=<><div className={customer?'':'ap-page-heading-row'}>{customer?<div style={{marginBottom:22}}><h1 className="public-page-title">Lịch hẹn của tôi</h1><p className="public-page-subtitle" style={{marginBottom:0}}>Theo dõi các lịch hẹn đã đặt tại AkinaClinic.</p></div>:<PageHeader title="Lịch hẹn" subtitle="Theo dõi và xử lý lịch hẹn tập trung." action={<button className="ap-btn" onClick={load}><RefreshRounded sx={{fontSize:17}}/>Làm mới</button>}/>}</div>{error&&<div className="alert-box error">{error}</div>}{customer&&<div className="ap-card" style={{display:'flex',gap:8,flexWrap:'wrap',marginBottom:14}} role="tablist" aria-label="Lọc lịch hẹn">{[['upcoming','Sắp tới'],['pending','Chờ xác nhận'],['history','Lịch sử'],['cancelled','Đã hủy']].map(([value,label])=><button key={value} role="tab" aria-selected={tab===value} className={`ap-btn ${tab===value?'primary':''}`} onClick={()=>setTab(value)}>{label}</button>)}</div>}<div className="ap-card" style={{padding:0,overflow:'hidden'}}><div className="ap-table-wrap" style={{border:0,borderRadius:0,overflowX:'auto'}}><table className="ap-table"><thead><tr><th>Mã</th><th>Khách hàng</th><th>Loại lịch</th><th>Dịch vụ</th><th>Ngày giờ</th><th>Chuyên viên</th><th>Trạng thái</th><th className="right">Tổng tiền</th><th className="right">Thao tác</th></tr></thead><tbody>{filteredRows.map(r=><tr key={r.id}><td><strong>#{r.id}</strong>{customer&&r.confirm_code&&<div style={{marginTop:5}}><Link to={`/ticket/${encodeURIComponent(r.confirm_code)}`} className="ap-note">Xem mã vé: {r.confirm_code}</Link></div>}</td><td>{r.customer_name}</td><td>{r.appointment_type_label||'Khám / tư vấn'}</td><td>{r.items?.map(i=>i.service_name).join(', ')||'—'}{r.treatment_session_label&&<div className="muted">{r.treatment_session_label}</div>}</td><td className="muted">{fmt(r.appointment)}</td><td>{r.staff_name||'Chưa phân công'}</td><td><span className={`ap-badge ${r.status}`}>{r.status_label}</span></td><td className="right"><strong>{money(r.total)}</strong></td><td className="right"><div style={{display:'flex',gap:6,justifyContent:'flex-end',flexWrap:'wrap'}}>{r.status==='pending'&&['manager','sysadmin','consultant','staff','doctor'].includes(user?.role)&&<button className="ap-btn primary" disabled={busy===`${r.id}-confirm`} onClick={()=>act(r.id,'confirm')}>Xác nhận</button>}{['checked_in','in_progress'].includes(r.status)&&['manager','sysadmin','staff','doctor'].includes(user?.role)&&<button className="ap-btn" disabled={busy===`${r.id}-complete`} onClick={()=>act(r.id,'complete')}>Hoàn thành lịch</button>}{customer&&canCustomerChangeBooking(r)&&<><button className="ap-btn" onClick={()=>openReschedule(r)}>Đổi lịch</button><button className="ap-btn" disabled={busy===`${r.id}-cancel`} onClick={()=>act(r.id,'cancel')}>Hủy</button></>}{!customer&&['pending','confirmed'].includes(r.status)&&<button className="ap-btn" disabled={busy===`${r.id}-no_show`} onClick={()=>act(r.id,'no_show')}>Không đến</button>}</div></td></tr>)}{!filteredRows.length&&<tr><td className="ap-empty" colSpan={9}>Chưa có lịch hẹn trong mục này.</td></tr>}</tbody></table></div></div></>;
  const page=customer?<div className="customer-account">{content}</div>:content;
  return <>{page}{rescheduling&&customer&&canCustomerChangeBooking(rescheduling)&&<div className="booking-reschedule-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&closeReschedule()}>
    <section className="booking-reschedule-dialog" role="dialog" aria-modal="true" aria-labelledby="booking-reschedule-title">
      <header className="booking-reschedule-header"><span className="booking-reschedule-icon"><EventAvailableRounded/></span><div><h2 id="booking-reschedule-title">Đổi lịch hẹn</h2><p>Chọn thời gian mới phù hợp với bạn.</p></div><button type="button" className="booking-reschedule-close" onClick={closeReschedule} aria-label="Đóng" disabled={busy===`${rescheduling.id}-reschedule`}><CloseRounded/></button></header>
      <div className="booking-reschedule-body">
        <div className="booking-reschedule-current"><span>Lịch hiện tại</span><strong>{fmt(rescheduling.appointment)}</strong><small>{rescheduling.appointment_type_label||'Khám / tư vấn'}{rescheduling.staff_name?` · ${rescheduling.staff_name}`:''}</small></div>
        {rescheduleError&&<div className="alert-box error" role="alert">{rescheduleError}</div>}
        <div className="booking-reschedule-fields">
          <label><span>Ngày mới</span><input type="date" min={localDate(new Date())} value={newDate} onChange={(event)=>setNewDate(event.target.value)}/></label>
          <label><span>Giờ mới</span><input type="time" step="900" value={newTime} onChange={(event)=>setNewTime(event.target.value)}/></label>
        </div>
        <p className="booking-reschedule-note">Yêu cầu đổi lịch sẽ được gửi đến phòng khám. Lịch mới chỉ có hiệu lực sau khi được xác nhận.</p>
      </div>
      <footer className="booking-reschedule-footer"><button type="button" className="ap-btn" onClick={closeReschedule} disabled={busy===`${rescheduling.id}-reschedule`}>Để sau</button><button type="button" className="ap-btn primary" onClick={reschedule} disabled={!newDate||!newTime||busy===`${rescheduling.id}-reschedule`}>{busy===`${rescheduling.id}-reschedule`?'Đang gửi…':'Gửi yêu cầu đổi lịch'}</button></footer>
    </section>
  </div>}</>;
}

function CustomerBookings(){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState('');
  const [tab,setTab]=useState('upcoming');
  const [expandedId,setExpandedId]=useState(null);
  const [rescheduling,setRescheduling]=useState(null);
  const [cancelling,setCancelling]=useState(null);
  const [newDate,setNewDate]=useState('');
  const [newTime,setNewTime]=useState('');
  const [actionError,setActionError]=useState('');

  const load=async()=>{
    setLoading(true);
    setError('');
    try{
      const {data}=await api.get('/bookings/');
      setRows(data.results||data);
    }catch{
      setError('Không tải được lịch hẹn. Vui lòng kiểm tra kết nối rồi thử lại.');
    }finally{
      setLoading(false);
    }
  };
  useEffect(()=>{
    load();
    const refresh=()=>load();
    window.addEventListener('ohio:realtime',refresh);
    return()=>window.removeEventListener('ohio:realtime',refresh);
  },[]);

  const filteredRows=useMemo(()=>{
    const today=localDate(new Date());
    const visible=rows.filter((booking)=>{
      if(tab==='pending')return booking.status==='pending'&&localDate(booking.appointment)>=today;
      if(tab==='history')return ['completed','no_show'].includes(booking.status)||(
        ['pending','confirmed','checked_in','in_progress'].includes(booking.status)&&localDate(booking.appointment)<today
      );
      if(tab==='cancelled')return booking.status==='cancelled';
      return ['pending','confirmed','checked_in','in_progress'].includes(booking.status)&&localDate(booking.appointment)>=today;
    });
    return visible.sort((a,b)=>{
      const delta=new Date(a.appointment)-new Date(b.appointment);
      return ['history','cancelled'].includes(tab)?-delta:delta;
    });
  },[rows,tab]);

  const counts=useMemo(()=>{
    const today=localDate(new Date());
    return {
      upcoming:rows.filter((b)=>['pending','confirmed','checked_in','in_progress'].includes(b.status)&&localDate(b.appointment)>=today).length,
      pending:rows.filter((b)=>b.status==='pending'&&localDate(b.appointment)>=today).length,
      history:rows.filter((b)=>['completed','no_show'].includes(b.status)||(
        ['pending','confirmed','checked_in','in_progress'].includes(b.status)&&localDate(b.appointment)<today
      )).length,
      cancelled:rows.filter((b)=>b.status==='cancelled').length,
    };
  },[rows]);

  const openReschedule=(booking)=>{
    if(!canCustomerChangeBooking(booking))return;
    const date=new Date(booking.appointment);
    setRescheduling(booking);
    setNewDate(localDate(booking.appointment));
    setNewTime(`${String(date.getHours()).padStart(2,'0')}:${String(date.getMinutes()).padStart(2,'0')}`);
    setActionError('');
  };
  const dismissActions=()=>{
    if(busy)return;
    setRescheduling(null);
    setCancelling(null);
    setActionError('');
  };
  const reschedule=async()=>{
    if(!rescheduling||!canCustomerChangeBooking(rescheduling)||!newDate||!newTime)return;
    const appointment=new Date(`${newDate}T${newTime}`);
    if(Number.isNaN(appointment.getTime())||appointment.getTime()<Date.now()+CUSTOMER_CHANGE_NOTICE_MS){
      setActionError('Lịch mới cần cách hiện tại ít nhất 24 giờ.');
      return;
    }
    setBusy(`reschedule-${rescheduling.id}`);
    setActionError('');
    try{
      await api.post(`/bookings/${rescheduling.id}/reschedule/`,{
        appointment:appointment.toISOString(),
        reason:'Khách hàng yêu cầu đổi lịch',
      });
      setRescheduling(null);
      await load();
    }catch(err){
      setActionError(err.response?.data?.detail||'Không thể đổi lịch. Vui lòng chọn khung giờ khác.');
    }finally{
      setBusy('');
    }
  };
  const cancelBooking=async()=>{
    if(!cancelling||!canCustomerChangeBooking(cancelling))return;
    setBusy(`cancel-${cancelling.id}`);
    setActionError('');
    try{
      await api.post(`/bookings/${cancelling.id}/cancel/`,{reason:'Khách hàng chủ động hủy lịch'});
      setCancelling(null);
      await load();
    }catch(err){
      setActionError(err.response?.data?.detail||'Không thể hủy lịch. Vui lòng liên hệ phòng khám.');
    }finally{
      setBusy('');
    }
  };

  const tabs=[
    ['upcoming','Sắp tới',counts.upcoming],
    ['pending','Chờ xác nhận',counts.pending],
    ['history','Lịch sử',counts.history],
    ['cancelled','Đã hủy',counts.cancelled],
  ];
  const pageError=error&&<div className="customer-bookings-error" role="alert"><span>{error}</span><button type="button" onClick={load} disabled={loading}><RefreshRounded/>Thử lại</button></div>;
  const emptyCopy={
    upcoming:['Chưa có lịch hẹn sắp tới','Các lịch đang chờ hoặc đã được xác nhận sẽ xuất hiện ở đây.'],
    pending:['Không có lịch đang chờ xác nhận','Lịch hẹn mới sẽ được phòng khám xác nhận tại đây.'],
    history:['Chưa có lịch sử khám','Lịch hoàn thành hoặc khách không đến sẽ được lưu tại đây.'],
    cancelled:['Chưa có lịch đã hủy','Các lịch bạn đã hủy sẽ xuất hiện tại đây.'],
  }[tab];
  return <section className="customer-account customer-bookings">
    <header className="customer-bookings-heading">
      <div><h1>Lịch hẹn của tôi</h1><p>Theo dõi lịch khám và yêu cầu đặt lịch tại AkinaClinic.</p></div>
      <Link to="/book" className="customer-bookings-new"><AddRounded/>Đặt lịch mới</Link>
    </header>
    {pageError}
    <nav className="customer-bookings-tabs" role="tablist" aria-label="Lọc lịch hẹn">
      {tabs.map(([id,label,count])=><button type="button" key={id} role="tab" aria-selected={tab===id} className={tab===id?'active':''} onClick={()=>setTab(id)}>{label}<span>{count}</span></button>)}
    </nav>
    <div className="customer-bookings-list" aria-busy={loading}>
      {loading&&!rows.length&&Array.from({length:2},(_,i)=><div className="customer-booking-skeleton" key={i}><span/><span/><span/></div>)}
      {!loading&&!error&&!filteredRows.length&&<div className="customer-bookings-empty"><CalendarMonthRounded/><h2>{emptyCopy[0]}</h2><p>{emptyCopy[1]}</p>{tab==='upcoming'&&<Link to="/book" className="customer-bookings-new">Đặt lịch mới</Link>}</div>}
      {!error&&filteredRows.map((booking)=><CustomerBookingCard key={booking.id} booking={booking} expanded={expandedId===booking.id} onToggle={()=>setExpandedId(expandedId===booking.id?null:booking.id)} onReschedule={()=>openReschedule(booking)} onCancel={()=>{setCancelling(booking);setActionError('');}} />)}
    </div>
    {rescheduling&&<div className="customer-booking-modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&dismissActions()}>
      <section className="customer-booking-modal" role="dialog" aria-modal="true" aria-labelledby="customer-reschedule-title">
        <header><span className="customer-booking-modal-icon"><EventAvailableRounded/></span><div><h2 id="customer-reschedule-title">Đổi lịch hẹn</h2><p>Chỉ có thể đổi lịch trước giờ hẹn tối thiểu 24 giờ.</p></div><button type="button" onClick={dismissActions} disabled={Boolean(busy)} aria-label="Đóng"><CloseRounded/></button></header>
        <div className="customer-booking-modal-body">
          <div className="customer-booking-current"><span>Lịch hiện tại</span><strong>{fmt(rescheduling.appointment)}</strong><small>{bookingDisplayTitle(rescheduling)}</small></div>
          {actionError&&<div className="alert-box error" role="alert">{actionError}</div>}
          <div className="customer-booking-fields">
            <label><span>Ngày mới</span><input type="date" min={localDate(new Date(Date.now()+CUSTOMER_CHANGE_NOTICE_MS))} value={newDate} onChange={(event)=>setNewDate(event.target.value)}/></label>
            <label><span>Giờ mới</span><input type="time" step="900" value={newTime} onChange={(event)=>setNewTime(event.target.value)}/></label>
          </div>
          <p>Phòng khám sẽ kiểm tra khung giờ và xác nhận lại lịch mới.</p>
        </div>
        <footer><button type="button" className="customer-booking-secondary" onClick={dismissActions} disabled={Boolean(busy)}>Để sau</button><button type="button" className="customer-booking-primary" onClick={reschedule} disabled={!newDate||!newTime||Boolean(busy)}>{busy?'Đang gửi…':'Gửi yêu cầu'}</button></footer>
      </section>
    </div>}
    {cancelling&&<div className="customer-booking-modal-backdrop" onMouseDown={(event)=>event.target===event.currentTarget&&dismissActions()}>
      <section className="customer-booking-modal customer-booking-cancel-modal" role="alertdialog" aria-modal="true" aria-labelledby="customer-cancel-title">
        <header><span className="customer-booking-modal-icon"><InfoOutlined/></span><div><h2 id="customer-cancel-title">Xác nhận hủy lịch?</h2><p>Thao tác này sẽ hủy yêu cầu đặt lịch.</p></div><button type="button" onClick={dismissActions} disabled={Boolean(busy)} aria-label="Đóng"><CloseRounded/></button></header>
        <div className="customer-booking-modal-body"><div className="customer-booking-current"><span>{bookingDisplayTitle(cancelling)}</span><strong>{fmt(cancelling.appointment)}</strong></div>{actionError&&<div className="alert-box error" role="alert">{actionError}</div>}<p>Bạn chỉ có thể tự hủy trước giờ hẹn ít nhất 24 giờ. Nếu lịch gần hơn, vui lòng liên hệ phòng khám.</p></div>
        <footer><button type="button" className="customer-booking-secondary" onClick={dismissActions} disabled={Boolean(busy)}>Giữ lịch</button><button type="button" className="customer-booking-danger" onClick={cancelBooking} disabled={Boolean(busy)}>{busy?'Đang hủy…':'Xác nhận hủy'}</button></footer>
      </section>
    </div>}
  </section>;
}

function bookingDisplayTitle(booking){
  if(booking.appointment_type==='session')return booking.treatment_session_details?.plan_title||booking.treatment_session_label||'Buổi liệu trình';
  return bookingTypeLabel(booking);
}

function bookingTypeLabel(booking){
  const labels={
    consult:'Khám mới',
    follow_up:'Tái khám',
    procedure:'Thủ thuật',
    session:'Buổi liệu trình',
  };
  return labels[booking.appointment_type]||booking.appointment_type_label||'Lịch hẹn';
}

function bookingCost(booking){
  if(booking.appointment_type==='session')return {label:'Chi phí',value:'Đã nằm trong liệu trình',note:'Buổi này thuộc gói điều trị hiện tại.'};
  if(booking.total>0)return {label:booking.appointment_type==='consult'?'Phí khám':booking.appointment_type==='follow_up'?'Phí tái khám':'Chi phí dự kiến',value:money(booking.total)};
  if(booking.discount_total>0)return {label:'Cần thanh toán',value:'0đ sau voucher'};
  const label=booking.appointment_type==='consult'?'Phí khám':booking.appointment_type==='follow_up'?'Phí tái khám':'Chi phí dự kiến';
  return {label,value:'Phòng khám xác nhận',note:'Mức phí sẽ được phòng khám thông báo trước khi thực hiện.'};
}

function CustomerBookingCard({booking,expanded,onToggle,onReschedule,onCancel}){
  const session=booking.treatment_session_details;
  const costs=bookingCost(booking);
  const date=new Date(booking.appointment);
  const canChange=canCustomerChangeBooking(booking);
  const needsClinicHelp=['pending','confirmed'].includes(booking.status)&&!canChange;
  const serviceNames=(booking.items||[]).map((item)=>item.service_name||item.service?.name).filter(Boolean);
  return <article className="customer-booking-card">
    <header className="customer-booking-card-header"><span>Mã lịch <strong>#{booking.id}</strong></span><span className={`customer-booking-status ${booking.status}`}>{booking.status_label}</span></header>
    <div className="customer-booking-main">
      <div className="customer-booking-date"><strong>{String(date.getDate()).padStart(2,'0')}</strong><span>THG {String(date.getMonth()+1).padStart(2,'0')}</span></div>
      <div className="customer-booking-summary">
        {booking.appointment_type==='session'?<><h2>{session?.plan_title||booking.treatment_session_label||'Liệu trình điều trị'}</h2><span className="customer-booking-kind">Buổi liệu trình · Buổi {session?.session_number||'—'}{session?.total_sessions?`/${session.total_sessions}`:''} · {session?.session_status_label||'Chưa cập nhật'}</span></>:<><h2>{bookingTypeLabel(booking)}</h2>{serviceNames.length>0&&<span className="customer-booking-kind">{serviceNames.join(', ')}</span>}</>}
        <span><AccessTimeRounded/>{date.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})} · {date.toLocaleDateString('vi-VN',{weekday:'long'})}</span>
        <span><PersonOutlineRounded/>{booking.staff_name||'Phòng khám sẽ phân công'}</span>
      </div>
    </div>
    <div className="customer-booking-cost"><div><span>{costs.label}</span><small>{costs.note||''}</small></div><strong>{costs.value}</strong></div>
    {needsClinicHelp&&<div className="customer-booking-notice">Lịch hẹn còn dưới 24 giờ. <Link to="/chat">Liên hệ phòng khám</Link> nếu cần hỗ trợ thay đổi.</div>}
    {expanded&&<div className="customer-booking-details">
      <div><span>Loại lịch</span><strong>{bookingTypeLabel(booking)}</strong></div>
      {booking.appointment_type==='session'&&<><div><span>Liệu trình</span><strong>{session?.plan_title||booking.treatment_session_label||'—'}</strong></div><div><span>Tiến độ buổi</span><strong>Buổi {session?.session_number||'—'}{session?.total_sessions?`/${session.total_sessions}`:''} · {session?.session_status_label||'Chưa cập nhật'}</strong></div><div><span>Trạng thái liệu trình</span><strong>{session?.plan_status_label||'—'}</strong></div></>}
      {booking.appointment_type!=='session'&&<div><span>Dịch vụ</span><strong>{serviceNames.join(', ')||'Phòng khám xác nhận'}</strong></div>}
      <div><span>Trạng thái lịch</span><strong>{booking.status_label}</strong></div>
      <div><span>Mã lịch nội bộ</span><strong>#{booking.id}</strong></div>
      {booking.note&&<div className="customer-booking-details-note"><span>Ghi chú</span><strong>{booking.note}</strong></div>}
    </div>}
    <footer className="customer-booking-card-footer">
      <button type="button" className="customer-booking-secondary" onClick={onToggle}>{expanded?'Thu gọn':'Chi tiết lịch'}</button>
      {booking.confirm_code&&<Link to={`/ticket/${encodeURIComponent(booking.confirm_code)}`} className="customer-booking-secondary">Vé điện tử & mã xác nhận</Link>}
      <span className="customer-booking-footer-spacer"/>
      {canChange&&<><button type="button" className="customer-booking-secondary" onClick={onReschedule}>Đổi lịch</button><button type="button" className="customer-booking-danger" onClick={onCancel}>Hủy lịch</button></>}
      {!booking.confirm_code&&<span className="customer-booking-no-ticket">Chưa có mã vé</span>}
    </footer>
  </article>;
}
