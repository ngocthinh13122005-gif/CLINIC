import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
const money = (v) => new Intl.NumberFormat('vi-VN').format(v || 0) + 'đ';
const policyText = {
  direct: 'Có thể yêu cầu đặt trực tiếp',
  assessment: 'Cần bác sĩ tư vấn hoặc đánh giá trước',
  indicated: 'Chỉ thực hiện khi đã có chỉ định',
  plan_only: 'Chỉ đặt trong liệu trình hiện có',
};
export default function PublicServicesPage(){
  const [rows,setRows]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState('');
  useEffect(()=>{
    api.get('/services/', { skipAuth: true })
      .then(({data})=>setRows(data.results||data))
      .catch(()=>setError('Không thể tải danh sách dịch vụ. Vui lòng thử lại sau.'))
      .finally(()=>setLoading(false));
  },[]);
  return <div className="public-page services-page">
    <header className="services-intro">
      <span className="services-eyebrow">AKINACLINIC · DA LIỄU & THẨM MỸ</span>
      <h1 className="public-page-title">Dịch vụ chăm sóc da</h1>
      <p className="public-page-subtitle">Tham khảo các dịch vụ tại AkinaClinic và đặt lịch tư vấn phù hợp với nhu cầu của bạn.</p>
    </header>
    {error&&<p className="services-message error" role="alert">{error}</p>}
    {loading&&<p className="services-message" role="status">Đang tải danh sách dịch vụ…</p>}
    {!loading&&!error&&!rows.length&&<p className="services-message">Hiện chưa có dịch vụ để hiển thị.</p>}
    {!loading&&!error&&rows.length>0&&<div className="grid-services">{rows.map(s=><article className="card-service" key={s.id}>
      {s.image_url?<img className="service-image" src={s.image_url} alt={s.name}/>:<div className="service-ph" aria-label={`Ảnh ${s.name} đang được cập nhật`}>Hình ảnh đang được cập nhật</div>}
      <div className="card-service-body">
        <div className="service-category">{s.category_name||'Dịch vụ'}</div>
        <h2 className="service-title">{s.name}</h2>
        <p className="service-desc">{s.description||'Dịch vụ chăm sóc tại AkinaClinic.'}</p>
        <div className="service-meta"><span className="price">{money(s.price)}</span><span className="muted">{s.duration} phút</span></div>
        <p className="service-policy">{policyText[s.booking_policy]||policyText.assessment}</p>
        <Link to={`/book?service_id=${s.id}${s.booking_policy==='direct'?'&appointment_type=procedure':''}`} className="ohio-btn ohio-btn-outline services-book-link">{s.booking_policy==='direct'?'Đặt lịch dịch vụ':'Đặt lịch tư vấn'}</Link>
      </div>
    </article>)}</div>}
  </div>;
}
