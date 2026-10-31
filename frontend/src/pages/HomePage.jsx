import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import CheckCircleOutlineRounded from '@mui/icons-material/CheckCircleOutlineRounded';
import MedicalServicesOutlined from '@mui/icons-material/MedicalServicesOutlined';
import SpaOutlined from '@mui/icons-material/SpaOutlined';
import { Link } from 'react-router-dom';
import '../styles/home.css';

const IMAGES = {
  consultation: 'https://akinacenter.com/wp-content/uploads/2022/01/MG_4616-1.jpg',
  doctor: 'https://akinacenter.com/wp-content/uploads/2025/10/BS-Nguyen-1141x2048.jpg',
  peel: 'https://akinacenter.com/wp-content/uploads/2021/09/akina-chemical-peel-scaled.jpg',
  plasma: 'https://akinacenter.com/wp-content/uploads/2021/09/akina-plasma-med-scaled.jpg',
  rf: 'https://akinacenter.com/wp-content/uploads/2021/09/akina-lan-kim-tre-hoa-scaled.jpg',
};

const SERVICES = [
  {
    title: 'Chemical Peel',
    description: 'Phương pháp chăm sóc da có sử dụng hoạt chất peel, được tư vấn theo tình trạng da.',
    image: IMAGES.peel,
    alt: 'Hình ảnh dịch vụ Chemical Peel tại Akina',
    icon: SpaOutlined,
  },
  {
    title: 'Plasma Med',
    description: 'Tìm hiểu liệu trình Plasma Med và trao đổi với bác sĩ về mức độ phù hợp.',
    image: IMAGES.plasma,
    alt: 'Hình ảnh dịch vụ Plasma Med tại Akina',
    icon: MedicalServicesOutlined,
  },
  {
    title: 'RF Rolling',
    description: 'Lăn kim vi điểm kết hợp RF; cần được thăm khám và tư vấn trước khi thực hiện.',
    image: IMAGES.rf,
    alt: 'Hình ảnh liệu trình RF Rolling tại Akina',
    icon: AutoAwesomeRounded,
  },
];

const VISIT_STEPS = [
  { title: 'Đón tiếp', description: 'Tiếp nhận thông tin và nhu cầu chăm sóc da.' },
  { title: 'Thăm khám', description: 'Bác sĩ đánh giá tình trạng da và tư vấn.' },
  { title: 'Thực hiện', description: 'Tiến hành dịch vụ theo kế hoạch đã trao đổi.' },
  { title: 'Theo dõi', description: 'Hướng dẫn chăm sóc sau dịch vụ.' },
];

function ClinicImage({ src, alt, className = '', loading = 'lazy' }) {
  return <img className={className} src={src} alt={alt} loading={loading} decoding="async"/>;
}

