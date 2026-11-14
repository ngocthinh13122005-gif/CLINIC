import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded';
import MedicalServicesOutlined from '@mui/icons-material/MedicalServicesOutlined';
import api from '../api/client';
import { BOOKING_POLICY, bookLabel, bookLink, money, useDoctors } from '../components/public/usePublic';
import { DoctorCard, PageHero, Photo, Section, SectionHead } from '../components/public/PublicParts';

export default function ServiceDetailPage() {
  const { id } = useParams();
  const [s, setS] = useState(null); const [err, setErr] = useState(false);
  const doctors = useDoctors();
  useEffect(() => { setS(null); setErr(false); api.get(`/services/${id}/`, { skipAuth: true }).then(({ data }) => setS(data)).catch(() => setErr(true)); }, [id]);
  if (err) return <div className="pk-page"><div className="pk-wrap pk-body"><div className="pk-state err" role="alert"><strong>Không tìm thấy dịch vụ</strong><span>Dịch vụ không tồn tại hoặc đã ngừng cung cấp.</span><Link to="/dich-vu" className="pk-btn sm">Xem danh sách dịch vụ</Link></div></div></div>;
  if (!s) return <div className="pk-page"><div className="pk-wrap pk-body" aria-busy="true"><div className="pk-skel-l w60 big"/><div className="pk-skel-img tall"/></div></div>;
  const related = (doctors.data || []).filter((d) => (d.service_names || []).includes(s.name)).slice(0, 4);
  return <div className="pk-page">
    <PageHero title={s.name} eyebrow={s.category_name || 'Dịch vụ'} crumbs={[{ label: 'Trang chủ', to: '/' }, { label: 'Dịch vụ', to: '/dich-vu' }, { label: s.name }]}/>
    <div className="pk-wrap pk-body pk-detail">
      <div className="pk-detail-media"><Photo src={s.image_url} alt={s.name} fallback={<MedicalServicesOutlined/>} loading="eager"/></div>
      <div className="pk-detail-info">
        <h2>Giới thiệu dịch vụ</h2>
        <p className="pk-prose">{s.description || 'Thông tin chi tiết về dịch vụ sẽ được bác sĩ trao đổi trong buổi thăm khám, dựa trên tình trạng da của bạn.'}</p>
        <dl className="pk-facts">
          <div><dt>Chi phí tham khảo</dt><dd>{s.price ? money(s.price) : 'Liên hệ phòng khám'}</dd></div>
          {s.duration ? <div><dt>Thời lượng</dt><dd><AccessTimeRounded/>{s.duration} phút</dd></div> : null}
          <div><dt>Hình thức đặt lịch</dt><dd>{BOOKING_POLICY[s.booking_policy] || BOOKING_POLICY.assessment}</dd></div>
        </dl>
        <div className="pk-hero-actions"><Link to={bookLink(s)} className="pk-btn lg">{bookLabel(s)}</Link><Link to="/dich-vu" className="pk-btn line lg">Xem dịch vụ khác</Link></div>
        <p className="pk-note">Chi phí và chỉ định cụ thể do bác sĩ xác nhận sau khi thăm khám.</p>
      </div>
    </div>
    {related.length > 0 && <Section tone="soft"><SectionHead title="Bác sĩ thực hiện dịch vụ này"/><div className="pk-grid4">{related.map((d) => <DoctorCard key={d.id} d={d}/>)}</div></Section>}
  </div>;
}
