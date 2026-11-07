import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Loading, initials, isoDay, money, useLoad } from './ui';
import { addDays, indexHours, mondayOf, parseDay, svcNames, TYPES } from './calendarKit';
import { DatePopover } from './CalendarPanels';
import { PHASE, PHASES, avatarTone, countPhases, dueState, filterBookings, groupByDay, phaseOf, rangeLabel } from './bookingListKit';
import { useBookingActions } from './useBookingActions';
import './pabau-calendar.css';
import './pabau-list.css';

const DOW = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

/**
 * Chế độ DANH SÁCH lịch hẹn. Tự tải dữ liệu, dùng chung thao tác/ràng buộc với timeline.
 * Props (đều tùy chọn): date + onDateChange để đồng bộ ngày với chế độ timeline.
 */
export default function BookingListView({ date: dateProp, onDateChange, onSwitchCalendar }) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canBook = ['consultant', 'manager', 'doctor'].includes(user.role);
  const [dateState, setDateState] = useState(searchParams.get('date') || isoDay());
  const date = dateProp ?? dateState;
  const setDate = onDateChange ?? setDateState;
  const [span, setSpan] = useState('day');            // 'day' | 'week'
  const [phase, setPhase] = useState('');
  const [q, setQ] = useState('');
  const [staffId, setStaffId] = useState('');
  const [dateOpen, setDateOpen] = useState(false);
  const [now, setNow] = useState(new Date());
  const todayIso = isoDay();
  const range = span === 'week' ? [mondayOf(date), addDays(mondayOf(date), 6)] : [date, date];

  const staff = useLoad(async () => (await api.get('/staff/')).data, []);
  const services = useLoad(async () => (await api.get('/services/')).data, []);
  const hoursQ = useLoad(async () => { try { return (await api.get('/working-hours/')).data; } catch { return []; } }, []);
  const bookQ = useLoad(async () => { const { data } = await api.get('/bookings/', { params: { from: range[0], to: range[1] } }); return data.results || data; }, [range[0], range[1]]);
  const blockQ = useLoad(async () => { try { const { data } = await api.get('/blocked-times/', { params: { from: range[0], to: range[1] } }); return data.results || data; } catch { return []; } }, [range[0], range[1]]);

  useEffect(() => { // làm mới mỗi phút: cập nhật "bây giờ" và lịch mới từ lễ tân
    const t = setInterval(() => { setNow(new Date()); bookQ.reload(true); }, 60000);
    return () => clearInterval(t);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const doctors = useMemo(() => {
    const rows = (staff.data?.results || staff.data || []).filter((s) => s.account_role === 'doctor' && s.is_active);
    return user.role === 'doctor' ? rows.filter((s) => s.user_id === user.id) : rows;
  }, [staff.data, user]);
  const svcList = (services.data?.results || services.data || []).filter((s) => s.is_active);
  const hours = useMemo(() => indexHours(hoursQ.data?.results || hoursQ.data || []), [hoursQ.data]);
  const all = bookQ.data || [];
  const blocks = blockQ.data?.results || blockQ.data || [];
  const reload = () => { bookQ.reload(true); blockQ.reload(true); };
  const { act, overlays, alert, setAlert, openCreate } = useBookingActions({ canBook, reload, doctors, services: svcList, bookings: all, blocks, hours });

  const scoped = filterBookings(all, { q, staff: staffId });           // đã lọc tìm kiếm + bác sĩ, chưa lọc trạng thái
  const counts = countPhases(filterBookings(all, { q, staff: staffId, phase: '' }).concat(all.filter((b) => phaseOf(b) === 'cancelled' && (!staffId || b.staff === Number(staffId)))));
  const shown = phase ? filterBookings(all, { phase, q, staff: staffId }) : scoped;
  const groups = groupByDay(shown);
  const step = span === 'week' ? 7 : 1;
  const label = span === 'week'
    ? `${parseDay(range[0]).getDate()}/${parseDay(range[0]).getMonth() + 1} – ${parseDay(range[1]).getDate()}/${parseDay(range[1]).getMonth() + 1}/${parseDay(range[1]).getFullYear()}`
    : date === todayIso ? 'Go to Today' : parseDay(date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
  const doctorOf = (id) => doctors.find((d) => d.id === id);

  return <div className="pb pbl">
    <div className="pb-bar">
      <div className="pb-nav">
        <button onClick={() => setDate(addDays(date, -step))} title={span === 'week' ? 'Tuần trước' : 'Ngày trước'}>‹</button>
        <button onClick={() => setDate(addDays(date, -7))} title="Tuần trước">«</button>
        <button className="pb-date" onClick={() => setDateOpen(!dateOpen)} title="Chọn ngày">{label} ▾</button>
        <button onClick={() => setDate(addDays(date, 7))} title="Tuần sau">»</button>
        <button onClick={() => setDate(addDays(date, step))} title={span === 'week' ? 'Tuần sau' : 'Ngày sau'}>›</button>
      </div>
      {dateOpen && <DatePopover date={date} onPick={(d) => { setDate(d); setDateOpen(false); }} onClose={() => setDateOpen(false)} />}
      {date !== todayIso && <button className="pb-ghost" onClick={() => setDate(todayIso)}>Hôm nay</button>}
      <div className="pbl-seg" role="tablist" aria-label="Phạm vi">
        {[['day', 'Ngày'], ['week', 'Tuần']].map(([k, l]) => <button key={k} role="tab" aria-selected={span === k} className={span === k ? 'on' : ''} onClick={() => setSpan(k)}>{l}</button>)}
      </div>
      <label className="pbl-search"><span aria-hidden>⌕</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm tên, SĐT, mã hồ sơ, #mã lịch…" />
        {q && <button onClick={() => setQ('')} aria-label="Xóa tìm kiếm">×</button>}</label>
      <select className="pb-select" value={staffId} onChange={(e) => setStaffId(e.target.value)} aria-label="Bác sĩ">
        <option value="">Tất cả bác sĩ</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select>
      <span className="pb-spacer" />
      <button className="pb-ghost" onClick={() => onSwitchCalendar ? onSwitchCalendar() : navigate(`/lich-hen?date=${date}`)}>Lịch</button>
      <button className="pb-icon" onClick={reload} title="Làm mới">↻</button>
      {canBook && <button className="pb-create" onClick={() => openCreate({ staff: staffId ? Number(staffId) : doctors[0]?.id, date: date < todayIso ? todayIso : date, time: '09:00' })}><b>⊕</b> Create</button>}
    </div>
    {alert && <div className="pb-alert">⚠ {alert}<button onClick={() => setAlert('')}>×</button></div>}

    <div className="pbl-chips" role="tablist" aria-label="Lọc theo trạng thái">
      <button role="tab" aria-selected={!phase} className={!phase ? 'on' : ''} onClick={() => setPhase('')}>Tất cả<b>{scoped.length}</b></button>
      {PHASES.map(([k, l, c]) => <button key={k} role="tab" aria-selected={phase === k} className={phase === k ? 'on' : ''} onClick={() => setPhase(phase === k ? '' : k)}>
        <i style={{ background: c }} />{l}<b>{counts[k]}</b></button>)}
    </div>

    {(bookQ.loading && !bookQ.data) ? <Loading /> : !groups.length ? <div className="pbl-empty">
      <div className="pbl-empty-ic">▦</div><b>{q || phase || staffId ? 'Không có lịch hẹn khớp bộ lọc' : 'Chưa có lịch hẹn nào'}</b>
      <p>{q || phase || staffId ? 'Thử đổi từ khóa hoặc bỏ bộ lọc.' : `${span === 'week' ? 'Tuần này' : 'Ngày này'} chưa có lịch hẹn.`}</p>
      {(q || phase || staffId) ? <button className="pb-btn" onClick={() => { setQ(''); setPhase(''); setStaffId(''); }}>Xóa bộ lọc</button>
        : canBook && <button className="pb-btn blue" style={{ width: 180 }} onClick={() => openCreate({ staff: doctors[0]?.id, date: date < todayIso ? todayIso : date, time: '09:00' })}>Tạo lịch hẹn</button>}
    </div> : <div className="pbl-list">
      {groups.map((g) => {
        const d = parseDay(g.day);
        let markerDone = false;
        return <section key={g.day} className="pbl-day">
          <header><b>{DOW[d.getDay()]}, {d.getDate()}/{d.getMonth() + 1}/{d.getFullYear()}</b>
            {g.day === todayIso && <span className="pbl-today">Hôm nay</span>}<small>{g.items.length} lịch hẹn</small></header>
          {g.items.map((b) => {
            const showNow = g.day === todayIso && !markerDone && new Date(b.appointment) > now;
            if (showNow) markerDone = true;
            return <div key={b.id}>
              {showNow && <div className="pbl-now"><i /><span>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · Bây giờ</span></div>}
              <Row b={b} now={now} doctor={doctorOf(b.staff)} canBook={canBook} act={act} />
            </div>;
          })}
          {g.day === todayIso && !markerDone && g.items.length > 0 && <div className="pbl-now"><i /><span>{now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })} · Bây giờ</span></div>}
        </section>;
      })}
    </div>}
    {overlays}
  </div>;
}

