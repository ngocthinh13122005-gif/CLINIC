import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import FullscreenRounded from '@mui/icons-material/FullscreenRounded';
import FullscreenExitRounded from '@mui/icons-material/FullscreenExitRounded';
import EventNoteRounded from '@mui/icons-material/EventNoteRounded';
import FilterListRounded from '@mui/icons-material/FilterListRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Avatar, Btn, Field, Loading, Modal, PageHead, Pill, WEEKDAY, addDays, errMsg, fmtTime, isoDay, useLoad, useToast } from './ui';
import { PatientPicker } from './PatientForm';
import SmartFilterBar from './SmartFilterBar';
import PabauCalendar from './PabauCalendar';
import BookingListView from './BookingListView';

const START_H = 7, END_H = 20, PPM = 2.5;           // khoảng 15 phút gần 38px, dễ đọc như lịch Pabau
const TYPES = { consult: 'Khám / tư vấn', follow_up: 'Tái khám', procedure: 'Thủ thuật', session: 'Buổi liệu trình' };
const INTERNAL_BOOKING_TYPES = ['consult', 'procedure'];
const LIST_STATUS_OPTIONS = [
  { value: 'pending', label: 'Chờ xác nhận' },
  { value: 'confirmed', label: 'Đã xác nhận' },
  { value: 'arrived', label: 'Đã đến' },
  { value: 'completed', label: 'Hoàn thành' },
  { value: 'cancelled', label: 'Đã hủy' },
  { value: 'no_show', label: 'Không đến' },
  { value: 'all', label: 'Tất cả' },
];
const mondayOf = (iso) => { const d = new Date(iso + 'T00:00:00'); const w = (d.getDay() + 6) % 7; return addDays(iso, -w); };
const minutesOf = (iso) => { const d = new Date(iso); return d.getHours() * 60 + d.getMinutes(); };
const dayOf = (iso) => isoDay(new Date(iso));
const statusTone = (status) => ({
  pending: 'amber', confirmed: 'blue', checked_in: 'teal', in_progress: 'blue',
  completed: 'green', cancelled: 'gray', no_show: 'red',
}[status] || 'gray');
const listStatusParam = (status) => ({
  arrived: 'checked_in,in_progress',
}[status] || (status === 'all' ? '' : status));

function layout(items) {
  const sorted = [...items].sort((a, b) => new Date(a.appointment) - new Date(b.appointment));
  const lanes = [];
  sorted.forEach((b) => {
    const s = minutesOf(b.appointment), e = minutesOf(b.end_time);
    let i = lanes.findIndex((end) => end <= s);
    if (i < 0) { i = lanes.length; lanes.push(0); }
    lanes[i] = e; b._lane = i;
  });
  sorted.forEach((b) => { b._lanes = Math.max(1, lanes.length); });
  return sorted;
}

