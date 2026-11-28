import { useState } from 'react';
import { Link } from 'react-router-dom';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import { useAuth } from '../../context/AuthContext';
import { BOOKING_PILL, Card, PageTitle, Pill, dateTimeText, money, useApi } from './portalKit';

export default function PortalDashboard() {
  const { user } = useAuth();
  const bookings = useApi('/bookings/');
  const portal = useApi('/clinic/my-portal/');
  const billing = useApi('/clinic/my-portal/billing/');
  const forms = useApi('/clinic/my-portal/forms/');
  const [hideAlert, setHideAlert] = useState(false);

  const rows = (bookings.data?.results || bookings.data || []);
  const now = Date.now();
  const upcoming = rows.filter((b) => ['pending', 'confirmed', 'checked_in', 'in_progress'].includes(b.status) && new Date(b.appointment) >= now - 3600e3)
    .sort((a, b) => new Date(a.appointment) - new Date(b.appointment));
  const next = upcoming[0];
  const activity = [...rows].sort((a, b) => new Date(b.appointment) - new Date(a.appointment)).slice(0, 5);
  const plans = (portal.data?.plans || []).filter((p) => p.status === 'active');
  const remaining = plans.reduce((n, p) => n + Math.max((p.total_sessions || 0) - (p.done_sessions || 0), 0), 0);
  const outstanding = billing.data?.outstanding || 0;
  const pendingForms = (forms.data?.forms || []).filter((f) => f.status === 'pending').length;
  const pendingBookings = rows.filter((b) => b.status === 'pending' && new Date(b.appointment) >= now).length;
  const alerts = [
    outstanding > 0 && { text: `Số dư còn nợ ${money(outstanding)} trên ${billing.data.due_count} hóa đơn`, to: '/thanh-toan', cta: 'Xem hóa đơn' },
    pendingForms > 0 && { text: `${pendingForms} phiếu cam kết đang chờ ký`, to: '/bieu-mau', cta: 'Xem phiếu' },
    pendingBookings > 0 && { text: `${pendingBookings} lịch hẹn đang chờ phòng khám xác nhận`, to: '/bookings', cta: 'Xem lịch hẹn' },
  ].filter(Boolean);
  const first = (user?.full_name || user?.username || '').trim().split(/\s+/).slice(-1)[0];

  return <>
    <PageTitle title="Chào mừng đến cổng bệnh nhân" sub={`Xin chào ${first || 'bạn'} — mọi thông tin của bạn tại AkinaClinic ở đây.`}/>
    {[[bookings, 'lịch hẹn'], [portal, 'hồ sơ'], [billing, 'thanh toán'], [forms, 'phiếu cam kết']].map(([resource, label]) => resource.error && <div className="cp-error" role="alert" key={label}>Không tải được {label}. {resource.error} <button type="button" onClick={resource.reload}>Thử lại</button></div>)}
    {portal.data && !portal.data.patient_linked && <div className="cp-note">Tài khoản chưa được liên kết với hồ sơ bệnh nhân. <Link to="/chat">Liên hệ phòng khám</Link> để xác minh và liên kết hồ sơ.</div>}
    {alerts.length > 0 && !hideAlert && <div className="cp-alert" role="status">
      <span className="cp-alert-ic"><ErrorOutlineRounded/></span>
      <div><strong>Cần xử lý</strong><ul>{alerts.map((a) => <li key={a.to}><span>{a.text}</span><Link to={a.to}>{a.cta} <ArrowForwardRounded/></Link></li>)}</ul></div>
      <button type="button" onClick={() => setHideAlert(true)} aria-label="Ẩn thông báo"><CloseRounded/></button>
    </div>}
    <div className="cp-grid2">
      <Card title="Lịch hẹn sắp tới" action={<Link className="cp-link-sm" to="/bookings">XEM TẤT CẢ</Link>}>
        {bookings.loading ? <p className="cp-muted">Đang tải…</p> : next ? <div className="cp-next">
          <div className="cp-next-top"><span className="cp-av lg">{(next.staff_name || 'A').slice(0, 1)}</span><div><strong>{next.staff_name || 'Chưa phân công bác sĩ'}</strong><small>Bác sĩ / chuyên viên</small></div></div>
          <dl><div><dt>Dịch vụ</dt><dd>{next.items?.map((i) => i.service_name).join(', ') || next.appointment_type_label || 'Khám / tư vấn'}</dd></div>
            <div><dt>Thời gian</dt><dd>{dateTimeText(next.appointment)}</dd></div></dl>
          <Pill kind={BOOKING_PILL[next.status]?.[0]}>{BOOKING_PILL[next.status]?.[1] || next.status_label}</Pill>
        </div> : <div className="cp-empty-sm"><p>Bạn chưa có lịch hẹn sắp tới.</p><Link className="cp-btn primary" to="/book">Đặt lịch ngay</Link></div>}
      </Card>
      <Card title="Tóm tắt tài khoản">
        <div className="cp-stats">
          <div><small>Buổi liệu trình còn lại</small><b>{portal.loading ? '…' : portal.error ? '—' : remaining}</b></div>
          <div><small>Còn nợ</small><b className={outstanding ? 'warn' : ''}>{billing.loading ? '…' : billing.error ? '—' : money(outstanding)}</b></div>
          <div><small>Phiếu chờ ký</small><b>{forms.loading ? '…' : forms.error ? '—' : pendingForms}</b></div>
        </div>
      </Card>
    </div>
    <Card title="Hoạt động gần đây" action={<Link className="cp-link-sm" to="/bookings">XEM TẤT CẢ</Link>} flush>
      {activity.length ? <ul className="cp-activity">{activity.map((b) => {
        const [k, l] = BOOKING_PILL[b.status] || ['done', b.status_label];
        return <li key={b.id}><span className="cp-av">{(b.items?.[0]?.service_name || 'A').slice(0, 1)}</span>
          <div><strong>{b.items?.map((i) => i.service_name).join(', ') || b.appointment_type_label || 'Khám / tư vấn'}</strong><small>{b.staff_name ? `${b.staff_name} · ` : ''}{dateTimeText(b.appointment)}</small></div><Pill kind={k}>{l}</Pill></li>;
      })}</ul> : <p className="cp-muted pad">{bookings.loading ? 'Đang tải…' : 'Chưa có hoạt động nào.'}</p>}
    </Card>
  </>;
}
