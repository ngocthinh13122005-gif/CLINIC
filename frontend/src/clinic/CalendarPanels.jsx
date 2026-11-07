import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import api from '../api/client';
import { errMsg, initials, money } from './ui';
import { PatientPicker } from './PatientForm';
import {
  CONFIRM_STATES, STEPS, TYPES, addDays, addMonths, clock12, dayKey, findConflict, hhmm,
  mondayOf, parseDay, stepIndex, svcNames, pad,
} from './calendarKit';

const MONTHS = ['Tháng 1', 'Tháng 2', 'Tháng 3', 'Tháng 4', 'Tháng 5', 'Tháng 6', 'Tháng 7', 'Tháng 8', 'Tháng 9', 'Tháng 10', 'Tháng 11', 'Tháng 12'];
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const WEEKDAY_FULL = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

/** Bấm ra ngoài thì đóng. */
function useOutside(onClose) {
  const ref = useRef(null);
  useEffect(() => {
    const fn = (e) => ref.current && !ref.current.contains(e.target) && onClose();
    const esc = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('mousedown', fn); document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('mousedown', fn); document.removeEventListener('keydown', esc); };
  }, [onClose]);
  return ref;
}

export function Dialog({ title, children, footer, onClose, wide }) {
  return <div className="pb-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="pb-modal" style={wide ? { width: 520 } : undefined} role="dialog" aria-label={title}>
      <div className="pb-modal-h">{title}<button onClick={onClose} aria-label="Đóng">×</button></div>
      <div className="pb-modal-b">{children}</div>
      <div className="pb-modal-f">{footer}</div>
    </div>
  </div>;
}

/* ---------------- Chọn ngày (ảnh 6) ---------------- */
function MonthGrid({ year, month, date, onPick }) {
  const lead = new Date(year, month, 1).getDay();
  const cells = Array.from({ length: 42 }, (_, i) => new Date(year, month, 1 - lead + i));
  return <div className="pb-month"><div className="pb-month-t">{MONTHS[month]} {year}</div>
    <div className="pb-month-g">{DOW.map((d) => <b key={d}>{d}</b>)}
      {cells.map((c) => <button key={c.getTime()} className={`${c.getMonth() !== month ? 'out' : ''} ${dayKey(c) === date ? 'sel' : ''} ${dayKey(c) === dayKey(new Date()) ? 'today' : ''}`}
        onClick={() => onPick(dayKey(c))}>{pad(c.getDate())}</button>)}</div></div>;
}

export function DatePopover({ date, onPick, onClose }) {
  const ref = useOutside(onClose);
  const [view, setView] = useState(() => { const d = parseDay(date); return { y: d.getFullYear(), m: d.getMonth() }; });
  const monday = mondayOf(date);
  const next = new Date(view.y, view.m + 1, 1);
  const quick = [['+ 2 tuần', 14], ['+ 4 tuần', 28], ['+ 6 tuần', 42], ['+ 3 tháng', 'm3'], ['+ 6 tháng', 'm6'], ['+ 12 tháng', 'm12']];
  const jump = (q) => onPick(typeof q === 'number' ? addDays(date, q) : addMonths(date, Number(q.slice(1))));
  const years = Array.from({ length: 7 }, (_, i) => new Date().getFullYear() - 2 + i);
  return <div className="pb-datepop" ref={ref}>
    <div className="pb-weekstrip">{Array.from({ length: 7 }, (_, i) => addDays(monday, i)).map((d) => { const x = parseDay(d); return (
      <button key={d} className={d === date ? 'on' : ''} onClick={() => onPick(d)}><small>{WEEKDAY_FULL[x.getDay()].replace('Thứ ', 'T').replace('Chủ nhật', 'CN')}</small><b>{x.getDate()}</b><span>{MONTHS[x.getMonth()]}</span></button>); })}</div>
    <div className="pb-date-main">
      <div className="pb-months">
        <div className="pb-month-ctl">
          <select value={view.m} onChange={(e) => setView({ ...view, m: Number(e.target.value) })}>{MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}</select>
          <select value={view.y} onChange={(e) => setView({ ...view, y: Number(e.target.value) })}>{years.map((y) => <option key={y}>{y}</option>)}</select>
          <button onClick={() => setView({ y: view.m ? view.y : view.y - 1, m: (view.m + 11) % 12 })}>‹</button>
          <button onClick={() => setView({ y: view.m < 11 ? view.y : view.y + 1, m: (view.m + 1) % 12 })}>›</button>
        </div>
        <div className="pb-months-g"><MonthGrid year={view.y} month={view.m} date={date} onPick={onPick} /><MonthGrid year={next.getFullYear()} month={next.getMonth()} date={date} onPick={onPick} /></div>
      </div>
      <div className="pb-quick">{quick.map(([l, q]) => <button key={l} onClick={() => jump(q)}>{l}</button>)}</div>
    </div>
  </div>;
}