export default function HomePage() {
  return (
    <div className="home-page">
      <section className="home-hero">
        <div className="home-container home-hero-grid">
          <div className="home-hero-copy">
            <p className="home-eyebrow">AKINA CENTER · DA LIỄU</p>
            <h1>Chăm sóc da<br/>bằng sự <span>thấu hiểu.</span></h1>
            <p className="home-hero-description">
              Mỗi làn da có một câu chuyện riêng. Hãy bắt đầu bằng buổi thăm khám cùng bác sĩ để hiểu rõ tình trạng da và lựa chọn hướng chăm sóc phù hợp.
            </p>
            <div className="home-actions">
              <Link to="/book" className="home-button primary">Đặt lịch thăm khám <ArrowForwardRounded/></Link>
              <Link to="/dich-vu" className="home-button secondary">Khám phá dịch vụ</Link>
            </div>
            <div className="home-hero-trust">
              <span><CheckCircleOutlineRounded/> Bác sĩ trực tiếp thăm khám</span>
              <span><CheckCircleOutlineRounded/> Tư vấn theo tình trạng da</span>
            </div>
          </div>
          <div className="home-hero-visual">
            <ClinicImage
              src={IMAGES.consultation}
              alt="Bác sĩ tư vấn trực tiếp cho khách hàng tại phòng khám Akina"
              className="home-hero-image"
              loading="eager"
            />
            <div className="home-photo-caption">
              <span className="home-photo-icon"><MedicalServicesOutlined/></span>
              <span><strong>Thăm khám cùng bác sĩ</strong><small>Lắng nghe và tư vấn rõ ràng</small></span>
            </div>
          </div>
        </div>
      </section>

      <section className="home-trust-strip" aria-label="Cam kết chăm sóc">
        <div className="home-container home-trust-grid">
          <div><span className="home-trust-mark">01</span><span><strong>Chuyên môn</strong><small>Bác sĩ thăm khám và tư vấn</small></span></div>
          <div><span className="home-trust-mark">02</span><span><strong>Cá nhân hóa</strong><small>Trao đổi theo tình trạng da</small></span></div>
          <div><span className="home-trust-mark">03</span><span><strong>Đồng hành</strong><small>Hướng dẫn chăm sóc sau dịch vụ</small></span></div>
        </div>
      </section>

      <section className="home-section">
        <div className="home-container">
          <header className="home-section-heading">
            <div>
              <p className="home-eyebrow">DỊCH VỤ TẠI AKINA</p>
              <h2>Công nghệ chăm sóc da<br className="home-desktop-break"/> tại Akina</h2>
            </div>
            <Link to="/dich-vu" className="home-text-link">Xem tất cả dịch vụ <ArrowForwardRounded/></Link>
          </header>
          <div className="home-service-grid">
            {SERVICES.map(({ title, description, image, alt, icon: Icon }) => (
              <Link to="/dich-vu" className="home-service-card" key={title}>
                <div className="home-service-image-wrap">
                  <ClinicImage src={image} alt={alt} className="home-service-image"/>
                </div>
                <div className="home-service-content">
                  <span className="home-service-icon"><Icon/></span>
                  <h3>{title}</h3>
                  <p>{description}</p>
                  <span className="home-service-link">Tìm hiểu thêm <ArrowForwardRounded/></span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section className="home-process-section">
        <div className="home-container">
          <header className="home-section-heading centered">
            <div>
              <p className="home-eyebrow">QUY TRÌNH THĂM KHÁM</p>
              <h2>Rõ ràng trong từng bước</h2>
              <p className="home-section-intro">Bạn luôn được trao đổi về tình trạng da và hướng chăm sóc trước khi thực hiện dịch vụ.</p>
            </div>
          </header>
          <ol className="home-process-grid">
            {VISIT_STEPS.map((step, index) => (
              <li className="home-process-step" key={step.title}>
                <span className="home-step-number">{String(index + 1).padStart(2, '0')}</span>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="home-doctor-section">
        <div className="home-container home-doctor-grid">
          <div className="home-doctor-photo-wrap">
            <ClinicImage
              src={IMAGES.doctor}
              alt="Thạc sĩ, bác sĩ Cao Nguyên, Giám đốc chuyên môn Akina Center"
              className="home-doctor-photo"
            />
            <span className="home-doctor-photo-label">Đội ngũ chuyên môn Akina</span>
          </div>
          <div className="home-doctor-copy">
            <p className="home-eyebrow">CHUYÊN MÔN & TẬN TÂM</p>
            <h2>Được thăm khám kỹ lưỡng, an tâm hơn trên hành trình chăm sóc da.</h2>
            <p>
              Tại Akina, bác sĩ trực tiếp thăm khám và tư vấn. Mỗi bước được trao đổi rõ ràng để bạn hiểu tình trạng da, phương án chăm sóc và cách theo dõi sau dịch vụ.
            </p>
            <div className="home-doctor-name">
              <strong>ThS.BS. Cao Nguyên</strong>
              <span>Giám đốc chuyên môn · Bác sĩ da liễu</span>
            </div>
            <Link to="/book" className="home-button primary">Đặt lịch với bác sĩ <ArrowForwardRounded/></Link>
          </div>
        </div>
      </section>

      <section className="home-cta-section">
        <div className="home-container home-cta-content">
          <div>
            <p className="home-eyebrow">BẮT ĐẦU TỪ MỘT BUỔI THĂM KHÁM</p>
            <h2>Sẵn sàng lắng nghe làn da của bạn.</h2>
          </div>
          <Link to="/book" className="home-button primary">Đặt lịch ngay <ArrowForwardRounded/></Link>
        </div>
      </section>
    </div>
  );
}
