import { useMemo, useState } from 'react';
import { CardSkeletons, PageHero, ServiceCard, StateBox } from '../components/public/PublicParts';
import { useServices } from '../components/public/usePublic';

export default function PublicServicesPage() {
  const { data, loading, error } = useServices();
  const [cat, setCat] = useState('all');
  const cats = useMemo(() => [...new Set((data || []).map((s) => s.category_name).filter(Boolean))], [data]);
  const rows = (data || []).filter((s) => cat === 'all' || s.category_name === cat);
  return <div className="pk-page">
    <PageHero eyebrow="Dịch vụ" title="Dịch vụ chăm sóc da" desc="Tham khảo các dịch vụ tại phòng khám và đặt lịch thăm khám hoặc tư vấn phù hợp với nhu cầu của bạn." crumbs={[{ label: 'Trang chủ', to: '/' }, { label: 'Dịch vụ' }]}/>
    <div className="pk-wrap pk-body">
      {cats.length > 1 && <div className="pk-filter" role="group" aria-label="Lọc theo nhóm dịch vụ">
        <button type="button" className={cat === 'all' ? 'on' : ''} onClick={() => setCat('all')}>Tất cả</button>
        {cats.map((c) => <button type="button" key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{c}</button>)}
      </div>}
      <div className="pk-grid3">
        {loading ? <CardSkeletons n={6}/> : <StateBox error={error && 'Không thể tải danh sách dịch vụ. Vui lòng thử lại sau.'} empty={!rows.length && 'Hiện chưa có dịch vụ để hiển thị.'}>{rows.map((s) => <ServiceCard key={s.id} s={s}/>)}</StateBox>}
      </div>
    </div>
  </div>;
}
