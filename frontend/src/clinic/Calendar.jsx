import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { Avatar, Btn, Field, Loading, Modal, PageHead, Pill, WEEKDAY, addDays, errMsg, fmtTime, isoDay, useLoad, useToast } from './ui';
import { PatientPicker } from './PatientForm';
import SmartFilterBar from './SmartFilterBar';

const START_H = 7, END_H = 19, PPM = 1.5;           // px mỗi phút
const TYPES = { consult: 'Khám / tư vấn', follow_up: 'Tái khám', procedure: 'Thủ thuật', session: 'Buổi liệu trình' };
const LIST_STATUS_OPTIONS = [
  { value: 'all', label: 'Tất cả' },
  { value: 'pending', label: 'Chờ xác nhận' },
  { value: 'confirmed', label: 'Đã xác nhận' },
  { value: 'arrived', label: 'Đã đến' },
  { value: 'completed', label: 'Hoàn thành' },
  { value: 'cancelled', label: 'Đã hủy' },
  { value: 'no_show', label: 'Không đến' },
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
  const [searchParams] = useSearchParams();
  const canBook = ['consultant', 'manager', 'doctor'].includes(user.role);
  const canRestore = user.role === 'manager';
  const [date, setDate] = useState(isoDay());
  const [viewMode, setViewMode] = useState(() => searchParams.get('view') === 'list' || searchParams.has('status') ? 'list' : 'calendar');
  const [listStatus, setListStatus] = useState(() => LIST_STATUS_OPTIONS.some((option) => option.value === searchParams.get('status')) ? searchParams.get('status') : 'all');
  const [listDate, setListDate] = useState('');
  const [listDoctor, setListDoctor] = useState('');
  const [listQuery, setListQuery] = useState('');
  const [listPage, setListPage] = useState(1);
  const [debouncedListQuery, setDebouncedListQuery] = useState('');
  const [listActionError, setListActionError] = useState('');
  const [toast, toastNode] = useToast();
  const [sel, setSel] = useState(null);
  const [creating, setCreating] = useState(null);
  const [q, setQ] = useState('');
  const [doctorFilter, setDoctorFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [now, setNow] = useState(new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 60000); return () => clearInterval(t); }, []);
  const weekStart = mondayOf(date);
  const staff = useLoad(async () => (await api.get('/staff/')).data, []);
  const week = useLoad(async () => {
    const { data } = await api.get('/bookings/', { params: { from: weekStart, to: addDays(weekStart, 6) } });
    return (data.results || data).filter((b) => b.status !== 'cancelled');
  }, [weekStart]);
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
  const all = week.data || [];
  const displayDoctors = doctorFilter ? doctors.filter((d) => String(d.id) === doctorFilter) : doctors;
  const dayBookings = all.filter((b) => {
    if (dayOf(b.appointment) !== date) return false;
    if (typeFilter && b.appointment_type !== typeFilter) return false;
    if (statusFilter && b.status !== statusFilter) return false;
    if (q.trim()) {
      const haystack = [b.customer_name, b.customer_phone, b.staff_name, ...(b.items || []).map((i) => i.service_name || i.service?.name)].filter(Boolean).join(' ').toLowerCase();
      if (!haystack.includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });
  const counts = useMemo(() => { const m = {}; all.forEach((b) => { const k = dayOf(b.appointment); m[k] = (m[k] || 0) + 1; }); return m; }, [all]);
  const hours = Array.from({ length: END_H - START_H }, (_, i) => START_H + i);
  const todayIso = isoDay();
  const scrollRef = useRef(null);
  const nowTop = (now.getHours() * 60 + now.getMinutes() - START_H * 60) * PPM;
  useEffect(() => { const el = scrollRef.current; if (el) el.scrollTop = date === todayIso ? Math.max(0, nowTop - 150) : 0; }, [date, week.loading, staff.loading]); // eslint-disable-line react-hooks/exhaustive-deps
  const reload = () => { week.reload(true); list.reload(true); };
  const closeBooking = useCallback(() => setSel(null), []);
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
    let body = {};
    if (action === 'restore') {
      const reason = window.prompt('Lý do khôi phục lịch đã hủy (ít nhất 5 ký tự):');
      if (reason === null) return;
      if (reason.trim().length < 5) { setListActionError('Cần nhập lý do khôi phục ít nhất 5 ký tự.'); return; }
      body = { reason: reason.trim() };
    }
    setListActionError('');
    try {
      await api.post(`/bookings/${booking.id}/${action}/`, body);
      toast(successMessage);
      reload();
    } catch (error) {
      setListActionError(errMsg(error));
    }
  };
  const listBookings = list.data?.results || [];
  const listPageCount = Math.max(1, Math.ceil((list.data?.count || 0) / 20));

  const clickCol = (e, doc) => {
    if (!canBook) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const min = Math.round(((e.clientY - rect.top) / PPM) / 15) * 15 + START_H * 60;
    setCreating({ staff: doc.id, date, time: `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}` });
  };

  return <>
    <PageHead title={user.role === 'doctor' ? 'Lịch hẹn của tôi' : 'Lịch hẹn bác sĩ'} subtitle="Bấm vào ô trống để đặt lịch, bấm vào lịch hẹn để xem chi tiết hoặc đón khách."
      actions={canBook && <Btn kind="primary" icon={<AddRounded />} onClick={() => setCreating({ staff: doctors[0]?.id || '', date, time: '09:00' })}>Đặt lịch hẹn</Btn>} />
    <div className="cl-view-tabs" role="tablist" aria-label="Chế độ xem lịch hẹn">
      <button type="button" role="tab" aria-selected={viewMode === 'list'} className={viewMode === 'list' ? 'on' : ''} onClick={() => setViewMode('list')}>Danh sách</button>
      <button type="button" role="tab" aria-selected={viewMode === 'calendar'} className={viewMode === 'calendar' ? 'on' : ''} onClick={() => setViewMode('calendar')}>Calendar</button>
    </div>
    {viewMode === 'calendar' && <>
      <SmartFilterBar id="calendar" search={q} onSearch={setQ} placeholder="Tìm bệnh nhân, số điện thoại, bác sĩ hoặc dịch vụ…" filters={calendarFilters} onApplyFavorite={applyFavorite}/>
      {staff.error && <div className="cl-alert error" role="alert">{staff.error}<Btn onClick={() => staff.reload()}>Tải lại danh sách bác sĩ</Btn></div>}
      <div className="cl-cal-controls">
      <div className="cl-seg">
        <button onClick={() => setDate(addDays(date, -1))} aria-label="Ngày trước"><ChevronLeftRounded /></button>
        <button onClick={() => setDate(todayIso)} className={date === todayIso ? 'on' : ''}>Hôm nay</button>
        <button onClick={() => setDate(addDays(date, 1))} aria-label="Ngày sau"><ChevronRightRounded /></button>
      </div>
      <input type="date" className="cl-date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} />
      <strong className="cl-cal-title">{new Date(date + 'T00:00:00').toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</strong>
      <div className="cl-legend">{Object.entries(TYPES).map(([k, v]) => <span key={k}><i className={`t-${k}`} />{v}</span>)}</div>
      </div>
      {(staff.loading || week.loading) && !week.data ? <Loading /> : week.error ? <div className="cl-alert error" role="alert">{week.error}<Btn onClick={() => week.reload()}>Thử lại</Btn></div> :
      <div className="cl-cal">
        <aside className="cl-cal-rail">
          {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map((d) => {
            const dt = new Date(d + 'T00:00:00');
            return <button key={d} className={`${d === date ? 'on' : ''} ${d === todayIso ? 'today' : ''}`} onClick={() => setDate(d)}>
              <b>{dt.getDate()}</b><span>{WEEKDAY[dt.getDay()]}</span>{counts[d] ? <em>{counts[d]}</em> : null}</button>;
          })}
        </aside>
        <div className="cl-cal-scroll" ref={scrollRef}>
          <div className="cl-cal-grid" style={{ gridTemplateColumns: `64px repeat(${Math.max(1, displayDoctors.length)}, minmax(190px, 1fr))` }}>
            <div className="cl-cal-corner" />
            {displayDoctors.map((d) => <div className="cl-cal-doc" key={d.id}><Avatar name={d.name} size={30} /><span><strong>{d.name}</strong><small>{d.position}</small></span></div>)}
            {!displayDoctors.length && <div className="cl-cal-doc"><small>Không có bác sĩ phù hợp bộ lọc.</small></div>}
            <div className="cl-cal-times" style={{ height: (END_H - START_H) * 60 * PPM }}>
              {hours.map((h) => <span key={h} style={{ top: (h - START_H) * 60 * PPM }}>{String(h).padStart(2, '0')}:00</span>)}</div>
            {displayDoctors.map((doc) => {
              const items = layout(dayBookings.filter((b) => b.staff === doc.id));
              return <div className="cl-cal-col" key={doc.id} style={{ height: (END_H - START_H) * 60 * PPM }} onClick={(e) => e.target === e.currentTarget && clickCol(e, doc)}>
                {hours.map((h) => <i key={h} className="cl-hline" style={{ top: (h - START_H) * 60 * PPM }} />)}
                {items.map((b) => {
                  const top = (minutesOf(b.appointment) - START_H * 60) * PPM;
                  const h = Math.max(40, (b.duration_minutes || 30) * PPM - 3);
                  return <button key={b.id} className={`cl-block t-${b.appointment_type} ${b.status}`}
                    style={{ top, height: h, left: `${(b._lane / b._lanes) * 100}%`, width: `calc(${100 / b._lanes}% - 4px)` }}
                    onClick={() => setSel(b)}>
                    <strong>{fmtTime(b.appointment)} – {fmtTime(b.end_time)}</strong>
                    <span className="n">{b.customer_name}</span>
                    <span className="s">{b.items?.map((i) => i.service_name || i.service?.name).filter(Boolean).join(', ') || b.appointment_type_label}</span>
                    {b.visit_status && <Pill tone={b.visit_status === 'completed' ? 'green' : b.visit_status === 'in_consult' ? 'blue' : 'amber'} dot>{{ waiting: 'Đã đến', in_consult: 'Đang khám', completed: 'Xong', cancelled: 'Hủy' }[b.visit_status]}</Pill>}
                  </button>;
                })}
                {date === todayIso && nowTop > 0 && nowTop < (END_H - START_H) * 60 * PPM && <i className="cl-nowline" style={{ top: nowTop }} />}
              </div>;
            })}
          </div>
        </div>
      </div>}
    </>}
    {viewMode === 'list' && <section className="cl-booking-list">
      {staff.error && <div className="cl-alert error" role="alert">{staff.error}<Btn onClick={() => staff.reload()}>Tải lại danh sách bác sĩ</Btn></div>}
      <div className="cl-booking-list-filters">
        <label className="cl-booking-search"><span>Tìm lịch hẹn</span><input value={listQuery} onChange={(event) => { setListQuery(event.target.value); setListPage(1); }} placeholder="Tên, số điện thoại, bác sĩ, dịch vụ hoặc mã lịch" /></label>
        <label><span>Ngày hẹn</span><input type="date" value={listDate} onChange={(event) => { setListDate(event.target.value); setListPage(1); }} /></label>
        <label><span>Bác sĩ</span><select value={listDoctor} onChange={(event) => { setListDoctor(event.target.value); setListPage(1); }}><option value="">Tất cả bác sĩ</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.name}</option>)}</select></label>
      </div>
      <div className="cl-booking-status-tabs" role="tablist" aria-label="Lọc trạng thái lịch hẹn">
        {LIST_STATUS_OPTIONS.map((option) => <button key={option.value} type="button" role="tab" aria-selected={listStatus === option.value}
          className={listStatus === option.value ? 'on' : ''} onClick={() => { setListStatus(option.value); setListPage(1); }}>{option.label}</button>)}
      </div>
      {listActionError && <div className="cl-alert error" role="alert">{listActionError}<button type="button" aria-label="Đóng thông báo" onClick={() => setListActionError('')}>×</button></div>}
      {list.loading ? <Loading text="Đang tải danh sách lịch hẹn…" /> : list.error ? <div className="cl-alert error" role="alert">{list.error}<Btn onClick={() => list.reload()}>Thử lại</Btn></div> :
        listBookings.length ? <>
          <div className="cl-booking-list-summary">Tổng cộng {list.data.count} lịch hẹn</div>
          <div className="cl-booking-list-rows">{listBookings.map((booking) => {
            const session = booking.treatment_session_details;
            const services = (booking.items || []).map((item) => item.service_name || item.service?.name).filter(Boolean).join(', ');
            const canManageBooking = canBook && ['pending', 'confirmed'].includes(booking.status) && !booking.visit_id;
            return <article className="cl-booking-list-row" key={booking.id}>
              <button type="button" className="cl-booking-row-main" onClick={() => setSel(booking)} aria-label={`Xem lịch hẹn ${booking.id} của ${booking.customer_name}`}>
                <span className="cl-booking-row-time"><strong>{fmtTime(booking.appointment)}</strong><small>{new Date(booking.appointment).toLocaleDateString('vi-VN')}</small></span>
                <span className="cl-booking-row-customer"><strong>{booking.customer_name || 'Khách hàng'}</strong><small>{booking.customer_phone || 'Chưa có số điện thoại'} · Mã lịch #{booking.id}</small></span>
                <span className="cl-booking-row-type"><strong>{booking.appointment_type_label || TYPES[booking.appointment_type] || 'Lịch hẹn'}</strong>
                  {booking.appointment_type === 'session' && session ? <small>{session.plan_title} · Buổi {session.session_number}/{session.total_sessions} · Buổi: {session.session_status_label} · Liệu trình: {session.plan_status_label}</small> : <small>{services || 'Chưa có dịch vụ'}</small>}
                </span>
                <span className="cl-booking-row-doctor"><strong>{booking.staff_name || 'Chưa phân công'}</strong><small>{booking.visit_status === 'waiting' ? 'Đã đến phòng khám' : booking.visit_status === 'in_consult' ? 'Đang khám' : ''}</small></span>
                <Pill tone={statusTone(booking.status)}>{booking.status_label}</Pill>
              </button>
              <div className="cl-booking-list-actions">
                {canManageBooking && booking.status === 'pending' && <Btn size="sm" kind="primary" onClick={() => runListAction(booking, 'confirm', 'Đã xác nhận lịch hẹn.')}>Xác nhận</Btn>}
                {canManageBooking && <Btn size="sm" onClick={() => setSel(booking)}>Đổi lịch / Chi tiết</Btn>}
                {canManageBooking && <Btn size="sm" onClick={() => runListAction(booking, 'cancel', 'Đã hủy lịch hẹn.')}>Hủy</Btn>}
                {canRestore && booking.status === 'cancelled' && <Btn size="sm" onClick={() => runListAction(booking, 'restore', 'Đã gửi lịch về chờ xác nhận.')}>Khôi phục</Btn>}
              </div>
            </article>;
          })}</div>
          {listPageCount > 1 && <nav className="cl-booking-pagination" aria-label="Phân trang lịch hẹn">
            <span>Trang {listPage}/{listPageCount}</span>
            <Btn size="sm" disabled={listPage <= 1} onClick={() => setListPage((page) => page - 1)}>Trước</Btn>
            <Btn size="sm" disabled={listPage >= listPageCount} onClick={() => setListPage((page) => page + 1)}>Tiếp</Btn>
          </nav>}
        </> : <div className="cl-booking-list-empty"><strong>Không tìm thấy lịch hẹn</strong><span>Thử đổi trạng thái, ngày hẹn hoặc từ khóa tìm kiếm.</span></div>}
    </section>}
    <BookingDetail booking={sel} canBook={canBook} canRestore={canRestore} onClose={closeBooking} onChanged={(msg) => { setSel(null); toast(msg); reload(); }} doctors={doctors} staffMembers={staff.data?.results || staff.data || []} />
    <BookingForm init={creating} doctors={doctors} onClose={() => setCreating(null)} onSaved={() => { setCreating(null); toast('Đã đặt lịch hẹn.'); reload(); }} />
    {toastNode}
  </>;
}