export default function CalendarPage() {
  const { user } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const canBook = ['consultant', 'manager', 'doctor'].includes(user.role);
  const canManageWaitlist = ['consultant', 'manager'].includes(user.role);
  const [date, setDate] = useState(() => searchParams.get('date') || isoDay());
  const hasExplicitView = searchParams.has('view') || searchParams.has('status');
  const [viewMode, setViewMode] = useState(() => searchParams.get('view') === 'list' || searchParams.has('status') ? 'list' : 'calendar');
  const [calendarScale, setCalendarScale] = useState('day');
  const [listStatus, setListStatus] = useState(() => LIST_STATUS_OPTIONS.some((option) => option.value === searchParams.get('status')) ? searchParams.get('status') : 'all');
  const [listDate, setListDate] = useState('');
  const [listDoctor, setListDoctor] = useState('');
  const [listQuery, setListQuery] = useState('');
  const [listPage, setListPage] = useState(1);
  const [debouncedListQuery, setDebouncedListQuery] = useState('');
  const [listActionError, setListActionError] = useState('');
  const [calendarExpanded, setCalendarExpanded] = useState(false);
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [listFiltersOpen, setListFiltersOpen] = useState(false);
  const [showCancelled, setShowCancelled] = useState(false);
  const [toast, toastNode] = useToast();
  const [sel, setSel] = useState(null);
  const [hoverCard, setHoverCard] = useState(null);
  const hoverTimer = useRef(null);
  const [creating, setCreating] = useState(null);
  const [q, setQ] = useState('');
  const [doctorFilter, setDoctorFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    if (hasExplicitView) return undefined;
    let active = true;
    api.get('/settings/user/').then(({ data }) => {
      const preference = data.values?.['ui.calendar_view'];
      if (active && ['calendar', 'list'].includes(preference)) setViewMode(preference);
    }).catch(() => {
      if (active) toast('Không tải được chế độ xem đã lưu; đang dùng lịch theo bác sĩ.');
    });
    return () => { active = false; };
  }, [hasExplicitView]);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (!calendarExpanded) return undefined;
    const closeOnEscape = (event) => {
      if (event.key === 'Escape') setCalendarExpanded(false);
    };
    document.body.classList.add('cl-calendar-expanded-open');
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.classList.remove('cl-calendar-expanded-open');
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [calendarExpanded]);
  const weekStart = mondayOf(date);
  const monthFirstDate = new Date(`${date.slice(0, 7)}-01T00:00:00`);
  const monthFirst = `${date.slice(0, 7)}-01`;
  const monthDays = new Date(monthFirstDate.getFullYear(), monthFirstDate.getMonth() + 1, 0).getDate();
  const monthGridStart = mondayOf(monthFirst);
  const monthGridLength = Math.ceil((((monthFirstDate.getDay() + 6) % 7) + monthDays) / 7) * 7;
  const monthGridEnd = addDays(monthGridStart, monthGridLength - 1);
  const monthDates = Array.from({ length: monthGridLength }, (_, index) => addDays(monthGridStart, index));
  const calendarFrom = calendarScale === 'month' ? monthGridStart : weekStart;
  const calendarTo = calendarScale === 'month' ? monthGridEnd : addDays(weekStart, 6);
  const staff = useLoad(async () => (await api.get('/staff/')).data, []);
  const week = useLoad(async () => {
    const { data } = await api.get('/bookings/', { params: { from: calendarFrom, to: calendarTo } });
    return data.results || data;
  }, [calendarFrom, calendarTo]);
  const list = useLoad(async () => {
    if (viewMode !== 'list') return { count: 0, results: [] };
    const params = { view: 'list', page: listPage, page_size: 20 };
    const status = listStatusParam(listStatus);
    if (status) params.status = status;
    if (listDate) { params.from = listDate; params.to = listDate; }
    if (listDoctor) params.staff = listDoctor;
    if (debouncedListQuery.trim()) params.q = debouncedListQuery.trim();
    return (await api.get('/bookings/', { params })).data;
  }, [viewMode, listPage, listStatus, listDate, listDoctor, debouncedListQuery]);
  const doctors = useMemo(() => {
    const rows = (staff.data?.results || staff.data || []).filter((s) => s.account_role === 'doctor' && s.is_active);
    return user.role === 'doctor' ? rows.filter((s) => s.user_id === user.id) : rows;
  }, [staff.data, user]);
  useEffect(() => {
    if (!location.state?.openCreate || staff.loading) return;
    if (canBook) setCreating({ staff: doctors[0]?.id || '', date: isoDay(), time: '09:00' });
    navigate(`${location.pathname}${location.search}`, { replace: true, state: null });
  }, [location.pathname, location.search, location.state, staff.loading, canBook, doctors, navigate]);
  const all = (week.data || []).filter((booking) => showCancelled || booking.status !== 'cancelled');
  const displayDoctors = doctorFilter ? doctors.filter((d) => String(d.id) === doctorFilter) : doctors;
  const matchesCalendarFilters = (b) => {
    if (doctorFilter && String(b.staff) !== doctorFilter) return false;
    if (typeFilter && b.appointment_type !== typeFilter) return false;
    if (statusFilter && b.status !== statusFilter) return false;
    if (q.trim()) {
      const haystack = [b.customer_name, b.customer_phone, b.staff_name, ...(b.items || []).map((i) => i.service_name || i.service?.name)].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  };
  const dayBookings = all.filter((b) => dayOf(b.appointment) === date && matchesCalendarFilters(b));
  const weekBookings = all.filter(matchesCalendarFilters);
  const timeTicks = Array.from({ length: (END_H - START_H) * 4 }, (_, i) => START_H * 60 + i * 15);
  const todayIso = isoDay();
  const scrollRef = useRef(null);
  const nowTop = (now.getHours() * 60 + now.getMinutes() - START_H * 60) * PPM;
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = date === todayIso ? Math.max(0, nowTop - 150) : 0; }, [date, week.loading, staff.loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => { week.reload(true); list.reload(true); };
  const closeBooking = useCallback(() => setSel(null), []);
  const showBookingHover = (booking, target) => {
    window.clearTimeout(hoverTimer.current);
    const rect = target.getBoundingClientRect();
    const width = Math.min(700, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 12));
    const top = Math.max(12, Math.min(rect.top - 34, window.innerHeight - 380));
    setHoverCard({ booking, left, top });
  };
  const delayHideBookingHover = () => {
    window.clearTimeout(hoverTimer.current);
    hoverTimer.current = window.setTimeout(() => setHoverCard(null), 180);
  };
  const keepBookingHover = () => window.clearTimeout(hoverTimer.current);
  useEffect(() => {
    const timeout = setTimeout(() => { setDebouncedListQuery(listQuery); setListPage(1); }, 250);
    return () => clearTimeout(timeout);
  }, [listQuery]);
  const calendarFilters = [
    { key: 'doctor', label: 'Bác sĩ', value: doctorFilter, onChange: setDoctorFilter, options: doctors.map((d) => ({ value: String(d.id), label: d.name })) },
    { key: 'type', label: 'Loại lịch hẹn', value: typeFilter, onChange: setTypeFilter, options: Object.entries(TYPES).map(([value, label]) => ({ value, label })) },
    { key: 'status', label: 'Trạng thái', value: statusFilter, onChange: setStatusFilter, options: [{ value: 'pending', label: 'Chờ xác nhận' }, { value: 'confirmed', label: 'Đã xác nhận' }, { value: 'completed', label: 'Hoàn thành' }] },
  ];
  const applyFavorite = (state) => { setQ(state.search || ''); setDoctorFilter(state.filters?.doctor || ''); setTypeFilter(state.filters?.type || ''); setStatusFilter(state.filters?.status || ''); };
  const runListAction = async (booking, action, successMessage) => {
    if (action === 'cancel' && !window.confirm(`Bạn có chắc muốn hủy lịch hẹn của ${booking.customer_name}?`)) return;
    setListActionError('');
    try {
      await api.post(`/bookings/${booking.id}/${action}/`);
      toast(successMessage);
      reload();
    } catch (error) {
      setListActionError(errMsg(error));
    }
  };
  const listBookings = list.data?.results || [];
  const listPageCount = Math.max(1, Math.ceil((list.data?.count || 0) / 20));
  const countsByStatus = list.data?.status_counts || {};
  const statusCount = (status) => status === 'all'
    ? Object.values(countsByStatus).reduce((total, count) => total + count, 0)
    : status === 'arrived'
      ? (countsByStatus.checked_in || 0) + (countsByStatus.in_progress || 0)
      : countsByStatus[status] || 0;

  const clickCol = (e, doc, targetDate = date) => {
    if (!canBook) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const min = Math.round(((e.clientY - rect.top) / PPM) / 15) * 15 + START_H * 60;
    setCreating({ staff: doc.id, date: targetDate, time: `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}` });
  };
  const clickWeekCol = (event, targetDate) => {
    if (!canBook) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const min = Math.round(((event.clientY - rect.top) / PPM) / 15) * 15 + START_H * 60;
    setCreating({ staff: '', date: targetDate, time: `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}` });
  };
  const weekDates = Array.from({ length: 7 }, (_, index) => addDays(weekStart, index));
  const shownDateLabel = calendarScale === 'day'
    ? new Date(date + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : calendarScale === 'week'
      ? `${new Date(weekStart + 'T00:00:00').toLocaleDateString('vi-VN', { day: 'numeric', month: 'short' })} – ${new Date(weekDates[6] + 'T00:00:00').toLocaleDateString('vi-VN', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : new Date(date + 'T00:00:00').toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });
  const moveDate = (amount) => {
    if (calendarScale === 'month') {
      const current = new Date(`${date}T00:00:00`);
      const next = isoDay(new Date(current.getFullYear(), current.getMonth() + amount, 1));
      setDate(next);
      if (viewMode === 'list') setListDate(next);
      return;
    }
    const next = addDays(date, amount);
    setDate(next);
    if (viewMode === 'list') setListDate(next);
  };

  return <div className={`cl-calendar-page ${sel ? 'has-selected-booking' : ''} ${viewMode === 'list' ? 'cl-schedule-mode' : ''}`}>
    {viewMode === 'waitlist' && <PageHead title="Danh sách chờ" subtitle="Theo dõi yêu cầu xếp lịch sớm và chủ động liên hệ khách khi có khung phù hợp." />}
    {viewMode === 'waitlist' && canManageWaitlist && <div className="cl-appointment-modebar" role="toolbar" aria-label="Chế độ lịch hẹn">
      <button type="button" className="cl-appointment-waitlist on" onClick={() => setViewMode('calendar')}>Quay lại lịch hẹn</button>
    </div>}
    {viewMode === 'waitlist' && canManageWaitlist && <AppointmentWaitlistPanel doctors={doctors} onBooked={(message) => { toast(message); reload(); }} />}
    {viewMode === 'calendar' && <PabauCalendar initialDate={date} onDateChange={setDate} onSwitchList={() => setViewMode('list')} />}
    {viewMode === 'list' && <BookingListView date={date} onDateChange={setDate} onSwitchCalendar={() => setViewMode('calendar')} />}
    {viewMode === 'legacy-calendar' && <div className={`cl-calendar-shell ${calendarExpanded ? 'expanded' : ''}`}>
      <div className="cl-calendar-toolbar">
      <SmartFilterBar id="calendar" className="cl-calendar-filters" search={q} onSearch={setQ} placeholder="Tìm bệnh nhân, số điện thoại, bác sĩ hoặc dịch vụ…" filters={calendarFilters} onApplyFavorite={applyFavorite}/>
      <div className={`cl-cal-controls ${calendarScale === 'month' ? 'month-view' : ''}`}>
      <div className="cl-calendar-scale" role="group" aria-label="Phạm vi lịch">
        <button type="button" className={calendarScale === 'day' ? 'on' : ''} aria-pressed={calendarScale === 'day'} onClick={() => setCalendarScale('day')}>Ngày</button>
        <button type="button" className={calendarScale === 'week' ? 'on' : ''} aria-pressed={calendarScale === 'week'} onClick={() => setCalendarScale('week')}>Tuần</button>
        <button type="button" className={calendarScale === 'month' ? 'on' : ''} aria-pressed={calendarScale === 'month'} onClick={() => setCalendarScale('month')}>Tháng</button>
      </div>
      <strong className="cl-cal-title">{shownDateLabel}</strong>
      <label className="cl-calendar-cancelled"><input type="checkbox" checked={showCancelled} onChange={(event) => setShowCancelled(event.target.checked)} /> Hiện lịch đã hủy</label>
      <div className="cl-appointment-mode-switch cl-calendar-view-switch" role="group" aria-label="Chuyển lịch và danh sách"><button type="button" className="on" title="Lịch" aria-label="Lịch" onClick={() => setViewMode('calendar')}><CalendarMonthRounded /></button><button type="button" title="Danh sách lịch hẹn" aria-label="Danh sách lịch hẹn" onClick={() => navigate(`/lich-hen/danh-sach?date=${date}`)}><EventNoteRounded /></button></div>
      <button type="button" className="cl-calendar-expand" aria-label={calendarExpanded ? 'Thoát toàn màn hình' : 'Mở toàn màn hình'} title={calendarExpanded ? 'Thoát toàn màn hình' : 'Mở toàn màn hình'} onClick={() => setCalendarExpanded((value) => !value)}>
        {calendarExpanded ? <FullscreenExitRounded /> : <FullscreenRounded />}
      </button>
      <div className="cl-legend">{Object.entries(TYPES).map(([k, v]) => <span key={k}><i className={`t-${k}`} />{v}</span>)}</div>
      </div>
      </div>
      {staff.error && <div className="cl-alert error" role="alert">{staff.error}<Btn onClick={() => staff.reload()}>Tải lại danh sách bác sĩ</Btn></div>}
      <div className="cl-calendar-workspace">
      {(staff.loading || week.loading) && !week.data ? <Loading /> : week.error ? <div className="cl-alert error" role="alert">{week.error}<Btn onClick={() => week.reload()}>Thử lại</Btn></div> :
      <div className="cl-cal">
        {calendarScale === 'month' ? <div className={`cl-month-grid ${monthGridLength === 42 ? 'six-weeks' : ''}`}>
          {WEEKDAY.map((_, index) => <div className="cl-month-weekday" key={index}>{WEEKDAY[(index + 1) % 7]}</div>)}
          {monthDates.map((day) => {
            const dayDate = new Date(`${day}T00:00:00`);
            const dayBookings = weekBookings.filter((booking) => dayOf(booking.appointment) === day)
              .sort((a, b) => new Date(a.appointment) - new Date(b.appointment));
            const inMonth = day.slice(0, 7) === date.slice(0, 7);
            return <section className={`cl-month-cell ${inMonth ? '' : 'outside-month'} ${day === todayIso ? 'today' : ''}`} key={day}>
              <div className="cl-month-day">
                {canBook
                  ? <button type="button" aria-label={`Tạo lịch hẹn ngày ${dayDate.toLocaleDateString('vi-VN')}`} onClick={() => setCreating({ staff: doctors[0]?.id || '', date: day, time: '09:00' })}>{dayDate.getDate()}</button>
                  : <span>{dayDate.getDate()}</span>}
                <small>{dayBookings.length || ''}</small>
              </div>
              <div className="cl-month-events">
                {dayBookings.map((booking) => {
                  const service = booking.items?.map((item) => item.service_name || item.service?.name).filter(Boolean).join(', ') || booking.appointment_type_label;
                  return <button type="button" key={booking.id} className={`cl-month-event t-${booking.appointment_type} ${booking.status}`} onMouseEnter={(event) => showBookingHover(booking, event.currentTarget)} onMouseLeave={delayHideBookingHover} onFocus={(event) => showBookingHover(booking, event.currentTarget)} onBlur={delayHideBookingHover} onClick={() => { setHoverCard(null); setSel(booking); }}>
                    <span><time>{fmtTime(booking.appointment)}</time><strong>{booking.customer_name || 'Khách hàng'}</strong></span>
                    <small>{service} · {booking.staff_name || 'Chưa phân công'}</small>
                  </button>;
                })}
              </div>
            </section>;
          })}
        </div> : <div className="cl-cal-scroll" ref={scrollRef}>
          <div className={`cl-cal-grid ${calendarScale === 'week' ? 'week' : 'day'}`} style={{ gridTemplateColumns: `58px repeat(${calendarScale === 'day' ? Math.max(1, displayDoctors.length) : 7}, minmax(${calendarScale === 'day' ? 164 : 136}px, 1fr))` }}>
            <div className="cl-cal-corner" />
            {calendarScale === 'day' ? displayDoctors.length ? displayDoctors.map((d) => <div className="cl-cal-doc" key={d.id}><Avatar name={d.name} size={32} /><span><strong>{d.name}</strong><small>{d.position}</small></span></div>) :
              <div className="cl-cal-doc"><small>Không có bác sĩ phù hợp bộ lọc.</small></div> :
              weekDates.map((day) => {
                const dt = new Date(day + 'T00:00:00');
                return <div className={`cl-cal-doc cl-cal-day-head ${day === todayIso ? 'today' : ''}`} key={day}>
                  <span><small>{WEEKDAY[dt.getDay()]}</small><strong>{dt.getDate()} {dt.toLocaleDateString('vi-VN', { month: 'short' })}</strong><small>{weekBookings.filter((booking) => dayOf(booking.appointment) === day).length} lịch</small></span>
                </div>;
              })}
            <div className="cl-cal-times" style={{ height: (END_H - START_H) * 60 * PPM }}>
              {timeTicks.map((minute) => {
                const hour = Math.floor(minute / 60);
                const quarter = minute % 60;
                return <span key={minute} className={quarter === 0 ? 'hour' : ''} style={{ top: (minute - START_H * 60) * PPM }}>
                  {String(hour).padStart(2, '0')}:{String(quarter).padStart(2, '0')}
                </span>;
              })}</div>
            {calendarScale === 'day' ? displayDoctors.length ? displayDoctors.map((doc) => {
              const items = layout(dayBookings.filter((b) => b.staff === doc.id));
              return <div className="cl-cal-col" key={doc.id} style={{ height: (END_H - START_H) * 60 * PPM }} onClick={(e) => e.target === e.currentTarget && clickCol(e, doc)}>
                {timeTicks.map((minute) => <i key={minute} className={`cl-hline ${minute % 60 === 0 ? 'hour' : ''}`} style={{ top: (minute - START_H * 60) * PPM }} />)}
                {items.map((b) => {
                  const top = (minutesOf(b.appointment) - START_H * 60) * PPM;
                  const h = Math.max(40, (b.duration_minutes || 30) * PPM - 3);
                  return <button key={b.id} className={`cl-block t-${b.appointment_type} ${b.status}`}
                    style={{ top, height: h, left: `${(b._lane / b._lanes) * 100}%`, width: `calc(${100 / b._lanes}% - 4px)` }}
                    onMouseEnter={(event) => showBookingHover(b, event.currentTarget)} onMouseLeave={delayHideBookingHover}
                    onFocus={(event) => showBookingHover(b, event.currentTarget)} onBlur={delayHideBookingHover}
                    onClick={() => { setHoverCard(null); setSel(b); }}>
                    <strong>{fmtTime(b.appointment)} – {fmtTime(b.end_time)}</strong>
                    <span className="n">{b.customer_name}</span>
                    <span className="s">{b.items?.map((i) => i.service_name || i.service?.name).filter(Boolean).join(', ') || b.appointment_type_label}</span>
                    {b.visit_status && <Pill tone={b.visit_status === 'completed' ? 'green' : b.visit_status === 'in_consult' ? 'blue' : 'amber'} dot>{{ waiting: 'Đã đến', in_consult: 'Đang khám', completed: 'Xong', cancelled: 'Hủy' }[b.visit_status]}</Pill>}
                  </button>;
                })}
                {date === todayIso && nowTop > 0 && nowTop < (END_H - START_H) * 60 * PPM && <i className="cl-nowline" style={{ top: nowTop }} />}
              </div>;
            }) : <div className="cl-cal-col cl-cal-empty-col" style={{ height: (END_H - START_H) * 60 * PPM }}>
              {timeTicks.map((minute) => <i key={minute} className={`cl-hline ${minute % 60 === 0 ? 'hour' : ''}`} style={{ top: (minute - START_H * 60) * PPM }} />)}
              <span>Chọn bộ lọc khác hoặc tải lại danh sách bác sĩ.</span>
            </div> : weekDates.map((day) => {
              const items = layout(weekBookings.filter((booking) => dayOf(booking.appointment) === day));
              return <div className="cl-cal-col cl-cal-week-col" key={day} style={{ height: (END_H - START_H) * 60 * PPM }} onClick={(event) => event.target === event.currentTarget && clickWeekCol(event, day)}>
                {timeTicks.map((minute) => <i key={minute} className={`cl-hline ${minute % 60 === 0 ? 'hour' : ''}`} style={{ top: (minute - START_H * 60) * PPM }} />)}
                {items.map((booking) => {
                  const top = (minutesOf(booking.appointment) - START_H * 60) * PPM;
                  const height = Math.max(42, (booking.duration_minutes || 30) * PPM - 3);
                  return <button key={booking.id} className={`cl-block t-${booking.appointment_type} ${booking.status}`}
                    style={{ top, height, left: `${(booking._lane / booking._lanes) * 100}%`, width: `calc(${100 / booking._lanes}% - 4px)` }}
                    onMouseEnter={(event) => showBookingHover(booking, event.currentTarget)} onMouseLeave={delayHideBookingHover}
                    onFocus={(event) => showBookingHover(booking, event.currentTarget)} onBlur={delayHideBookingHover}
                    onClick={() => { setHoverCard(null); setSel(booking); }}>
                    <strong>{fmtTime(booking.appointment)} · {booking.customer_name}</strong>
                    <span className="s">{booking.items?.map((item) => item.service_name || item.service?.name).filter(Boolean).join(', ') || booking.appointment_type_label}</span>
                    <span className="cl-week-booking-staff">{booking.staff_name || 'Chưa phân công'}</span>
                  </button>;
                })}
                {day === todayIso && nowTop > 0 && nowTop < (END_H - START_H) * 60 * PPM && <i className="cl-nowline" style={{ top: nowTop }} />}
              </div>;
            })}
          </div>
        </div>
        }
      </div>}
      </div>
    </div>}
    {hoverCard && createPortal(<BookingHoverCard booking={hoverCard.booking} style={{ left: hoverCard.left, top: hoverCard.top }}
      onMouseEnter={keepBookingHover} onMouseLeave={delayHideBookingHover} onOpen={() => { setHoverCard(null); setSel(hoverCard.booking); }} />, document.body)}
    {viewMode === 'legacy-list' && <section className="cl-schedule-view">
      <header className="cl-schedule-view-head"><div><small>{new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN',{month:'long',year:'numeric'})}</small><strong>Lịch hẹn · {new Date(`${date}T00:00:00`).toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'long',year:'numeric'})}</strong></div><div><button type="button" className="cl-schedule-filter-toggle" aria-expanded={listFiltersOpen} onClick={() => setListFiltersOpen((open) => !open)}><FilterListRounded/> Bộ lọc</button><button type="button" className="cl-schedule-close" onClick={() => setViewMode('calendar')}>Đóng</button></div></header>
      <nav className="cl-schedule-date-strip" aria-label="Ngày trong tuần"><button aria-label="Tuần trước" onClick={() => { const next=addDays(date,-7);setDate(next);setListDate(next); }}><ChevronLeftRounded/></button>{Array.from({length:7},(_,index)=>addDays(mondayOf(date),index)).map((day)=>{const dayDate=new Date(`${day}T00:00:00`);return <button type="button" key={day} className={day===date?'on':''} onClick={()=>{setDate(day);setListDate(day);setListPage(1)}}><span>{dayDate.toLocaleDateString('vi-VN',{weekday:'short'})}</span><strong>{dayDate.toLocaleDateString('vi-VN',{day:'numeric',month:'long'})}</strong></button>})}<button aria-label="Tuần sau" onClick={() => { const next=addDays(date,7);setDate(next);setListDate(next); }}><ChevronRightRounded/></button><button className="cl-schedule-today" onClick={()=>{setDate(todayIso);setListDate(todayIso)}}>Hôm nay</button></nav>
      <div className="cl-schedule-status-cards">{[{value:'pending',label:'Chờ xác nhận',tone:'amber'},{value:'confirmed',label:'Đã xác nhận',tone:'blue'},{value:'arrived',label:'Đã đến',tone:'teal'},{value:'completed',label:'Hoàn thành',tone:'green'},{value:'cancelled',label:'Đã hủy',tone:'red'}].map((item)=><button type="button" key={item.value} className={listStatus===item.value?'on':''} onClick={()=>{setListStatus(listStatus===item.value?'all':item.value);setListPage(1)}}><span className={`status-dot ${item.tone}`}/>{item.label}<strong>{statusCount(item.value)}</strong></button>)}</div>
      <div className={`cl-booking-list ${listFiltersOpen?'filters-open':''}`}>
      {staff.error && <div className="cl-alert error" role="alert">{staff.error}<Btn onClick={() => staff.reload()}>Tải lại danh sách bác sĩ</Btn></div>}
      <div className="cl-booking-list-filters">
        <label className="cl-booking-search"><span>Tìm lịch hẹn</span><input value={listQuery} onChange={(event) => { setListQuery(event.target.value); setListPage(1); }} placeholder="Tên, số điện thoại, bác sĩ, dịch vụ hoặc mã lịch" /></label>
        <label><span>Ngày hẹn</span><input type="date" value={listDate} onChange={(event) => { setListDate(event.target.value); setListPage(1); }} /></label>
        <label><span>Bác sĩ</span><select value={listDoctor} onChange={(event) => { setListDoctor(event.target.value); setListPage(1); }}><option value="">Tất cả bác sĩ</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select></label>
      </div>
      <div className="cl-booking-status-row">
        <div className="cl-tabs-pill cl-booking-status-tabs" role="tablist" aria-label="Lọc trạng thái lịch hẹn">
        {LIST_STATUS_OPTIONS.map((option) => <button key={option.value} type="button" role="tab" aria-selected={listStatus === option.value}
          className={listStatus === option.value ? 'on' : ''} onClick={() => { setListStatus(option.value); setListPage(1); }}>{option.label}<b>{statusCount(option.value)}</b></button>)}
        </div>
      </div>
      {listActionError && <div className="cl-alert error" role="alert">{listActionError}<button type="button" aria-label="Đóng thông báo" onClick={() => setListActionError('')}>×</button></div>}
      {list.loading ? <Loading text="Đang tải danh sách lịch hẹn…" /> : list.error ? <div className="cl-alert error" role="alert">{list.error}<Btn onClick={() => list.reload()}>Thử lại</Btn></div> :
        listBookings.length ? <>
          <div className="cl-booking-list-summary">
            <span><strong>{list.data.count}</strong> lịch phù hợp<small>{listStatus === 'pending' ? 'CSKH xử lý lịch chờ xác nhận' : 'Danh sách lịch hẹn'}</small></span>
            <button type="button" className="cl-link" onClick={() => { setListStatus('all'); setListDate(''); setListDoctor(''); setListQuery(''); setListPage(1); }}>Xóa bộ lọc</button>
          </div>
          <div className="cl-booking-table-wrap"><table className="cl-booking-table">
            <thead><tr><th>Mã</th><th>Ngày giờ</th><th>Bệnh nhân</th><th>Loại lịch / dịch vụ</th><th>Bác sĩ</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
            <tbody>{listBookings.map((booking) => {
              const session = booking.treatment_session_details;
              const services = (booking.items || []).map((item) => item.service_name || item.service?.name).filter(Boolean).join(', ');
              const canManageBooking = canBook && ['pending', 'confirmed'].includes(booking.status) && !booking.visit_id;
              return <tr key={booking.id}>
                <td><strong>#{booking.id}</strong></td>
                <td><strong>{fmtTime(booking.appointment)}</strong><small>{new Date(booking.appointment).toLocaleDateString('vi-VN')}</small></td>
                <td><strong>{booking.customer_name || 'Khách hàng'}</strong><small>{booking.customer_phone || 'Chưa có số điện thoại'}</small></td>
                <td><strong>{booking.appointment_type_label || TYPES[booking.appointment_type] || 'Lịch hẹn'}</strong>
                  <small>{booking.appointment_type === 'session' && session
                    ? `${session.plan_title} · Buổi ${session.session_number}/${session.total_sessions} · ${session.session_status_label}`
                    : services || 'Chưa có dịch vụ'}</small></td>
                <td><strong>{booking.staff_name || 'Chưa phân công'}</strong></td>
                <td><Pill tone={statusTone(booking.status)}>{booking.status_label}</Pill></td>
                <td className="cl-booking-table-actions">
                  {canManageBooking && booking.status === 'pending' && <Btn size="sm" kind="primary" onClick={() => runListAction(booking, 'confirm', 'Đã xác nhận lịch hẹn.')}>Xác nhận</Btn>}
                  {canManageBooking && <Btn size="sm" onClick={() => setSel(booking)}>Chi tiết</Btn>}
                  {canManageBooking && <Btn size="sm" onClick={() => runListAction(booking, 'cancel', 'Đã hủy lịch hẹn.')}>Hủy</Btn>}
                  {user.role === 'manager' && booking.status === 'cancelled' && <Btn size="sm" kind="primary" onClick={() => setSel(booking)}>Khôi phục</Btn>}
                  {!(canManageBooking || (user.role === 'manager' && booking.status === 'cancelled')) && <Btn size="sm" onClick={() => setSel(booking)}>Chi tiết</Btn>}
                </td>
              </tr>;
            })}</tbody>
          </table></div>
          {listPageCount > 1 && <nav className="cl-booking-pagination" aria-label="Phân trang lịch hẹn">
            <span>Trang {listPage}/{listPageCount}</span>
            <Btn size="sm" disabled={listPage <= 1} onClick={() => setListPage((page) => page - 1)}>Trước</Btn>
            <Btn size="sm" disabled={listPage >= listPageCount} onClick={() => setListPage((page) => page + 1)}>Tiếp</Btn>
          </nav>}
        </> : <div className="cl-booking-list-empty"><strong>Không tìm thấy lịch hẹn</strong><span>Thử đổi trạng thái, ngày hẹn hoặc từ khóa tìm kiếm.</span></div>}
      </div>
    </section>}
    <BookingDetail booking={sel} canBook={canBook} isManager={user.role === 'manager'} onClose={closeBooking} onChanged={(msg) => { setSel(null); toast(msg); reload(); }} onRebook={(booking) => {
      const original = new Date(booking.appointment);
      const nextDate = original.getTime() > Date.now() ? isoDay(original) : isoDay();
      setCreating({ patient_id: booking.patient, staff: booking.staff || '', date: nextDate, time: fmtTime(booking.appointment), type: booking.appointment_type, service_ids: (booking.items || []).map((item) => item.service).filter(Boolean) });
      setSel(null);
    }} doctors={doctors} staffMembers={staff.data?.results || staff.data || []} />
    <BookingForm init={creating} doctors={doctors} staffMembers={staff.data?.results || staff.data || []} onClose={() => setCreating(null)} onSaved={() => { setCreating(null); toast('Đã đặt lịch hẹn.'); reload(); }} />
    {toastNode}
  </div>;
}

function AppointmentDatePicker({ value, onChange, onClose }) {
  const selected = new Date(`${value}T00:00:00`);
  const [month, setMonth] = useState(new Date(selected.getFullYear(), selected.getMonth(), 1));
  const monthDates = (offset) => {
    const first = new Date(month.getFullYear(), month.getMonth() + offset, 1);
    const start = new Date(first); start.setDate(1 - first.getDay());
    return Array.from({ length: 42 }, (_, index) => { const day = new Date(start); day.setDate(start.getDate() + index); return day; });
  };
  const monthName = (offset) => new Date(month.getFullYear(), month.getMonth() + offset, 1).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' });
  const choose = (day) => onChange(isoDay(day));
  return <div className="cl-date-popover" role="dialog" aria-label="Chọn ngày lịch hẹn">
    <div className="cl-date-popover-head"><button type="button" aria-label="Tháng trước" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}><ChevronLeftRounded/></button><strong>{monthName(0)} – {monthName(1)}</strong><button type="button" aria-label="Tháng sau" onClick={() => setMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}><ChevronRightRounded/></button></div>
    <div className="cl-date-popover-calendars">{[0,1].map((offset)=><section key={offset}><h3>{monthName(offset)}</h3><div className="cl-date-month-grid">{['CN','T2','T3','T4','T5','T6','T7'].map((day)=><b key={day}>{day}</b>)}{monthDates(offset).map((day,index)=>{const dayIso=isoDay(day);const inMonth=day.getMonth()===new Date(month.getFullYear(),month.getMonth()+offset,1).getMonth();return <button type="button" key={`${dayIso}-${index}`} className={`${inMonth?'':'outside'} ${dayIso===value?'selected':''}`} onClick={()=>choose(day)}>{day.getDate()}</button>})}</div></section>)}</div>
    <aside className="cl-date-shortcuts">{[[14,'+2 tuần'],[28,'+4 tuần'],[42,'+6 tuần'],['m3','+3 tháng'],['m6','+6 tháng'],['m12','+12 tháng']].map(([amount,label])=><button type="button" key={label} onClick={()=>{const target=new Date(`${value}T00:00:00`);if(typeof amount==='string')target.setMonth(target.getMonth()+Number(amount.slice(1)));else target.setDate(target.getDate()+amount);choose(target)}}>{label}</button>)}</aside>
    <footer><button type="button" onClick={onClose}>Đóng</button><button type="button" onClick={()=>choose(new Date())}>Hôm nay</button></footer>
  </div>;
}

function AppointmentWaitlistPanel({ doctors, onBooked }) {
  const [status, setStatus] = useState('active');
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [page, setPage] = useState(1);
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [entryToBook, setEntryToBook] = useState(null);
  const [error, setError] = useState('');
  const [toast, toastNode] = useToast();
  useEffect(() => { const timer = setTimeout(() => { setDebouncedQuery(query.trim()); setPage(1); }, 250); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { setPage(1); }, [status]);
  const rows = useLoad(async () => {
    const params = { status, page, page_size: 20, q: debouncedQuery || undefined };
    return (await api.get('/appointment-waitlist/', { params })).data;
  }, [status, debouncedQuery, page, refreshKey]);
  const changeState = async (entry, action, success) => {
    setError('');
    try {
      await api.post(`/appointment-waitlist/${entry.id}/${action}/`);
      toast(success);
      setRefreshKey((value) => value + 1);
    } catch (exception) { setError(errMsg(exception)); }
  };
  const list = Array.isArray(rows.data) ? rows.data : rows.data?.results || [];
  const pages = Math.max(1, Math.ceil((rows.data?.count || 0) / 20));
  return <section className="cl-waitlist">
    <header className="cl-waitlist-head"><div><h2>Khách muốn được xếp lịch sớm hơn</h2><p>Liên hệ khách khi có khung phù hợp; lịch chỉ được tạo sau khi chọn giờ và bác sĩ.</p></div>
      <div className="cl-waitlist-actions"><select aria-label="Lọc danh sách chờ" value={status} onChange={(event) => setStatus(event.target.value)}><option value="active">Đang chờ và đã liên hệ</option><option value="booked">Đã đặt lịch</option><option value="cancelled">Đã hủy</option></select><Btn kind="primary" onClick={() => setCreating(true)}>Thêm vào danh sách chờ</Btn></div></header>
    <label className="cl-waitlist-search"><span>Tìm khách hàng</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tên, số điện thoại hoặc dịch vụ…" /></label>
    {error && <div className="cl-alert error" role="alert">{error}</div>}
    {rows.loading ? <Loading text="Đang tải danh sách chờ…" /> : rows.error ? <div className="cl-alert error" role="alert">{rows.error}<Btn onClick={() => rows.reload(true)}>Thử lại</Btn></div> : list.length ? <div className="cl-booking-table-wrap"><table className="cl-booking-table"><thead><tr><th>Khách hàng</th><th>Dịch vụ</th><th>Khoảng ngày</th><th>Bác sĩ ưu tiên</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{list.map((entry) => <tr key={entry.id}>
      <td><strong>{entry.patient_name}</strong><small>{entry.phone}{entry.patient_code ? ` · ${entry.patient_code}` : ''}</small></td><td>{entry.service_name || 'Chưa chọn dịch vụ'}</td>
      <td>{entry.preferred_from || entry.preferred_to ? `${entry.preferred_from || 'Bất kỳ'} – ${entry.preferred_to || 'Bất kỳ'}` : 'Linh hoạt'}</td><td>{entry.preferred_staff_name || 'Bất kỳ bác sĩ phù hợp'}</td>
      <td><Pill tone={entry.status === 'booked' ? 'green' : entry.status === 'cancelled' ? 'gray' : entry.status === 'contacted' ? 'blue' : 'amber'}>{entry.status_label}</Pill></td>
      <td className="cl-booking-table-actions">{['waiting', 'contacted'].includes(entry.status) && <><Btn size="sm" kind="primary" onClick={() => setEntryToBook(entry)}>Xếp lịch</Btn>{entry.status === 'waiting' && <Btn size="sm" onClick={() => changeState(entry, 'contact', 'Đã ghi nhận đã liên hệ khách.')}>Đã liên hệ</Btn>}<Btn size="sm" onClick={() => changeState(entry, 'cancel-entry', 'Đã đóng yêu cầu chờ.')}>Đóng</Btn></>}</td>
    </tr>)}</tbody></table></div> : <div className="cl-booking-list-empty"><strong>{debouncedQuery ? 'Không tìm thấy yêu cầu phù hợp' : 'Danh sách đang trống'}</strong><span>{debouncedQuery ? 'Thử tìm bằng tên, số điện thoại hoặc dịch vụ.' : 'Ghi nhận khách cần khung giờ sớm hơn để CSKH chủ động liên hệ khi có chỗ.'}</span></div>}
    {!rows.loading && pages > 1 && <nav className="cl-booking-pagination" aria-label="Phân trang danh sách chờ"><span>Trang {page}/{pages} · {rows.data.count} yêu cầu</span><Btn size="sm" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>Trước</Btn><Btn size="sm" disabled={page >= pages} onClick={() => setPage((current) => current + 1)}>Tiếp</Btn></nav>}
    {creating && <WaitlistCreateModal doctors={doctors} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); setRefreshKey((value) => value + 1); toast('Đã thêm khách vào danh sách chờ.'); }} />}
    {entryToBook && <WaitlistBookingModal entry={entryToBook} doctors={doctors} onClose={() => setEntryToBook(null)} onSaved={(message) => { setEntryToBook(null); setRefreshKey((value) => value + 1); onBooked(message); }} />}
    {toastNode}
  </section>;
}

function BookingHoverCard({ booking, style, onMouseEnter, onMouseLeave, onOpen }) {
  const service = booking.items?.map((item) => item.service_name || item.service?.name).filter(Boolean).join(', ')
    || booking.treatment_session_details?.plan_title || booking.appointment_type_label || TYPES[booking.appointment_type];
  const progress = [
    { value: 'pending', label: 'Chờ xác nhận' },
    { value: 'confirmed', label: 'Đã xác nhận' },
    { value: 'checked_in', label: 'Đã đến' },
    { value: 'in_progress', label: 'Đang khám' },
    { value: 'completed', label: 'Hoàn tất' },
  ];
  let active = Math.max(0, progress.findIndex((step) => step.value === booking.status));
  if (booking.visit_status === 'waiting') active = Math.max(active, 2);
  if (booking.visit_status === 'in_consult') active = Math.max(active, 3);
  if (booking.visit_status === 'completed') active = 4;
  const created = booking.history?.find((entry) => entry.event === 'created') || booking.history?.[0];
  const cancelled = ['cancelled', 'no_show'].includes(booking.status);
  const fullDate = new Date(booking.appointment);
  return <aside className="cl-booking-hover" style={style} role="dialog" aria-label={`Thông tin lịch hẹn ${booking.customer_name || ''}`} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave}>
    <header className="cl-booking-hover-head">
      <Pill tone={statusTone(booking.status)}>{booking.status_label || 'Lịch hẹn'}</Pill>
      <strong>{fmtTime(booking.appointment)} – {fmtTime(booking.end_time)}</strong>
      <span>{booking.duration_minutes || 30} phút</span>
    </header>
    <div className="cl-booking-hover-body">
      <section className="cl-booking-hover-client">
        <span className="cl-booking-hover-label">BỆNH NHÂN</span>
        <div className="cl-booking-hover-person"><Avatar name={booking.customer_name || booking.guest_name || 'Khách hàng'} size={42} /><div><strong>{booking.customer_name || booking.guest_name || 'Khách hàng'}</strong><small>{booking.patient_code || (booking.patient ? `Hồ sơ #${booking.patient}` : 'Khách đặt lịch')}</small></div></div>
        {booking.customer_phone && <p className="cl-booking-hover-contact"><span>Điện thoại</span><strong>{booking.customer_phone}</strong></p>}
        {booking.customer_email && <p className="cl-booking-hover-contact"><span>Email</span><strong>{booking.customer_email}</strong></p>}
      </section>
      <section className="cl-booking-hover-appointment">
        <span className="cl-booking-hover-label">LỊCH HẸN</span>
        <h3>{service}</h3>
        <p className="cl-booking-hover-with">BÁC SĨ / NGƯỜI THỰC HIỆN</p>
        <strong className="cl-booking-hover-staff">{booking.staff_name || 'Chưa phân công'}</strong>
        {cancelled ? <div className="cl-booking-hover-terminal">{booking.status === 'no_show' ? 'Khách không đến' : 'Lịch hẹn đã hủy'}</div> : <div className="cl-booking-progress" aria-label="Tiến trình lịch hẹn">
          {progress.map((step, index) => <div key={step.value} className={`${index < active ? 'done' : ''} ${index === active ? 'current' : ''}`}><i /><span>{step.label}</span></div>)}
        </div>}
        {booking.visit_status === 'waiting' && <p className="cl-booking-hover-visit">Bệnh nhân đang chờ tại sảnh</p>}
        {booking.visit_status === 'in_consult' && <p className="cl-booking-hover-visit">Đang được bác sĩ tiếp nhận</p>}
      </section>
    </div>
    <footer className="cl-booking-hover-foot">
      <span>{created ? `Tạo bởi ${created.actor_name || 'Khách hàng'} · ${new Date(created.created_at).toLocaleString('vi-VN')}` : `Ngày hẹn ${fullDate.toLocaleDateString('vi-VN')}`}</span>
      <button type="button" onClick={onOpen}>Mở chi tiết lịch</button>
    </footer>
  </aside>;
}

