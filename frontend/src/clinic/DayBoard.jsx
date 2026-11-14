import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import FilterListRounded from '@mui/icons-material/FilterListRounded';
import HourglassBottomRounded from '@mui/icons-material/HourglassBottomRounded';
import TrendingUpRounded from '@mui/icons-material/TrendingUpRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import EventRounded from '@mui/icons-material/EventRounded';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import api from '../api/client';
import { Avatar, Empty, Loading, errMsg, money, useInterval, useLoad, useToast } from './ui';
import { useClinicInfo } from './InvoiceDoc';
import './dayboard.css';

const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const DOW = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const BAR = ['#f4606b', '#f59a3d', '#37b86f', '#9a6ee8', '#3aa6d8', '#e0568f', '#6d8bf0', '#2fb5a4'];
const PAY = { unpaid: ['Chưa thanh toán', 'red'], partial: ['Thanh toán một phần', 'amber'], paid: ['Đã thanh toán', 'green'], none: ['Chưa có hóa đơn', 'grey'] };
const CARDS = [['waiting', 'Đang chờ', HourglassBottomRounded, 'blue'], ['progress', 'Đang thực hiện', TrendingUpRounded, 'amber'], ['done', 'Hoàn tất', CheckRounded, 'green'], ['scheduled', 'Chưa đến', EventRounded, 'grey']];