/* ---------------- Bộ lọc nhân sự ---------------- */
export function FilterPopover({ doctors, hidden, setHidden, onClose }) {
  const ref = useOutside(onClose);
  const toggle = (id) => setHidden((h) => (h.includes(id) ? h.filter((x) => x !== id) : [...h, id]));
  return <div className="pb-filter" ref={ref}>
    <div className="pb-filter-h"><b>Hiển thị bác sĩ</b><button onClick={() => setHidden([])}>Chọn tất cả</button></div>
    {doctors.map((d) => <label key={d.id}><input type="checkbox" checked={!hidden.includes(d.id)} onChange={() => toggle(d.id)} /><span className="pb-av sm">{initials(d.name)}</span>{d.name}</label>)}
  </div>;
}

/* ---------------- Menu Create (ảnh 8) ---------------- */
export function CreateMenu({ onPick, onClose, canBook }) {
  const ref = useOutside(onClose);
  const items = [['client', '👤', 'Bệnh nhân', 'Shift + C'], canBook && ['appt', '▦', 'Lịch hẹn', 'Shift + A'], canBook && ['block', '⛔', 'Khóa giờ', 'Shift + B']].filter(Boolean);
  return <div className="pb-createmenu" ref={ref}><div className="pb-cm-h">Tạo mới<button onClick={onClose}>×</button></div>
    <div className="pb-cm-g">{items.map(([k, ic, l, sc]) => <button key={k} onClick={() => onPick(k)}><i>{ic}</i><span>{l}</span><kbd>{sc}</kbd></button>)}</div></div>;
}

/* ---------------- Bảng tạo / sửa lịch hẹn / khóa giờ (ảnh 7) ---------------- */
const TAB_KINDS = [['appt', 'Lịch hẹn'], ['lunch', 'Nghỉ trưa'], ['meeting', 'Họp'], ['off', 'OFF'], ['other', 'Khác']];
const toIso = (day, time) => new Date(`${day}T${time}`).toISOString();