function WaitlistCreateModal({ doctors, onClose, onSaved }) {
  const services = useLoad(async () => (await api.get('/services/')).data, []);
  const [patient, setPatient] = useState(null);
  const [form, setForm] = useState({ patient_name: '', phone: '', service: '', preferred_staff: '', preferred_from: '', preferred_to: '', note: '' });
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const list = Array.isArray(services.data) ? services.data : services.data?.results || [];
  const submit = async () => { setBusy(true); setError(''); try { await api.post('/appointment-waitlist/', { ...form, patient: patient?.id || null, service: form.service || null, preferred_staff: form.preferred_staff || null, preferred_from: form.preferred_from || null, preferred_to: form.preferred_to || null }); onSaved(); } catch (exception) { setError(errMsg(exception)); } finally { setBusy(false); } };
  return <Modal open title="Thêm khách vào danh sách chờ" subtitle="Ghi nhận yêu cầu liên hệ khi có khung giờ phù hợp. Chưa tạo lịch hẹn ở bước này." onClose={onClose} footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={busy || !form.patient_name.trim() || !form.phone.trim()} onClick={submit}>{busy ? 'Đang lưu…' : 'Lưu yêu cầu'}</Btn></>}>
    {error && <div className="cl-alert error" role="alert">{error}</div>}<Field label="Liên kết hồ sơ bệnh nhân (nếu đã có)"><PatientPicker value={patient} onPick={(value) => { setPatient(value); if (value) setForm((current) => ({ ...current, patient_name: value.full_name, phone: value.phone })); }} /></Field><div className="cl-form-grid">
      <Field label="Họ và tên" required><input value={form.patient_name} onChange={(event) => setForm({ ...form, patient_name: event.target.value })} /></Field>
      <Field label="Số điện thoại" required><input inputMode="tel" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></Field>
      <Field label="Dịch vụ quan tâm"><select value={form.service} onChange={(event) => setForm({ ...form, service: event.target.value })}><option value="">Chưa xác định</option>{list.filter((service) => service.is_active).map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></Field>
      <Field label="Bác sĩ ưu tiên"><select value={form.preferred_staff} onChange={(event) => setForm({ ...form, preferred_staff: event.target.value })}><option value="">Bất kỳ bác sĩ phù hợp</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select></Field>
      <Field label="Có thể từ ngày"><input type="date" value={form.preferred_from} onChange={(event) => setForm({ ...form, preferred_from: event.target.value })} /></Field>
      <Field label="Đến ngày"><input type="date" value={form.preferred_to} onChange={(event) => setForm({ ...form, preferred_to: event.target.value })} /></Field>
      <Field label="Ghi chú điều phối" span="2"><textarea rows="2" maxLength={255} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} placeholder="Khung giờ mong muốn, yêu cầu liên hệ…" /></Field>
    </div>
  </Modal>;
}

