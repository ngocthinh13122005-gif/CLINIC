import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip, CartesianGrid } from 'recharts';
import PageHeader from '../components/PageHeader';
import MetricCard from '../components/MetricCard';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ensureFirebaseAuth, firebaseEnabled, subscribeSystemEvents } from '../services/firebase';
import '../styles/operations.css';
import PaymentsRounded from '@mui/icons-material/PaymentsRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import PeopleAltRounded from '@mui/icons-material/PeopleAltRounded';
import BadgeRounded from '@mui/icons-material/BadgeRounded';
import PendingActionsRounded from '@mui/icons-material/PendingActionsRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import SavingsRounded from '@mui/icons-material/SavingsRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import EditRounded from '@mui/icons-material/EditRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ChatBubbleRounded from '@mui/icons-material/ChatBubbleRounded';
import CalendarViewWeekRounded from '@mui/icons-material/CalendarViewWeekRounded';
import GroupRounded from '@mui/icons-material/GroupRounded';
import Inventory2Rounded from '@mui/icons-material/Inventory2Rounded';

const money = (v)=> new Intl.NumberFormat('vi-VN').format(Math.round(v||0))+'đ';
const shortMoney = (v)=> new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:0}).format((v||0)/25000);
const fmtDateTime = (v)=> v ? new Date(v).toLocaleString('vi-VN',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';
const fmtDate = (v)=> v ? new Date(v).toLocaleDateString('vi-VN') : '—';

function SectionCard({title, subtitle, action, children, className=''}) {
  return <section className={`ops-card ${className}`}>
    <div className="ops-card-head">
      <div>
        <h3>{title}</h3>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {action}
    </div>
    {children}
  </section>;
}

function Empty({text='Chưa có dữ liệu.'}){ return <div className="ops-empty">{text}</div>; }

function useRequest(loader, deps=[]) {
  const [state, setState] = useState({loading:true, data:null, error:''});
  useEffect(()=>{ let ok=true; setState({loading:true,data:null,error:''}); loader().then((data)=> ok && setState({loading:false,data,error:''})).catch((e)=> ok && setState({loading:false,data:null,error:e?.response?.data?.detail||'Không tải được dữ liệu.'})); return ()=>{ok=false}; }, deps);
  return state;
}

export function ManagerDashboardPage(){
  const { user } = useAuth();
  const [refresh, setRefresh] = useState(0);
  const req = useRequest(async()=> (await api.get('/dashboard/manager/')).data, [refresh]);
  useEffect(()=>{let unsub=()=>{};(async()=>{if(firebaseEnabled && await ensureFirebaseAuth()){unsub=subscribeSystemEvents('manager-dashboard',()=>setRefresh(v=>v+1),()=>{});}})();return()=>unsub();},[]);
  const data = req.data || {summary:{}, revenue_growth:[], leaderboard:[], feed:[]};
  return <>
    <PageHeader title="Bảng điều khiển quản lý" subtitle={`Xin chào ${user?.full_name || user?.username}. Theo dõi doanh thu, lịch hẹn, nhân sự và vận hành phòng khám theo thời gian thực.`}/>
    {req.error && <div className="alert-box error">{req.error}</div>}
    <div className="ap-grid-4 ops-mb16">
      <MetricCard label="Tổng doanh thu" value={money(data.summary.revenue)} icon={PaymentsRounded} tone="primary"/>
      <MetricCard label="Lịch đang hoạt động" value={data.summary.active_bookings || 0} icon={PendingActionsRounded} tone="warning"/>
      <MetricCard label="Công suất roster" value={`${data.summary.roster_capacity || 0}%`} icon={CalendarViewWeekRounded} tone="success"/>
      <MetricCard label="Ca hoàn thành" value={data.summary.completed_sessions || 0} icon={CheckCircleOutlineRounded}/>
    </div>

    <div className="ops-dashboard-grid">
      <SectionCard title="Revenue growth trend" subtitle="So sánh doanh thu hoàn thành theo tuần" action={<span className="ops-chip">Weekly view</span>}>
        <div className="ops-chart-wrap">
          {data.revenue_growth?.length ? <ResponsiveContainer width="100%" height={280}>
            <LineChart data={data.revenue_growth}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="name" />
              <YAxis tickFormatter={(v)=>`${Math.round(v/1000000)}tr`} />
              <Tooltip formatter={(v)=> money(v)} />
              <Line type="monotone" dataKey="value" strokeWidth={3} dot={{r:4}} activeDot={{r:6}} />
            </LineChart>
          </ResponsiveContainer> : <Empty/>}
        </div>
      </SectionCard>

      <SectionCard title="Artisan leaderboard" subtitle="Nhân sự có doanh thu hoàn thành cao nhất" className="ops-side-card">
        <div className="ops-leaderboard">
          {(data.leaderboard||[]).map((item, idx)=><div className="ops-leader-item" key={item.id}><div className="ops-leader-rank">#{idx+1}</div><div className="ops-leader-info"><strong>{item.name}</strong><span>{item.position}</span></div><div className="ops-leader-value">{shortMoney(item.value)}</div></div>)}
          {!data.leaderboard?.length && <Empty/>}
        </div>
      </SectionCard>

      <SectionCard title="Live operational feed" subtitle="Cập nhật lịch hẹn mới và trạng thái xử lý" className="ops-span-2">
        <div className="ops-feed">
          {(data.feed||[]).map((item)=><div className="ops-feed-item" key={item.id}><div><strong>{item.title}</strong><span>{fmtDateTime(item.time)}</span></div><span className={`ap-badge ${item.status}`}>{item.status}</span></div>)}
          {!data.feed?.length && <Empty/>}
        </div>
      </SectionCard>

      <SectionCard title="Truy cập nhanh" subtitle="Đi đến các module quản lý" className="ops-side-card">
        <div className="ops-shortcuts">
          <Link className="ops-shortcut" to="/roster"><CalendarMonthRounded/><span>Lịch & Roster</span></Link>
          <Link className="ops-shortcut" to="/services"><Inventory2Rounded/><span>Dịch vụ</span></Link>
          <Link className="ops-shortcut" to="/staff-directory"><GroupRounded/><span>Nhân sự</span></Link>
          <Link className="ops-shortcut" to="/crm"><PeopleAltRounded/><span>CRM khách hàng</span></Link>
          <Link className="ops-shortcut" to="/vouchers"><SavingsRounded/><span>Voucher</span></Link>
          <Link className="ops-shortcut" to="/chat"><ForumRounded/><span>Chat CSKH</span></Link>
        </div>
      </SectionCard>
    </div>
  </>;
}

export function RosterPage(){
  const [date, setDate] = useState(new Date().toISOString().slice(0,10)); const [refresh,setRefresh]=useState(0);
  const [shift,setShift]=useState({staff:'',weekday:0,start_time:'08:00',end_time:'17:00'});
  const req = useRequest(async()=> {
    const [staffRes, bookingRes, leaveRes, hoursRes] = await Promise.all([api.get('/staff/'), api.get('/bookings/'), api.get('/leave-requests/'), api.get('/working-hours/')]);
    return {staff: staffRes.data.results || staffRes.data || [], bookings: bookingRes.data.results || bookingRes.data || [], leaves: leaveRes.data.results || leaveRes.data || [], hours: hoursRes.data.results || hoursRes.data || []};
  }, [refresh]);
  const slots = ['09:00','10:00','11:00','13:30','14:30','15:30','16:30'];
  const dayBookings = (req.data?.bookings || []).filter(b => (b.appointment || '').slice(0,10) === date);
  const approvedLeaves = req.data?.leaves?.filter(l => l.status === 'approved' && l.start_date <= date && l.end_date >= date) || [];
  const weekday=new Date(`${date}T00:00:00`).getDay(); const djangoWeekday=(weekday+6)%7;
  const addShift=async(e)=>{e.preventDefault();if(!shift.staff)return;await api.post('/working-hours/',{...shift,staff:Number(shift.staff),weekday:Number(shift.weekday)});setRefresh(v=>v+1)};
  const deleteShift=async(id)=>{await api.delete(`/working-hours/${id}/`);setRefresh(v=>v+1)};
  return <>
    <PageHeader title="Lịch trực & lịch hẹn" subtitle="Quản lý roster theo ngày, giờ làm việc tuần, nghỉ phép và trạng thái booking."/>
    <div className="ops-toolbar"><label>Ngày xem</label><input className="ap-input ops-date" type="date" value={date} onChange={e=>setDate(e.target.value)}/></div>
    <SectionCard title="Roster scheduling & calendar" subtitle="Dạng lịch theo ngày cho quản lý vận hành">
      <div className="ops-roster-grid">
        <div className="ops-roster-table">
          <table className="ap-table"><thead><tr><th>Khung giờ</th>{(req.data?.staff||[]).map(s=><th key={s.id}>{s.name}</th>)}</tr></thead><tbody>
            {slots.map(slot=> <tr key={slot}><td><strong>{slot}</strong></td>{(req.data?.staff||[]).map(s=>{
              const leave = approvedLeaves.some(l => l.staff === s.user_id || l.staff === s.id);
              const hasWindow=(req.data?.hours||[]).some(h=>h.staff===s.id&&h.weekday===djangoWeekday&&h.start_time.slice(0,5)<=slot&&h.end_time.slice(0,5)>slot);
              const booking = dayBookings.find(b => b.staff === s.id && new Date(b.appointment).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})===slot);
              let cell = hasWindow?<span className="ops-state available">AVAILABLE</span>:<span className="ops-state off">OFF DUTY</span>;
              if(leave) cell = <span className="ops-state off">ON LEAVE</span>;
              else if(booking) cell = <div className={`ops-state-card ${booking.status}`}><strong>{booking.customer_name}</strong><span>{booking.items?.map(i=>i.service_name).join(', ') || 'Busy'}</span></div>;
              return <td key={s.id}>{cell}</td>
            })}</tr>)}
          </tbody></table>
        </div>
        <aside className="ops-roster-side">
          <h4>Active staff shifts</h4>
          {(req.data?.staff||[]).map(s=>{
            const leave = approvedLeaves.some(l => l.staff === s.user_id || l.staff === s.id);
            const onDuty=(req.data?.hours||[]).some(h=>h.staff===s.id&&h.weekday===djangoWeekday);
            return <div className="ops-staff-shift" key={s.id}><div><strong>{s.name}</strong><span>{leave?'On leave':onDuty?'On duty':'Off duty'}</span></div><div className={`ops-toggle ${!leave&&onDuty?'on':'off'}`}/></div>
          })}
        </aside>
      </div>
    </SectionCard>
    <div className="ops-two-col" style={{marginTop:16}}>
      <SectionCard title="Weekly working hours" subtitle="Các khung giờ làm việc đang quyết định availability">
        <div className="ap-table-wrap"><table className="ap-table"><thead><tr><th>Nhân sự</th><th>Thứ</th><th>Giờ</th><th></th></tr></thead><tbody>{(req.data?.hours||[]).map(h=><tr key={h.id}><td>{h.staff_name}</td><td>{h.weekday_label}</td><td>{h.start_time.slice(0,5)} – {h.end_time.slice(0,5)}</td><td><button className="ap-btn" onClick={()=>deleteShift(h.id)}>Xóa</button></td></tr>)}{!(req.data?.hours||[]).length&&<tr><td colSpan="4"><Empty/></td></tr>}</tbody></table></div>
      </SectionCard>
      <SectionCard title="Thêm ca làm việc" subtitle="Thiết lập giờ làm theo tuần cho nhân sự">
        <form className="ap-stack" onSubmit={addShift}><div className="ap-field"><label>Nhân sự</label><select className="ap-select" required value={shift.staff} onChange={e=>setShift({...shift,staff:e.target.value})}><option value="">Chọn nhân sự</option>{(req.data?.staff||[]).map(s=><option value={s.id} key={s.id}>{s.name}</option>)}</select></div><div className="ap-field"><label>Thứ</label><select className="ap-select" value={shift.weekday} onChange={e=>setShift({...shift,weekday:Number(e.target.value)})}>{['Thứ Hai','Thứ Ba','Thứ Tư','Thứ Năm','Thứ Sáu','Thứ Bảy','Chủ Nhật'].map((d,i)=><option value={i} key={d}>{d}</option>)}</select></div><div className="ap-form-grid"><div className="ap-field"><label>Bắt đầu</label><input className="ap-input" type="time" value={shift.start_time} onChange={e=>setShift({...shift,start_time:e.target.value})}/></div><div className="ap-field"><label>Kết thúc</label><input className="ap-input" type="time" value={shift.end_time} onChange={e=>setShift({...shift,end_time:e.target.value})}/></div></div><button className="ap-btn primary">Thêm ca</button></form>
      </SectionCard>
    </div>
  </>;
}


export function StaffDirectoryPage(){
  const [refresh,setRefresh]=useState(0);
  const req = useRequest(async()=> { const [staffRes, serviceRes] = await Promise.all([api.get('/staff/'), api.get('/services/')]); return {staff:staffRes.data.results||staffRes.data||[],services:serviceRes.data.results||serviceRes.data||[]}; }, [refresh]);
  const [form,setForm]=useState({name:'',position:'',phone:'',username:'',email:'',password:'',role:'staff',service_ids:[]});
  const [error,setError]=useState('');
  const create=async(e)=>{e.preventDefault();setError('');try{await api.post('/staff/',form);setForm({name:'',position:'',phone:'',username:'',email:'',password:'',role:'staff',service_ids:[]});setRefresh(v=>v+1);}catch(err){setError(err.response?.data?.detail||Object.values(err.response?.data||{}).flat().join(' ')||'Không thể tạo nhân sự.')}};
  const toggle=async(row)=>{await api.patch(`/staff/${row.id}/`,{is_active:!row.is_active});setRefresh(v=>v+1)};
  const rows = req.data?.staff || [];
  return <>
    <PageHeader title="Danh bạ nhân sự" subtitle="Tạo tài khoản staff/bác sĩ, quản lý trạng thái làm việc và hồ sơ nhân sự."/>
    {error&&<div className="alert-box error">{error}</div>}
    <div className="ops-two-col">
      <SectionCard title="Staff directory" subtitle="Danh sách nhân sự trong hệ thống">
        <div className="ap-table-wrap"><table className="ap-table"><thead><tr><th>Tên</th><th>Vị trí</th><th>Điện thoại</th><th>Trạng thái</th><th></th></tr></thead><tbody>
          {rows.map(r=><tr key={r.id}><td><strong>{r.name}</strong></td><td>{r.position}</td><td>{r.phone || '—'}</td><td><span className={`ap-badge ${r.is_active ? 'confirmed' : 'cancelled'}`}>{r.is_active ? 'Active' : 'Inactive'}</span></td><td><button className="ap-btn" onClick={()=>toggle(r)}>{r.is_active?'Tạm ngưng':'Kích hoạt'}</button></td></tr>)}
          {!rows.length && <tr><td colSpan="5"><Empty/></td></tr>}
        </tbody></table></div>
      </SectionCard>
      <SectionCard title="Thêm nhân sự" subtitle="Tài khoản mới bắt buộc đổi mật khẩu ở lần đăng nhập đầu tiên">
        <form className="ap-stack" onSubmit={create}>
          <div className="ap-form-grid"><div className="ap-field"><label>Họ tên</label><input className="ap-input" required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></div><div className="ap-field"><label>Chức vụ</label><input className="ap-input" required value={form.position} onChange={e=>setForm({...form,position:e.target.value})}/></div></div>
          <div className="ap-form-grid"><div className="ap-field"><label>Tên đăng nhập</label><input className="ap-input" required value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/></div><div className="ap-field"><label>Vai trò</label><select className="ap-select" value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="staff">Staff</option><option value="doctor">Bác sĩ</option></select></div></div>
          <div className="ap-form-grid"><div className="ap-field"><label>Email</label><input className="ap-input" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/></div><div className="ap-field"><label>Số điện thoại</label><input className="ap-input" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})}/></div></div>
          <div className="ap-field"><label>Mật khẩu tạm</label><input className="ap-input" type="password" minLength="6" required value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/></div>
          <div className="ap-field"><label>Dịch vụ có thể thực hiện</label><div className="ops-service-checks">{(req.data?.services||[]).map(s=><label key={s.id}><input type="checkbox" checked={form.service_ids.includes(s.id)} onChange={e=>setForm({...form,service_ids:e.target.checked?[...form.service_ids,s.id]:form.service_ids.filter(id=>id!==s.id)})}/>{s.name}</label>)}</div></div>
          <button className="ap-btn primary">Tạo nhân sự</button>
        </form>
      </SectionCard>
    </div>
  </>;
}