export function BookingPanel({ init, doctors, services, bookings, blocks, hours, onClose, onSaved }) {
  const editing = init.booking || null, editBlock = init.block || null;
  const [tab, setTab] = useState(editBlock ? editBlock.kind : (init.tab || 'appt'));
  const [patient, setPatient] = useState(null);
  const [f, setF] = useState(() => editing ? {
    staff: editing.staff, date: dayKey(new Date(editing.appointment)), time: hhmm(new Date(editing.appointment).getHours() * 60 + new Date(editing.appointment).getMinutes()),
    type: editing.appointment_type, service_ids: (editing.items || []).map((i) => i.service), note: editing.note || '', dur: editing.duration_minutes, notify: false,
  } : editBlock ? {
    staff: editBlock.staff, date: dayKey(new Date(editBlock.start)), time: hhmm(new Date(editBlock.start).getHours() * 60 + new Date(editBlock.start).getMinutes()),
    end: hhmm(new Date(editBlock.end).getHours() * 60 + new Date(editBlock.end).getMinutes()), note: editBlock.note || '',
  } : { staff: init.staff || doctors[0]?.id || '', date: init.date, time: init.time || '09:00', end: hhmm(Math.min(23 * 60, Number((init.time || '09:00').slice(0, 2)) * 60 + Number((init.time || '09:00').slice(3)) + 60)), type: 'consult', service_ids: [], note: '', dur: null, notify: false });
  const [slots, setSlots] = useState([]);
  const [slotsError, setSlotsError] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const chosen = services.filter((s) => f.service_ids.includes(s.id));
  const natural = f.type === 'consult' ? 60 : chosen.reduce((a, s) => a + s.duration, 0);
  const minutes = f.dur || natural || 30;
  const total = chosen.reduce((a, s) => a + s.price, 0);
  useEffect(() => { // gợi ý giờ trống từ /availability/
    if (tab !== 'appt' || !f.staff || !f.date || (f.type === 'procedure' && !f.service_ids.length)) {
      setSlots([]);
      setSlotsError('');
      return undefined;
    }
    const t = setTimeout(() => api.get('/availability/', { params: {
      service_ids: f.service_ids.join(','), appointment_type: f.type, date: f.date, staff_id: f.staff,
    } }).then(({ data }) => {
      setSlots((data.staff?.find((row) => row.staff_id === Number(f.staff))?.slots || [])
        .map((slot) => hhmm(new Date(slot).getHours() * 60 + new Date(slot).getMinutes())));
      setSlotsError('');
    }).catch((error) => {
      setSlots([]);
      setSlotsError(errMsg(error, 'Không tải được khung giờ khả dụng.'));
    }), 250);
    return () => clearTimeout(t);
  }, [tab, f.service_ids, f.staff, f.date, f.type]);
  useEffect(() => {
    const esc = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc); return () => window.removeEventListener('keydown', esc);
  }, [onClose]);

  const isBlock = tab !== 'appt';
  const start = new Date(toIso(f.date, f.time));
  const conflict = useMemo(() => {
    if (!f.staff || !f.date || !f.time) return '';
    if (isBlock) {
      const end = new Date(toIso(f.date, f.end || f.time));
      if (end <= start) return 'Giờ kết thúc phải sau giờ bắt đầu.';
      if (start <= new Date()) return 'Không thể khóa khung giờ đã bắt đầu hoặc đã qua.';
      if (start.getMinutes() % 5 || end.getMinutes() % 5 || dayKey(start) !== dayKey(end)) return 'Giờ phải tròn bội số 5 phút và không được qua nửa đêm.';
      const block = (blocks || []).find((item) => item.id !== editBlock?.id && item.staff === Number(f.staff)
        && start < new Date(item.end) && new Date(item.start) < end);
      if (block) return 'Trùng với một khung giờ khóa khác của nhân sự này.';
      const hit = (bookings || []).find((b) => b.staff === Number(f.staff) && !['cancelled', 'no_show'].includes(b.status) && start < new Date(new Date(b.appointment).getTime() + (b.duration_minutes || 60) * 60000) && new Date(b.appointment) < end);
      return hit ? `Đang có lịch hẹn của ${hit.customer_name} lúc ${clock12(hit.appointment)} — hãy dời lịch đó trước.` : '';
    }
    if (f.type === 'procedure' && !f.service_ids.length) return 'Vui lòng chọn ít nhất một dịch vụ.';
    return findConflict({ staffId: Number(f.staff), start, minutes, bookings, blocks, hours, excludeId: editing?.id || null }) || '';
  }, [f, isBlock, bookings, blocks, hours, editing, minutes]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggleSvc = (id) => setF((s) => ({ ...s, dur: null, service_ids: s.service_ids.includes(id) ? s.service_ids.filter((x) => x !== id) : [...s.service_ids, id] }));
  const submit = async () => {
    setBusy(true); setErr('');
    try {
      if (isBlock) {
        const body = { staff: Number(f.staff), kind: tab, start: toIso(f.date, f.time), end: toIso(f.date, f.end), note: f.note };
        if (editBlock) await api.patch(`/blocked-times/${editBlock.id}/`, body); else await api.post('/blocked-times/', body);
        onSaved(editBlock ? 'Đã cập nhật khung giờ khóa.' : 'Đã khóa khung giờ.');
      } else if (editing) {
        await api.post(`/bookings/${editing.id}/edit/`, { staff: Number(f.staff), appointment: toIso(f.date, f.time), duration_minutes: minutes,
          service_ids: f.service_ids, note: f.note, appointment_type: f.type, notify: f.notify });
        onSaved('Đã lưu thay đổi lịch hẹn.');
      } else {
        await api.post('/bookings/', { patient: patient.id, staff: Number(f.staff), appointment: toIso(f.date, f.time), appointment_type: f.type, service_ids: f.service_ids, note: f.note });
        onSaved('Đã đặt lịch hẹn.');
      }
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const removeBlock = async () => {
    if (!window.confirm('Xóa khung giờ khóa này?')) return;
    try { await api.delete(`/blocked-times/${editBlock.id}/`); onSaved('Đã xóa khung giờ khóa.'); } catch (e) { setErr(errMsg(e)); }
  };
  const ready = isBlock ? !!f.staff && !conflict : !!f.staff && (f.type === 'consult' || f.service_ids.length > 0) && (editing || patient) && !conflict;
  const appointmentTypes = editing && !['consult', 'procedure'].includes(editing.appointment_type)
    ? [editing.appointment_type]
    : ['consult', 'procedure'];
  const serviceOptions = f.type === 'procedure'
    ? services.filter((service) => service.booking_policy === 'direct' || editing?.items?.some((item) => item.service === service.id))
    : services;
  const pat = patient || (editing && { full_name: editing.customer_name, code: editing.patient_code, phone: editing.customer_phone });

  return <div className="pb-dlg" role="dialog" aria-label="Tạo lịch hẹn mới">
    <div className="pb-dlg-h"><span>{editing ? 'Chỉnh sửa lịch hẹn' : editBlock ? 'Chỉnh sửa khung giờ khóa' : 'Tạo lịch hẹn mới'}</span><button onClick={onClose} aria-label="Đóng">×</button></div>
    <div className="pb-tabs">{TAB_KINDS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} disabled={(editing || editBlock) && ((editing ? 'appt' : editBlock.kind) !== k)}
      onClick={() => setTab(k)}>{l}</button>)}</div>
    <div className="pb-dlg-c">
      <div className="pb-form">
        {!isBlock && !editing && <PatientPicker value={patient} onPick={setPatient} autoFocus />}
        <h6>Chi tiết</h6>
        <div className="pb-box">
          <label>Địa điểm<select disabled><option>Ohio Clinic</option></select></label>
          <label>Bác sĩ<select value={f.staff} onChange={(e) => set('staff', Number(e.target.value))}>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
          {!isBlock && <>
            <label>Loại lịch hẹn<select value={f.type} onChange={(e) => { setF((s) => ({ ...s, type: e.target.value, dur: null })); setSlotsError(''); }}>{appointmentTypes.map((k) => <option key={k} value={k}>{TYPES[k]}</option>)}</select></label>
            <label>Dịch vụ{natural ? ` · ${natural} phút` : ''}</label>
            {editing?.treatment_session_id || editing?.follow_up_visit_id
              ? <p className="pb-muted">Dịch vụ được quản lý từ hồ sơ liệu trình/lượt khám đã liên kết.</p>
              : <div className="pb-svcs">{serviceOptions.map((s) => <label key={s.id} className={f.service_ids.includes(s.id) ? 'on' : ''}>
              <input type="checkbox" checked={f.service_ids.includes(s.id)} onChange={() => toggleSvc(s.id)} />
              <span>{s.name}<small>{s.duration} phút · {money(s.price)}</small></span></label>)}</div>}</>}
          <div className="pb-two">
            <label>Ngày<input type="date" value={f.date} onChange={(e) => set('date', e.target.value)} /></label>
            <label>Giờ bắt đầu<input type="time" step={300} value={f.time} onChange={(e) => set('time', e.target.value)} /></label>
          </div>
          {isBlock ? <label>Giờ kết thúc<input type="time" step={300} value={f.end} onChange={(e) => set('end', e.target.value)} /></label>
            : <label>Thời lượng<select value={minutes} onChange={(e) => set('dur', Number(e.target.value))}>
              {[...new Set([natural || 30, minutes, ...Array.from({ length: 95 }, (_, i) => 10 + i * 5)])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{m} phút</option>)}</select></label>}
          {!isBlock && slots.length > 0 && <div className="pb-slots"><small>Giờ còn trống</small>{slots.slice(0, 30).map((s) => <button key={s} className={s === f.time ? 'on' : ''} onClick={() => set('time', s)}>{s}</button>)}</div>}
          {slotsError && <div className="pb-err" role="alert">{slotsError}</div>}
        </div>
        <h6>Ghi chú</h6>
        <input className="pb-line" value={f.note} onChange={(e) => set('note', e.target.value)} placeholder="Thêm ghi chú…" />
        {editing && <label className="pb-notify"><input type="checkbox" checked={f.notify} onChange={(e) => set('notify', e.target.checked)} /> Gửi email thông báo nếu đổi giờ</label>}
        {conflict && <div className="pb-err">⚠ {conflict}</div>}
        {err && <div className="pb-err">{err}</div>}
      </div>
      <div className="pb-side">{pat ? <div><span className="pb-pop-av dark">{initials(pat.full_name)}</span><b>{pat.full_name}</b>
        <p>{[pat.code || pat.patient_code, pat.phone].filter(Boolean).join(' · ')}</p>{pat.allergies && <p className="pb-warning">Dị ứng: {pat.allergies}</p>}
        {editing?.reschedule_count > 0 && <p className="pb-muted">Đã dời {editing.reschedule_count} lần · giờ cũ {clock12(editing.rescheduled_from)}</p>}</div>
        : <p>{isBlock ? 'Khung giờ khóa sẽ chặn mọi lịch hẹn mới của bác sĩ.' : 'Tìm bệnh nhân có sẵn hoặc tạo hồ sơ mới.'}</p>}</div>
    </div>
    <div className="pb-foot">
      <div className="pb-foot-r">
        {editBlock && <button className="pb-btn red" onClick={removeBlock}>Xóa</button>}
        <button className="pb-btn blue wide" disabled={!ready || busy} onClick={submit}>
          {busy ? 'Đang lưu…' : isBlock ? (editBlock ? 'Lưu thay đổi' : 'Khóa khung giờ') : editing ? 'Lưu thay đổi' : 'Đặt lịch hẹn'}</button>
      </div>
      {!isBlock && <div className="pb-total">Tổng: {money(total)} <span>{minutes} phút</span></div>}
    </div>
  </div>;
}