function WaitlistBookingModal({ entry, doctors, onClose, onSaved }) {
  const [date, setDate] = useState(entry.preferred_from || isoDay()); const [time, setTime] = useState('09:00');
  const [staff, setStaff] = useState(String(entry.preferred_staff || doctors[0]?.id || '')); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async () => { setBusy(true); setError(''); try { await api.post(`/appointment-waitlist/${entry.id}/book/`, { appointment: new Date(`${date}T${time}`).toISOString(), staff: Number(staff) }); onSaved('Đã đặt lịch từ danh sách chờ.'); } catch (exception) { setError(errMsg(exception)); } finally { setBusy(false); } };
  return <Modal open title={`Xếp lịch cho ${entry.patient_name}`} subtitle="Máy chủ sẽ xác minh bác sĩ, dịch vụ và xung đột trước khi lưu lịch." onClose={onClose} footer={<><Btn onClick={onClose}>Đóng</Btn><Btn kind="primary" disabled={busy || !date || !time || !staff} onClick={submit}>{busy ? 'Đang kiểm tra…' : 'Xác nhận lịch hẹn'}</Btn></>}>
    {error && <div className="cl-alert error" role="alert">{error}</div>}<div className="cl-form-grid"><Field label="Ngày hẹn" required><input type="date" min={isoDay()} value={date} onChange={(event) => setDate(event.target.value)} /></Field><Field label="Giờ hẹn" required><input type="time" step={900} value={time} onChange={(event) => setTime(event.target.value)} /></Field><Field label="Bác sĩ" required span="2"><select value={staff} onChange={(event) => setStaff(event.target.value)}><option value="">Chọn bác sĩ</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select></Field><Field label="Dịch vụ"><input value={entry.service_name || 'Khám / tư vấn'} readOnly /></Field><Field label="Khách hàng"><input value={`${entry.patient_name} · ${entry.phone}`} readOnly /></Field></div>
  </Modal>;
}