export function AttendanceLeavePage(){
  const req = useRequest(async()=> {
    const [att, leave] = await Promise.all([api.get('/attendance/'), api.get('/leave-requests/')]);
    return {attendance: att.data.results || att.data || [], leaves: leave.data.results || leave.data || []};
  }, []);
  const approve = async(id, action)=>{ await api.post(`/leave-requests/${id}/${action}/`); window.location.reload(); };
  return <>
    <PageHeader title="Chấm công & nghỉ phép" subtitle="Theo dõi check-in/check-out và phê duyệt đơn nghỉ phép."/>
    <div className="ops-two-col">
      <SectionCard title="Attendance" subtitle="Chấm công gần đây">
        <div className="ap-table-wrap"><table className="ap-table"><thead><tr><th>Nhân sự</th><th>Ngày</th><th>Giờ vào</th><th>Giờ ra</th><th>Trạng thái</th></tr></thead><tbody>
          {(req.data?.attendance||[]).map(a=><tr key={a.id}><td>{a.staff_name}</td><td>{fmtDate(a.date)}</td><td>{a.check_in || '—'}</td><td>{a.check_out || '—'}</td><td><span className="ap-badge confirmed">{a.status}</span></td></tr>)}
          {!(req.data?.attendance||[]).length && <tr><td colSpan="5"><Empty/></td></tr>}
        </tbody></table></div>
      </SectionCard>
      <SectionCard title="Leave requests" subtitle="Đơn nghỉ phép cần xử lý">
        <div className="ap-table-wrap"><table className="ap-table"><thead><tr><th>Nhân sự</th><th>Khoảng thời gian</th><th>Loại nghỉ</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
          {(req.data?.leaves||[]).map(l=><tr key={l.id}><td>{l.staff_name}</td><td>{l.start_date} → {l.end_date}</td><td>{l.leave_type}</td><td><span className={`ap-badge ${l.status==='approved'?'completed':l.status==='rejected'?'cancelled':'pending'}`}>{l.status}</span></td><td>{l.status==='pending' ? <div className="ops-row-actions"><button className="ap-btn primary" onClick={()=>approve(l.id,'approve')}>Duyệt</button><button className="ap-btn" onClick={()=>approve(l.id,'reject')}>Từ chối</button></div> : '—'}</td></tr>)}
          {!(req.data?.leaves||[]).length && <tr><td colSpan="5"><Empty/></td></tr>}
        </tbody></table></div>
      </SectionCard>
    </div>
  </>;
}