/* ---------------- Popover chi tiết lịch hẹn (ảnh 2) ---------------- */
export function DetailPopover({ sel: { b, x, y }, canBook, onClose, act }) {
  const [menu, setMenu] = useState(false);
  const cur = stepIndex(b);
  const open = ['pending', 'confirmed'].includes(b.status) && !b.visit_id;
  const started = new Date(b.appointment) <= new Date();
  const statusLabel = b.status === 'no_show' ? 'Vắng mặt' : b.status === 'cancelled' ? 'Đã hủy' : b.running_late ? 'Đến trễ' : STEPS[cur];
  return <div className="pb-pop" style={{ left: x, top: y }} onMouseDown={(e) => e.stopPropagation()}>
    <div className="pb-pop-h">
      <button className="pb-x" onClick={onClose} aria-label="Đóng">×</button>
      <span className="pb-pop-av">{initials(b.customer_name)}</span>
      <h3>{b.customer_name}</h3>
      <span className="pb-chip">✉ {b.customer_email || '—'}</span>
      <span className="pb-chip">☎ {b.customer_phone || '—'}</span>
    </div>
    <div className="pb-pop-b">
      <div className="pb-steps">{STEPS.map((s, i) => {
        const click = canBook && open && ((i === 1 && b.status === 'pending') || (i === 2 && !b.visit_id));
        return <button key={s} disabled={!click} title={s} className={i === cur ? 'on' : i < cur ? 'done' : ''}
          onClick={() => act(i === 1 ? 'confirm' : 'arrive', b)}>{i === cur ? s : '✓'}</button>;
      })}</div>
      <div className="pb-status-row"><b>{statusLabel}</b>
        {b.running_late && b.status !== 'no_show' && <span className="pb-tag late">Đến trễ</span>}
        {b.reschedule_count > 0 && <span className="pb-tag">Đã dời {b.reschedule_count} lần</span>}
        <span className="pb-spacer" />
        <button className="pb-noshow" disabled={!canBook || !(open && started) && b.status !== 'no_show'} title={started ? '' : 'Chỉ đánh dấu sau giờ hẹn'}
          onClick={() => act(b.status === 'no_show' ? 'undo_no_show' : 'no_show', b)}>{b.status === 'no_show' ? 'Bỏ vắng mặt' : 'Vắng mặt'}</button></div>
      <div className="pb-svc"><span>{svcNames(b)}</span>{canBook && open && <button title="Sửa dịch vụ" onClick={() => act('edit', b)}>✎</button>}</div>
      <p className="pb-meta">{new Date(b.appointment).toLocaleDateString('vi-VN')} · {clock12(b.appointment)} · {b.duration_minutes} phút · {b.staff_name || 'Chưa phân công'}</p>
      {b.note && <p className="pb-meta">Ghi chú: {b.note}</p>}
      {b.cancel_reason && <p className="pb-meta">Lý do hủy: {b.cancel_reason}</p>}
      <div className="pb-acts">
        <button className="pb-btn" disabled={!canBook || !open} onClick={() => act('edit', b)}>✎ Sửa lịch hẹn</button>
        <button className="pb-btn red" disabled={!canBook || !['pending', 'confirmed'].includes(b.status) || !!b.visit_id} onClick={() => act('cancel', b)}>⊗ Hủy lịch</button>
        <button className="pb-btn" disabled={!canBook || !open} onClick={() => act('reschedule', b)}>▦ Đổi giờ</button>
        <button className="pb-btn" disabled={!canBook || !['completed', 'cancelled', 'no_show'].includes(b.status) || !['consult', 'procedure'].includes(b.appointment_type)} onClick={() => act('rebook', b)}>↻ Đặt lại</button>
        <div className="pb-qa-wrap">
          <button className="pb-btn" disabled={!canBook} onClick={() => setMenu(!menu)}>⚡ Thao tác nhanh</button>
          {menu && <div className="pb-qa">
            <button disabled={!open} onClick={() => act('late', b)}>{b.running_late ? 'Bỏ đánh dấu đến trễ' : 'Đánh dấu đến trễ'}</button>
            {CONFIRM_STATES.map(([k, l]) => <button key={k} disabled={!open} onClick={() => act('state:' + k, b)}>{l}</button>)}
          </div>}
        </div>
        {b.patient ? <Link className="pb-btn as-link" to={`/benh-nhan/${b.patient}`}>☰ Hồ sơ {b.patient_code}</Link> : <button className="pb-btn" disabled>☰ Chưa có hồ sơ</button>}
      </div>
      <hr />
      <div className="pb-checkrow">
        <button className="pb-btn blue wide" disabled={!canBook || !b.visit_id} title={b.visit_id ? '' : 'Cần đón bệnh nhân trước'} onClick={() => act('checkout', b)}>Thanh toán</button>
        <button className="pb-btn sq" title="Mở chi tiết" onClick={() => act('expand', b)}>⤢</button>
      </div>
    </div>
  </div>;
}

