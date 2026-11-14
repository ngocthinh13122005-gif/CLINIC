import { Link } from 'react-router-dom';
import CallOutlined from '@mui/icons-material/CallOutlined';
import ForumOutlined from '@mui/icons-material/ForumOutlined';
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded';
import PlaceOutlined from '@mui/icons-material/PlaceOutlined';
import EventAvailableOutlined from '@mui/icons-material/EventAvailableOutlined';
import { PageHero } from '../components/public/PublicParts';
import { DEFAULT_HOTLINE, telHref, useClinicProfile } from '../components/public/usePublic';

const real = (v) => (v && !/^\[.*\]$/.test(String(v).trim()) ? String(v).trim() : '');

export default function ContactPage() {
  const clinic = useClinicProfile();
  const phone = clinic?.hotline || DEFAULT_HOTLINE;
  const address = real(clinic?.address); const email = real(clinic?.email);
  const items = [
    { icon: CallOutlined, t: 'Hotline tư vấn', v: <a href={telHref(phone)}>{phone}</a> },
    email && { icon: MailOutlineRounded, t: 'Email', v: <a href={`mailto:${email}`}>{email}</a> },
    { icon: PlaceOutlined, t: 'Địa chỉ', v: address || 'Địa chỉ đang được cập nhật. Vui lòng gọi hotline để được hướng dẫn.' },
  ].filter(Boolean);
  return <div className="pk-page">
    <PageHero eyebrow="Liên hệ" title={`Liên hệ AkinaClinic`} desc="Cần hỗ trợ về dịch vụ hoặc lịch hẹn? Hãy gọi cho phòng khám hoặc đặt lịch trực tuyến." crumbs={[{ label: 'Trang chủ', to: '/' }, { label: 'Liên hệ' }]}/>
    <div className="pk-wrap pk-body pk-contact">
      <div className="pk-card pk-contact-card">
        <h2>Thông tin phòng khám</h2>
        <ul className="pk-contact-list">{items.map(({ icon: Icon, t, v }) => <li key={t}><span className="pk-ico"><Icon/></span><div><small>{t}</small><div>{v}</div></div></li>)}</ul>
      </div>
      <div className="pk-card pk-contact-card">
        <h2>Bạn muốn làm gì tiếp theo?</h2>
        <div className="pk-contact-actions">
          <Link to="/book" className="pk-action"><EventAvailableOutlined/><span><strong>Đặt lịch thăm khám</strong><small>Chọn dịch vụ, bác sĩ và khung giờ còn trống.</small></span></Link>
          <Link to="/chat" className="pk-action"><ForumOutlined/><span><strong>Trao đổi với phòng khám</strong><small>Đăng nhập để nhắn tin trực tiếp với bộ phận CSKH.</small></span></Link>
        </div>
      </div>
    </div>
  </div>;
}