export function PayrollPage(){
  const req = useRequest(async()=> (await api.get('/dashboard/payroll/')).data, []);
  const data = req.data || {summary:{}, rows:[]};
  return <>
    <PageHeader title="Quản lý payroll" subtitle="Tính lương sơ bộ từ ngày công, hoa hồng booking và khấu trừ đi trễ."/>
    <div className="ap-grid-4 ops-mb16">
      <MetricCard label="Payroll" value={money(data.summary.payroll)} icon={PaymentsRounded}/>
      <MetricCard label="Workdays" value={data.summary.workdays || 0} icon={CalendarMonthRounded}/>
      <MetricCard label="Nhân sự đã duyệt" value={data.summary.approved || 0} icon={BadgeRounded}/>
      <MetricCard label="Trạng thái" value="Approved" icon={CheckCircleOutlineRounded} tone="success"/>
    </div>
    <SectionCard title="Attendance & compensation" subtitle="Bảng tính lương tham khảo cho quản lý">
      <div className="ap-table-wrap"><table className="ap-table"><thead><tr><th>Nhân sự</th><th>Ngày công</th><th>Nghỉ</th><th>Lương cơ bản</th><th>Hoa hồng</th><th>Khấu trừ</th><th>Thực nhận</th><th>Trạng thái</th></tr></thead><tbody>
        {(data.rows||[]).map(r=><tr key={r.id}><td><strong>{r.name}</strong></td><td>{r.workdays}</td><td>{r.leave_days}</td><td>{money(r.base_salary)}</td><td>{money(r.commission)}</td><td>{money(r.deductions)}</td><td><strong>{money(r.net_pay)}</strong></td><td><span className={`ap-badge ${r.status==='approved'?'confirmed':'pending'}`}>{r.status}</span></td></tr>)}
        {!data.rows?.length && <tr><td colSpan="8"><Empty/></td></tr>}
      </tbody></table></div>
    </SectionCard>
  </>;
}

