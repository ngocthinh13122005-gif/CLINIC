import { Link } from 'react-router-dom';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CallOutlined from '@mui/icons-material/CallOutlined';
import ForumOutlined from '@mui/icons-material/ForumOutlined';
import EventRepeatOutlined from '@mui/icons-material/EventRepeatOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import MedicalInformationOutlined from '@mui/icons-material/MedicalInformationOutlined';
import EventAvailableOutlined from '@mui/icons-material/EventAvailableOutlined';
import VerifiedOutlined from '@mui/icons-material/VerifiedOutlined';
import SupportAgentOutlined from '@mui/icons-material/SupportAgentOutlined';
import { CardSkeletons, DoctorCard, Photo, Section, SectionHead, ServiceCard, StateBox, TextLink } from '../components/public/PublicParts';
import { IMG, DEFAULT_HOTLINE, telHref, useClinicProfile, useDoctors, useServices } from '../components/public/usePublic';

const WHY = [
  { icon: MedicalInformationOutlined, t: 'Thăm khám chuyên môn', d: 'Bác sĩ đánh giá tình trạng da trực tiếp trước khi đề xuất bất kỳ dịch vụ nào.' },
  { icon: FactCheckOutlined, t: 'Kế hoạch điều trị cá nhân hóa', d: 'Hướng chăm sóc và liệu trình được xây dựng theo tình trạng và mục tiêu của từng người.' },
  { icon: EventRepeatOutlined, t: 'Theo dõi và tái khám', d: 'Lịch tái khám và các buổi liệu trình được ghi nhận, nhắc lịch trong hồ sơ của bạn.' },
  { icon: ForumOutlined, t: 'Quy trình rõ ràng', d: 'Thông tin dịch vụ, thời lượng, chi phí và lịch hẹn được xác nhận minh bạch với bạn.' },
];
const STEPS = [
  { t: 'Chọn dịch vụ', d: 'Chọn dịch vụ quan tâm hoặc đặt lịch tư vấn nếu bạn chưa biết nên bắt đầu từ đâu.' },
  { t: 'Chọn bác sĩ và thời gian', d: 'Xem các khung giờ còn trống thực tế của phòng khám và chọn chuyên viên phù hợp.' },
  { t: 'Xác nhận lịch hẹn', d: 'Điền thông tin liên hệ, nhận mã xác nhận và phòng khám sẽ xác nhận lại với bạn.' },
  { t: 'Đến phòng khám', d: 'Đến đúng giờ hẹn, bác sĩ thăm khám và tư vấn trực tiếp.' },
];

const STRIP = [
  { icon: EventAvailableOutlined, t: 'Đặt lịch trực tuyến', d: 'Chọn dịch vụ, bác sĩ và giờ trống' },
  { icon: VerifiedOutlined, t: 'Nhận mã xác nhận', d: 'Ngay sau khi đặt lịch thành công' },
  { icon: SupportAgentOutlined, t: 'Tư vấn cùng trợ lý', d: 'Hỏi nhanh về dịch vụ và giá' },
];
const GALLERY = [
  ['lab', 'Thực hiện thủ thuật chăm sóc da'], ['nurse', 'Điều dưỡng chuẩn bị dụng cụ'], ['steth', 'Thăm khám lâm sàng'],
  ['lab2', 'Chuẩn bị mẫu và dung dịch'], ['scope', 'Hỗ trợ chẩn đoán'], ['derm', 'Kiểm tra và đánh giá'],
];