function BookingPatientOverview({ booking }) {
  const [patient, setPatient] = useState(null);
  const [summary, setSummary] = useState(null);
  const [invoices, setInvoices] = useState([]);
  const [consents, setConsents] = useState([]);
  const [consentsAvailable, setConsentsAvailable] = useState(false);
  const [billingAvailable, setBillingAvailable] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    setPatient(null); setSummary(null); setInvoices([]); setConsents([]); setConsentsAvailable(false); setBillingAvailable(false); setError(''); setLoading(false);
    if (!booking.patient) return () => { active = false; };
    setLoading(true);
    Promise.allSettled([
      api.get(`/clinic/patients/${booking.patient}/`),
      api.get(`/clinic/patients/${booking.patient}/summary/`),
      api.get('/clinic/invoices/', { params: { patient: booking.patient } }),
      api.get('/clinic/consents/', { params: { patient: booking.patient } }),
    ]).then(([patientResult, summaryResult, invoiceResult, consentResult]) => {
      if (!active) return;
      if (patientResult.status === 'fulfilled') setPatient(patientResult.value.data);
      else setError(errMsg(patientResult.reason, 'Không tải được hồ sơ khách hàng.'));
      if (summaryResult.status === 'fulfilled') setSummary(summaryResult.value.data);
      if (invoiceResult.status === 'fulfilled') {
        const data = invoiceResult.value.data;
        setInvoices(Array.isArray(data) ? data : data.results || []);
        setBillingAvailable(true);
      }
      if (consentResult.status === 'fulfilled') {
        const data = consentResult.value.data;
        setConsents(Array.isArray(data) ? data : data.results || []);
        setConsentsAvailable(true);
      }
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [booking.id, booking.patient]);
  const money = (value) => new Intl.NumberFormat('vi-VN').format(Number(value || 0)) + 'đ';
  const due = invoices.filter((invoice) => Number(invoice.balance) > 0);
  return <>
    <div className="cl-client-overview-head">
      <Avatar name={patient?.full_name || booking.customer_name} />
      <div><h3>{patient?.full_name || booking.customer_name}</h3><p>{patient?.code || booking.patient_code || 'Chưa liên kết mã hồ sơ'}</p></div>
      {booking.patient && <Link className="cl-link" to={`/benh-nhan/${booking.patient}`}>Mở hồ sơ</Link>}
    </div>
    {loading && <Loading text="Đang tải hồ sơ khách hàng…" />}
    {error && <p className="cl-muted">{error}</p>}
    <dl className="cl-client-contact">
      <div><dt>Điện thoại</dt><dd>{patient?.phone || booking.customer_phone || 'Chưa có'}</dd></div>
      <div><dt>Email</dt><dd>{patient?.email || booking.customer_email || 'Chưa có'}</dd></div>
      {patient?.date_of_birth && <div><dt>Ngày sinh</dt><dd>{new Date(`${patient.date_of_birth}T00:00:00`).toLocaleDateString('vi-VN')}{patient.age ? ` · ${patient.age} tuổi` : ''}</dd></div>}
      {patient?.gender_label && <div><dt>Giới tính</dt><dd>{patient.gender_label}</dd></div>}
    </dl>
    {patient?.skin_type && <div className="cl-patient-fact"><span>Loại da</span><strong>{patient.skin_type}</strong></div>}
    <div className="cl-patient-sections">
      <details className="cl-patient-accordion" open><summary><span>Dị ứng</span><b>{patient?.allergies ? '1' : '0'}</b></summary><div className={patient?.allergies ? 'is-alert' : ''}>{patient?.allergies || 'Chưa ghi nhận dị ứng trong hồ sơ.'}</div></details>
      <details className="cl-patient-accordion"><summary><span>Cảnh báo y tế</span><b>{[patient?.chronic_conditions, patient?.current_medications, patient?.pregnancy_status].filter(Boolean).length}</b></summary><div>{patient?.chronic_conditions && <p><strong>Bệnh nền:</strong> {patient.chronic_conditions}</p>}{patient?.current_medications && <p><strong>Thuốc đang dùng:</strong> {patient.current_medications}</p>}{patient?.pregnancy_status && <p><strong>Tình trạng thai kỳ:</strong> {patient.pregnancy_status}</p>}{!patient?.chronic_conditions && !patient?.current_medications && !patient?.pregnancy_status && 'Chưa ghi nhận cảnh báo y tế.'}</div></details>
      <details className="cl-patient-accordion"><summary><span>Biểu mẫu & cam kết</span><b>{consents.length}</b></summary><div>{consents.length ? consents.slice(0, 5).map((consent) => <p key={consent.id}><strong>{consent.title || consent.kind_label}</strong><span>{consent.status_label} · {consent.created_at ? new Date(consent.created_at).toLocaleDateString('vi-VN') : ''}</span></p>) : consentsAvailable ? 'Chưa có phiếu cam kết gắn với hồ sơ này.' : 'Tài khoản hiện tại không có quyền xem phiếu cam kết.'}</div></details>
      <details className="cl-patient-accordion"><summary><span>Ghi chú</span><b>{[booking.note, patient?.clinical_notes, patient?.skin_history].filter(Boolean).length}</b></summary><div>{booking.note && <p><strong>Ghi chú lịch hẹn:</strong> {booking.note}</p>}{patient?.clinical_notes && <p><strong>Ghi chú chuyên môn:</strong> {patient.clinical_notes}</p>}{patient?.skin_history && <p><strong>Tiền sử da:</strong> {patient.skin_history}</p>}{![booking.note, patient?.clinical_notes, patient?.skin_history].some(Boolean) && 'Chưa có ghi chú.'}</div></details>
      <details className="cl-patient-accordion"><summary><span>Billing Info · Thanh toán</span><b>{invoices.length}</b></summary><div>{billingAvailable ? invoices.length ? invoices.slice(0, 5).map((invoice) => <p key={invoice.id}><strong>{invoice.code || `Hóa đơn #${invoice.id}`}</strong><span>{invoice.status_label} · Còn {money(invoice.balance)}</span></p>) : 'Chưa có hóa đơn.' : 'Bạn không có quyền xem dữ liệu thanh toán hoặc dịch vụ chưa khả dụng.'}</div></details>
      <details className="cl-patient-accordion"><summary><span>Bảo hiểm</span><b>—</b></summary><div>AkinaClinic hiện chưa lưu thông tin bảo hiểm cho hồ sơ này.</div></details>
    </div>
    <div className="cl-client-stats">
      <div><span>Lượt khám</span><strong>{summary?.visit_count ?? patient?.visit_count ?? '—'}</strong></div>
      <div><span>Công nợ</span><strong>{billingAvailable ? money(due.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0)) : '—'}</strong></div>
    </div>
    <section className="cl-client-history">
      <h4>Lần khám gần nhất</h4>
      <p>{summary?.last_visit ? new Date(summary.last_visit).toLocaleString('vi-VN') : 'Chưa ghi nhận lượt khám'}</p>
    </section>
    {summary?.upcoming?.length > 0 && <section className="cl-client-history">
      <h4>Lịch hẹn sắp tới</h4>
      {summary.upcoming.slice(0, 3).map((item) => <p key={item.id}>{new Date(item.appointment).toLocaleString('vi-VN')} · {item.type}{item.doctor ? ` · ${item.doctor}` : ''}</p>)}
    </section>}
    {summary?.active_plans?.length > 0 && <section className="cl-client-history">
      <h4>Liệu trình đang thực hiện</h4>
      {summary.active_plans.map((plan) => <p key={plan.id}>{plan.title} · {plan.done}/{plan.total} buổi</p>)}
    </section>}
    {!booking.patient && <p className="cl-muted">Hồ sơ bệnh nhân sẽ được liên kết khi tiếp đón lịch này.</p>}
  </>;
}