export function CRMPage(){
  const [refresh,setRefresh]=useState(0);
  const req = useRequest(async()=> (await api.get('/dashboard/crm/')).data, [refresh]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null); const [delta,setDelta]=useState(0);
  const rows = useMemo(()=> (req.data || []).filter(r => `${r.name} ${r.email} ${r.phone}`.toLowerCase().includes(query.toLowerCase())), [req.data, query]);
  useEffect(()=> { if (!selected && rows[0]) setSelected(rows[0]); else if(selected){const fresh=rows.find(r=>r.id===selected.id);if(fresh)setSelected(fresh);} }, [rows]);
  const adjust=async()=>{if(!selected||!delta)return;await api.post(`/dashboard/customers/${selected.id}/points/`,{delta:Number(delta)});setDelta(0);setRefresh(v=>v+1);};
  return <>
    <PageHeader title="CRM khách hàng" subtitle="Theo dõi hồ sơ khách hàng, hạng thành viên, tổng chi tiêu và điểm thưởng."/>
    <SectionCard title="Customer CRM directory" subtitle="Tìm kiếm và kiểm tra hồ sơ khách hàng">
      <div className="ops-crm-layout">
        <div>
          <div className="ops-search"><SearchRounded sx={{fontSize:18}}/><input placeholder="Tìm theo tên, email, số điện thoại..." value={query} onChange={e=>setQuery(e.target.value)} /></div>
          <div className="ap-table-wrap"><table className="ap-table"><thead><tr><th>Khách hàng</th><th>Hạng</th><th>Tổng chi tiêu</th><th>Lượt dùng</th><th></th></tr></thead><tbody>
            {rows.map(r=><tr key={r.id}><td><strong>{r.name}</strong><div className="muted">{r.phone}</div></td><td><span className="ops-tier">{r.tier}</span></td><td>{money(r.total_spending)}</td><td>{r.visits}</td><td><button className="ap-btn" onClick={()=>setSelected(r)}>Inspect</button></td></tr>)}
            {!rows.length && <tr><td colSpan="5"><Empty/></td></tr>}
          </tbody></table></div>
        </div>
        <aside className="ops-profile-panel">
          {selected ? <>
            <div className="ops-profile-top"><div className="ops-profile-avatar">{selected.name?.[0] || 'C'}</div><div><strong>{selected.name}</strong><span>{selected.email || '—'}</span></div></div>
            <div className="ops-kpi-boxes">
              <div><small>Membership</small><strong>{selected.tier}</strong></div>
              <div><small>Reward points</small><strong>{selected.loyalty_points} pts</strong></div>
              <div><small>Total spending</small><strong>{money(selected.total_spending)}</strong></div>
              <div><small>Visits</small><strong>{selected.visits}</strong></div>
            </div>
            <div className="ap-field"><label>Điều chỉnh điểm</label><div className="ops-row-actions"><input className="ap-input" type="number" value={delta} onChange={e=>setDelta(Number(e.target.value))}/><button className="ap-btn primary" type="button" onClick={adjust}>Cập nhật điểm</button></div></div>
          </> : <Empty text="Chọn một khách hàng để xem chi tiết."/>}
        </aside>
      </div>
    </SectionCard>
  </>;
}