function Row({ b, now, doctor, canBook, act }) {
  const ph = phaseOf(b), meta = PHASE[ph], due = dueState(b, now), t = rangeLabel(b), tone = avatarTone(b.customer_name);
  const open = ['pending', 'confirmed'].includes(b.status) && !b.visit_id;
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!menu) return undefined;
    const fn = (e) => ref.current && !ref.current.contains(e.target) && setMenu(false);
    document.addEventListener('mousedown', fn); return () => document.removeEventListener('mousedown', fn);
  }, [menu]);
  const go = (k) => { setMenu(false); act(k, b); };
  const primary = !canBook ? null : ph === 'pending' ? ['confirm', 'Xác nhận', 'blue'] : ph === 'confirmed' ? ['arrive', 'Đã đến', 'green'] : ph === 'arrived' ? ['checkout', 'Thanh toán', 'ghost'] : null;
  const started = new Date(b.appointment) <= now;
  return <article className={`pbl-row t-${b.appointment_type} ph-${ph}`} onClick={() => act('detail', b)} tabIndex={0}
    onKeyDown={(e) => e.key === 'Enter' && e.target === e.currentTarget && act('detail', b)}>
    <div className="pbl-time"><b>{t.start}</b><small>{t.minutes} phút</small></div>
    <div className="pbl-patient">
      <span className="pbl-av" style={{ background: tone.bg, color: tone.fg }}>{initials(b.customer_name)}</span>
      <div><b>{b.customer_name}</b><small>{[b.customer_phone, b.patient_code].filter(Boolean).join(' · ') || 'Khách chưa có hồ sơ'}</small></div>
    </div>
    <div className="pbl-svc"><b>{svcNames(b) || TYPES[b.appointment_type]}</b>
      <small><i className={`t-${b.appointment_type}`} />{TYPES[b.appointment_type]}{b.total ? ` · ${money(b.total)}` : ''}</small></div>
    <div className="pbl-doc">{doctor ? <><span className="pb-av sm">{initials(doctor.name)}</span><span>{doctor.name}</span></> : <span className="mut">{b.staff_name || 'Chưa phân công'}</span>}</div>
    <div className="pbl-status">
      <span className="pbl-pill" style={{ '--c': meta.color }}>{ph === 'arrived' && b.visit_status === 'in_consult' ? 'Đang khám' : meta.label}</span>
      <div className="pbl-flags">
        {due === 'overdue' && <em className="red">Quá giờ</em>}{due === 'soon' && <em className="blue">Sắp tới</em>}
        {b.running_late && ph !== 'no_show' && <em className="amber">Đến trễ</em>}{b.reschedule_count > 0 && <em>Dời {b.reschedule_count} lần</em>}
      </div>
    </div>
    <div className="pbl-act" onClick={(e) => e.stopPropagation()} ref={ref}>
      {primary && <button className={`pbl-btn ${primary[2]}`} onClick={() => go(primary[0])}>{primary[1]}</button>}
      <button className="pbl-more" aria-label="Thao tác khác" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
      {menu && <div className="pbl-menu" role="menu">
        <button role="menuitem" onClick={() => go('detail')}>Xem chi tiết</button>
        {b.patient && <Link role="menuitem" to={`/benh-nhan/${b.patient}`}>Hồ sơ {b.patient_code}</Link>}
        {canBook && <>
          <hr />
          <button role="menuitem" disabled={!open} onClick={() => go('edit')}>Sửa lịch hẹn</button>
          <button role="menuitem" disabled={!open} onClick={() => go('reschedule')}>Đổi giờ</button>
          <button role="menuitem" onClick={() => go('rebook')}>Đặt lại</button>
          <button role="menuitem" disabled={!open} onClick={() => go('late')}>{b.running_late ? 'Bỏ đánh dấu đến trễ' : 'Đánh dấu đến trễ'}</button>
          <button role="menuitem" disabled={ph === 'no_show' ? false : !(open && started)} title={started ? '' : 'Chỉ đánh dấu sau giờ hẹn'}
            onClick={() => go(ph === 'no_show' ? 'undo_no_show' : 'no_show')}>{ph === 'no_show' ? 'Bỏ đánh dấu vắng mặt' : 'Vắng mặt'}</button>
          <hr />
          <button role="menuitem" className="danger" disabled={!open} onClick={() => go('cancel')}>Hủy lịch hẹn</button>
        </>}
      </div>}
    </div>
  </article>;
}