function BookingDetail({ booking: b, canBook, isManager, onClose, onChanged, onRebook, doctors, staffMembers }) {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [err, setErr] = useState('');
  const [resched, setResched] = useState(null);
  const [exceptionAction, setExceptionAction] = useState('');
  const [exceptionReason, setExceptionReason] = useState('');
  const [exceptionStaff, setExceptionStaff] = useState('');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setErr('');
    setResched(null);
    setExceptionAction('');
    setExceptionReason('');
    setExceptionStaff('');
    setActionsOpen(false);
    if (!b) return undefined;
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [b?.id, onClose]);
  if (!b) return null;
  const run = async (fn, msg) => {
    if (busy) return;
    setBusy(true);
    setErr('');
    try { await fn(); onChanged(msg); } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const canAct = canBook && ['pending', 'confirmed'].includes(b.status) && !b.visit_id;
  const sessionPolicy = b.treatment_session_policy;
  const sessionServiceId = Number(sessionPolicy?.service_id);
  const bookingServiceIds = (b.items || []).map((item) => Number(item.service)).filter(Boolean);
  const assignmentOptions = b.appointment_type === 'consult' || b.appointment_type === 'follow_up'
    ? doctors
    : (staffMembers || []).filter((person) => {
      if (!person.is_active || !person.user_id || !['doctor', 'staff'].includes(person.account_role)) return false;
      if (b.appointment_type === 'session' && !sessionPolicy?.allow_staff_delegation && person.user_id !== sessionPolicy?.doctor_user_id) return false;
      const requiredServices = b.appointment_type === 'session' ? [sessionServiceId] : bookingServiceIds;
      return requiredServices.length > 0 && requiredServices.every((id) => (person.service_ids_current || []).some((serviceId) => Number(serviceId) === id));
    });
  const rescheduleOptions = isManager ? assignmentOptions.filter((person) => person.id === b.staff) : assignmentOptions;
  const sessionDetails = b.treatment_session_details;
  const serviceNames = b.items?.map((item) => item.service_name || item.service?.name).filter(Boolean).join(', ');
  const runManagerException = async () => {
    const reason = exceptionReason.trim();
    if (!reason || !exceptionAction) {
      setErr('Vui lòng nhập lý do trước khi thực hiện.');
      return;
    }
    if (exceptionAction === 'reassign' && !exceptionStaff) {
      setErr('Vui lòng chọn nhân sự đủ điều kiện.');
      return;
    }
    const message = exceptionAction === 'restore' ? 'Xác nhận khôi phục lịch này về trạng thái chờ xác nhận?' : 'Xác nhận điều phối lịch sang nhân sự đã chọn?';
    if (!window.confirm(`${message}\n\nLý do: ${reason}`)) return;
    const endpoint = exceptionAction === 'restore' ? 'restore' : 'reassign';
    await run(() => api.post(`/bookings/${b.id}/${endpoint}/`, {
      reason,
      confirmed: true,
      ...(exceptionAction === 'reassign' ? { staff: Number(exceptionStaff) } : {}),
    }), exceptionAction === 'restore' ? 'Đã khôi phục lịch về trạng thái chờ xác nhận.' : 'Đã điều phối lại nhân sự.');
  };
  return <div className="cl-booking-side-panel">
    <aside className="cl-booking-drawer" aria-label={`Chi tiết lịch hẹn ${b.id}`}>
      <header className="cl-booking-drawer-header">
        <div><span className="cl-drawer-kicker">Mã lịch #{b.id}</span><h2>{b.customer_name}</h2><p>{b.appointment_type_label} · {new Date(b.appointment).toLocaleDateString('vi-VN')} · {fmtTime(b.appointment)} – {fmtTime(b.end_time)}</p></div>
        <button className="cl-icon-btn" onClick={onClose} aria-label="Đóng"><CloseRounded /></button>
      </header>
      <div className="cl-booking-drawer-body">
        {err && <div className="cl-alert error" role="alert">{err}</div>}
        <div className="cl-booking-detail-grid">
        <section className="cl-client-overview" aria-label="Hồ sơ khách hàng">
          <div className="cl-detail-section-title">Hồ sơ khách hàng</div>
          <BookingPatientOverview booking={b} />
        </section>
        <section className="cl-appointment-overview" aria-label="Thông tin lịch hẹn">
        <div className={`cl-appointment-status-head tone-${statusTone(b.status)}`}>
          <div><span>{b.status_label}</span><strong>{fmtTime(b.appointment)} – {fmtTime(b.end_time)}</strong><small>{new Date(b.appointment).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} · {b.appointment_type_label}</small></div>
          <span className="cl-appointment-code">#{b.id}</span>
        </div>
        <div className="cl-appointment-progress" aria-label="Tiến trình lịch hẹn">
          {[['pending', 'Chờ xác nhận'], ['confirmed', 'Đã xác nhận'], ['checked_in', 'Đã đến'], ['in_progress', 'Đang phục vụ'], ['completed', 'Hoàn thành']].map(([key, label], index) => {
            const order = ['pending', 'confirmed', 'checked_in', 'in_progress', 'completed'];
            const current = order.indexOf(b.status);
            return <div key={key} className={current >= index ? 'is-done' : ''}><i />{label}</div>;
          })}
          {['cancelled', 'no_show'].includes(b.status) && <div className="is-terminal">{b.status_label}</div>}
        </div>
        <dl className="cl-dl">
          <div><dt>Điện thoại</dt><dd>{b.customer_phone || '—'}</dd></div>
          <div><dt>Bác sĩ / người thực hiện</dt><dd>{b.staff_name || 'Chưa phân công'}</dd></div>
          <div><dt>Loại lịch</dt><dd>{b.appointment_type_label || TYPES[b.appointment_type]}</dd></div>
          <div><dt>Trạng thái</dt><dd><Pill tone={statusTone(b.status)}>{b.status_label}</Pill></dd></div>
          {b.appointment_type === 'session' && sessionDetails && <div className="span2"><dt>Liệu trình</dt><dd>{sessionDetails.plan_title} · Buổi {sessionDetails.session_number}/{sessionDetails.total_sessions}</dd><small>Buổi: {sessionDetails.session_status_label} · Liệu trình: {sessionDetails.plan_status_label}</small></div>}
          <div className="span2"><dt>Dịch vụ</dt><dd>{serviceNames || (b.appointment_type === 'session' ? sessionDetails?.plan_title : null) || '—'}</dd></div>
          {b.note && <div className="span2"><dt>Ghi chú</dt><dd>{b.note}</dd></div>}
        </dl>
        {b.history?.length > 0 && <section className="cl-booking-history"><h3>Lịch sử cập nhật</h3><ol>{b.history.map((item, index) => <li key={`${item.event}-${item.created_at}-${index}`}><strong>{item.event === 'rescheduled' ? 'Đổi lịch' : item.event === 'reassigned' ? 'Điều phối nhân sự' : item.event === 'restored' ? 'Khôi phục lịch' : item.event === 'confirmed' ? 'Xác nhận' : item.event === 'checked_in' ? 'Check-in' : item.event === 'in_progress' ? 'Bắt đầu phục vụ' : item.event === 'cancelled' ? 'Hủy lịch' : item.event === 'no_show' ? 'Không đến' : item.event === 'completed' ? 'Hoàn thành lịch' : 'Tạo lịch'}</strong><span>{item.actor_name || 'Khách hàng'} · {new Date(item.created_at).toLocaleString('vi-VN')}</span>{item.old_appointment && item.new_appointment && item.old_appointment !== item.new_appointment && <small>{new Date(item.old_appointment).toLocaleString('vi-VN')} → {new Date(item.new_appointment).toLocaleString('vi-VN')}</small>}{item.reason && <small>{item.reason}</small>}</li>)}</ol></section>}
        {b.patient ? <Link className="cl-link" to={`/benh-nhan/${b.patient}`}>Mở hồ sơ bệnh án {b.patient_code}</Link> : <small className="cl-muted">Chưa liên kết hồ sơ bệnh nhân — sẽ tự tạo khi đón.</small>}
        {resched && <div className="cl-form-grid cl-drawer-reschedule">
          <Field label="Ngày"><input type="date" value={resched.date} onChange={(e) => setResched({ ...resched, date: e.target.value })} /></Field>
          <Field label="Giờ"><input type="time" step={900} value={resched.time} onChange={(e) => setResched({ ...resched, time: e.target.value })} /></Field>
          <Field label={b.appointment_type === 'session' ? 'Người thực hiện' : 'Bác sĩ'} span="2"><select value={resched.staff || ''} disabled={!rescheduleOptions.length} onChange={(e) => setResched({ ...resched, staff: Number(e.target.value) })}><option value="">— Chọn người đủ điều kiện —</option>{rescheduleOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>{isManager && <small className="cl-muted">Thay đổi nhân sự cần dùng thao tác Điều phối ngoại lệ để ghi lý do và nhật ký.</small>}{b.appointment_type === 'session' && <small className="cl-muted">{sessionPolicy?.allow_staff_delegation ? 'Bác sĩ phụ trách đã cho phép điều phối bác sĩ/nhân sự có dịch vụ phù hợp.' : 'Chỉ bác sĩ phụ trách liệu trình được thực hiện buổi này.'}</small>}</Field>
          <Btn kind="primary" disabled={!resched.staff || !rescheduleOptions.length || busy} onClick={() => run(() => api.post(`/bookings/${b.id}/reschedule/`, { appointment: new Date(`${resched.date}T${resched.time}`).toISOString(), staff: resched.staff }), 'Đã đổi lịch hẹn.')}>Lưu giờ mới</Btn>
        </div>}
        {isManager && ['pending', 'confirmed', 'cancelled'].includes(b.status) && <section className="cl-manager-exceptions">
          <h3>Điều phối ngoại lệ · Manager</h3>
          <p>Thao tác được kiểm tra lại tình trạng lịch, chuyên môn và xung đột tại máy chủ.</p>
          {!exceptionAction ? <div className="cl-manager-exception-buttons">
            <Btn disabled={busy || !assignmentOptions.some((person) => person.id !== b.staff)} onClick={() => { setExceptionAction('reassign'); setExceptionStaff(assignmentOptions.find((person) => person.id !== b.staff)?.id || ''); }}>Điều phối nhân sự</Btn>
            {b.status === 'cancelled' && <Btn kind="primary" disabled={busy} onClick={() => setExceptionAction('restore')}>Khôi phục lịch</Btn>}
          </div> : <div className="cl-manager-exception-form">
            {exceptionAction === 'reassign' && <Field label="Nhân sự đủ điều kiện"><select value={exceptionStaff} onChange={(event) => setExceptionStaff(event.target.value)}><option value="">— Chọn nhân sự —</option>{assignmentOptions.filter((person) => person.id !== b.staff).map((person) => <option key={person.id} value={person.id}>{person.name} · {person.position}</option>)}</select>{b.appointment_type === 'session' && <small className="cl-muted">{sessionPolicy?.allow_staff_delegation ? 'Chỉ chọn bác sĩ/nhân viên đủ điều kiện theo dịch vụ và chỉ định.' : 'Chỉ bác sĩ phụ trách liệu trình được phân công.'}</small>}</Field>}
            <Field label="Lý do (bắt buộc)"><textarea rows="3" maxLength="200" value={exceptionReason} onChange={(event) => setExceptionReason(event.target.value)} placeholder="Ghi rõ lý do điều phối hoặc khôi phục lịch" /></Field>
            <div className="cl-manager-exception-buttons">
              <Btn disabled={busy} onClick={() => { setExceptionAction(''); setExceptionReason(''); }}>Đóng</Btn>
              <Btn kind="primary" disabled={busy || !exceptionReason.trim() || (exceptionAction === 'reassign' && !exceptionStaff)} onClick={runManagerException}>{busy ? 'Đang xử lý…' : exceptionAction === 'restore' ? 'Xác nhận khôi phục' : 'Xác nhận điều phối'}</Btn>
            </div>
          </div>}
        </section>}
        </section>
        </div>
      </div>
      <footer className="cl-booking-drawer-footer cl-booking-actions-footer">
        <div className="cl-booking-actions-menu-wrap">
          <button type="button" className="cl-booking-actions-trigger" aria-expanded={actionsOpen} onClick={() => setActionsOpen((open) => !open)}>Thao tác <span aria-hidden="true">⌄</span></button>
          {actionsOpen && <div className="cl-booking-actions-menu" role="menu">
            {canAct && <>
              <button type="button" role="menuitem" disabled={busy} onClick={() => { setActionsOpen(false); setResched({ date: isoDay(new Date(b.appointment)), time: fmtTime(b.appointment), staff: assignmentOptions.some((person) => person.id === b.staff) ? b.staff : assignmentOptions[0]?.id || '' }); }}>Đổi lịch hẹn</button>
              {b.status === 'pending' && <button type="button" role="menuitem" disabled={busy} onClick={() => { setActionsOpen(false); run(() => api.post(`/bookings/${b.id}/confirm/`), 'Đã xác nhận lịch hẹn.'); }}>Xác nhận lịch</button>}
              {new Date(b.appointment) <= new Date() && <button type="button" role="menuitem" disabled={busy} onClick={() => { setActionsOpen(false); if (window.confirm('Ghi nhận khách không đến lịch hẹn này?')) run(() => api.post(`/bookings/${b.id}/no_show/`), 'Đã ghi nhận khách không đến.'); }}>Ghi nhận không đến</button>}
              <button type="button" role="menuitem" className="is-danger" disabled={busy} onClick={() => { setActionsOpen(false); if (window.confirm(`Bạn có chắc muốn hủy lịch hẹn của ${b.customer_name}?`)) run(() => api.post(`/bookings/${b.id}/cancel/`), 'Đã hủy lịch hẹn.'); }}>Hủy lịch</button>
            </>}
            {isManager && b.status === 'cancelled' && <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); setExceptionAction('restore'); }}>Khôi phục lịch</button>}
            {canBook && ['consult', 'procedure'].includes(b.appointment_type) && ['completed', 'cancelled', 'no_show'].includes(b.status) && <button type="button" role="menuitem" onClick={() => { setActionsOpen(false); onRebook(b); }}>Đặt lịch tiếp</button>}
          </div>}
        </div>
        <div className="cl-booking-actions-spacer" />
        {canAct && b.status === 'pending' && <Btn disabled={busy} kind="primary" onClick={() => run(() => api.post(`/bookings/${b.id}/confirm/`), 'Đã xác nhận lịch hẹn.')}>Xác nhận</Btn>}
        {canAct && b.status === 'confirmed' && <Btn disabled={busy} kind="primary" onClick={() => run(() => api.post('/clinic/visits/from-booking/', { booking_id: b.id }), 'Đã đón bệnh nhân — đang chờ ở sảnh.')}>Đã đến</Btn>}
        {b.visit_id && ['manager', 'consultant'].includes(user?.role) && <Btn kind="primary" onClick={() => navigate(`/thu-ngan?visitId=${b.visit_id}`)}>Thanh toán</Btn>}
      </footer>
    </aside>
  </div>;
}