export function VouchersPage(){
  const [refresh, setRefresh] = useState(0);
  const req = useRequest(async()=> { const res = await api.get('/vouchers/'); return res.data.results || res.data || []; }, [refresh]);
  const [form, setForm] = useState({code:'',title:'',description:'',points_cost:200,discount_value:30000,min_spend:100000,expires_at:'',is_active:true});
  const submit = async(e)=>{ e.preventDefault(); await api.post('/vouchers/', form); setForm({code:'',title:'',description:'',points_cost:200,discount_value:30000,min_spend:100000,expires_at:'',is_active:true}); setRefresh(v=>v+1); };
  const remove = async(id)=>{ await api.delete(`/vouchers/${id}/`); setRefresh(v=>v+1); };
  const rows = Array.isArray(req.data) ? req.data : [];
  return <>
    <PageHeader title="Quản lý voucher" subtitle="Tạo voucher đổi điểm thưởng, theo dõi hiệu lực và hiển thị cho khách hàng."/>
    <div className="ops-voucher-layout">
      <SectionCard title="Voucher list" subtitle="Danh sách voucher đang quản lý" className="ops-span-2">
        <div className="ap-table-wrap"><table className="ap-table"><thead><tr><th>Tiêu đề</th><th>Điểm</th><th>Giá trị</th><th>Hết hạn</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>
          {rows.map(v=><tr key={v.id}><td><strong>{v.title}</strong><div className="muted">{v.code}</div></td><td>{v.points_cost} pts</td><td>{money(v.discount_value)}</td><td>{v.expires_at || '—'}</td><td><span className={`ap-badge ${v.is_active ? 'confirmed' : 'cancelled'}`}>{v.is_active ? 'ACTIVE' : 'INACTIVE'}</span></td><td><button className="ap-btn" onClick={()=>remove(v.id)}><DeleteOutlineRounded sx={{fontSize:16}}/> Xóa</button></td></tr>)}
          {!rows.length && <tr><td colSpan="6"><Empty/></td></tr>}
        </tbody></table></div>
      </SectionCard>
      <SectionCard title="Create voucher" subtitle="Tạo nhanh voucher mới">
        <form className="ap-stack" onSubmit={submit}>
          <div className="ap-field"><label>Mã</label><input className="ap-input" required value={form.code} onChange={e=>setForm({...form, code:e.target.value})}/></div>
          <div className="ap-field"><label>Tiêu đề</label><input className="ap-input" required value={form.title} onChange={e=>setForm({...form, title:e.target.value})}/></div>
          <div className="ap-field"><label>Mô tả</label><textarea className="ap-textarea" value={form.description} onChange={e=>setForm({...form, description:e.target.value})}/></div>
          <div className="ap-form-grid">
            <div className="ap-field"><label>Điểm</label><input className="ap-input" type="number" value={form.points_cost} onChange={e=>setForm({...form, points_cost:Number(e.target.value)})}/></div>
            <div className="ap-field"><label>Giá trị giảm</label><input className="ap-input" type="number" value={form.discount_value} onChange={e=>setForm({...form, discount_value:Number(e.target.value)})}/></div>
          </div>
          <div className="ap-form-grid">
            <div className="ap-field"><label>Min spend</label><input className="ap-input" type="number" value={form.min_spend} onChange={e=>setForm({...form, min_spend:Number(e.target.value)})}/></div>
            <div className="ap-field"><label>Hết hạn</label><input className="ap-input" type="date" value={form.expires_at} onChange={e=>setForm({...form, expires_at:e.target.value})}/></div>
          </div>
          <label className="ops-check"><input type="checkbox" checked={form.is_active} onChange={e=>setForm({...form, is_active:e.target.checked})}/> Kích hoạt ngay</label>
          <button className="ap-btn primary"><AddRounded sx={{fontSize:16}}/> Thêm voucher</button>
        </form>
      </SectionCard>
    </div>
  </>;
}

