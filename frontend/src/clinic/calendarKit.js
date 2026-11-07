// Hằng số và hàm thuần cho lịch hẹn kiểu Pabau. Không phụ thuộc React nên dễ kiểm thử.
export const START_H = 7, END_H = 20, STEP = 10, ROW = 28;      // mỗi ô 10 phút cao 28px như Pabau
export const PPM = ROW / STEP;                                    // px mỗi phút
export const GRID_H = (END_H - START_H) * 60 * PPM;

export const TYPES = { consult: 'Khám / tư vấn', follow_up: 'Tái khám', procedure: 'Thủ thuật', session: 'Buổi liệu trình' };
export const BLOCK_KINDS = { lunch: 'Nghỉ trưa', meeting: 'Họp', off: 'OFF', other: 'Khác' };
export const CONFIRM_STATES = [
  ['unconfirmed', 'Chưa xác nhận'], ['waiting_reply', 'Chờ khách trả lời'], ['replied_no', 'Khách trả lời không đến'],
  ['confirmed', 'Đã xác nhận'], ['unable_contact', 'Không liên lạc được'],
];
export const STEPS = ['Chờ xác nhận', 'Đã xác nhận', 'Đã đến', 'Đang khám', 'Hoàn thành'];

export const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseDay = (iso) => new Date(`${iso}T00:00:00`);
export const addDays = (iso, n) => { const d = parseDay(iso); d.setDate(d.getDate() + n); return dayKey(d); };
export const addMonths = (iso, n) => { const d = parseDay(iso); d.setMonth(d.getMonth() + n); return dayKey(d); };
export const mondayOf = (iso) => addDays(iso, -((parseDay(iso).getDay() + 6) % 7));
export const minutesOf = (d) => d.getHours() * 60 + d.getMinutes();
export const atMinute = (iso, min) => { const d = parseDay(iso); d.setMinutes(min); return d; };
export const hhmm = (min) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const label12 = (min) => { const h = Math.floor(min / 60); return `${pad(h % 12 || 12)}:${pad(min % 60)} ${h < 12 ? 'AM' : 'PM'}`; };
export const clock12 = (d) => label12(minutesOf(new Date(d)));
export const clockShort = (d) => clock12(d).replace(/^0/, '').replace(' ', '').toLowerCase();
export const durationOf = (b) => b.duration_minutes || 60;
export const endOf = (b) => new Date(new Date(b.appointment).getTime() + durationOf(b) * 60000);
export const snap = (min, step = STEP) => Math.round(min / step) * step;
export const svcNames = (b) => (b.items || []).map((i) => i.service_name || i.service?.name).filter(Boolean).join(', ') || b.appointment_type_label || '';

/** Chỉ lịch chưa hoàn thành/hủy/vắng và chưa đón khách mới được dời, đổi thời lượng. */
export const isMovable = (b, canBook) => canBook && ['pending', 'confirmed'].includes(b.status) && !b.visit_id;

/** Xếp các lịch trùng giờ thành các làn song song. */
export function layoutLanes(items) {
  const sorted = [...items].sort((a, b) => new Date(a.appointment) - new Date(b.appointment));
  const lanes = [];
  const out = sorted.map((b) => {
    const s = minutesOf(new Date(b.appointment)), e = minutesOf(endOf(b));
    let i = lanes.findIndex((end) => end <= s);
    if (i < 0) { i = lanes.length; lanes.push(0); }
    lanes[i] = e;
    return { b, lane: i };
  });
  return out.map((o) => ({ ...o, lanes: Math.max(1, lanes.length) }));
}

/** Bước hiện tại của lịch hẹn (0..4) cho thanh trạng thái. */
export function stepIndex(b) {
  if (b.visit_status === 'completed' || b.status === 'completed') return 4;
  if (b.visit_status === 'in_consult') return 3;
  if (b.visit_status === 'waiting') return 2;
  return b.status === 'confirmed' ? 1 : 0;
}

/**
 * Bản sao phía giao diện của bộ ràng buộc ở server (core/availability.slot_error) để báo lỗi tức thì khi kéo/thả/đặt lịch.
 * Server vẫn là nơi quyết định cuối cùng. hours: { [staffId]: { [weekday 0=Thứ Hai]: [[startMin, endMin], ...] } } (có thể rỗng).
 */
export function findConflict({ staffId, start, minutes, bookings, blocks, hours, excludeId = null, now = new Date() }) {
  if (!staffId) return 'Cần chọn bác sĩ.';
  if (start <= now) return 'Giờ hẹn phải ở tương lai.';
  if (start.getMinutes() % 5) return 'Giờ hẹn phải tròn bội số 5 phút.';
  if (minutes < 10 || minutes > 480) return 'Thời lượng phải từ 10 đến 480 phút.';
  const end = new Date(start.getTime() + minutes * 60000);
  if (dayKey(end) !== dayKey(start)) return 'Lịch hẹn không được kéo dài qua nửa đêm.';
  const wins = hours?.[staffId]?.[(start.getDay() + 6) % 7];
  if (hours?.[staffId]) {
    const s = minutesOf(start), e = s + minutes;
    if (!wins || !wins.some(([a, b]) => a <= s && e <= b)) return 'Ngoài giờ làm việc của bác sĩ.';
  }
  for (const k of blocks || []) {
    if (k.staff !== staffId) continue;
    const ks = new Date(k.start), ke = new Date(k.end);
    if (start < ke && ks < end) return `Trùng khung "${BLOCK_KINDS[k.kind] || k.kind}" (${clock12(ks)}–${clock12(ke)}).`;
  }
  for (const b of bookings || []) {
    if (b.staff !== staffId || b.id === excludeId || ['cancelled', 'no_show'].includes(b.status)) continue;
    const bs = new Date(b.appointment), be = endOf(b);
    if (start < be && bs < end) return `Trùng lịch của ${b.customer_name} (${clock12(bs)}–${clock12(be)}).`;
  }
  return null;
}

/** [{staff, weekday, start_time:'08:00:00', end_time}] -> { [staffId]: { [weekday]: [[a,b]] } } */
export function indexHours(rows = []) {
  const out = {};
  rows.forEach((r) => {
    const [h1, m1] = r.start_time.split(':').map(Number), [h2, m2] = r.end_time.split(':').map(Number);
    ((out[r.staff] ||= {})[r.weekday] ||= []).push([h1 * 60 + m1, h2 * 60 + m2]);
  });
  return out;
}
