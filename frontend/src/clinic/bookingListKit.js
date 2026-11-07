// Hàm thuần cho chế độ danh sách lịch hẹn (không phụ thuộc React → dễ kiểm thử).
import { dayKey, durationOf, endOf } from './calendarKit';

/** Giai đoạn của lịch hẹn, dùng cho bộ lọc và màu trạng thái. */
export const PHASES = [
  ['pending', 'Chờ xác nhận', '#f5a623'],
  ['confirmed', 'Đã xác nhận', '#4f8ef7'],
  ['arrived', 'Đã đến', '#35c27f'],
  ['completed', 'Hoàn thành', '#8b929c'],
  ['no_show', 'Vắng mặt', '#ff5a64'],
  ['cancelled', 'Đã hủy', '#b3b8bf'],
];
export const PHASE = Object.fromEntries(PHASES.map(([k, l, c]) => [k, { label: l, color: c }]));

export function phaseOf(b) {
  if (b.status === 'cancelled') return 'cancelled';
  if (b.status === 'no_show') return 'no_show';
  if (b.status === 'completed' || b.visit_status === 'completed') return 'completed';
  if (b.visit_id) return 'arrived';
  return b.status === 'confirmed' ? 'confirmed' : 'pending';
}

/** 'overdue' = quá giờ hẹn mà khách chưa đến; 'soon' = còn ≤ 30 phút; '' = bình thường. */
export function dueState(b, now = new Date()) {
  const p = phaseOf(b);
  if (p !== 'pending' && p !== 'confirmed') return '';
  const start = new Date(b.appointment);
  if (start <= now) return 'overdue';
  return start - now <= 30 * 60000 ? 'soon' : '';
}

export const countPhases = (list) => {
  const out = Object.fromEntries(PHASES.map(([k]) => [k, 0]));
  list.forEach((b) => { out[phaseOf(b)] += 1; });
  return out;
};

const norm = (s = '') => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/đ/g, 'd');   // hạ chữ thường TRƯỚC để "Đ" hoa cũng thành "d"

/** phase: '' (tất cả, ẩn lịch đã hủy) | khóa PHASES; q: tìm theo tên/SĐT/mã hồ sơ/mã lịch; staff: id bác sĩ hoặc ''. */
export function filterBookings(list, { phase = '', q = '', staff = '' } = {}) {
  const needle = norm(q.trim());
  return list.filter((b) => {
    const p = phaseOf(b);
    if (phase ? p !== phase : p === 'cancelled') return false;
    if (staff && b.staff !== Number(staff)) return false;
    if (!needle) return true;
    return norm(`${b.customer_name} ${b.customer_phone || ''} ${b.patient_code || ''} #${b.id}`).includes(needle);
  });
}

/** Sắp xếp theo giờ và nhóm theo ngày: [{ day, items }] */
export function groupByDay(list) {
  const sorted = [...list].sort((a, b) => new Date(a.appointment) - new Date(b.appointment));
  const out = [];
  sorted.forEach((b) => {
    const d = dayKey(new Date(b.appointment));
    if (!out.length || out[out.length - 1].day !== d) out.push({ day: d, items: [] });
    out[out.length - 1].items.push(b);
  });
  return out;
}

export const rangeLabel = (b) => {
  const s = new Date(b.appointment), e = endOf(b), f = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return { start: f(s), end: f(e), minutes: durationOf(b) };
};

/** Màu pastel ổn định cho avatar theo tên. */
export const avatarTone = (name = '') => {
  let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360;
  return { bg: `hsl(${h} 70% 90%)`, fg: `hsl(${h} 45% 28%)` };
};