function BookingDetail({ booking: b, canBook, canRestore, onClose, onChanged, doctors, staffMembers }) {
  const [err, setErr] = useState('');
  const [resched, setResched] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setErr('');
    setResched(null);
    if (!b) return undefined;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const closeOnEscape = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
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
  const sessionPerformers = (staffMembers || []).filter((person) =>
    person.is_active &&
    person.user_id &&
    ['doctor', 'staff'].includes(person.account_role) &&
    (person.service_ids_current || []).some((id) => Number(id) === sessionServiceId) &&
    (sessionPolicy?.allow_staff_delegation || person.user_id === sessionPolicy?.doctor_user_id),
  );
  const assignmentOptions = b.appointment_type === 'session' ? sessionPerformers : doctors;
  const sessionDetails = b.treatment_session_details;
  const serviceNames = b.items?.map((item) => item.service_name || item.service?.name).filter(Boolean).join(', ');
  const closeWithBackdrop = (event) => { if (event.target === event.currentTarget) onClose(); };
  return <div className="cl-drawer-backdrop" onMouseDown={closeWithBackdrop}>
    <aside className="cl-booking-drawer" role="dialog" aria-modal="true" aria-label={`Chi tiết lịch hẹn ${b.id}`}>
      <header className="cl-booking-drawer-header">
        <div><span className="cl-drawer-kicker">Mã lịch #{b.id}</span><h2>{b.customer_name}</h2><p>{b.appointment_type_label} · {new Date(b.appointment).toLocaleDateString('vi-VN')} · {fmtTime(b.appointment)} – {fmtTime(b.end_time)}</p></div>
        <button className="cl-icon-btn" onClick={onClose} aria-label="Đóng"><CloseRounded /></button>
      </header>
      <div className="cl-booking-drawer-body">
        {err && <div className="cl-alert error" role="alert">{err}</div>}
        <dl className="cl-dl">
          <div><dt>Điện thoại</dt><dd>{b.customer_phone || '—'}</dd></div>
          <div><dt>Bác sĩ / người thực hiện</dt><dd>{b.staff_name || 'Chưa phân công'}</dd></div>
          <div><dt>Loại lịch</dt><dd>{b.appointment_type_label || TYPES[b.appointment_type]}</dd></div>
          <div><dt>Trạng thái</dt><dd><Pill tone={statusTone(b.status)}>{b.status_label}</Pill></dd></div>
          {b.appointment_type === 'session' && sessionDetails && <div className="span2"><dt>Liệu trình</dt><dd>{sessionDetails.plan_title} · Buổi {sessionDetails.session_number}/{sessionDetails.total_sessions}</dd><small>Buổi: {sessionDetails.session_status_label} · Liệu trình: {sessionDetails.plan_status_label}</small></div>}
          <div className="span2"><dt>Dịch vụ</dt><dd>{serviceNames || (b.appointment_type === 'session' ? sessionDetails?.plan_title : null) || '—'}</dd></div>
          {b.note && <div className="span2"><dt>Ghi chú</dt><dd>{b.note}</dd></div>}
        </dl>
        {b.history?.length > 0 && <section className="cl-booking-history"><h3>Lịch sử cập nhật</h3><ol>{b.history.map((item, index) => <li key={`${item.event}-${item.created_at}-${index}`}><strong>{item.event === 'rescheduled' ? 'Đổi lịch' : item.event === 'confirmed' ? 'Xác nhận' : item.event === 'checked_in' ? 'Check-in' : item.event === 'in_progress' ? 'Bắt đầu phục vụ' : item.event === 'cancelled' ? 'Hủy lịch' : item.event === 'no_show' ? 'Không đến' : item.event === 'completed' ? 'Hoàn thành lịch' : 'Tạo lịch'}</strong><span>{item.actor_name || 'Khách hàng'} · {new Date(item.created_at).toLocaleString('vi-VN')}</span>{item.old_appointment && item.new_appointment && item.old_appointment !== item.new_appointment && <small>{new Date(item.old_appointment).toLocaleString('vi-VN')} → {new Date(item.new_appointment).toLocaleString('vi-VN')}</small>}{item.reason && <small>{item.reason}</small>}</li>)}</ol></section>}
        {b.patient ? <Link className="cl-link" to={`/benh-nhan/${b.patient}`}>Mở hồ sơ {b.patient_code}</Link> : <small className="cl-muted">Chưa liên kết hồ sơ bệnh nhân — sẽ tự tạo khi đón.</small>}
        {resched && <div className="cl-form-grid cl-drawer-reschedule">
          <Field label="Ngày"><input type="date" value={resched.date} onChange={(e) => setResched({ ...resched, date: e.target.value })} /></Field>
          <Field label="Giờ"><input type="time" step={900} value={resched.time} onChange={(e) => setResched({ ...resched, time: e.target.value })} /></Field>
          <Field label={b.appointment_type === 'session' ? 'Người thực hiện' : 'Bác sĩ'} span="2"><select value={resched.staff || ''} disabled={!assignmentOptions.length} onChange={(e) => setResched({ ...resched, staff: Number(e.target.value) })}><option value="">— Chọn người đủ điều kiện —</option>{assignmentOptions.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select>{b.appointment_type === 'session' && <small className="cl-muted">{sessionPolicy?.allow_staff_delegation ? 'Bác sĩ phụ trách đã cho phép điều phối bác sĩ/nhân sự có dịch vụ phù hợp.' : 'Chỉ bác sĩ phụ trách liệu trình được thực hiện buổi này.'}</small>}</Field>
          <Btn kind="primary" disabled={!resched.staff || !assignmentOptions.length || busy} onClick={() => run(() => api.post(`/bookings/${b.id}/reschedule/`, { appointment: new Date(`${resched.date}T${resched.time}`).toISOString(), staff: resched.staff }), 'Đã đổi lịch hẹn.')}>Lưu giờ mới</Btn>
        </div>}
      </div>
      {(canAct || (canRestore && b.status === 'cancelled')) && <footer className="cl-booking-drawer-footer">
      {canRestore && b.status === 'cancelled' && <Btn disabled={busy} kind="primary" onClick={() => { const reason = window.prompt('Lý do khôi phục lịch đã hủy (ít nhất 5 ký tự):'); if (reason === null) return; if (reason.trim().length < 5) { setErr('Cần nhập lý do khôi phục ít nhất 5 ký tự.'); return; } run(() => api.post(`/bookings/${b.id}/restore/`, { reason: reason.trim() }), 'Lịch đã chuyển về chờ xác nhận.'); }}>Khôi phục lịch</Btn>}
      {canAct && <>
      <Btn disabled={busy} onClick={() => {
        if (window.confirm(`Bạn có chắc muốn hủy lịch hẹn của ${b.customer_name}?`)) {
          run(() => api.post(`/bookings/${b.id}/cancel/`), 'Đã hủy lịch hẹn.');
        }
      }}>Hủy lịch</Btn>
      <Btn disabled={busy} onClick={() => setResched({ date: isoDay(new Date(b.appointment)), time: fmtTime(b.appointment), staff: assignmentOptions.some((person) => person.id === b.staff) ? b.staff : assignmentOptions[0]?.id || '' })}>Đổi giờ</Btn>
      {b.status === 'pending' && <Btn disabled={busy} kind="primary" onClick={() => run(() => api.post(`/bookings/${b.id}/confirm/`), 'Đã xác nhận lịch hẹn.')}>Xác nhận</Btn>}
      {new Date(b.appointment) <= new Date() && <Btn disabled={busy} onClick={() => run(() => api.post(`/bookings/${b.id}/no_show/`), 'Đã ghi nhận khách không đến.')}>Không đến</Btn>}
      <Btn disabled={busy} kind="primary" onClick={() => run(() => api.post('/clinic/visits/from-booking/', { booking_id: b.id }), 'Đã đón bệnh nhân — đang chờ ở sảnh.')}>Bệnh nhân đã đến</Btn></>}
      </footer>}
    </aside>
  </div>;
}

function BookingForm({ init, doctors, onClose, onSaved }) {
  const services = useLoad(async () => (await api.get('/services/')).data, []);
  const [f, setF] = useState(null);
  const [patient, setPatient] = useState(null);
  const [plans, setPlans] = useState([]);
  const [sessionId, setSessionId] = useState('');
  const [plansError, setPlansError] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (init) { setF({ type: 'consult', service_ids: [], note: '', ...init }); setPatient(null); setErr(''); } }, [init]);
  useEffect(() => {
    setSessionId(''); setPlans([]); setPlansError('');
    if (!init || !patient?.id || f?.type !== 'session') return;
    let active = true;
    api.get('/clinic/plans/', { params: { patient: patient.id, status: 'active' } })
      .then(({ data }) => { if (active) setPlans(data.results || data || []); })
      .catch((e) => { if (active) setPlansError(errMsg(e)); });
    return () => { active = false; };
  }, [init, patient?.id, f?.type]);
  if (!init || !f) return null;
  const list = (services.data?.results || services.data || []).filter((s) => s.is_active);
  const toggle = (id) => setF((s) => ({ ...s, service_ids: s.service_ids.includes(id) ? s.service_ids.filter((x) => x !== id) : [...s.service_ids, id] }));
  const availableSessions = plans.flatMap((p) => (p.sessions || []).filter((s) => s.status === 'pending' && !s.has_active_booking && p.service).map((s) => ({ ...s, plan: p })));
  const chosenSession = availableSessions.find((s) => String(s.id) === String(sessionId));
  const total = list.filter((s) => f.service_ids.includes(s.id)).reduce((a, s) => a + s.price, 0);
  const mins = list.filter((s) => f.service_ids.includes(s.id)).reduce((a, s) => a + s.duration, 0);
  const submit = async () => {
    setErr('');
    if (f.type === 'session' && !chosenSession) { setErr('Vui lòng chọn buổi liệu trình hợp lệ trước khi đặt.'); return; }
    if (!patient) { setErr('Vui lòng chọn bệnh nhân.'); return; }
    setBusy(true);
    try {
      await api.post('/bookings/', { patient: patient.id, ...(f.type === 'session' ? { treatment_session_id: chosenSession.id } : { staff: f.staff, service_ids: f.service_ids }), appointment: new Date(`${f.date}T${f.time}`).toISOString(),
        appointment_type: f.type, note: f.note });
      onSaved();
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  return <Modal open wide title="Đặt lịch hẹn" subtitle="Chọn bệnh nhân, bác sĩ, thời gian và dịch vụ." onClose={onClose}
    footer={<><Btn onClick={onClose}>Đóng</Btn><Btn kind="primary" disabled={!patient || (f.type === 'session' ? !chosenSession : !f.staff || (f.type === 'procedure' && !f.service_ids.length)) || busy} onClick={submit}>{busy ? 'Đang lưu…' : 'Đặt lịch'}</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <PatientPicker value={patient} onPick={setPatient} />
    <div className="cl-form-grid" style={{ marginTop: 16 }}>
      {f.type !== 'session' && <Field label="Bác sĩ"><select value={f.staff || ''} onChange={(e) => setF({ ...f, staff: Number(e.target.value) })}><option value="">— Chọn bác sĩ —</option>{doctors.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}</select></Field>}
      <Field label="Loại lịch hẹn"><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Ngày"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
      <Field label="Giờ"><input type="time" step={900} value={f.time} onChange={(e) => setF({ ...f, time: e.target.value })} /></Field>
      {f.type === 'session' && <Field label="Buổi liệu trình đã được chỉ định" span="2"><select value={sessionId} onChange={(e) => setSessionId(e.target.value)}><option value="">— Chọn buổi chưa đặt —</option>{availableSessions.map((session) => <option key={session.id} value={session.id}>{session.plan.title} · Buổi {session.number}/{session.plan.total_sessions} · {session.plan.service_name || 'Dịch vụ theo phác đồ'}</option>)}</select>{plansError && <small role="alert">{plansError}</small>}{!plansError && patient && !availableSessions.length && <small>Không có buổi liệu trình đang hiệu lực và chưa được đặt lịch.</small>}</Field>}
      {f.type !== 'session' && <Field label={`Dịch vụ${mins ? ` · ${mins} phút` : ''}`} span="2">
        <div className="cl-check-grid">{list.map((s) => <label key={s.id} className={f.service_ids.includes(s.id) ? 'on' : ''}>
          <input type="checkbox" checked={f.service_ids.includes(s.id)} onChange={() => toggle(s.id)} /><span><strong>{s.name}</strong><small>{s.duration} phút · {new Intl.NumberFormat('vi-VN').format(s.price)}đ</small></span></label>)}</div></Field>}
      <Field label="Ghi chú" span="2"><input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ghi chú cho bác sĩ / lễ tân" /></Field>
    </div>
    {f.type !== 'session' && total > 0 && <p className="cl-hint">Tạm tính: <b>{new Intl.NumberFormat('vi-VN').format(total)}đ</b></p>}
  </Modal>;
}