export default function DayBoardPage() {
  const nav = useNavigate(); const [sp, setSp] = useSearchParams(); const [toast, toastNode] = useToast(); const clinic = useClinicInfo();
  const date = sp.get('date') || '';
  const q = useLoad(async () => (await api.get('/clinic/day-board/', { params: { date: date || undefined } })).data, [date]);
  const data = q.data; const cur = data?.date || date; const today = data?.today;
  const [stage, setStage] = useState('all'); const [staff, setStaff] = useState(''); const [showOff, setShowOff] = useState(false); const [fOpen, setFOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  useInterval(() => q.reload(true), 30000);
  useEffect(() => { const k = (e) => e.key === 'Escape' && !fOpen && nav(-1); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [nav, fOpen]);
  const go = (d) => setSp(d === today ? {} : { date: d }, { replace: true });

  const strip = useMemo(() => (cur ? Array.from({ length: 11 }, (_, i) => addDays(cur, i - 5)) : []), [cur]);
  const staffList = useMemo(() => { const m = new Map(); (data?.results || []).forEach((r) => r.staff && m.set(r.staff, r.staff_name)); return [...m]; }, [data]);
  const rows = (data?.results || []).filter((r) => (showOff || !['cancelled', 'no_show'].includes(r.stage)) && (stage === 'all' || r.stage === stage) && (!staff || String(r.staff) === staff));
  const month = cur ? (m => m.charAt(0).toUpperCase() + m.slice(1))(parse(cur).toLocaleDateString('vi-VN', { month: 'long', year: 'numeric' })) : '';
  const filters = (staff ? 1 : 0) + (showOff ? 1 : 0);

  const arrive = async (r) => {
    setBusy(r.id);
    try { await api.post('/clinic/visits/from-booking/', { booking_id: r.id }); toast('Đã đón khách — đang chờ ở sảnh.'); await q.reload(true); }
    catch (e) { toast(errMsg(e), 'error'); } finally { setBusy(null); }
  };

  return <div className="db" role="dialog" aria-label="Lịch hôm nay">
    <header className="db-head"><div className="brand" aria-hidden="true">{((clinic.name || 'A').trim().split(/\s+/).pop() || 'A').charAt(0).toUpperCase()}</div>
      <div className="ttl"><h1>{month}</h1><p>Đang xem {clinic.name}</p></div>
      <div className="act">
        <div className="db-fwrap"><button className={`db-btn ${filters ? 'on' : ''}`} aria-expanded={fOpen} onClick={() => setFOpen((o) => !o)}><FilterListRounded fontSize="small" />Lọc{filters > 0 && <i>{filters}</i>}</button>
          {fOpen && <><button className="db-dismiss" aria-label="Đóng bộ lọc" onClick={() => setFOpen(false)} /><div className="db-pop">
            <label>Nhân viên<select value={staff} onChange={(e) => setStaff(e.target.value)}><option value="">Tất cả nhân viên</option>{staffList.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
            <label className="chk"><input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />Hiện lịch đã hủy / không đến</label>
            <button className="db-link" onClick={() => { setStaff(''); setShowOff(false); setStage('all'); }}>Xóa bộ lọc</button></div></>}</div>
        <button className="db-btn" onClick={() => nav(-1)}>Đóng</button></div></header>

    <div className="db-scroll"><div className="db-wrap">
      <nav className="db-strip" aria-label="Chọn ngày">
        <button className="arr" aria-label="Lùi 7 ngày" onClick={() => go(addDays(cur, -7))}><ChevronLeftRounded /></button>
        <div className="days">{strip.map((d) => { const dt = parse(d); return <button key={d} className={`${d === cur ? 'sel' : ''} ${d === today ? 'today' : ''}`} aria-current={d === cur ? 'date' : undefined} onClick={() => go(d)}><small>{DOW[dt.getDay()]}</small><b>{dt.getDate()}</b></button>; })}</div>
        <button className="arr" aria-label="Tới 7 ngày" onClick={() => go(addDays(cur, 7))}><ChevronRightRounded /></button>
        <button className="todaybtn" disabled={cur === today} onClick={() => go(today)}>Hôm nay</button></nav>

      <div className="db-cols">
        <section className="db-list" aria-live="polite">
          {!data ? (q.error ? <div className="db-err">{q.error}</div> : <Loading />) : !rows.length ? <Empty title="Không có lịch hẹn" hint={stage !== 'all' || staff ? 'Thử bỏ bộ lọc để xem toàn bộ ngày.' : 'Ngày này chưa có lịch hẹn nào.'} /> :
            rows.map((r) => { const [pl, pt] = PAY[r.pay]; const off = ['cancelled', 'no_show'].includes(r.stage);
              return <article key={r.id} className={`db-row ${off ? 'off' : ''}`} style={{ '--bar': r.staff ? BAR[r.staff % BAR.length] : '#c4ccd8' }}>
                <div className="tm"><b>{r.time}</b><small>{r.duration}′</small></div>
                <Avatar name={r.client_name} size={46} />
                <div className="who">{r.patient ? <Link to={`/benh-nhan/${r.patient}`}>{r.client_name}</Link> : <strong>{r.client_name}</strong>}
                  <span className="svc">{r.services.join(', ') || 'Chưa chọn dịch vụ'}</span>
                  <span className={`st ${r.stage}`}>{r.stage_label}{r.running_late && r.stage === 'scheduled' ? ' · đến trễ' : ''}</span></div>
                <div className="stf"><PersonOutlineRounded fontSize="small" /><span>{r.staff_name || 'Chưa phân công'}</span></div>
                <div className="end">{r.pay !== 'none' || r.stage === 'done' ? <span className={`pay ${pt}`} title={r.total ? `${money(r.paid)} / ${money(r.total)}` : ''}>{pl}</span> : <span className="pay grey">{pl}</span>}
                  {r.stage === 'scheduled' && cur === today && <button className="db-btn pri sm" disabled={busy === r.id} onClick={() => arrive(r)}>{busy === r.id ? '…' : 'Đón khách'}</button>}
                  {r.invoice && <Link className="db-link" to={`/hoa-don/${r.invoice}`}>Hóa đơn</Link>}</div></article>; })}
        </section>
        <aside className="db-cards">{CARDS.map(([k, t, Ic, tone]) => <button key={k} className={`db-card ${stage === k ? 'on' : ''}`} aria-pressed={stage === k} onClick={() => setStage(stage === k ? 'all' : k)}>
          <span className={`ic ${tone}`}><Ic /></span><span className="tx"><small>{t}</small><b>{data ? data.counts[k] : '–'}</b></span></button>)}
          {data && <p className="db-total">Tổng {rows.length}/{data.results.length} lịch hẹn</p>}</aside>
      </div></div></div>{toastNode}
  </div>;
}