export function SignupPage(){
  const { user } = useAuth();
  const [form, setForm] = useState({full_name:'', username:'', phone:'', email:'', password:''});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  if (user) return <Link to="/">Bạn đã đăng nhập.</Link>;
  const submit = async(e)=>{ e.preventDefault(); setError(''); setSuccess(''); try { await api.post('/auth/register/', form); setSuccess('Đăng ký thành công. Bây giờ bạn có thể đăng nhập.'); setForm({full_name:'', username:'', phone:'', email:'', password:''}); } catch(err) { setError(err.response?.data?.detail || 'Không thể đăng ký.'); } };
  return <div className="login-wrap"><div className="login-card"><h1>Đăng ký tài khoản</h1>{error&&<div className="alert-box error">{error}</div>}{success&&<div className="alert-box success">{success}</div>}<form onSubmit={submit}><div className="form-group"><label className="form-label">Họ tên</label><input className="ohio-input" value={form.full_name} onChange={e=>setForm({...form, full_name:e.target.value})}/></div><div className="form-group"><label className="form-label">Tên đăng nhập</label><input className="ohio-input" required value={form.username} onChange={e=>setForm({...form, username:e.target.value})}/></div><div className="form-group"><label className="form-label">Số điện thoại</label><input className="ohio-input" value={form.phone} onChange={e=>setForm({...form, phone:e.target.value})}/></div><div className="form-group"><label className="form-label">Email</label><input className="ohio-input" type="email" value={form.email} onChange={e=>setForm({...form, email:e.target.value})}/></div><div className="form-group"><label className="form-label">Mật khẩu</label><input className="ohio-input" type="password" required value={form.password} onChange={e=>setForm({...form, password:e.target.value})}/></div><button className="ohio-btn ohio-btn-primary" style={{width:'100%'}}>Tạo tài khoản</button></form><div style={{textAlign:'center',marginTop:16,fontSize:'var(--fs-sm)'}}><Link to="/login">Đã có tài khoản? Đăng nhập</Link></div></div></div>;
}


