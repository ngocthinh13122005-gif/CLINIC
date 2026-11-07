import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Card, Empty, Loading, Pill, fmtDate, fmtTime, isoDay, money, useInterval, useLoad } from './ui';

export default function ClinicHome() {
  const { user } = useAuth();
  const { data: d, error, reload } = useLoad(async () => (await api.get('/clinic/dashboard/')).data, []);
  useInterval(() => reload(true), 30000);
  const hour = new Date().getHours();
  const hello = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const name = user.first_name || user.full_name || user.username;
  const role = user?.role;
  const clinical = ['doctor', 'manager'].includes(role);
  const billing = ['manager', 'consultant'].includes(user.role);
  const canSeeTasks = ['manager', 'doctor', 'consultant'].includes(role);
  const [mySchedule, setMySchedule] = useState(['doctor', 'staff'].includes(role));
  const today = isoDay();
  const schedule = useLoad(async () => {
    const { data } = await api.get('/bookings/', { params: { from: today, to: today } });
    return (data.results || data).filter((booking) => !['cancelled', 'no_show'].includes(booking.status))
      .sort((a, b) => new Date(a.appointment) - new Date(b.appointment));
  }, [today]);
  const staff = useLoad(async () => (await api.get('/staff/')).data, []);
  const currentStaff = (staff.data?.results || staff.data || []).find((member) => String(member.user_id) === String(user.id));
  const todaysBookings = useMemo(() => {
    const rows = schedule.data || [];
    return mySchedule ? (currentStaff ? rows.filter((booking) => String(booking.staff) === String(currentStaff.id)) : []) : rows;
  }, [schedule.data, mySchedule, currentStaff]);
  const tasks = useLoad(async () => {
    if (!canSeeTasks) return [];
    return (await api.get('/clinic/care-tasks/', { params: { status: 'pending', mine: '1' } })).data;
  }, [canSeeTasks]);
  const fin = useLoad(async () => (billing ? (await api.get('/clinic/invoices/summary/')).data : null), [billing]).data;
  if (!d) return error ? <div className="cl-alert error">{error}</div> : <Loading />;
  const max = Math.max(1, ...d.top_diagnoses.map((x) => x.n));
  const roleHeading = ({ manager: 'Điều hành phòng khám', doctor: 'Khu vực chuyên môn', consultant: 'Bàn làm việc tiếp đón', staff: 'Lịch công việc của bạn' })[role] || 'Không gian làm việc';
  return <>
    <section className="cl-home-hero">
      <div><span className="cl-home-eyebrow">{roleHeading}</span><h2>{hello}, {name}</h2><p>{new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · Các việc cần ưu tiên trong ngày.</p></div>
      <div className="cl-home-hero-actions"><Link to="/benh-nhan">Bệnh nhân</Link>{clinical && <Link to="/lieu-trinh">Liệu trình</Link>}{role === 'manager' && <Link to="/bao-cao">Báo cáo</Link>}</div>
    </section>
    <section className="cl-home-workspace">
      <Card title="Lịch hôm nay" subtitle={`${todaysBookings.length} lịch hẹn · ${new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long' })}`}
        className="cl-home-work-card" action={<div className="cl-home-segment" aria-label="Phạm vi lịch hôm nay">
          <button type="button" className={!mySchedule ? 'active' : ''} onClick={() => setMySchedule(false)}>Toàn phòng khám</button>
          <button type="button" className={mySchedule ? 'active' : ''} onClick={() => setMySchedule(true)}>Lịch của tôi</button>
        </div>}>
        {schedule.loading && !schedule.data ? <Loading text="Đang tải lịch hẹn…" /> : schedule.error ? <div className="cl-home-inline-error"><span>{schedule.error}</span><button type="button" onClick={() => schedule.reload()}>Thử lại</button></div> : todaysBookings.length ? <div className="cl-home-agenda">
          {todaysBookings.slice(0, 6).map((booking) => <Link to="/lich-hen" className="cl-home-agenda-row" key={booking.id}>
            <span className="cl-home-agenda-time">{fmtTime(booking.appointment)}</span>
            <span className="cl-home-agenda-copy"><strong>{booking.customer_name || booking.guest_name || 'Khách hàng'}</strong><small>{booking.appointment_type_label || 'Lịch hẹn'}{booking.staff_name ? ` · ${booking.staff_name}` : ''}</small></span>
            <Pill tone={{ pending: 'amber', confirmed: 'blue', checked_in: 'teal', in_progress: 'blue', completed: 'green' }[booking.status] || 'neutral'}>{booking.status_label || 'Đã đặt'}</Pill>
          </Link>)}
          <Link className="cl-home-view-all" to="/lich-hen">Mở lịch hẹn</Link>
        </div> : <Empty title={mySchedule && !currentStaff ? 'Chưa liên kết hồ sơ nhân sự' : 'Hôm nay chưa có lịch hẹn'} hint={mySchedule && !currentStaff ? 'Chọn “Toàn phòng khám” hoặc liên hệ quản trị để liên kết tài khoản với hồ sơ nhân sự.' : 'Lịch hẹn mới sẽ xuất hiện tại đây.'} />}
      </Card>
      {canSeeTasks && <Card title="Việc cần làm" subtitle="Các việc chăm sóc đang chờ xử lý" className="cl-home-work-card" action={<Link className="cl-home-view-all head" to="/cham-soc">Xem tất cả</Link>}>
        {tasks.loading && !tasks.data ? <Loading text="Đang tải công việc…" /> : tasks.error ? <div className="cl-home-inline-error"><span>{tasks.error}</span><button type="button" onClick={() => tasks.reload()}>Thử lại</button></div> : tasks.data?.length ? <div className="cl-home-task-list">
          {tasks.data.slice(0, 5).map((task) => <Link to="/cham-soc" className="cl-home-task-row" key={task.id}>
            <span className={`cl-home-task-mark ${task.priority === 'urgent' ? 'urgent' : ''}`} />
            <span className="cl-home-task-copy"><strong>{task.title || task.patient_name}</strong><small>{task.patient_name}{task.due_date ? ` · Hạn ${fmtDate(task.due_date)}` : ''}</small></span>
            <Pill tone={task.priority === 'urgent' ? 'red' : task.overdue ? 'amber' : 'neutral'}>{task.priority_label || (task.overdue ? 'Quá hạn' : 'Chờ xử lý')}</Pill>
          </Link>)}
        </div> : <Empty title="Không có việc đang chờ" hint="Các việc chăm sóc mới sẽ được hiển thị tại đây." />}
      </Card>}
    </section>
    <div className={`cl-home-stats ${role}`}>
      {role === 'manager' && <>
        <div><span>Lịch hẹn hôm nay</span><strong>{d.appointments_today}</strong><small>{d.new_patients_month} hồ sơ mới tháng này</small></div>
        <div><span>Lượt khám đang chờ</span><strong>{d.today.waiting}</strong><small>{d.today.in_consult} lượt đang khám</small></div>
        <div><span>Liệu trình đang mở</span><strong>{d.active_plans}</strong><small>{d.sessions_due.length} buổi đến hạn trong 3 ngày</small></div>
        <div><span>Thu đã ghi nhận hôm nay</span><strong>{fin ? money(fin.today_revenue) : '—'}</strong><small>{fin ? `${fin.today_invoices} hóa đơn` : 'Không tải được số liệu thu'}</small></div>
      </>}
      {role === 'doctor' && <>
        <div><span>Lượt khám hôm nay</span><strong>{d.today.total}</strong><small>{d.today.completed} lượt đã hoàn tất</small></div>
        <div><span>Bệnh án cần ký</span><strong>{d.unsigned_records}</strong><small>Chỉ tính hồ sơ trong phạm vi của bạn</small></div>
        <div><span>Buổi liệu trình sắp đến</span><strong>{d.sessions_due.length}</strong><small>Trong 3 ngày tới</small></div>
      </>}
      {role === 'consultant' && <>
        <div><span>Lịch hẹn hôm nay</span><strong>{d.appointments_today}</strong><small>Toàn phòng khám</small></div>
        <div><span>Khách đang chờ</span><strong>{d.today.waiting}</strong><small>{d.today.in_consult} đang được phục vụ</small></div>
        <div><span>Thời gian chờ trung bình</span><strong>{d.today.avg_wait_minutes} phút</strong><small>Tính trên lượt đã được mời</small></div>
      </>}
      {role === 'staff' && <>
        <div><span>Lịch hẹn được phân công</span><strong>{d.appointments_today}</strong><small>Trong ngày hôm nay</small></div>
        <div><span>Lượt đã tiếp nhận</span><strong>{d.today.total}</strong><small>Theo phân công của bạn</small></div>
      </>}
    </div>
    {role === 'manager' && fin && <div className="cl-home-finance"><span>Đối soát nhanh</span><Link to="/thu-ngan">Công nợ {money(fin.debt_total)} · {fin.debt_count} hóa đơn cần theo dõi</Link>{fin.month_revenue != null && <small>Đã thu tháng này: {money(fin.month_revenue)}</small>}</div>}
    <div className="cl-grid-2">
      <Card title={role === 'doctor' ? 'Lượt khám của bạn · 14 ngày' : 'Hoạt động khám · 14 ngày'} subtitle="Không tính lượt đã hủy">
        <div className="cl-chart"><ResponsiveContainer width="100%" height={260}>
          <AreaChart data={d.visits_14d} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <defs><linearGradient id="clg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#24bee1" stopOpacity={0.24} /><stop offset="100%" stopColor="#24bee1" stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#e8eef3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6b7c8d' }} interval={1} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6b7c8d' }} />
            <Tooltip formatter={(v) => [`${v} lượt`, 'Khám']} labelStyle={{ color: '#10253a' }} />
            <Area type="monotone" dataKey="count" stroke="#159bc1" strokeWidth={2.5} fill="url(#clg)" />
          </AreaChart></ResponsiveContainer></div>
      </Card>
      <Card title="Cần xử lý">
        <ul className="cl-todo">
          {role !== 'staff' && <li><span>Bệnh nhân đang chờ ở sảnh</span><b className={d.today.waiting ? 'hot' : ''}>{d.today.waiting}</b></li>}
          {clinical && <li><span>Bệnh án chưa ký</span><b className={d.unsigned_records ? 'hot' : ''}>{d.unsigned_records}</b></li>}
          {clinical && <li><span>Liệu trình đang thực hiện</span><b>{d.active_plans}</b></li>}
          {clinical && <li><span>Buổi liệu trình đến hạn (3 ngày)</span><b className={d.sessions_due.length ? 'hot' : ''}>{d.sessions_due.length}</b></li>}
        </ul>
      </Card>
    </div>
    <div className="cl-grid-2">
      {clinical && <Card title="Buổi liệu trình sắp đến hạn" subtitle="Đối chiếu lịch hẹn trước khi liên hệ khách hàng">
        {d.sessions_due.length ? d.sessions_due.map((s) => <Link className="cl-li link" to={`/benh-nhan/${s.patient_id}`} key={s.id}>
          <span><strong>{s.patient}</strong><small>{s.plan} · buổi {s.number}</small></span>
          <Pill tone={s.overdue ? 'red' : 'amber'}>{s.overdue ? 'Quá hạn ' : ''}{fmtDate(s.date)}</Pill></Link>) : <Empty title="Không có buổi nào đến hạn" />}
      </Card>}
      {clinical ? <Card title="Chẩn đoán thường gặp" subtitle="30 ngày gần đây, từ bệnh án đã ký">
        {d.top_diagnoses.length ? d.top_diagnoses.map((x) => <div className="cl-bar" key={x.diagnosis_name}>
          <span><b>{x.diagnosis_code}</b> {x.diagnosis_name}</span><div><i style={{ width: `${(x.n / max) * 100}%` }} /></div><em>{x.n}</em></div>) : <Empty title="Chưa có dữ liệu" hint="Xuất hiện khi bác sĩ ký bệnh án." />}
      </Card> : <Card title="Lối tắt"><div className="cl-shortcuts">
        {role === 'consultant' && <Link to="/tiep-don">Tiếp đón hôm nay</Link>}<Link to="/benh-nhan">Danh sách bệnh nhân</Link><Link to="/lich-hen">Lịch hẹn</Link>{clinical && <Link to="/lieu-trinh">Liệu trình</Link>}</div></Card>}
    </div>
  </>;
}