export default function HomePage() {
  const clinic = useClinicProfile();
  const services = useServices();
  const doctors = useDoctors();
  const hotline = clinic?.hotline || DEFAULT_HOTLINE;
  const svcList = (services.data || []).slice(0, 6);
  const docList = (doctors.data || []).slice(0, 4);

  return <div className="pk-page">
    <section className="pk-hero">
      <div className="pk-wrap pk-hero-grid">
        <div className="pk-hero-copy">
          <p className="pk-eyebrow">Da liễu &amp; Thẩm mỹ</p>
          <h1>Chăm sóc da bắt đầu từ một buổi thăm khám <em>đúng cách</em></h1>
          <p className="pk-lead">Bác sĩ lắng nghe, đánh giá tình trạng da và cùng bạn lựa chọn hướng điều trị phù hợp, với quy trình và chi phí rõ ràng ngay từ đầu.</p>
          <div className="pk-hero-actions">
            <Link to="/book" className="pk-btn lg">Đặt lịch thăm khám<ArrowForwardRounded/></Link>
            <Link to="/dich-vu" className="pk-btn line lg">Khám phá dịch vụ</Link>
          </div>
          <ul className="pk-checks">
            <li><CheckRounded/>Bác sĩ trực tiếp thăm khám và tư vấn</li>
            <li><CheckRounded/>Khung giờ trống cập nhật theo lịch thực tế</li>
            <li><CheckRounded/>Nhận mã xác nhận ngay sau khi đặt lịch</li>
          </ul>
        </div>
        <div className="pk-hero-media">
          <span className="pk-hero-block" aria-hidden="true"/>
          <Photo src={IMG('hero')} alt="Bác sĩ tư vấn trực tiếp cho khách hàng tại phòng khám" loading="eager"/>
          <div className="pk-float a"><span className="pk-ico"><MedicalInformationOutlined/></span><div><strong>Bác sĩ thăm khám</strong><small>Đánh giá trực tiếp tình trạng da</small></div></div>
          <div className="pk-float b"><span className="pk-ico"><EventRepeatOutlined/></span><div><strong>Theo dõi tái khám</strong><small>Lịch hẹn lưu trong hồ sơ</small></div></div>
        </div>
      </div>
    </section>

    <section className="pk-strip"><div className="pk-wrap pk-strip-in">
      {STRIP.map(({ icon: Icon, t, d }) => <div className="pk-strip-i" key={t}><Icon/><div><strong>{t}</strong><small>{d}</small></div></div>)}
      <a className="pk-strip-i call" href={telHref(hotline)}><CallOutlined/><div><strong>{hotline}</strong><small>Hotline tư vấn</small></div></a>
    </div></section>

    <Section id="gioi-thieu">
      <div className="pk-about">
        <div className="pk-about-media">
          <Photo className="m1" src={IMG('team')} alt="Đội ngũ y bác sĩ của phòng khám"/>
          <Photo className="m2" src={IMG('smile')} alt="Khách hàng hài lòng sau buổi thăm khám"/>
          <span className="pk-about-tag"><strong>Lấy người bệnh</strong>làm trung tâm</span>
        </div>
        <div className="pk-about-copy">
          <p className="pk-eyebrow">Về AkinaClinic</p>
          <h2>Phòng khám da liễu &amp; thẩm mỹ chú trọng quy trình rõ ràng</h2>
          <p className="pk-sec-desc">Mỗi khách hàng được thăm khám, tư vấn và theo dõi theo hồ sơ riêng. Dịch vụ, thời lượng, chi phí và lịch hẹn đều được xác nhận minh bạch trước khi thực hiện.</p>
          <ul className="pk-checks">
            <li><CheckRounded/>Đánh giá chuyên môn trước khi đề xuất dịch vụ</li>
            <li><CheckRounded/>Liệu trình cá nhân hóa, ghi nhận từng buổi</li>
            <li><CheckRounded/>Nhắc lịch và theo dõi tái khám trong hồ sơ</li>
          </ul>
          <div className="pk-hero-actions"><Link to="/book" className="pk-btn">Đặt lịch tư vấn</Link><Link to="/contact" className="pk-btn line">Liên hệ phòng khám</Link></div>
        </div>
      </div>
    </Section>

    <Section id="dich-vu" tone="soft">
      <SectionHead eyebrow="Dịch vụ" title="Dịch vụ tại phòng khám" desc="Danh sách dịch vụ đang được phòng khám cung cấp. Mỗi dịch vụ đều có thông tin thời lượng và hình thức đặt lịch phù hợp."
        action={<TextLink to="/dich-vu">Xem tất cả dịch vụ</TextLink>}/>
      <div className="pk-grid3">
        {services.loading ? <CardSkeletons n={3}/> : <StateBox error={services.error && 'Vui lòng thử lại sau ít phút.'} empty={!svcList.length && 'Danh sách dịch vụ đang được cập nhật.'}>{svcList.map((s) => <ServiceCard key={s.id} s={s}/>)}</StateBox>}
      </div>
    </Section>

    <section className="pk-why-band">
      <div className="pk-wrap pk-why-grid">
        <div className="pk-why-copy">
          <p className="pk-eyebrow">Vì sao chọn chúng tôi</p>
          <h2>Một quy trình thăm khám rõ ràng, lấy người bệnh làm trung tâm</h2>
          <Photo src={IMG('patient')} alt="Điều dưỡng chăm sóc và trò chuyện cùng người bệnh"/>
        </div>
        <div className="pk-why-list">
          {WHY.map(({ icon: Icon, t, d }) => <div className="pk-why" key={t}><span className="pk-ico"><Icon/></span><div><h3>{t}</h3><p>{d}</p></div></div>)}
        </div>
      </div>
    </section>

    <Section id="bac-si">
      <SectionHead eyebrow="Chuyên môn" title="Bác sĩ" desc="Bác sĩ phụ trách thăm khám và theo dõi quá trình điều trị của bạn." action={<TextLink to="/doi-ngu-bac-si">Xem tất cả bác sĩ</TextLink>}/>
      <div className="pk-grid4">
        {doctors.loading ? <CardSkeletons n={4} kind="doc"/> : <StateBox error={doctors.error && 'Vui lòng thử lại sau ít phút.'} empty={!docList.length && 'Thông tin đội ngũ bác sĩ đang được cập nhật.'}>{docList.map((d) => <DoctorCard key={d.id} d={d}/>)}</StateBox>}
      </div>
    </Section>

    <Section tone="soft" id="quy-trinh">
      <SectionHead eyebrow="Quy trình" title="Đặt lịch trong bốn bước"/>
      <ol className="pk-steps">
        {STEPS.map((s, i) => <li key={s.t}><span className="pk-step-n">{i + 1}</span><h3>{s.t}</h3><p>{s.d}</p></li>)}
      </ol>
    </Section>

    <Section id="hoat-dong">
      <SectionHead eyebrow="Hình ảnh" title="Hoạt động chuyên môn tại phòng khám"/>
      <div className="pk-gallery">
        {GALLERY.map(([n, alt]) => <figure key={n}><Photo src={IMG(n)} alt={alt}/><figcaption>{alt}</figcaption></figure>)}
      </div>
    </Section>

    <section className="pk-cta-band"><div className="pk-wrap pk-cta-in">
      <div><h2>Sẵn sàng đặt lịch thăm khám?</h2><p>Chọn thời gian phù hợp, phòng khám sẽ xác nhận lại với bạn.</p></div>
      <div className="pk-hero-actions"><Link to="/book" className="pk-btn red lg">Đặt lịch ngay</Link><a href={telHref(hotline)} className="pk-btn ghost lg"><CallOutlined/>{hotline}</a></div>
    </div></section>
  </div>;
}