/* ---------------- Ngăn chi tiết bên phải (ảnh 3) ---------------- */
export function DetailDrawer({ b, canBook, onClose, act }) {
  const cur = stepIndex(b);
  const open = ['pending', 'confirmed'].includes(b.status) && !b.visit_id;
  const d = new Date(b.appointment);
  const chips = [['Chờ xác nhận', b.status === 'pending', null], ['Đã đến', cur >= 2, open ? 'arrive' : null], ['Hoàn thành', cur === 4, null], ['Đến trễ', b.running_late, open ? 'late' : null]];
  return <aside className="pb-drawer" onMouseDown={(e) => e.stopPropagation()}>
    <div className="pb-drawer-l">
      <div className="pb-dr-top"><button onClick={onClose}>× TỔNG QUAN BỆNH NHÂN</button></div>
      <div className="pb-dr-client"><span className="pb-pop-av dark">{initials(b.customer_name)}</span>
        <div><h3>{b.customer_name}</h3><p>{b.patient_code || 'Chưa có hồ sơ'}</p></div></div>
      <div className="pb-dr-card"><small>SĐT</small><b>{b.customer_phone || '—'}</b><small>Email</small><b>{b.customer_email || '—'}</b></div>
      {b.patient && <Link className="pb-btn as-link" to={`/benh-nhan/${b.patient}`}>Mở hồ sơ bệnh nhân</Link>}
    </div>
    <div className="pb-drawer-r">
      <div className="pb-dr-date"><div><small>THÁNG {d.getMonth() + 1}</small><b>{pad(d.getDate())}</b></div>
        <div><h3>{WEEKDAY_FULL[d.getDay()]}, {d.getDate()}/{d.getMonth() + 1}/{d.getFullYear()}</h3><p>{clock12(d)} · {TYPES[b.appointment_type]}</p></div>
        {b.status === 'no_show' && <span className="pb-tag red">Vắng mặt</span>}</div>
      <div className="pb-dr-status">{chips.map(([l, on, key]) => <button key={l} className={on ? 'on' : ''} disabled={!canBook || !key} onClick={() => act(key, b)}>{l}</button>)}
        <button className="pb-noshow big" disabled={!canBook || !(open && d <= new Date()) && b.status !== 'no_show'} onClick={() => act(b.status === 'no_show' ? 'undo_no_show' : 'no_show', b)}>{b.status === 'no_show' ? 'Bỏ vắng mặt' : 'Vắng mặt'}</button></div>
      <h6>Dịch vụ</h6>
      {(b.items || []).map((i) => <div className="pb-dr-svc" key={i.id}><b>{i.service_name}</b><span>{money(i.price)} · {b.staff_name}</span></div>)}
      <h6>Ghi chú</h6><div className="pb-dr-note">{b.note || 'Không có ghi chú.'}</div>
      <div className="pb-dr-total"><span>Tổng cộng</span><b>{money(b.total)}</b></div>
      <div className="pb-acts">
        <button className="pb-btn" disabled={!canBook || !open} onClick={() => act('edit', b)}>✎ Sửa</button>
        <button className="pb-btn" disabled={!canBook || !open} onClick={() => act('reschedule', b)}>▦ Đổi giờ</button>
        <button className="pb-btn" disabled={!canBook || !['completed', 'cancelled', 'no_show'].includes(b.status) || !['consult', 'procedure'].includes(b.appointment_type)} onClick={() => act('rebook', b)}>↻ Đặt lại</button>
        <button className="pb-btn red" disabled={!canBook || !open} onClick={() => act('cancel', b)}>⊗ Hủy lịch</button>
      </div>
      <button className="pb-btn blue wide" disabled={!canBook || !b.visit_id} onClick={() => act('checkout', b)}>Thanh toán</button>
    </div>
  </aside>;
}