export function MyVouchersPage(){
  const {user,refreshMe}=useAuth(); const [rows,setRows]=useState([]); const [available,setAvailable]=useState([]); const [error,setError]=useState('');
  const load=async()=>{try{const [all,mine]=await Promise.all([api.get('/vouchers/'),api.get('/vouchers/mine/')]);setAvailable(all.data.results||all.data||[]);setRows(mine.data.results||mine.data||[]);}catch(e){setError('Không tải được voucher.')}};
  useEffect(()=>{load();},[]);
  const redeem=async(id)=>{try{await api.post(`/vouchers/${id}/redeem/`);await refreshMe();await load();}catch(err){setError(err.response?.data?.detail||'Không thể đổi voucher.')}};
  return <div className="customer-account"><div style={{marginBottom:22}}><h1 className="public-page-title">Voucher & điểm thưởng</h1><p className="public-page-subtitle" style={{marginBottom:0}}>Bạn đang có <strong>{user?.loyalty_points||0} điểm</strong>. Đổi voucher để sử dụng khi đặt lịch.</p></div>{error&&<div className="alert-box error">{error}</div>}<div className="ops-two-col"><SectionCard title="Voucher của tôi" subtitle="Voucher chưa sử dụng, hệ thống sẽ đề xuất khi bạn đặt lịch"><div className="ops-voucher-cards">{rows.map(v=><div className="ops-voucher-card" key={v.id}><strong>{v.title}</strong><span>{v.code}</span><div>{money(v.discount_value)} · đơn từ {money(v.min_spend)}</div></div>)}{!rows.length&&<Empty text="Bạn chưa có voucher nào."/>}</div></SectionCard><SectionCard title="Đổi thêm voucher" subtitle="Sử dụng điểm loyalty"><div className="ops-voucher-cards">{available.filter(v=>!v.redeemed&&!v.is_expired).map(v=><div className="ops-voucher-card" key={v.id}><strong>{v.title}</strong><span>{v.points_cost} điểm · giảm {money(v.discount_value)}</span><button className="ap-btn primary" disabled={(user?.loyalty_points||0)<v.points_cost} onClick={()=>redeem(v.id)}>Đổi voucher</button></div>)}{!available.filter(v=>!v.redeemed&&!v.is_expired).length&&<Empty text="Không có voucher khả dụng để đổi."/>}</div></SectionCard></div></div>;
}
