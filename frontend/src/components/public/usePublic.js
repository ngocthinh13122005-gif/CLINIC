import { useEffect, useRef, useState } from 'react';
import api from '../../api/client';

export const DEFAULT_HOTLINE = '0919 005 523';
export const money = (v) => new Intl.NumberFormat('vi-VN').format(v || 0) + 'đ';
export const telHref = (v) => `tel:${String(v || DEFAULT_HOTLINE).replace(/[^+\d]/g, '')}`;

const cache = {};
const pending = {};
/** Tải dữ liệu công khai một lần cho cả phiên (dùng chung giữa header, footer, trang chủ). */
function useCached(key, fetcher, deps = []) {
  const [state, setState] = useState(() => cache[key] || { data: null, loading: true, error: '' });
  useEffect(() => {
    let active = true;
    if (cache[key]) { setState(cache[key]); return undefined; }
    setState({ data: null, loading: true, error: '' });
    if (!pending[key]) {
      pending[key] = Promise.resolve().then(fetcher)
        .then((data) => { const s = { data, loading: false, error: '' }; cache[key] = s; return s; })
        .finally(() => { delete pending[key]; });
    }
    pending[key].then((s) => { if (active) setState(s); })
      .catch(() => { if (active) setState({ data: null, loading: false, error: 'load' }); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ...deps]);
  return state;
}

export function useClinicProfile() {
  return useCached('profile', async () => (await api.get('/clinic/profile/', { skipAuth: true })).data).data;
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

export const IMG = (n) => `/img/${n}.jpg`;
export const CLINIC_PHOTO = IMG('hero');
const SERVICE_PHOTOS = [
  [/peel/i, IMG('nurse')],
  [/plasma|profhilo|tái tạo|prp/i, IMG('lab')],
  [/rf|lăn kim|trẻ hóa|laser/i, IMG('steth')],
  [/mụn|nám|da/i, IMG('derm')],
];
const FALLBACKS = ['patient', 'steth', 'lab2', 'scope', 'derm', 'nurse'].map(IMG);
/** Ảnh dịch vụ: ưu tiên ảnh tải lên trong hệ thống, sau đó ảnh minh họa cục bộ theo tên/nhóm dịch vụ. */
export const serviceImg = (s) => s.image_url || (SERVICE_PHOTOS.find(([re]) => re.test(s.name || '')) || [null, FALLBACKS[(Number(s.id) || 0) % FALLBACKS.length]])[1];

const RV_SELECTORS = [
  '.pk-hero-copy > *', '.pk-hero-media', '.pk-pagehero .pk-wrap > *', '.pk-strip-i', '.pk-about-media', '.pk-about-copy > *',
  '.pk-sec-head', '.pk-grid3 > *', '.pk-grid4 > *', '.pk-why-copy > *', '.pk-why-band .pk-why', '.pk-steps li',
  '.pk-gallery figure', '.pk-cta-in > *', '.pk-foot-grid > *', '.pk-body > *',
].join(',');

/** Hiệu ứng xuất hiện khi cuộn tới cho các khối của trang khách hàng (so le theo thứ tự, tự gỡ sau khi chạy xong). */
export function useScrollReveal(depKey) {
  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window) || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timers = [];
    const io = new IntersectionObserver((entries) => entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target; io.unobserve(el); el.classList.add('in');
      timers.push(setTimeout(() => { el.classList.remove('pk-rv', 'in'); el.style.removeProperty('--d'); }, 1300));
    }), { threshold: 0.08, rootMargin: '0px 0px -6% 0px' });
    const scan = () => document.querySelectorAll(RV_SELECTORS).forEach((el) => {
      if (el.dataset.rv || el.closest('.pk-header,.floating-contact')) return;
      el.dataset.rv = '1';
      const i = Array.prototype.indexOf.call(el.parentElement?.children || [], el);
      el.style.setProperty('--d', `${Math.min(Math.max(i, 0), 6) * 90}ms`);
      el.classList.add('pk-rv'); io.observe(el);
    });
    scan();
    const mo = new MutationObserver(scan); mo.observe(document.querySelector('.public-shell') || document.body, { childList: true, subtree: true });
    return () => { io.disconnect(); mo.disconnect(); timers.forEach(clearTimeout); document.querySelectorAll('[data-rv]').forEach((el) => { el.classList.remove('pk-rv', 'in'); delete el.dataset.rv; }); };
  }, [depKey]);
}