/* ---------------- Tổng quan xác nhận (ảnh 5) ---------------- */
export function ConfirmDrawer({ date, bookings, doctors, onClose, onOpen, onState, canBook }) {
  const [filter, setFilter] = useState('');
  const rows = bookings.filter((b) => !['cancelled', 'no_show', 'completed'].includes(b.status)).sort((a, b) => new Date(a.appointment) - new Date(b.appointment));
  const count = (k) => rows.filter((b) => b.confirm_state === k).length;
  const shown = filter ? rows.filter((b) => b.confirm_state === filter) : rows;
  const docName = (id) => doctors.find((d) => d.id === id)?.name || '';
  const cards = [['unconfirmed', '!', '#f5a623'], ['waiting_reply', '⌛', '#4db6e8'], ['replied_no', '✕', '#ff5a64'], ['confirmed', '✓', '#35c27f'], ['unable_contact', '☎', '#8b929c']];
  return <div className="pb-confirm">
    <div className="pb-confirm-h"><div><b>Tổng quan xác nhận</b><small>{parseDay(date).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</small></div><button onClick={onClose}>Đóng</button></div>
    <div className="pb-confirm-b">
      <div className="pb-confirm-list">{shown.map((b) => <div className="pb-crow" key={b.id}>
        <time>{clock12(b.appointment)}</time><span className="pb-av sm">{initials(b.customer_name)}</span>
        <button className="pb-cname" onClick={() => onOpen(b)}><b>{b.customer_name}</b><small>{svcNames(b)}</small><em>{b.status === 'no_show' ? 'Vắng mặt' : STEPS[stepIndex(b)]}</em></button>
        <span className="pb-cdoc">{docName(b.staff)}</span>
        <select className={`pb-cstate s-${b.confirm_state}`} disabled={!canBook || ['completed', 'no_show'].includes(b.status) || !!b.visit_id} value={b.confirm_state} onChange={(e) => onState(b, e.target.value)}>
          {CONFIRM_STATES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <a className="pb-cico" href={b.customer_phone ? `tel:${b.customer_phone}` : undefined} title="Gọi" aria-disabled={!b.customer_phone}>☎</a>
      </div>)}{!shown.length && <div className="pb-empty">Không có lịch hẹn.</div>}</div>
      <div className="pb-confirm-s">{cards.map(([k, ic, c]) => <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(filter === k ? '' : k)}>
        <i style={{ background: c }}>{ic}</i><span>{CONFIRM_STATES.find((s) => s[0] === k)[1]}</span><b>{count(k)}</b></button>)}</div>
    </div>
  </div>;
}

/* ---------------- Hộp thoại xác nhận kéo-thả / đổi thời lượng ---------------- */
export function MoveDialog({ info, onConfirm, onCancel }) {
  const { b, kind, from, to, minutes, deltaMin, error } = info;
  return <Dialog title={kind === 'resize' ? 'Đổi thời lượng lịch hẹn' : 'Dời lịch hẹn'} onClose={onCancel}
    footer={<><button className="pb-btn" onClick={onCancel}>Hủy</button>
      {!error && kind === 'move' && <button className="pb-btn" onClick={() => onConfirm(false)}>Đổi giờ</button>}
      {!error && <button className="pb-btn blue" onClick={() => onConfirm(true)}>{kind === 'resize' ? 'Đổi thời lượng' : 'Đổi giờ & thông báo'}</button>}</>}>
    <p><b>{b.customer_name}</b> — {svcNames(b)}</p>
    {kind === 'resize' ? <p>Thời lượng: {b.duration_minutes} → <b>{minutes} phút</b> ({deltaMin > 0 ? '+' : ''}{deltaMin} phút)</p>
      : <p>{clock12(from)} → <b>{clock12(to.start)}</b>, {to.start.toLocaleDateString('vi-VN')}{to.staffName ? ` · ${to.staffName}` : ''}</p>}
    {error ? <div className="pb-err">⚠ {error}</div> : <p className="pb-muted">Lịch sẽ quay về trạng thái "Chờ xác nhận" vì đã đổi giờ.</p>}
  </Dialog>;
}

export function ReasonDialog({ b, onConfirm, onCancel }) {
  const [reason, setReason] = useState('');
  return <Dialog title="Hủy lịch hẹn" onClose={onCancel}
    footer={<><button className="pb-btn" onClick={onCancel}>Giữ lịch</button><button className="pb-btn red" onClick={() => onConfirm(reason)}>Xác nhận hủy</button></>}>
    <p>Hủy lịch của <b>{b.customer_name}</b> lúc {clock12(b.appointment)}?</p>
    <textarea className="pb-ta" rows={3} placeholder="Lý do hủy (không bắt buộc)" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={255} />
  </Dialog>;
}

/** Đổi giờ (kind='reschedule') hoặc đặt lại (kind='rebook'): chọn ngày, bác sĩ, giờ + gợi ý giờ trống. */
export function SlotDialog({ kind, b, doctors, bookings, blocks, hours, onConfirm, onCancel }) {
  const start = new Date(b.appointment);
  const [day, setDay] = useState(dayKey(kind === 'rebook' ? new Date(Date.now() + 7 * 864e5) : start));
  const [time, setTime] = useState(hhmm(start.getHours() * 60 + start.getMinutes()));
  const [staff, setStaff] = useState(b.staff);
  const [notify, setNotify] = useState(true);
  const [slots, setSlots] = useState([]);
  const ids = (b.items || []).map((i) => i.service).join(',');
  useEffect(() => {
    if (!ids) return;
    api.get('/availability/', { params: { service_ids: ids, date: day, staff_id: staff } })
      .then(({ data }) => setSlots((data.staff[0]?.slots || []).map((s) => hhmm(new Date(s).getHours() * 60 + new Date(s).getMinutes())))).catch(() => setSlots([]));
  }, [ids, day, staff]);
  const when = new Date(`${day}T${time}`);
  const conflict = findConflict({ staffId: Number(staff), start: when, minutes: b.duration_minutes || 60, bookings, blocks, hours, excludeId: kind === 'reschedule' ? b.id : null });
  return <Dialog title={kind === 'rebook' ? 'Đặt lại lịch hẹn' : 'Đổi giờ lịch hẹn'} onClose={onCancel} wide
    footer={<><button className="pb-btn" onClick={onCancel}>Hủy</button>
      <button className="pb-btn blue" disabled={!!conflict} onClick={() => onConfirm({ appointment: when.toISOString(), staff: Number(staff), notify })}>{kind === 'rebook' ? 'Đặt lại' : 'Lưu giờ mới'}</button></>}>
    <p><b>{b.customer_name}</b> — {svcNames(b)} ({b.duration_minutes} phút)</p>
    <div className="pb-two pb-box">
      <label>Ngày<input type="date" value={day} onChange={(e) => setDay(e.target.value)} /></label>
      <label>Giờ<input type="time" step={300} value={time} onChange={(e) => setTime(e.target.value)} /></label>
      <label style={{ gridColumn: '1 / -1' }}>Bác sĩ<select value={staff} onChange={(e) => setStaff(Number(e.target.value))}>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
    </div>
    {slots.length > 0 && <div className="pb-slots"><small>Giờ còn trống</small>{slots.slice(0, 30).map((s) => <button key={s} className={s === time ? 'on' : ''} onClick={() => setTime(s)}>{s}</button>)}</div>}
    <label className="pb-notify"><input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Gửi email thông báo cho khách</label>
    {conflict && <div className="pb-err">⚠ {conflict}</div>}
  </Dialog>;
}
