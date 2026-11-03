import { Link } from 'react-router-dom';
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import PeopleAltRounded from '@mui/icons-material/PeopleAltRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Btn, Card, Empty, Loading, PageHead, Pill, fmtDate, money, useInterval, useLoad } from './ui';

export default function ClinicHome() {
  const { user } = useAuth();
  const { data: d, error, reload } = useLoad(async () => (await api.get('/clinic/dashboard/')).data, []);
  useInterval(() => reload(true), 30000);
  const hour = new Date().getHours();
  const hello = hour < 11 ? 'Chào buổi sáng' : hour < 14 ? 'Chào buổi trưa' : hour < 18 ? 'Chào buổi chiều' : 'Chào buổi tối';
  const name = user.first_name || user.full_name || user.username;
  const clinical = ['doctor', 'manager'].includes(user.role);
  const billing = ['manager', 'consultant'].includes(user.role);
  const fin = useLoad(async () => (billing ? (await api.get('/clinic/invoices/summary/')).data : null), [billing]).data;
  if (!d) return error ? <div className="cl-alert error">{error}</div> : <Loading />;
  const max = Math.max(1, ...d.top_diagnoses.map((x) => x.n));
  return <>
    <PageHead title={`${hello}, ${name}`} subtitle="Tình hình phòng khám hôm nay."
      actions={['consultant', 'manager', 'doctor'].includes(user.role) && <Link className="cl-btn primary" to="/tiep-don"><AddRounded />Đi tới tiếp đón</Link>} />
    <div className="cl-stat-row">
      <div className="cl-stat teal"><span>Lượt khám hôm nay</span><strong>{d.today.total}</strong><small>{d.today.completed} đã hoàn tất</small></div>
      <div className="cl-stat amber"><span>Đang chờ ở sảnh</span><strong>{d.today.waiting}</strong><small>{d.today.in_consult} đang tư vấn / khám</small></div>
      <div className="cl-stat blue"><span>Lịch hẹn hôm nay</span><strong>{d.appointments_today}</strong><small>Chờ vào trung bình {d.today.avg_wait_minutes} phút</small></div>
      <div className="cl-stat green"><span>Bệnh nhân mới tháng này</span><strong>{d.new_patients_month}</strong><small>Tổng {d.total_patients} hồ sơ</small></div>
    </div>
    {fin && <div className="cl-stat-row">
      <div className="cl-stat teal"><span>Thu hôm nay</span><strong>{money(fin.today_revenue)}</strong><small>{fin.today_invoices} hóa đơn</small></div>
      <div className="cl-stat amber"><span>Công nợ phải thu</span><strong>{money(fin.debt_total)}</strong><small>{fin.debt_count} hóa đơn chưa thu đủ</small></div>
      {fin.month_revenue != null && <div className="cl-stat green"><span>Doanh thu tháng</span><strong>{money(fin.month_revenue)}</strong><small>Tiền đã thu</small></div>}
      {fin.low_stock != null && <div className="cl-stat blue"><span>Thuốc sắp hết</span><strong>{fin.low_stock}</strong><small><Link to="/kho-thuoc">Xem kho thuốc →</Link></small></div>}
    </div>}
    <div className="cl-grid-2">
      <Card title="Lượt khám 14 ngày gần đây" subtitle="Không tính lượt đã hủy">
        <div className="cl-chart"><ResponsiveContainer width="100%" height={260}>
          <AreaChart data={d.visits_14d} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <defs><linearGradient id="clg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#526d80" stopOpacity={0.28} /><stop offset="100%" stopColor="#526d80" stopOpacity={0.02} /></linearGradient></defs>
            <CartesianGrid vertical={false} stroke="#e8eef3" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6b7c8d' }} interval={1} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} tick={{ fontSize: 12, fill: '#6b7c8d' }} />
            <Tooltip formatter={(v) => [`${v} lượt`, 'Khám']} labelStyle={{ color: '#10253a' }} />
            <Area type="monotone" dataKey="count" stroke="#526d80" strokeWidth={2.5} fill="url(#clg)" />
          </AreaChart></ResponsiveContainer></div>
      </Card>
      <Card title="Cần xử lý">
        <ul className="cl-todo">
          <li><span>Bệnh nhân đang chờ ở sảnh</span><b className={d.today.waiting ? 'hot' : ''}>{d.today.waiting}</b></li>
          {clinical && <li><span>Bệnh án chưa ký</span><b className={d.unsigned_records ? 'hot' : ''}>{d.unsigned_records}</b></li>}
          <li><span>Liệu trình đang thực hiện</span><b>{d.active_plans}</b></li>
          <li><span>Buổi liệu trình đến hạn (3 ngày)</span><b className={d.sessions_due.length ? 'hot' : ''}>{d.sessions_due.length}</b></li>
        </ul>
      </Card>
    </div>
    <div className="cl-grid-2">
      <Card title="Buổi liệu trình sắp đến hạn" subtitle="Nhắc bệnh nhân quay lại đúng lịch">
        {d.sessions_due.length ? d.sessions_due.map((s) => <Link className="cl-li link" to={`/benh-nhan/${s.patient_id}`} key={s.id}>
          <span><strong>{s.patient}</strong><small>{s.plan} · buổi {s.number}</small></span>
          <Pill tone={s.overdue ? 'red' : 'amber'}>{s.overdue ? 'Quá hạn ' : ''}{fmtDate(s.date)}</Pill></Link>) : <Empty title="Không có buổi nào đến hạn" />}
      </Card>
      {clinical ? <Card title="Chẩn đoán thường gặp" subtitle="30 ngày gần đây, từ bệnh án đã ký">
        {d.top_diagnoses.length ? d.top_diagnoses.map((x) => <div className="cl-bar" key={x.diagnosis_name}>
          <span><b>{x.diagnosis_code}</b> {x.diagnosis_name}</span><div><i style={{ width: `${(x.n / max) * 100}%` }} /></div><em>{x.n}</em></div>) : <Empty title="Chưa có dữ liệu" hint="Xuất hiện khi bác sĩ ký bệnh án." />}
      </Card> : <Card title="Lối tắt"><div className="cl-shortcuts">
        <Link to="/tiep-don"><PeopleAltRounded />Tiếp đón hôm nay</Link><Link to="/benh-nhan">Danh sách bệnh nhân</Link><Link to="/lich-hen">Lịch hẹn</Link><Link to="/lieu-trinh">Liệu trình</Link></div></Card>}
    </div>
  </>;
}
