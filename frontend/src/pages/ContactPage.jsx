import { useEffect, useState } from 'react';
import api from '../api/client';

export default function ContactPage() {
  const [clinic, setClinic] = useState(null);
  useEffect(() => { let active = true; api.get('/clinic/profile/').then(({ data }) => { if (active) setClinic(data); }).catch(() => {}); return () => { active = false; }; }, []);
  const phone = clinic?.hotline || '0919 005 523';
  return <div className="public-page narrow"><h1 className="public-page-title">Liên hệ {clinic?.brand_name || 'AkinaClinic'}</h1><p className="public-page-subtitle">Nếu cần hỗ trợ về dịch vụ hoặc lịch hẹn, bạn có thể đăng nhập để trao đổi trực tiếp với đội ngũ CSKH trong hệ thống.</p><div className="public-card"><h2 style={{ fontSize: 'var(--fs-md)', margin: '0 0 8px', color: '#172235' }}>Thông tin phòng khám</h2><p className="muted" style={{ lineHeight: 1.65, margin: 0 }}>{clinic?.address || 'Địa chỉ đang được cập nhật.'}</p><p style={{ margin: '10px 0 0' }}><a href={`tel:${phone.replace(/[^+\d]/g, '')}`}>Hotline: {phone}</a></p>{clinic?.email && <p style={{ margin: '6px 0 0' }}><a href={`mailto:${clinic.email}`}>{clinic.email}</a></p>}</div></div>;
}
