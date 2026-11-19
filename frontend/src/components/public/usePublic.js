import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';

export const DEFAULT_HOTLINE = '0919 005 523';
export const money = (v) => new Intl.NumberFormat('vi-VN').format(v || 0) + 'đ';
export const telHref = (v) => `tel:${String(v || DEFAULT_HOTLINE).replace(/[^+\d]/g, '')}`;

const cache = {};
/** Tải dữ liệu công khai một lần cho cả phiên (dùng chung giữa header, footer, trang chủ). */
function useCached(key, fetcher, deps = []) {
  const [state, setState] = useState(() => cache[key] || { data: null, loading: true, error: '' });
  useEffect(() => {
    let active = true;
    if (cache[key]) { setState(cache[key]); return undefined; }
    setState({ data: null, loading: true, error: '' });
    fetcher().then((data) => { const s = { data, loading: false, error: '' }; cache[key] = s; if (active) setState(s); })
      .catch(() => { if (active) setState({ data: null, loading: false, error: 'load' }); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);
  return state;
}

export function useClinicProfile() {
  return useCached('profile', async () => (await api.get('/clinic/profile/')).data).data;
}

export function useServices() {
  return useCached('services', async () => {
    const { data } = await api.get('/services/', { skipAuth: true });
    return (data.results || data).filter((s) => s.is_active !== false);
  });
}

export function useDoctors() {
  return useCached('doctors', async () => {
    const { data } = await api.get('/staff/', { skipAuth: true });
    return (data.results || data).filter((s) => s.is_active !== false && (s.account_role === 'doctor' || /bác sĩ|^bs[\s.]/i.test(`${s.position || ''}`)));
  });
}

/** Hiện dần khi cuộn tới (nhẹ, không thư viện). Tự bỏ qua khi người dùng bật giảm chuyển động. */
export function useReveal() {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    if (!('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { el.classList.add('in'); return undefined; }
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) { el.classList.add('in'); io.disconnect(); } }, { threshold: 0.12 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return ref;
}

export const BOOKING_POLICY = {
  direct: 'Có thể đặt lịch trực tiếp',
  assessment: 'Cần bác sĩ tư vấn hoặc đánh giá trước',
  indicated: 'Chỉ thực hiện khi đã có chỉ định',
  plan_only: 'Chỉ đặt trong liệu trình hiện có',
};

export const bookLink = (s) => `/book?service_id=${s.id}${s.booking_policy === 'direct' ? '&appointment_type=procedure' : ''}`;
export const bookLabel = (s) => (s.booking_policy === 'direct' ? 'Đặt lịch' : 'Đặt lịch tư vấn');

const UP = 'https://akinacenter.com/wp-content/uploads/';
export const CLINIC_PHOTO = `${UP}2022/01/MG_4616-1.jpg`;
const SERVICE_PHOTOS = [
  [/peel/i, `${UP}2021/09/akina-chemical-peel-scaled.jpg`],
  [/plasma|profhilo|tái tạo/i, `${UP}2021/09/akina-plasma-med-scaled.jpg`],
  [/rf|lăn kim|trẻ hóa/i, `${UP}2021/09/akina-lan-kim-tre-hoa-scaled.jpg`],
];
/** Ảnh dịch vụ: ưu tiên ảnh tải lên trong hệ thống, sau đó ảnh tương ứng trên akinacenter.com, cuối cùng là ảnh phòng khám. */
export const serviceImg = (s) => s.image_url || (SERVICE_PHOTOS.find(([re]) => re.test(s.name || '')) || [null, CLINIC_PHOTO])[1];
