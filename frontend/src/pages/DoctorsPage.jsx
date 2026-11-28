import { Link, useParams } from 'react-router-dom';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import { CardSkeletons, DoctorCard, PageHero, Photo, StateBox } from '../components/public/PublicParts';
import { useDoctors, useServices } from '../components/public/usePublic';

export function DoctorsPage() {
  const { data, loading, error } = useDoctors();
  return <div className="pk-page">
    <PageHero eyebrow="Chuyên môn" title="Bác sĩ" desc="Các bác sĩ phụ trách thăm khám, tư vấn và theo dõi điều trị tại phòng khám." crumbs={[{ label: 'Trang chủ', to: '/' }, { label: 'Bác sĩ' }]}/>
    <div className="pk-wrap pk-body"><div className="pk-grid4">
      {loading ? <CardSkeletons n={4} kind="doc"/> : <StateBox error={error && 'Không thể tải đội ngũ bác sĩ. Vui lòng thử lại sau.'} empty={!(data || []).length && 'Thông tin đội ngũ bác sĩ đang được cập nhật.'}>{(data || []).map((d) => <DoctorCard key={d.id} d={d}/>)}</StateBox>}
    </div></div>
  </div>;
}

export function DoctorProfilePage() {
  const { id } = useParams();
  const { data, loading, error } = useDoctors();
  const services = useServices();
  const d = (data || []).find((x) => String(x.id) === String(id));
  if (loading) return <div className="pk-page"><div className="pk-wrap pk-body" aria-busy="true"><div className="pk-skel-l w60 big"/><div className="pk-skel-img tall"/></div></div>;
  if (error || !d) return <div className="pk-page"><div className="pk-wrap pk-body"><div className="pk-state err" role="alert"><strong>Không tìm thấy hồ sơ bác sĩ</strong><span>Hồ sơ không tồn tại hoặc không thể tải.</span><Link to="/doi-ngu-bac-si" className="pk-btn sm">Xem đội ngũ bác sĩ</Link></div></div></div>;
  const svc = (services.data || []).filter((s) => (d.service_names || []).includes(s.name));
  return <div className="pk-page">
    <PageHero title={d.name} eyebrow={d.position || 'Bác sĩ'} crumbs={[{ label: 'Trang chủ', to: '/' }, { label: 'Bác sĩ', to: '/doi-ngu-bac-si' }, { label: d.name }]}/>
    <div className="pk-wrap pk-body pk-detail doc">
      <div className="pk-detail-media portrait"><Photo src={d.photo_url} alt={`Bác sĩ ${d.name}`} fallback={<PersonOutlineRounded/>} loading="eager"/></div>
      <div className="pk-detail-info">
        <h2>Thông tin chuyên môn</h2>
        <dl className="pk-facts">
          <div><dt>Chức danh</dt><dd>{d.position || 'Bác sĩ'}</dd></div>
          {d.experience_years > 0 && <div><dt>Kinh nghiệm</dt><dd>{d.experience_years} năm</dd></div>}
        </dl>
        {svc.length > 0 ? <><h3 className="pk-h3">Dịch vụ phụ trách</h3><ul className="pk-chiplist">{svc.map((s) => <li key={s.id}><Link to={`/dich-vu/${s.id}`}>{s.name}</Link></li>)}</ul></>
          : (d.service_names || []).length > 0 && <><h3 className="pk-h3">Dịch vụ phụ trách</h3><ul className="pk-chiplist">{d.service_names.map((n) => <li key={n}><span>{n}</span></li>)}</ul></>}
        <div className="pk-hero-actions"><Link to={`/book?staff_id=${d.id}`} className="pk-btn lg">Đặt lịch với bác sĩ</Link><Link to="/contact" className="pk-btn line lg">Liên hệ phòng khám</Link></div>
      </div>
    </div>
  </div>;
}
