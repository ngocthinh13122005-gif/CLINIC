import { useState } from 'react';
import { Link } from 'react-router-dom';
import ArrowForwardRounded from '@mui/icons-material/ArrowForwardRounded';
import MedicalServicesOutlined from '@mui/icons-material/MedicalServicesOutlined';
import SpaOutlined from '@mui/icons-material/SpaOutlined';
import { bookLabel, bookLink, money, serviceImg, useReveal } from './usePublic';

/** Ảnh có dự phòng: nếu không tải được sẽ hiện khung màu nhạt thay vì ảnh lỗi. */
export function Photo({ src, alt, className = '', fallback, loading = 'lazy' }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return <div className={`pk-photo-ph ${className}`} role="img" aria-label={alt}>{fallback || <SpaOutlined/>}</div>;
  return <img className={className} src={src} alt={alt} loading={loading} decoding="async" onError={() => setBad(true)}/>;
}

export function Section({ id, tone, children, className = '' }) {
  const ref = useReveal();
  return <section id={id} ref={ref} className={`pk-section pk-reveal ${tone === 'soft' ? 'soft' : ''} ${className}`}><div className="pk-wrap">{children}</div></section>;
}

export function SectionHead({ eyebrow, title, desc, action }) {
  return <header className="pk-sec-head">
    <div>{eyebrow && <p className="pk-eyebrow">{eyebrow}</p>}<h2>{title}</h2>{desc && <p className="pk-sec-desc">{desc}</p>}</div>
    {action}
  </header>;
}

export function TextLink({ to, children }) { return <Link to={to} className="pk-textlink">{children}<ArrowForwardRounded/></Link>; }

export function ServiceCard({ s }) {
  return <article className="pk-card pk-svc">
    <Link to={`/dich-vu/${s.id}`} className="pk-svc-media" aria-label={`Xem chi tiết ${s.name}`} tabIndex={-1}>
      <Photo src={serviceImg(s)} alt={s.name} fallback={<MedicalServicesOutlined/>}/>
    </Link>
    <div className="pk-svc-body">
      <span className="pk-tag">{s.category_name || 'Dịch vụ'}</span>
      <h3><Link to={`/dich-vu/${s.id}`}>{s.name}</Link></h3>
      <p>{s.description || 'Dịch vụ chăm sóc da tại phòng khám, được bác sĩ tư vấn theo tình trạng da.'}</p>
      <div className="pk-svc-meta"><strong>{s.price ? money(s.price) : 'Liên hệ'}</strong>{s.duration ? <span>{s.duration} phút</span> : null}</div>
      <div className="pk-svc-actions">
        <Link to={`/dich-vu/${s.id}`} className="pk-btn-text">Chi tiết</Link>
        <Link to={bookLink(s)} className="pk-btn sm">{bookLabel(s)}</Link>
      </div>
    </div>
  </article>;
}

export function DoctorCard({ d }) {
  return <article className="pk-card pk-doc">
    <Link to={`/doi-ngu-bac-si/${d.id}`} className="pk-doc-media" tabIndex={-1} aria-label={`Hồ sơ ${d.name}`}>
      <Photo src={d.photo_url} alt={`Bác sĩ ${d.name}`} fallback={<span className="pk-initial">{(d.name || 'BS').replace(/^(BS\.?|Bác sĩ)\s*/i, '').trim().split(/\s+/).slice(-2).map((w) => w[0]).join('').toUpperCase() || 'BS'}</span>}/>
    </Link>
    <div className="pk-doc-body">
      <h3><Link to={`/doi-ngu-bac-si/${d.id}`}>{d.name}</Link></h3>
      <p className="pk-doc-pos">{d.position || 'Bác sĩ'}</p>
      {d.service_names?.length > 0 && <p className="pk-doc-sv">{d.service_names.slice(0, 3).join(' · ')}{d.service_names.length > 3 ? ` · +${d.service_names.length - 3}` : ''}</p>}
      <Link to={`/book?staff_id=${d.id}`} className="pk-btn sm block">Đặt lịch</Link>
    </div>
  </article>;
}

export function CardSkeletons({ n = 3, kind = 'svc' }) {
  return <>{Array.from({ length: n }, (_, i) => <div className={`pk-card pk-skel ${kind}`} key={i} aria-hidden="true"><div className="pk-skel-img"/><div className="pk-skel-l w60"/><div className="pk-skel-l"/><div className="pk-skel-l w80"/></div>)}</>;
}

export function StateBox({ error, empty, children }) {
  if (error) return <div className="pk-state err" role="alert"><strong>Không thể tải dữ liệu</strong><span>{error}</span></div>;
  if (empty) return <div className="pk-state"><strong>{empty}</strong></div>;
  return children;
}

export function PageHero({ eyebrow, title, desc, crumbs, children }) {
  return <div className="pk-pagehero"><div className="pk-wrap">
    {crumbs && <nav className="pk-crumbs" aria-label="Đường dẫn">{crumbs.map((c, i) => c.to ? <span key={i}><Link to={c.to}>{c.label}</Link><i>/</i></span> : <span key={i} aria-current="page">{c.label}</span>)}</nav>}
    {eyebrow && <p className="pk-eyebrow">{eyebrow}</p>}
    <h1>{title}</h1>{desc && <p className="pk-lead">{desc}</p>}{children}
  </div></div>;
}
