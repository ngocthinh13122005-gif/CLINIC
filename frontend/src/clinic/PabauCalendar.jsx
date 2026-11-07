import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import EventNoteRounded from '@mui/icons-material/EventNoteRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Loading, errMsg, initials, isoDay, useLoad, useToast } from './ui';
import { PatientFormModal } from './PatientForm';
import {
  BLOCK_KINDS, END_H, GRID_H, PPM, START_H, STEP, TYPES, addDays, atMinute, clock12, clockShort, dayKey, durationOf, findConflict,
  hhmm, indexHours, isMovable, label12, layoutLanes, mondayOf, minutesOf, parseDay, snap, svcNames,
} from './calendarKit';
import { BookingPanel, ConfirmDrawer, CreateMenu, DatePopover, DetailDrawer, DetailPopover, FilterPopover, MoveDialog, ReasonDialog, SlotDialog } from './CalendarPanels';
import './pabau-calendar.css';

const SLOTS = Array.from({ length: (END_H - START_H) * 6 }, (_, i) => START_H * 60 + i * STEP);
const MON = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

export default function PabauCalendar({ initialDate, onDateChange, onSwitchList }) {
  const { user } = useAuth();
  const nav = useNavigate();
  const canBook = ['consultant', 'manager', 'doctor'].includes(user.role);
  const [view, setView] = useState('day');
  const [date, setCalendarDate] = useState(initialDate || isoDay());
  const setDate = (nextDate) => {
    setCalendarDate(nextDate);
    onDateChange?.(nextDate);
  };
  const [hidden, setHidden] = useState([]);
  const [pop, setPop] = useState({ date: false, filter: false, create: false, confirm: false });
  const [sel, setSel] = useState(null);             // popover chi tiết {b,x,y}
  const [drawerId, setDrawerId] = useState(null);
  const [panel, setPanel] = useState(null);         // bảng tạo/sửa
  const [dlg, setDlg] = useState(null);             // {type:'move'|'cancel'|'slot', ...}
  const [newPatient, setNewPatient] = useState(false);
  const [now, setNow] = useState(new Date());
  const [hover, setHover] = useState(null);
  const [ghost, setGhost] = useState(null);
  const [alert, setAlert] = useState('');
  const [toast, toastNode] = useToast();
  const rootRef = useRef(null);
  const colEls = useRef({});
  const dragRef = useRef(null);
  const scrollRef = useRef(null);
  const todayIso = isoDay();

  useEffect(() => {
    if (initialDate && initialDate !== date) setCalendarDate(initialDate);
  }, [initialDate, date]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const range = view === 'week' ? [mondayOf(date), addDays(mondayOf(date), 6)] : [date, date];
  const staff = useLoad(async () => (await api.get('/staff/')).data, []);
  const services = useLoad(async () => (await api.get('/services/')).data, []);
  const hoursQ = useLoad(async () => (await api.get('/working-hours/')).data, []);
  const bookQ = useLoad(async () => { const { data } = await api.get('/bookings/', { params: { from: range[0], to: range[1] } }); return data.results || data; }, [range[0], range[1]]);
  const blockQ = useLoad(async () => { const { data } = await api.get('/blocked-times/', { params: { from: range[0], to: range[1] } }); return data.results || data; }, [range[0], range[1]]);

  const allDoctors = useMemo(() => {
    const rows = (staff.data?.results || staff.data || []).filter((s) => s.account_role === 'doctor' && s.is_active);
    return user.role === 'doctor' ? rows.filter((s) => s.user_id === user.id) : rows;
  }, [staff.data, user]);
  const doctors = allDoctors.filter((d) => !hidden.includes(d.id));
  const svcList = (services.data?.results || services.data || []).filter((s) => s.is_active);
  const hours = useMemo(() => indexHours(hoursQ.data?.results || hoursQ.data || []), [hoursQ.data]);
  const bookings = useMemo(() => (bookQ.data || []).filter((b) => b.status !== 'cancelled'), [bookQ.data]);
  const blocks = blockQ.data?.results || blockQ.data || [];
  const reload = () => {
    staff.reload(true);
    services.reload(true);
    hoursQ.reload(true);
    bookQ.reload(true);
    blockQ.reload(true);
  };
  const loadError = staff.error || services.error || hoursQ.error || bookQ.error || blockQ.error;
  const days = view === 'week' ? Array.from({ length: 7 }, (_, i) => addDays(mondayOf(date), i)) : [date];
  const cols = days.flatMap((d, di) => doctors.map((s, si) => ({ key: `${d}|${s.id}`, day: d, staff: s, first: si === 0 && di > 0 })));
  const gridCols = `66px repeat(${Math.max(1, cols.length)}, minmax(${view === 'week' ? 84 : 170}px, 1fr))`;
  const nowTop = (minutesOf(now) - START_H * 60) * PPM;
  const dayBookings = bookings.filter((b) => dayKey(new Date(b.appointment)) === date);
  const unconfirmed = dayBookings.filter((b) => b.confirm_state === 'unconfirmed' && ['pending', 'confirmed', 'checked_in', 'in_progress'].includes(b.status)).length;

  // cuộn tới giờ hiện tại
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = days.includes(todayIso) ? Math.max(0, nowTop - 220) : 0; }, [date, view, staff.loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // phím tắt giống Pabau
  useEffect(() => {
    const fn = (e) => {
      if (!e.shiftKey || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'a' && canBook) openCreate(); else if (k === 'b' && canBook) openCreate('lunch'); else if (k === 'c') setNewPatient(true); else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', fn); return () => window.removeEventListener('keydown', fn);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const openCreate = (tab) => { setSel(null); setPop((p) => ({ ...p, create: false })); setPanel({ staff: doctors[0]?.id, date, time: '09:00', tab }); };
  const togglePop = (k) => setPop((p) => ({ date: false, filter: false, create: false, confirm: false, [k]: !p[k] }));
  const go = (n) => setDate(addDays(date, n));
  const run = async (fn, msg) => { setAlert(''); try { await fn(); if (msg) toast(msg); setSel(null); reload(); return true; } catch (e) { setAlert(errMsg(e)); return false; } };

  /* ---- hành động trên lịch hẹn ---- */
  const act = (kind, b) => {
    if (kind === 'confirm') return run(() => api.post(`/bookings/${b.id}/confirm/`), 'Đã xác nhận lịch hẹn.');
    if (kind === 'arrive') return run(() => api.post('/clinic/visits/from-booking/', { booking_id: b.id }), 'Đã đón bệnh nhân — đang chờ ở sảnh.');
    if (kind === 'edit') { setSel(null); setDrawerId(null); return setPanel({ booking: b }); }
    if (kind === 'cancel') { setSel(null); return setDlg({ type: 'cancel', b }); }
    if (kind === 'reschedule' || kind === 'rebook') { setSel(null); return setDlg({ type: 'slot', kind, b }); }
    if (kind === 'late') return run(() => api.post(`/bookings/${b.id}/running-late/`, { late: !b.running_late }), b.running_late ? 'Đã bỏ đánh dấu đến trễ.' : 'Đã đánh dấu khách đến trễ.');
    if (kind === 'no_show') return run(() => api.post(`/bookings/${b.id}/no-show/`), 'Đã đánh dấu vắng mặt.');
    if (kind === 'undo_no_show') return run(() => api.post(`/bookings/${b.id}/no-show/`, { undo: true }), 'Đã bỏ đánh dấu vắng mặt.');
    if (kind.startsWith('state:')) return run(() => api.post(`/bookings/${b.id}/confirm-state/`, { state: kind.slice(6) }), 'Đã cập nhật tình trạng liên hệ.');
    if (kind === 'checkout') return nav('/thu-ngan');
    if (kind === 'expand') { setSel(null); return setDrawerId(b.id); }
    return null;
  };
  const openDetail = (e, b) => {
    const r = e.currentTarget.getBoundingClientRect();
    setSel({ b, x: Math.max(8, Math.min(r.right + 8, window.innerWidth - 392)), y: Math.max(8, Math.min(r.top - 30, window.innerHeight - 600)) });
  };

  /* ---- kéo-thả / kéo đổi thời lượng ---- */
  const ctx = useRef(); ctx.current = { cols, bookings, blocks, hours, canBook, user };
  const startDrag = (e, b, mode, col) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (!isMovable(b, ctx.current.canBook)) return;
    dragRef.current = { b, mode, x0: e.clientX, y0: e.clientY, moved: false, startMin: minutesOf(new Date(b.appointment)), dur: durationOf(b), colKey: col.key, el: e.currentTarget.closest('.pb-ev') };
    window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp);
  };
  function onMove(e) {
    const d = dragRef.current; if (!d) return;
    if (!d.moved && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 5) return;
    d.moved = true;
    const { cols: cs, bookings: bs, blocks: ks, hours: hs } = ctx.current;
    const dy = (e.clientY - d.y0) / PPM;
    let key = d.colKey, start = d.startMin, dur = d.dur;
    if (d.mode === 'resize') dur = Math.max(10, snap(d.dur + dy)); else {
      start = snap(d.startMin + dy);
      const hit = cs.find((c) => { const r = colEls.current[c.key]?.getBoundingClientRect(); return r && e.clientX >= r.left && e.clientX < r.right; });
      if (hit) key = hit.key;
    }
    const col = cs.find((c) => c.key === key);
    const when = atMinute(col.day, start);
    const error = findConflict({ staffId: col.staff.id, start: when, minutes: dur, bookings: bs, blocks: ks, hours: hs, excludeId: d.b.id });
    d.last = { key, col, start, dur, when, error };
    setGhost({ key, top: (start - START_H * 60) * PPM, height: dur * PPM, ok: !error, label: `${label12(start)} – ${label12(start + dur)}`, error });
  }
  function onUp(e) {
    window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp);
    const d = dragRef.current; dragRef.current = null; setGhost(null);
    if (!d) return;
    if (!d.moved || !d.last) { openDetail({ currentTarget: d.el }, d.b); return; }
    const { col, when, dur, error } = d.last;
    const same = col.staff.id === d.b.staff && when.getTime() === new Date(d.b.appointment).getTime() && dur === durationOf(d.b);
    if (same) return;
    setDlg({ type: 'move', info: { b: d.b, kind: d.mode, from: d.b.appointment, to: { start: when, staffId: col.staff.id, staffName: col.staff.id !== d.b.staff ? col.staff.name : '' },
      minutes: dur, deltaMin: dur - durationOf(d.b), error } });
    e.preventDefault?.();
  }
  const confirmMove = async ({ b, kind, to, minutes }, notify) => {
    const body = kind === 'resize' ? { duration_minutes: minutes } : { appointment: to.start.toISOString(), staff: to.staffId, notify };
    setDlg(null);
    await run(() => api.post(`/bookings/${b.id}/edit/`, body), kind === 'resize' ? 'Đã đổi thời lượng.' : 'Đã đổi giờ lịch hẹn.');
  };

  /* ---- ô trống: tạo mới + tooltip giờ ---- */
  const minuteAt = (e, colEl) => START_H * 60 + Math.floor((e.clientY - colEl.getBoundingClientRect().top) / PPM / STEP) * STEP;
  const clickCol = (e, c) => {
    if (e.target !== e.currentTarget) return;
    setSel(null); setPop({ date: false, filter: false, create: false, confirm: false });
    if (canBook) setPanel({ staff: c.staff.id, date: c.day, time: hhmm(minuteAt(e, e.currentTarget)) });
  };
  const moveCol = (e, c) => {
    if (dragRef.current || e.target !== e.currentTarget) { if (hover) setHover(null); return; }
    const m = minuteAt(e, e.currentTarget);
    if (!hover || hover.m !== m || hover.k !== c.key) setHover({ m, k: c.key, x: e.clientX, y: e.clientY, name: c.staff.name, day: c.day });
  };

  const toggleFull = () => { const el = rootRef.current; if (!document.fullscreenElement) el?.requestFullscreen?.(); else document.exitFullscreen?.(); };
  const dateLabel = view === 'week'
    ? `${parseDay(days[0]).getDate()} – ${parseDay(days[6]).getDate()} ${MON[parseDay(days[6]).getMonth()]} ${parseDay(days[6]).getFullYear()}`
    : date === todayIso ? 'Go to Today' : parseDay(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const step = view === 'week' ? 7 : 1;
  const drawerB = drawerId && (bookQ.data || []).find((b) => b.id === drawerId);
  const panelOpen = !!panel;

  return <div className="pb-calendar" ref={rootRef}>
    <div className="pb-bar">
      <div className="pb-nav">
        <button onClick={() => go(-step)} title={view === 'week' ? 'Tuần trước' : 'Ngày trước'}>‹</button>
        <button onClick={() => go(-7)} title="Tuần trước">«</button>
        <button className="pb-date" onClick={() => togglePop('date')} title="Chọn ngày">{dateLabel} ▾</button>
        <button onClick={() => go(7)} title="Tuần sau">»</button>
        <button onClick={() => go(step)} title={view === 'week' ? 'Tuần sau' : 'Ngày sau'}>›</button>
      </div>
      {pop.date && <DatePopover date={date} onPick={(d) => { setDate(d); setPop({ ...pop, date: false }); }} onClose={() => setPop((p) => ({ ...p, date: false }))} />}
      {date !== todayIso && <button className="pb-ghost" onClick={() => setDate(todayIso)}>Hôm nay</button>}
      <div className="pb-legend">{Object.entries(TYPES).map(([k, v]) => <span key={k}><i className={`t-${k}`} />{v}</span>)}</div>
      <span className="pb-spacer" />
      <div className="pb-relative"><button className="pb-icon" onClick={() => togglePop('filter')} title="Lọc bác sĩ">⚲ Lọc{hidden.length > 0 && <sup>{allDoctors.length - hidden.length}</sup>}</button>
        {pop.filter && <FilterPopover doctors={allDoctors} hidden={hidden} setHidden={setHidden} onClose={() => setPop((p) => ({ ...p, filter: false }))} />}</div>
      <button className="pb-icon" onClick={() => togglePop('confirm')} title="Tổng quan xác nhận">✉{unconfirmed > 0 && <sup>{unconfirmed}</sup>}</button>
      <button className="pb-icon" onClick={toggleFull} title="Toàn màn hình">⤢</button>
      <button className="pb-icon" onClick={reload} title="Làm mới">↻</button>
      <button className="pb-icon" onClick={onSwitchList} title="Xem danh sách lịch hẹn" aria-label="Xem danh sách lịch hẹn"><EventNoteRounded fontSize="small" /></button>
      <select className="pb-select" value={view} onChange={(e) => setView(e.target.value)} aria-label="Chế độ xem"><option value="day">Day</option><option value="week">Week</option></select>
      <div className="pb-relative">
        <button className="pb-create" onClick={() => togglePop('create')}><b>⊕</b> Create</button>
        {pop.create && <CreateMenu canBook={canBook} onClose={() => setPop((p) => ({ ...p, create: false }))}
          onPick={(k) => { setPop((p) => ({ ...p, create: false })); if (k === 'client') setNewPatient(true); else openCreate(k === 'block' ? 'lunch' : undefined); }} />}
      </div>
    </div>
    {(alert || loadError) && <div className="pb-alert" role="alert">⚠ {alert || loadError}<button onClick={() => { setAlert(''); reload(); }}>Thử lại</button></div>}

    {pop.confirm && <ConfirmDrawer date={date} bookings={dayBookings} doctors={allDoctors} canBook={canBook} onClose={() => setPop((p) => ({ ...p, confirm: false }))}
      onOpen={(b) => { setPop((p) => ({ ...p, confirm: false })); setDrawerId(b.id); }} onState={(b, s) => act(`state:${s}`, b)} />}

    {(staff.loading || bookQ.loading) && !bookQ.data ? <Loading /> :
      <div className="pb-scroll" ref={scrollRef} onMouseDown={() => { setSel(null); }} onMouseLeave={() => setHover(null)}>
        <div className={`pb-grid ${view}`} style={{ gridTemplateColumns: gridCols }}>
          <div className="pb-corner" style={{ gridRow: view === 'week' ? 'span 2' : undefined }} />
          {view === 'week' && days.map((d) => { const x = parseDay(d); return <div key={d} className={`pb-dayh ${d === todayIso ? 'today' : ''}`} style={{ gridColumn: `span ${Math.max(1, doctors.length)}` }}
            onClick={() => { setDate(d); setView('day'); }}><small>{DOW[x.getDay()]}</small> <b>{x.getDate()}</b> {MON[x.getMonth()]}</div>; })}
          {cols.map((c) => <div className={`pb-head ${c.first ? 'day-start' : ''}`} style={view === 'week' ? { top: 30 } : undefined} key={`h${c.key}`}>
            <span className="pb-av">{initials(c.staff.name)}</span>
            {view === 'day' && <><b>{c.staff.name}</b><small>● Ohio Clinic</small><em>{c.staff.position}</em></>}</div>)}
          {!cols.length && <div className="pb-head"><em>Chưa có bác sĩ nào được hiển thị.</em></div>}
          <div className="pb-times" style={{ height: GRID_H }}>{SLOTS.map((m) => <span key={m} className={m % 60 === 0 ? 'hr' : ''} style={{ top: (m - START_H * 60) * PPM }}>{label12(m)}</span>)}</div>
          {cols.map((c) => <Column key={c.key} c={c} view={view} todayIso={todayIso} now={now} nowTop={nowTop} showNow={c.key === cols.find((x) => x.day === todayIso)?.key}
            bookings={bookings.filter((b) => b.staff === c.staff.id && dayKey(new Date(b.appointment)) === c.day)}
            blocks={blocks.filter((k) => k.staff === c.staff.id && dayKey(new Date(k.start)) === c.day)} hours={hours[c.staff.id]}
            sel={sel} ghost={ghost?.key === c.key ? ghost : null} draft={panel && !panel.booking && !panel.block && panel.staff === c.staff.id && panel.date === c.day ? panel : null}
            setRef={(el) => { colEls.current[c.key] = el; }} onClick={(e) => clickCol(e, c)} onMove={(e) => moveCol(e, c)} onLeave={() => setHover(null)}
            onStart={(e, b, mode) => startDrag(e, b, mode, c)} onOpen={openDetail} canBook={canBook} onBlock={(k) => canBook && setPanel({ block: k })} />)}
        </div>
      </div>}

    {hover && !ghost && !sel && <div className="pb-tip" style={{ left: hover.x + 14, top: hover.y + 14 }}><b>{hover.name} · {label12(hover.m)}</b><small>{parseDay(hover.day).toLocaleDateString('vi-VN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })}</small></div>}
    {ghost && ghost.error && <div className="pb-tip err" style={{ right: 24, bottom: 24 }}>{ghost.error}</div>}

    {sel && <DetailPopover sel={sel} canBook={canBook} onClose={() => setSel(null)} act={act} />}
    {drawerB && <DetailDrawer b={drawerB} canBook={canBook} onClose={() => setDrawerId(null)} act={act} />}
    {panelOpen && <BookingPanel key={panel.booking?.id || panel.block?.id || `${panel.staff}${panel.date}${panel.time}${panel.tab}`} init={panel} doctors={allDoctors} services={svcList}
      bookings={bookings} blocks={blocks} hours={hours} onClose={() => setPanel(null)} onSaved={(m) => { setPanel(null); toast(m); reload(); }} />}

    {dlg?.type === 'move' && <MoveDialog info={dlg.info} onCancel={() => setDlg(null)} onConfirm={(notify) => confirmMove(dlg.info, notify)} />}
    {dlg?.type === 'cancel' && <ReasonDialog b={dlg.b} onCancel={() => setDlg(null)}
      onConfirm={async (reason) => { const b = dlg.b; setDlg(null); await run(() => api.post(`/bookings/${b.id}/cancel/`, { reason }), 'Đã hủy lịch hẹn.'); }} />}
    {dlg?.type === 'slot' && <SlotDialog kind={dlg.kind} b={dlg.b} doctors={allDoctors} bookings={bookings} blocks={blocks} hours={hours} onCancel={() => setDlg(null)}
      onConfirm={async (p) => { const { kind, b } = dlg; setDlg(null);
        await run(() => (kind === 'rebook' ? api.post(`/bookings/${b.id}/rebook/`, p) : api.post(`/bookings/${b.id}/edit/`, p)), kind === 'rebook' ? 'Đã đặt lại lịch hẹn.' : 'Đã đổi giờ lịch hẹn.'); }} />}
    <PatientFormModal open={newPatient} onClose={() => setNewPatient(false)} onSaved={() => { setNewPatient(false); toast('Đã tạo hồ sơ bệnh nhân.'); }} />
    {toastNode}
  </div>;
}

/** Một cột (bác sĩ × ngày): nền giờ, vùng ngoài giờ làm, khung khóa, lịch hẹn, bóng kéo-thả. */
function Column({ onOpen, c, bookings, blocks, hours, sel, ghost, draft, setRef, onClick, onMove, onLeave, onStart, canBook, onBlock, todayIso, now, nowTop, showNow, view }) {
  const lay = layoutLanes(bookings);
  const wd = (parseDay(c.day).getDay() + 6) % 7;
  const wins = hours ? hours[wd] || [] : null;       // null = không biết giờ làm -> không tô xám
  const off = [];
  if (wins) { let cur = START_H * 60; [...wins].sort((a, b) => a[0] - b[0]).forEach(([a, b]) => { if (a > cur) off.push([cur, Math.min(a, END_H * 60)]); cur = Math.max(cur, b); }); if (cur < END_H * 60) off.push([cur, END_H * 60]); }
  const pastH = c.day < todayIso ? GRID_H : c.day === todayIso ? Math.min(GRID_H, Math.max(0, nowTop)) : 0;
  return <div className={`pb-col ${c.first ? 'day-start' : ''}`} ref={setRef} style={{ height: GRID_H }} onClick={onClick} onMouseMove={onMove} onMouseLeave={onLeave}>
    {off.map(([a, b]) => <i key={a} className="pb-off" style={{ top: (a - START_H * 60) * PPM, height: (b - a) * PPM }} />)}
    {pastH > 0 && <i className="pb-past" style={{ height: pastH }} />}
    {blocks.map((k) => <button key={k.id} className={`pb-block k-${k.kind}`} style={{ top: (minutesOf(new Date(k.start)) - START_H * 60) * PPM, height: Math.max(20, (new Date(k.end) - new Date(k.start)) / 60000 * PPM - 2) }}
      onMouseDown={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onBlock(k); }}><b>{BLOCK_KINDS[k.kind]}</b>{k.note && <span>{k.note}</span>}</button>)}
    {lay.map(({ b, lane, lanes }) => {
      const movable = isMovable(b, canBook);
      const h = Math.max(30, durationOf(b) * PPM - 2);
      const cls = `t-${b.appointment_type} ${b.status === 'completed' ? 'done' : ''} ${b.status === 'no_show' ? 'noshow' : ''} ${b.visit_id && b.status !== 'completed' ? 'arrived' : ''} ${sel?.b.id === b.id ? 'sel' : ''}`;
      return <div key={b.id} className={`pb-ev ${cls}`} style={{ top: (minutesOf(new Date(b.appointment)) - START_H * 60) * PPM, height: h, left: `calc(${(lane / lanes) * 100}% + 2px)`, width: `calc(${100 / lanes}% - 4px)`, cursor: movable ? 'grab' : 'pointer' }}
        onPointerDown={(e) => (movable ? onStart(e, b, 'move') : null)} onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { if (!movable) { e.stopPropagation(); onOpen(e, b); } }}>
        <b>{b.running_late && <u title="Đến trễ">⏱ </u>}{b.customer_name}</b><span>{clockShort(b.appointment)}</span><strong>{svcNames(b)}</strong>{view === 'day' && <em>{svcNames(b)}</em>}
        {movable && <i className="pb-grip" onPointerDown={(e) => onStart(e, b, 'resize')} title="Kéo để đổi thời lượng" />}
      </div>;
    })}
    {draft && <div className="pb-ev draft" style={{ top: (Number(draft.time.slice(0, 2)) * 60 + Number(draft.time.slice(3)) - START_H * 60) * PPM, height: 30 * PPM - 2, left: 2, right: 2 }}><b>Lịch hẹn mới</b><span>Chọn bệnh nhân và dịch vụ</span></div>}
    {ghost && <div className={`pb-ghost-ev ${ghost.ok ? 'ok' : 'bad'}`} style={{ top: ghost.top, height: ghost.height }}>{ghost.label}</div>}
    {showNow && nowTop > 0 && nowTop < GRID_H && <i className="pb-now" style={{ top: nowTop }}><u>{clock12(now)}</u></i>}
  </div>;
}