function BookingForm({ init, doctors, staffMembers, onClose, onSaved }) {
  const services = useLoad(async () => (await api.get('/services/')).data, []);
  const [f, setF] = useState(null);
  const [patient, setPatient] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [availability, setAvailability] = useState({ staff: [], loading: false, error: '' });
  const [selectedSlot, setSelectedSlot] = useState('');
  const [availabilityVersion, setAvailabilityVersion] = useState(0);
  const preferredTime = useRef('');
  useEffect(() => {
    if (!init) return;
    let active = true;
    setF({ type: 'consult', service_ids: [], note: '', ...init });
    preferredTime.current = init.time || '';
    setPatient(null); setErr(''); setSelectedSlot('');
    if (init.patient_id) api.get(`/clinic/patients/${init.patient_id}/`).then(({ data }) => { if (active) setPatient(data); }).catch(() => { if (active) setErr('Không tải được hồ sơ khách hàng đã chọn; vui lòng tìm và chọn lại.'); });
    return () => { active = false; };
  }, [init]);
  const serviceKey = f?.service_ids?.join(',') || '';

  useEffect(() => {
    if (!init || !f?.date) return undefined;
    if (f.type === 'procedure' && !serviceKey) {
      setAvailability({ staff: [], loading: false, error: '' });
      setSelectedSlot('');
      return undefined;
    }
    let active = true;
    setAvailability({ staff: [], loading: true, error: '' });
    setSelectedSlot('');
    const params = { date: f.date, appointment_type: f.type, service_ids: serviceKey };
    if (f.staff) params.staff_id = f.staff;
    api.get('/availability/', { params }).then(({ data }) => {
      if (!active) return;
      const currentTime = preferredTime.current;
      const rows = (data.staff || []).map((row) => ({
        ...row,
        slots: (row.slots || []).filter((slot) => new Date(slot).getTime() > Date.now()),
      }));
      setAvailability({ staff: rows, loading: false, error: '' });
      const preferred = rows.flatMap((row) => row.slots.map((slot) => ({ slot, staffId: row.staff_id })))
        .find(({ slot, staffId }) => {
          const value = new Date(slot);
          const time = `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
          return time === currentTime && (!f.staff || String(staffId) === String(f.staff));
        });
      if (preferred) {
        setSelectedSlot(preferred.slot);
        if (!f.staff) setF((current) => ({ ...current, staff: preferred.staffId }));
      }
    }).catch((exception) => {
      if (active) setAvailability({ staff: [], loading: false, error: errMsg(exception, 'Không tải được khung giờ khả dụng.') });
    });
    return () => { active = false; };
  }, [init, f?.date, f?.staff, f?.type, serviceKey, availabilityVersion]);

  if (!init || !f) return null;
  const servicesList = (services.data?.results || services.data || []).filter((s) => s.is_active);
  const list = f.type === 'procedure' ? servicesList.filter((service) => service.booking_policy === 'direct') : servicesList;
  const toggle = (id) => setF((s) => ({ ...s, service_ids: s.service_ids.includes(id) ? s.service_ids.filter((x) => x !== id) : [...s.service_ids, id] }));
  const selectedServices = list.filter((s) => f.service_ids.includes(s.id));
  const pricingComplete = selectedServices.every((service) => service.price != null && Number.isFinite(Number(service.price)));
  const total = selectedServices.reduce((amount, service) => amount + (Number(service.price) || 0), 0);
  const serviceIds = selectedServices.map((service) => service.id);
  const eligibleStaff = (staffMembers || []).filter((member) => member.is_active && (f.type !== 'consult' || member.account_role === 'doctor'));
  const selectedStaff = eligibleStaff.find((member) => String(member.id) === String(f.staff));
  const duration = f.type === 'consult' ? 60 : selectedServices.reduce((minutes, service) => minutes + Number(service.duration || 0), 0) || 60;

  const submit = async () => {
    if (!patient || !selectedSlot) {
      setErr('Vui lòng chọn bệnh nhân và khung giờ còn trống.');
      return;
    }
    setBusy(true); setErr('');
    try {
      await api.post('/bookings/', { patient: patient.id, staff: Number(f.staff), appointment: selectedSlot,
        appointment_type: f.type, service_ids: serviceIds, note: f.note });
      onSaved();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return <Modal open wide title="Đặt lịch hẹn" subtitle="Chọn hồ sơ, dịch vụ và khung giờ còn trống." onClose={onClose}
    footer={<><Btn onClick={onClose}>Đóng</Btn><Btn kind="primary" disabled={!patient || !f.staff || !selectedSlot || busy} onClick={submit}>{busy ? 'Đang lưu…' : 'Đặt lịch'}</Btn></>}>
    {err && <div className="cl-alert error" role="alert">{err}</div>}
    {services.error && <div className="cl-alert error" role="alert">{services.error}<Btn size="sm" onClick={() => services.reload(true)}>Tải lại dịch vụ</Btn></div>}
    <div className="cl-booking-client-select"><Field label="Hồ sơ khách hàng"><PatientPicker value={patient} onPick={(value) => { setPatient(value); setErr(''); }} /></Field></div>
    <div className="cl-booking-type-tabs" role="tablist" aria-label="Loại lịch hẹn">
      {INTERNAL_BOOKING_TYPES.map((type) => <button type="button" role="tab" aria-selected={f.type === type} className={f.type === type ? 'is-active' : ''} key={type} onClick={() => {
        setF({ ...f, type, staff: type === 'consult' ? (doctors[0]?.id || '') : '', service_ids: type === 'procedure' ? f.service_ids.filter((id) => servicesList.find((service) => service.id === id)?.booking_policy === 'direct') : f.service_ids });
        setErr('');
      }}>{TYPES[type]}</button>)}
    </div>
    <div className="cl-booking-form-layout">
    <div className="cl-booking-form-main">
      <div className="cl-form-grid cl-booking-form-grid">
      <div className="cl-field span2 cl-service-field">
        <span id="booking-services-label">Dịch vụ {f.type === 'consult' ? '(không bắt buộc)' : '· bắt buộc'}</span>
        {f.type === 'consult' && <small>Để trống nếu khách chưa xác định dịch vụ; thời lượng khám mặc định 60 phút.</small>}
        {f.type === 'procedure' && !list.length && <small>Chưa có dịch vụ nào được cấu hình cho phép đặt trực tiếp.</small>}
        <div className="cl-check-grid" role="group" aria-labelledby="booking-services-label">{list.map((s) => <label key={s.id} className={f.service_ids.includes(s.id) ? 'on' : ''}>
          <input type="checkbox" checked={f.service_ids.includes(s.id)} onChange={() => { toggle(s.id); setErr(''); }} /><span className="cl-check-option-copy"><strong>{s.name}</strong><small>{s.duration} phút · {s.price == null ? 'Chưa có giá' : `${new Intl.NumberFormat('vi-VN').format(Number(s.price))}đ`}</small></span></label>)}</div>
      </div>
      <Field label="Ghi chú" span="2"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ghi chú điều phối / yêu cầu của khách" /></Field>
      </div>
      <p className="cl-booking-workflow-note">Tái khám và buổi liệu trình cần được đặt từ hồ sơ bệnh nhân để liên kết đúng lượt khám hoặc buổi điều trị.</p>
    </div>
    <div className="cl-booking-form-side">
      <div className="cl-form-grid cl-booking-form-grid">
      <Field label="Ngày hẹn"><input type="date" min={isoDay()} value={f.date} onChange={(e) => { preferredTime.current = ''; setF({ ...f, date: e.target.value, time: '' }); setErr(''); }} /></Field>
      <div className="cl-field"><span>Thời lượng dự kiến</span><div className="cl-booking-duration">{duration} phút{f.type === 'consult' ? ' · Khám / tư vấn' : ''}</div></div>
      <Field label={f.type === 'consult' ? 'Bác sĩ' : 'Người thực hiện'} span="2">
        <select value={f.staff || ''} onChange={(e) => { setF({ ...f, staff: e.target.value ? Number(e.target.value) : '' }); setErr(''); }}>
          <option value="">{f.type === 'procedure' ? 'Tự chọn theo dịch vụ' : 'Chọn bác sĩ'}</option>
          {eligibleStaff.map((member) => <option key={member.id} value={member.id}>{member.name}</option>)}
        </select>
      </Field>
      <div className="cl-field span2 cl-availability-field">
        <span>Khung giờ còn trống{selectedStaff ? ` · ${selectedStaff.name}` : f.type === 'procedure' ? ' · Chọn người thực hiện cùng khung giờ' : ''}</span>
        {availability.loading ? <Loading text="Đang kiểm tra lịch trống…" /> : availability.error ? <div className="cl-alert error" role="alert">{availability.error}<Btn size="sm" onClick={() => setAvailabilityVersion((version) => version + 1)}>Thử lại</Btn></div> :
          f.type === 'procedure' && !serviceKey ? <small>Chọn dịch vụ để kiểm tra lịch của nhân viên đủ điều kiện.</small> :
            availability.staff.some((row) => row.slots.length) ? <div className="cl-availability-staff">{availability.staff.filter((row) => row.slots.length).map((row) => <div className="cl-availability-row" key={row.staff_id}>
              <strong>{row.staff_name}</strong>
              <div className="cl-slot-grid">{row.slots.map((slot) => <button type="button" key={slot} className={selectedSlot === slot ? 'selected' : ''} onClick={() => {
                setSelectedSlot(slot);
              const slotDate = new Date(slot);
              const slotTime = `${String(slotDate.getHours()).padStart(2, '0')}:${String(slotDate.getMinutes()).padStart(2, '0')}`;
              preferredTime.current = slotTime;
              setF((current) => ({ ...current, staff: row.staff_id, time: slotTime }));
              setErr('');
              }}>{fmtTime(slot)}</button>)}</div>
            </div>)}</div> :
              <div className="cl-booking-no-slots">Không còn khung giờ phù hợp trong ngày này. Hãy đổi ngày, dịch vụ hoặc người thực hiện.</div>}
        {selectedSlot && <small>Đã chọn: {new Date(selectedSlot).toLocaleDateString('vi-VN')} · {fmtTime(selectedSlot)} · {duration} phút</small>}
      </div>
      </div>
    </div>
    </div>
    {f.type === 'procedure' && selectedServices.length > 0 && pricingComplete && <p className="cl-hint">Tạm tính: <b>{new Intl.NumberFormat('vi-VN').format(total)}đ</b></p>}
  </Modal>;
}
