import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import EventAvailableRounded from '@mui/icons-material/EventAvailableRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import MedicalInformationRounded from '@mui/icons-material/MedicalInformationRounded';
import MedicationRounded from '@mui/icons-material/MedicationRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import SpaRounded from '@mui/icons-material/SpaRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import '../styles/patient-portal.css';

const TABS = [
  { id: 'visits', label: 'Lịch sử khám' },
  { id: 'care', label: 'Chăm sóc' },
  { id: 'plans', label: 'Liệu trình' },
  { id: 'prescriptions', label: 'Đơn thuốc' },
];

const dateText = (value) => value
  ? new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: 'long', year: 'numeric' })
  : 'Chưa cập nhật';
const dateTimeText = (value) => value
  ? new Date(value).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : 'Chưa cập nhật';

export default function PatientPortalPage() {
  const { user } = useAuth();
  const [portal, setPortal] = useState(null);
  const [tab, setTab] = useState('visits');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api.get('/clinic/my-portal/')
      .then(({ data }) => { if (active) setPortal(data); })
      .catch((err) => {
        if (active) setError(err.response?.data?.detail || 'Không thể tải hồ sơ sức khỏe. Vui lòng thử lại.');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [refreshKey]);

  const retry = () => setRefreshKey((key) => key + 1);
  const data = portal || { visits: [], care_instructions: [], plans: [], prescriptions: [] };

  return <div className="customer-account patient-portal">
    <section className="pp-hero">
      <div className="pp-hero-content">
        <span className="pp-eyebrow"><MedicalInformationRounded/> CỔNG HỒ SƠ BỆNH NHÂN</span>
        <h1>Hồ sơ sức khỏe của bạn</h1>
        <p>Xin chào <strong>{portal?.patient_name || user?.full_name || user?.username}</strong>. Theo dõi lịch sử khám, hướng dẫn chăm sóc và kế hoạch điều trị tại AkinaClinic.</p>
        <Link to="/book" className="pp-book-link">Đặt lịch khám mới <span aria-hidden="true">→</span></Link>
      </div>
      <div className="pp-hero-mark" aria-hidden="true"><MedicalInformationRounded/></div>
    </section>

    {error && <div className="pp-alert error" role="alert"><span>{error}</span><button type="button" onClick={retry}><RefreshRounded/>Thử lại</button></div>}

    {!loading && !error && !portal?.patient_linked && <section className="pp-link-notice">
      <span className="pp-notice-icon"><InfoOutlined/></span>
      <div><h2>Hồ sơ chưa được liên kết</h2><p>Tài khoản này chưa được phòng khám liên kết với hồ sơ bệnh nhân, nên lịch sử khám và thông tin điều trị chưa thể hiển thị. Vui lòng liên hệ AkinaClinic để xác minh và liên kết hồ sơ an toàn.</p>
        <Link to="/chat" className="pp-contact-link">Liên hệ phòng khám <span aria-hidden="true">→</span></Link>
      </div>
    </section>}

    {portal?.patient_linked && <>
      <section className="pp-records">
        <div className="pp-section-heading">
          <div><span className="pp-section-kicker">HỒ SƠ CÁ NHÂN</span><h2>Thông tin điều trị</h2><p>Dữ liệu chỉ dành cho tài khoản bệnh nhân đã được liên kết.</p></div>
          <button type="button" className="pp-refresh" onClick={retry} disabled={loading}><RefreshRounded/>Làm mới</button>
        </div>
        <div className="pp-tabs" role="tablist" aria-label="Các mục hồ sơ sức khỏe">
          {TABS.map(({ id, label }) => (
            <button type="button" role="tab" aria-selected={tab === id} aria-controls={`pp-panel-${id}`} id={`pp-tab-${id}`} key={id}
              className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
              <span>{label}</span><b>{data[id === 'care' ? 'care_instructions' : id]?.length || 0}</b>
            </button>
          ))}
        </div>
        <div className="pp-panel" role="tabpanel" id={`pp-panel-${tab}`} aria-labelledby={`pp-tab-${tab}`}>
          {loading ? <div className="pp-loading"><i/>Đang tải hồ sơ của bạn…</div> : (
            <>
              {tab === 'visits' && <VisitList rows={data.visits}/>}
              {tab === 'care' && <CareList rows={data.care_instructions}/>}
              {tab === 'plans' && <PlanList rows={data.plans}/>}
              {tab === 'prescriptions' && <PrescriptionList rows={data.prescriptions}/>}
            </>
          )}
        </div>
      </section>
      <p className="pp-privacy-note"><InfoOutlined/> Thông tin trên cổng bệnh nhân nhằm giúp bạn theo dõi hồ sơ đã được phòng khám cập nhật; vui lòng liên hệ bác sĩ khi cần giải thích chuyên môn.</p>
    </>}
  </div>;
}

function VisitList({ rows }) {
  if (!rows.length) return <EmptyState title="Chưa có lượt khám hoàn thành" text="Lịch sử khám sẽ xuất hiện tại đây sau khi lượt khám được hoàn tất." icon={CalendarMonthRounded}/>;
  return <div className="pp-list">{rows.map((visit) => (
    <article className="pp-card pp-visit-card" key={visit.id}>
      <span className="pp-card-icon"><CalendarMonthRounded/></span>
      <div className="pp-card-main">
        <div className="pp-card-top"><div><span className="pp-date">{dateTimeText(visit.date)}</span><h3>{visit.diagnosis || visit.reason || visit.visit_type}</h3></div><span className="pp-status"><CheckCircleRounded/>Hoàn thành</span></div>
        <div className="pp-meta"><span>{visit.visit_type}</span>{visit.doctor_name && <span>Bác sĩ {visit.doctor_name}</span>}{visit.diagnosis_code && <span>Mã ICD-10: {visit.diagnosis_code}</span>}</div>
        {visit.reason && visit.diagnosis && <p className="pp-detail"><strong>Lý do khám:</strong> {visit.reason}</p>}
        <Link className="pp-book-link" to={`/book?appointment_type=follow_up&follow_up_visit_id=${visit.id}`}>Đặt lịch tái khám lượt này <span aria-hidden="true">→</span></Link>
      </div>
    </article>
  ))}</div>;
}

function CareList({ rows }) {
  if (!rows.length) return <EmptyState title="Chưa có hướng dẫn chăm sóc" text="Hướng dẫn do bác sĩ cập nhật sau buổi khám sẽ được lưu tại đây." icon={SpaRounded}/>;
  return <div className="pp-list">{rows.map((row) => (
    <article className="pp-card pp-care-card" key={row.id}>
      <div className="pp-card-top"><div><span className="pp-date">{dateText(row.date)}{row.doctor_name ? ` · BS. ${row.doctor_name}` : ''}</span><h3>{row.diagnosis || 'Hướng dẫn sau khám'}</h3></div><span className="pp-soft-icon"><SpaRounded/></span></div>
      {row.treatment_direction && <div className="pp-care-block"><strong>Hướng điều trị</strong><p>{row.treatment_direction}</p></div>}
      {row.advice && <div className="pp-care-block"><strong>Dặn dò của bác sĩ</strong><p>{row.advice}</p></div>}
      {row.follow_up_date && <div className="pp-follow-up"><EventAvailableRounded/>Tái khám dự kiến: <strong>{dateText(row.follow_up_date)}</strong></div>}
    </article>
  ))}</div>;
}

function PlanList({ rows }) {
  if (!rows.length) return <EmptyState title="Chưa có liệu trình điều trị" text="Các liệu trình được phòng khám xác nhận sẽ xuất hiện ở đây cùng tiến độ từng buổi." icon={EventAvailableRounded}/>;
  return <div className="pp-list">{rows.map((plan) => {
    const progress = plan.total_sessions ? Math.round((plan.done_sessions / plan.total_sessions) * 100) : 0;
    return <article className="pp-card pp-plan-card" key={plan.id}>
      <div className="pp-card-top"><div><span className="pp-date">{plan.start_date ? `Bắt đầu ${dateText(plan.start_date)}` : 'Chưa lên lịch bắt đầu'}</span><h3>{plan.title}</h3></div><span className={`pp-plan-status ${plan.status}`}>{plan.status_label}</span></div>
      <div className="pp-meta">{plan.service_name && <span>{plan.service_name}</span>}{plan.doctor_name && <span>Bác sĩ {plan.doctor_name}</span>}{plan.total_sessions > 0 && <span>{plan.done_sessions}/{plan.total_sessions} buổi</span>}</div>
      {plan.diagnosis && <p className="pp-detail"><strong>Chẩn đoán:</strong> {plan.diagnosis}</p>}
      {plan.content && <p className="pp-detail">{plan.content}</p>}
      {plan.total_sessions > 0 && <div className="pp-progress"><div><span>Tiến độ liệu trình</span><strong>{progress}%</strong></div><span className="pp-progress-track"><i style={{ width: `${progress}%` }}/></span></div>}
      {plan.sessions.length > 0 && <ol className="pp-session-list">{plan.sessions.map((session) => <li key={session.id || session.number} className={session.status === 'done' ? 'done' : ''}>
        <span className="pp-session-dot">{session.status === 'done' ? <CheckCircleRounded/> : session.number}</span>
        <div><strong>Buổi {session.number}</strong><span>{session.status === 'done' ? `Đã thực hiện${session.performed_at ? ` · ${dateTimeText(session.performed_at)}` : ''}` : session.status === 'skipped' ? 'Đã bỏ qua' : session.booking ? `${session.booking.status_label} · ${dateTimeText(session.booking.appointment)}${session.booking.staff_name ? ` · ${session.booking.staff_name}` : ''}` : `Dự kiến ${dateText(session.planned_date)}`}</span>{session.status === 'pending' && <small>{session.allow_staff_delegation ? 'Bác sĩ phụ trách cho phép bố trí nhân sự đủ điều kiện.' : `Bác sĩ phụ trách${plan.doctor_name ? ` ${plan.doctor_name}` : ''} trực tiếp thực hiện.`}</small>}{session.content && <p>{session.content}</p>}{session.bookable && <Link className="pp-book-link" to={`/book?appointment_type=session&treatment_session_id=${session.id}`}>Đặt buổi này <span aria-hidden="true">→</span></Link>}</div>
      </li>)}</ol>}
    </article>;
  })}</div>;
}

function PrescriptionList({ rows }) {
  if (!rows.length) return <EmptyState title="Chưa có đơn thuốc được duyệt" text="Đơn thuốc do bác sĩ kê sẽ được lưu tại đây để bạn tiện theo dõi." icon={MedicationRounded}/>;
  return <div className="pp-list">{rows.map((prescription) => (
    <article className="pp-card pp-rx-card" key={prescription.id}>
      <div className="pp-card-top"><div><span className="pp-date">Đơn {prescription.code} · {dateTimeText(prescription.issued_at)}</span><h3>{prescription.diagnosis || 'Đơn thuốc sau khám'}</h3></div><span className="pp-status"><CheckCircleRounded/>Đã kê</span></div>
      {prescription.doctor_name && <p className="pp-doctor">Bác sĩ kê đơn: <strong>{prescription.doctor_name}</strong></p>}
      <div className="pp-medicine-list">{prescription.items.map((item, index) => <div className="pp-medicine" key={`${item.medicine_name}-${index}`}>
        <span className="pp-medicine-icon"><MedicationRounded/></span><div><strong>{item.medicine_name}{item.strength ? ` · ${item.strength}` : ''}</strong><span>{item.dosage || 'Liều dùng theo chỉ định'}{item.usage ? ` · ${item.usage}` : ''}</span><small>{item.days ? `${item.days} ngày` : ''}{item.quantity ? `${item.days ? ' · ' : ''}${item.quantity} ${item.unit || 'đơn vị'}` : ''}</small></div>
      </div>)}</div>
      {prescription.advice && <div className="pp-rx-advice"><strong>Lời dặn</strong><p>{prescription.advice}</p></div>}
    </article>
  ))}</div>;
}

function EmptyState({ title, text, icon: Icon }) {
  return <div className="pp-empty"><span><Icon/></span><h3>{title}</h3><p>{text}</p></div>;
}
