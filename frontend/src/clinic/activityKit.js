// Hằng số và hàm thuần cho module Hoạt động (kiểu Pabau Activities). Không phụ thuộc React → dễ kiểm thử.
export const STATES = [
  ['todo', 'Cần làm', '#596b7a', '#f0f2f5'],
  ['pending', 'Đang chờ', '#1559ac', '#e6f1fc'],
  ['awaiting_reply', 'Chờ phản hồi', '#0b687a', '#e1f5f9'],
  ['working', 'Đang xử lý', '#805900', '#fdf3da'],
  ['stuck', 'Bị kẹt', '#bd2435', '#fde8ea'],
  ['done', 'Đã xong', '#126e43', '#e2f6ec'],
];
export const STATE = Object.fromEntries(STATES.map(([k, label, color, bg]) => [k, { label, color, bg }]));
STATE.skipped = { label: 'Bỏ qua', color: '#596b7a', bg: '#f0f2f5' };

export const TABS = [['todo', 'Cần làm', true], ['overdue', 'Quá hạn', true], ['today', 'Hôm nay'], ['tomorrow', 'Ngày mai'], ['this_week', 'Tuần này'], ['next_week', 'Tuần sau'], ['completed', 'Đã hoàn thành', true]];
export const COLUMNS = [['done', 'Xong'], ['due', 'Hạn'], ['activity', 'Hoạt động'], ['linked', 'Khách hàng'], ['assigned', 'Phụ trách'], ['status', 'Trạng thái'], ['created', 'Tạo bởi']];
export const DEFAULT_COLS = ['done', 'due', 'activity', 'linked', 'assigned', 'status'];

export const pad = (n) => String(n).padStart(2, '0');
export const localDay = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
/** ISO -> {date:'YYYY-MM-DD', time:'HH:MM'} theo giờ máy */
export const splitDateTime = (iso) => { const d = new Date(iso); return { date: localDay(d), time: localTime(d) }; };
/** ('YYYY-MM-DD','HH:MM') -> ISO UTC */
export const joinDateTime = (date, time) => new Date(`${date}T${time || '00:00'}`).toISOString();
export const fmtDue = (iso) => { if (!iso) return '—'; const d = new Date(iso); const h = d.getHours(); return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(h % 12 || 12)}:${pad(d.getMinutes())} ${h < 12 ? 'AM' : 'PM'}`; };
export const fmtDay = (iso) => { const d = new Date(iso); return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`; };

/** Giờ mặc định cho form tạo: bắt đầu ở mốc 5 phút kế tiếp và kéo dài 10 phút. */
export function defaultRange(now = new Date()) {
  const s = new Date(now); s.setSeconds(0, 0); s.setMinutes(Math.ceil((s.getMinutes() + 1) / 5) * 5);
  const e = new Date(s.getTime() + 10 * 60000);
  return { from: splitDateTime(s.toISOString()), to: splitDateTime(e.toISOString()) };
}

const TOKEN = /\{\{(invoice|plan|booking|visit):(\d+)\}\}/g;
/** Tách ghi chú thành các đoạn văn bản và liên kết: [{text}|{link}] — link lấy từ `links` do server trả về. */
export function splitNote(note = '', links = []) {
  const byToken = Object.fromEntries(links.filter((l) => l.token).map((l) => [l.token, l]));
  const out = []; let last = 0;
  for (const m of note.matchAll(TOKEN)) {
    if (m.index > last) out.push({ text: note.slice(last, m.index) });
    out.push(byToken[m[0]] ? { link: byToken[m[0]] } : { text: '(hồ sơ đã bị xóa)' });
    last = m.index + m[0].length;
  }
  if (last < note.length) out.push({ text: note.slice(last) });
  return out;
}
export const tokensIn = (note = '') => [...new Set([...note.matchAll(TOKEN)].map((m) => m[0]))];
export const removeToken = (note, token) => note.split(token).join('').replace(/ {2,}/g, ' ').trim();

/** Bản sao ràng buộc của server để báo lỗi sớm ngay trên form. Trả về { field: message }. */
export function validateForm(f) {
  const e = {};
  if (!f.type) e.type = 'Hãy chọn loại hoạt động.';
  if (!f.patient && !f.conversation) e.patient = 'Hãy chọn bệnh nhân hoặc khách tiềm năng.';
  if ((f.title || '').length > 200) e.title = 'Tên hoạt động tối đa 200 ký tự.';
  if (!f.fromDate || !f.toDate) e.end_at = 'Hãy chọn hạn xử lý.';
  else {
    const s = new Date(`${f.fromDate}T${f.fromTime || '00:00'}`), t = new Date(`${f.toDate}T${f.toTime || '00:00'}`);
    if (t < s) e.end_at = 'Giờ kết thúc phải sau giờ bắt đầu.';
    else if (t - s > 30 * 864e5) e.end_at = 'Khoảng thời gian tối đa 30 ngày.';
  }
  return e;
}

/** Nhóm cho tab hồ sơ bệnh nhân: Quá hạn / Đã lên lịch / Hoàn thành */
export function groupForClient(list) {
  const g = { overdue: [], scheduled: [], done: [] };
  list.forEach((a) => (a.status !== 'pending' ? g.done : a.overdue ? g.overdue : g.scheduled).push(a));
  g.overdue.sort((a, b) => new Date(a.end_at) - new Date(b.end_at));
  g.scheduled.sort((a, b) => new Date(a.end_at) - new Date(b.end_at));
  g.done.sort((a, b) => new Date(b.completed_at || b.end_at) - new Date(a.completed_at || a.end_at));
  return g;
}

/** Trạng thái tiếp theo khi bấm vòng tròn "Xong". */
export const toggleTarget = (a) => (a.status === 'pending' ? 'done' : 'todo');
