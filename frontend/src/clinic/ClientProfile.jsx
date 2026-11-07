import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AddRounded from '@mui/icons-material/AddRounded';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import EditOutlined from '@mui/icons-material/EditOutlined';
import EventNoteOutlined from '@mui/icons-material/EventNoteOutlined';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import GridViewRounded from '@mui/icons-material/GridViewRounded';
import HealthAndSafetyOutlined from '@mui/icons-material/HealthAndSafetyOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import LoyaltyOutlined from '@mui/icons-material/LoyaltyOutlined';
import PlayArrowRounded from '@mui/icons-material/PlayArrowRounded';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import TaskAltOutlined from '@mui/icons-material/TaskAltOutlined';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { invTone } from './Billing';
import { ConsentsTab } from './Consents';
import { HistoryTab, ImagesTab, PlansTab, VisitsTab } from './Patients';
import { PatientFormModal } from './PatientForm';
import { PrescriptionsTab } from './Prescription';
import { NotesModal, PackagesTab } from './Packages';
import PatientActivities from './PatientActivities';
import { Avatar, Btn, Empty, Loading, Pill, errMsg, fmtDate, fmtDateTime, fmtTime, genderText, money, useLoad, useToast, visitTone } from './ui';

const arr = (d) => d?.results || d || [];
const MON = ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12'];
const apTone = { pending: 'amber', confirmed: 'blue', completed: 'green', cancelled: 'gray' };
const TIERS = [['Bronze', 0], ['Silver', 500000], ['Gold', 2000000], ['Platinum', 5000000]];
const TIER_BG = { Bronze: 'linear-gradient(135deg,#c58a5a,#9a6238)', Silver: 'linear-gradient(135deg,#aab4c0,#7f8b99)', Gold: 'linear-gradient(135deg,#e6b83c,#caa02a)', Platinum: 'linear-gradient(135deg,#5b7fb3,#35527f)' };

function Sub({ items, value, onChange }) {
  return <nav className="pb-sub">{items.map(([k, t, n]) => <button key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{t}{n != null && <i>{n}</i>}</button>)}</nav>;
}
const Box = ({ title, right, children, className = '' }) => <section className={`pb-card pb-cbox ${className}`}><header><h3>{title}</h3>{right}</header><div>{children}</div></section>;
const Plain = ({ k, v }) => <div className="pb-det"><dt>{k}</dt><dd>{v || <span className="dim">—</span>}</dd></div>;

/* ------------------------------------------------------------------ tổng quan */
function Summary({ patient, s, bookings, goto, canFinance, clinical }) {
  const [sub, setSub] = useState('fact');
  const allergies = (patient.allergies || '').split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean);
  const alerts = [];
  if (canFinance && s?.finance?.outstanding > 0) alerts.push({ t: `Còn nợ ${money(s.finance.outstanding)}`, d: 'Có hóa đơn chưa thanh toán đủ.', to: 'fin' });
  if (patient.pregnancy_status && !/^(không|khong|no)\b/i.test(patient.pregnancy_status)) alerts.push({ t: 'Thai kỳ / cho con bú', d: patient.pregnancy_status });
  const up = (bookings || []).filter((b) => b.upcoming).sort((a, b) => a.appointment.localeCompare(b.appointment));
  return <>
    <Sub value={sub} onChange={setSub} items={[['fact', 'Tóm tắt'], ['timeline', 'Dòng thời gian'], ...(clinical ? [['snap', 'Hình ảnh']] : [])]} />
    {sub === 'fact' && <>
      <Box title="Cảnh báo, dị ứng & ghi chú" className="pb-alerts"><div className="pb-3col">
        <div><h4>CẢNH BÁO <b>{alerts.length}</b></h4>{alerts.length ? alerts.map((a, i) => <div key={i} className="pb-alert warn"><WarningAmberRounded /><span><b>{a.t}</b><small>{a.d}</small></span></div>)
          : <div className="pb-ok"><HealthAndSafetyOutlined /><b>Không có cảnh báo</b><small>Chưa có điều gì cần lưu ý cho khách này.</small></div>}</div>
        <div><h4>DỊ ỨNG <b>{allergies.length}</b></h4>{allergies.length ? allergies.map((a) => <div key={a} className="pb-alert red"><span><b>{a}</b></span></div>) : <div className="pb-alert green"><span><b>Chưa ghi nhận dị ứng</b></span></div>}</div>
        <div><h4>GHI CHÚ <b>{patient.clinical_notes ? 1 : 0}</b></h4>{patient.clinical_notes ? <div className="pb-note-card"><p>{patient.clinical_notes}</p></div> : <p className="pb-empty">{clinical ? 'Chưa có ghi chú chuyên môn.' : 'Ghi chú chuyên môn chỉ bác sĩ và quản lý xem được.'}</p>}</div>
      </div></Box>
      <Box title="Lịch hẹn" right={<span className="pb-meta">{s?.last_visit ? `Khám gần nhất ${fmtDate(s.last_visit)}` : 'Chưa từng khám'} · {up.length} sắp tới</span>}>
        {up.length ? <div className="pb-aplist">{up.slice(0, 5).map((b, i) => <ApRow key={b.id} b={b} next={i === 0} />)}</div> : <p className="pb-empty">Không có lịch hẹn sắp tới.</p>}
        {up.length > 5 && <button className="pb-link" onClick={() => goto('appts')}>Xem tất cả {up.length} lịch hẹn</button>}</Box></>}
    {sub === 'timeline' && <VisitsTab patientId={patient.id} patient={patient} clinical={clinical} regions={[]} />}
  </>;
}

function ApRow({ b, next }) {
  const d = new Date(b.appointment);
  return <div className={`pb-ap ${next ? 'next' : ''} ${b.status}`}><div className="pb-ap-date"><b>{d.getDate()}</b><span>{MON[d.getMonth()]}</span></div>
    <div className="pb-ap-main"><strong>{b.services.length ? b.services.join(', ') : b.type}{next && <em>Kế tiếp</em>}</strong>
      <small>{fmtTime(b.appointment)}{b.duration ? ` · ${b.duration} phút` : ''}{b.staff_name ? ` · ${b.staff_name}` : ''} · Mã {b.code}</small></div>
    <Pill tone={apTone[b.status]} dot>{b.status_label}</Pill></div>;
}

/* ------------------------------------------------------------------ lịch hẹn */
function Appointments({ list }) {
  const [f, setF] = useState('all');
  const rows = list || [];
  const cnt = { all: rows.length, up: rows.filter((b) => b.upcoming).length, past: rows.filter((b) => !b.upcoming && b.status !== 'cancelled').length, cancelled: rows.filter((b) => b.status === 'cancelled').length };
  const shown = rows.filter((b) => (f === 'all' ? true : f === 'up' ? b.upcoming : f === 'past' ? !b.upcoming && b.status !== 'cancelled' : b.status === 'cancelled'));
  const groups = shown.reduce((m, b) => { const d = new Date(b.appointment); const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; (m[k] = m[k] || []).push(b); return m; }, {});
  return <>
    <nav className="pb-pills">{[['all', 'Tất cả'], ['up', 'Sắp tới'], ['past', 'Đã qua'], ['cancelled', 'Đã hủy']].map(([k, t]) => <button key={k} className={f === k ? 'on' : ''} onClick={() => setF(k)}>{t}<i>{cnt[k]}</i></button>)}</nav>
    {!shown.length ? <Box title="Lịch hẹn"><Empty title="Không có lịch hẹn" hint="Đặt lịch từ trang Lịch hẹn." /></Box> :
      Object.entries(groups).map(([k, items]) => <div key={k} className="pb-month"><h4>Tháng {k.slice(5)}/{k.slice(0, 4)} <i>{items.length} lịch hẹn</i></h4><div className="pb-aplist">{items.map((b) => <ApRow key={b.id} b={b} />)}</div></div>)}
  </>;
}

/* ------------------------------------------------------------------ tài chính */
function Finance({ patient, invoices, openInv, canSell }) {
  const nav = useNavigate();
  const [sub, setSub] = useState('inv'); const [f, setF] = useState('all');
  const inv = invoices || [];
  const pays = inv.flatMap((i) => i.payments.map((p) => ({ ...p, invoice_code: i.code, invoice: i.id }))).sort((a, b) => b.paid_at.localeCompare(a.paid_at));
  const items = inv.filter((i) => i.status !== 'void').flatMap((i) => i.items.map((x) => ({ ...x, invoice_code: i.code, invoice: i.id, created_at: i.created_at })));
  const open = inv.filter((i) => ['unpaid', 'partial'].includes(i.status)); const closed = inv.filter((i) => ['paid', 'void'].includes(i.status));
  const shown = f === 'open' ? open : f === 'closed' ? closed : inv;
  const firstDebt = open.find((i) => Number(i.balance) > 0);
  return <>
    {canSell && <div className="pb-actions-row"><Link className="pb-btn blue" to={`/ban-hang?patient=${patient.id}`}>Tạo hóa đơn</Link><button className="pb-btn" disabled={!firstDebt} title={firstDebt ? 'Thu tiền cho hóa đơn còn nợ' : 'Khách chưa có hóa đơn còn nợ'} onClick={() => firstDebt && nav(`/ban-hang/thu-tien/${firstDebt.id}`)}>Thu nhanh</button></div>}
    <Sub value={sub} onChange={setSub} items={[['inv', 'Hóa đơn', inv.length], ['pay', 'Thanh toán', pays.length], ['items', 'Mặt hàng', items.length]]} />
    {sub === 'inv' && <>
      <nav className="pb-pills"><button className={f === 'all' ? 'on' : ''} onClick={() => setF('all')}>Tất cả<i>{inv.length}</i></button><button className={f === 'open' ? 'on' : ''} onClick={() => setF('open')}>Còn nợ<i>{open.length}</i></button><button className={f === 'closed' ? 'on' : ''} onClick={() => setF('closed')}>Đã đóng<i>{closed.length}</i></button></nav>
      <section className="pb-card pb-grid"><div className="pb-table-wrap"><table className="pb-table"><thead><tr><th>Hóa đơn</th><th>Nội dung</th><th>Người lập</th><th>Trạng thái</th><th className="r">Số tiền</th><th className="r">Còn nợ</th></tr></thead>
        <tbody>{shown.map((i) => <tr key={i.id} className="click" onClick={() => openInv(i.id)}><td><b className="pb-code">{i.code}</b><small className="pb-sub2">{fmtDate(i.created_at)}</small></td>
          <td><span className="pb-ellip w">{i.items.map((x) => x.name).join(', ') || '—'}</span></td><td>{i.created_by_name}</td><td><Pill tone={invTone[i.status]} dot>{i.status_label}</Pill></td>
          <td className="r"><b>{money(i.total)}</b></td><td className="r"><span className={i.balance && i.status !== 'void' ? 'pb-red' : ''}>{i.status === 'void' ? '—' : money(i.balance)}</span></td></tr>)}
          {!shown.length && <tr><td className="pb-none" colSpan={6}>Chưa có hóa đơn.</td></tr>}</tbody></table></div></section></>}
    {sub === 'pay' && <section className="pb-card pb-grid"><div className="pb-table-wrap"><table className="pb-table"><thead><tr><th>Thời gian</th><th>Hóa đơn</th><th>Phương thức</th><th>Mã giao dịch</th><th>Người thu</th><th className="r">Số tiền</th></tr></thead>
      <tbody>{pays.map((p) => <tr key={p.id} className="click" onClick={() => openInv(p.invoice)}><td>{fmtDate(p.paid_at)} {fmtTime(p.paid_at)}</td><td><b className="pb-code">{p.invoice_code}</b></td><td>{p.method_label}</td><td>{p.reference || '—'}</td><td>{p.received_by_name}</td><td className="r"><b>{money(p.amount)}</b></td></tr>)}
        {!pays.length && <tr><td className="pb-none" colSpan={6}>Chưa có thanh toán.</td></tr>}</tbody></table></div></section>}
    {sub === 'items' && <section className="pb-card pb-grid"><div className="pb-table-wrap"><table className="pb-table"><thead><tr><th>Ngày</th><th>Tên hàng / dịch vụ</th><th>Hóa đơn</th><th className="r">SL</th><th className="r">Đơn giá</th><th className="r">Thành tiền</th></tr></thead>
      <tbody>{items.map((x) => <tr key={x.id} className="click" onClick={() => openInv(x.invoice)}><td>{fmtDate(x.created_at)}</td><td>{x.name}</td><td><b className="pb-code">{x.invoice_code}</b></td><td className="r">{x.quantity}</td><td className="r">{money(x.unit_price)}</td><td className="r"><b>{money(x.amount)}</b></td></tr>)}
        {!items.length && <tr><td className="pb-none" colSpan={6}>Chưa có mặt hàng.</td></tr>}</tbody></table></div></section>}
  </>;
}

/* ------------------------------------------------------------------ thành viên */
function Membership({ patient, s }) {
  const l = s?.loyalty; const tier = l?.tier || 'Bronze'; const spend = l?.spend || 0;
  const next = TIERS.find(([, v]) => v > spend);
  return <div className="pb-mem">
    <div className="pb-memcard" style={{ background: TIER_BG[tier] }}><span className="pb-memtag">Hạng thành viên</span><span className="pb-memst">ĐANG HOẠT ĐỘNG</span>
      <h2>{tier.toUpperCase()}</h2><small>MÃ KHÁCH {patient.code}</small><div className="pb-memfoot"><div><span>THAM GIA TỪ</span><b>{fmtDate(patient.created_at)}</b></div><div><span>ĐIỂM THƯỞNG</span><b>{l?.linked ? l.points : '—'}</b></div></div></div>
    <div className="pb-card pb-plan"><h3>Chi tiết hạng</h3>
      <dl><Plain k="Hạng" v={tier} /><Plain k="Tổng đã thanh toán" v={money(spend)} /><Plain k="Điểm thưởng" v={l?.linked ? `${l.points} điểm` : 'Chưa liên kết tài khoản'} />
        <Plain k="Lên hạng tiếp theo" v={next ? `${next[0]} khi đạt ${money(next[1])} (còn ${money(next[1] - spend)})` : 'Đã đạt hạng cao nhất'} /></dl>
      {!l?.linked && <p className="pb-note">Khách chưa có tài khoản trên cổng khách hàng nên chưa tích điểm. Điểm sẽ được cộng khi khách đăng ký và đặt lịch bằng tài khoản.</p>}</div>
    <div className="pb-card pb-benefits"><h3>Mốc hạng thành viên</h3><ul>{TIERS.map(([n, v]) => <li key={n} className={n === tier ? 'on' : ''}><b>{n}</b><span>{v ? `từ ${money(v)}` : 'mặc định'}</span></li>)}</ul></div>
  </div>;
}

/* ------------------------------------------------------------------ trang */
export default function ClientProfilePage() {
  const { id } = useParams(); const { user } = useAuth(); const nav = useNavigate(); const [searchParams, setSearchParams] = useSearchParams(); const role = user.role;
  const clinical = ['doctor', 'manager'].includes(role); const canFinance = ['doctor', 'manager', 'consultant'].includes(role); const canReception = canFinance;
  const validTabs = ['sum', 'appts', 'emr', 'fin', 'mem', 'pkg', 'act'];
  const [tab, setTabState] = useState(() => validTabs.includes(searchParams.get('tab')) ? searchParams.get('tab') : 'sum'); const setTab = (value) => { setTabState(value); const next = new URLSearchParams(searchParams); if (value === 'sum') next.delete('tab'); else next.set('tab', value); setSearchParams(next, { replace: true }); };
  const [emr, setEmr] = useState('visits'); const [collapsed, setCollapsed] = useState(false);
  const [editing, setEditing] = useState(false); const [menu, setMenu] = useState(false); const [notesOpen, setNotesOpen] = useState(false);
  const [toast, toastNode] = useToast(); const menuRef = useRef(null);
  useEffect(() => { const h = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenu(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  const p = useLoad(async () => (await api.get(`/clinic/patients/${id}/`)).data, [id]);
  const sum = useLoad(async () => (await api.get(`/clinic/patients/${id}/summary/`)).data, [id]);
  const meta = useLoad(async () => (await api.get('/clinic/meta/')).data, []);
  const aps = useLoad(async () => (await api.get(`/clinic/patients/${id}/appointments/`)).data, [id]);
  const invs = useLoad(async () => (canFinance ? arr((await api.get('/clinic/invoices/', { params: { patient: id } })).data) : []), [id]);
  const activitySummary = useLoad(async () => (canFinance ? (await api.get('/clinic/activities/', { params: { patient: id, page_size: 1 } })).data : null), [id, canFinance]);
  const plans = useLoad(async () => arr((await api.get('/clinic/plans/', { params: { patient: id } })).data), [id]);
  const patient = p.data; const s = sum.data;
  const reloadAll = () => { p.reload(true); sum.reload(true); invs.reload(true); };
  if (p.error && !patient) return <div className="cl-alert error">{p.error}</div>;
  if (!patient) return <Loading />;
  const checkIn = async () => { try { await api.post('/clinic/visits/', { patient: patient.id, visit_type: 'new' }); toast('Đã đón khách — đang chờ ở sảnh.'); sum.reload(true); } catch (e) { toast(errMsg(e), 'err'); } };
  const age = patient.age != null ? `${patient.age} tuổi` : '';
  const tabs = [['sum', 'Tổng quan', GridViewRounded], ['appts', 'Lịch hẹn', EventNoteOutlined, s?.stats?.bookings],
    ['emr', 'Bệnh án', HealthAndSafetyOutlined, s?.visit_count],
    ...(canFinance ? [['fin', 'Tài chính', ReceiptLongOutlined, invs.data?.length, s?.finance?.outstanding > 0 ? money(s.finance.outstanding) : null], ['mem', 'Thành viên', LoyaltyOutlined, 1]] : []),
    ['pkg', 'Liệu trình', Inventory2Outlined, (plans.data || []).filter((x) => ['active', 'draft'].includes(x.display_status || x.status)).length],
    ...(canFinance ? [['act', 'Hoạt động', TaskAltOutlined, (activitySummary.data?.counts?.todo || 0) + (activitySummary.data?.counts?.completed || 0)]] : [])];
  const emrTabs = [['visits', 'Lượt khám'], ...(clinical ? [['history', 'Tiền sử'], ['rx', 'Đơn thuốc'], ['images', 'Hình ảnh']] : []), ['consent', 'Cam kết']];
  const tier = s?.loyalty?.tier;
  return <div className={`pb pb-clientpage ${collapsed ? 'collapsed' : ''}`}>
    <aside className="pb-side">
      <div className="pb-side-top"><Link to="/benh-nhan" className="pb-back"><ChevronLeftRounded />Khách hàng</Link>
        <div className="pb-pop" ref={menuRef}><button className="pb-link flat" onClick={() => setMenu(!menu)}>Thao tác<ExpandMoreRounded /></button>
          {menu && <div className="pb-pop-box r menu">
            {s?.active_visit ? (role === 'doctor' && s.active_visit.status === 'in_consult' ? <button onClick={() => nav(`/kham/${s.active_visit.id}`)}><PlayArrowRounded />Vào khám</button> : <span className="pb-menu-note">{s.active_visit.status_label}</span>) : canReception && <button onClick={() => { setMenu(false); checkIn(); }}><AddRounded />Đón khách</button>}
            {canReception && <button onClick={() => { setMenu(false); setEditing(true); }}><EditOutlined />Sửa hồ sơ</button>}
            {['manager', 'consultant'].includes(role) && <button onClick={() => { setMenu(false); nav(`/ban-hang?patient=${patient.id}`); }}><AddRounded />Tạo hóa đơn</button>}
            {canFinance && <button onClick={() => { setMenu(false); setTab('fin'); }}><ReceiptLongOutlined />Xem hóa đơn</button>}</div>}</div></div>
      <div className="pb-profile">
        <Avatar name={patient.full_name} size={86} />
        <h2>{patient.full_name}</h2>
        <p>{[patient.date_of_birth && fmtDate(patient.date_of_birth), age, genderText(patient.gender)].filter(Boolean).join(' · ')}</p>
        <p className="pb-idline">Mã {patient.code}</p>
        <span className="pb-status"><i />Đang quản lý</span>
        <div className="pb-labels">{patient.allergies && <span className="pb-label red"><WarningAmberRounded />Dị ứng</span>}{tier && <span className="pb-label blue">{tier}</span>}{s?.active_visit && <span className="pb-label amber">{s.active_visit.status_label}</span>}</div>
      </div>
      <div className="pb-details"><header><b>Thông tin</b><span className="pb-detail-actions"><button className="pb-link flat" onClick={() => setNotesOpen(true)}>Ghi chú</button>{canReception && <button className="pb-ico" onClick={() => setEditing(true)} aria-label="Sửa"><EditOutlined /></button>}</span></header>
        <dl><div className="pb-det"><dt>Mã khách hàng</dt><dd>{patient.code}<button className="pb-copy" onClick={() => navigator.clipboard?.writeText(patient.code).then(() => toast('Đã sao chép mã.'))}><ContentCopyRounded />Sao chép</button></dd></div>
          <Plain k="Nguồn biết đến" v={patient.referral_source} /><Plain k="Giới tính" v={genderText(patient.gender)} /><Plain k="Ngày sinh" v={patient.date_of_birth && fmtDate(patient.date_of_birth)} />
          <Plain k="Địa chỉ" v={patient.address} /><Plain k="Email" v={patient.email} /><Plain k="Điện thoại" v={patient.phone} /><Plain k="CCCD / CMND" v={patient.national_id} />
          <Plain k="Nghề nghiệp" v={patient.occupation} /><Plain k="Liên hệ khi cần" v={patient.emergency_contact} />{clinical && <Plain k="Phân loại da (Fitzpatrick)" v={patient.skin_type && `Loại ${patient.skin_type}`} />}</dl></div>
    </aside>
    <button className="pb-fold" onClick={() => setCollapsed(!collapsed)} aria-label="Thu gọn cột thông tin">{collapsed ? <ChevronRightRounded /> : <ChevronLeftRounded />}</button>
    <main className="pb-main">
      <nav className="pb-ctabs" role="tablist">{tabs.map(([k, t, Ic, n, badge]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><Ic />{t}{badge && <em>{badge}</em>}{n != null && <i>{n}</i>}</button>)}</nav>
      <div className="pb-cbody">
        {tab === 'sum' && <Summary patient={patient} s={s} bookings={aps.data} goto={setTab} canFinance={canFinance} clinical={clinical} />}
        {tab === 'appts' && <Appointments list={aps.data} />}
        {tab === 'emr' && <><Sub value={emr} onChange={setEmr} items={emrTabs} />
          {emr === 'visits' && <VisitsTab patientId={id} patient={patient} clinical={clinical} regions={meta.data?.regions || []} />}
          {emr === 'history' && clinical && <HistoryTab patient={patient} meta={meta.data} onSaved={() => { p.reload(true); toast('Đã lưu tiền sử.'); }} />}
          {emr === 'rx' && clinical && <PrescriptionsTab patient={patient} />}
          {emr === 'images' && clinical && <ImagesTab patient={patient} regions={meta.data?.regions || []} canUpload={role === 'doctor'} />}
          {emr === 'consent' && <ConsentsTab patient={patient} canSign={canFinance} />}</>}
        {tab === 'fin' && canFinance && <Finance patient={patient} invoices={invs.data} openInv={(invoiceId) => nav(`/hoa-don/${invoiceId}`)} canSell={['manager', 'consultant'].includes(role)} />}
        {tab === 'mem' && canFinance && <Membership patient={patient} s={s} />}
        {tab === 'pkg' && <PackagesTab patient={patient} role={role} rows={plans.data || []} loading={plans.loading} reload={plans.reload} onChanged={() => { sum.reload(true); plans.reload(true); }} />}
        {tab === 'act' && canFinance && <PatientActivities patient={patient} onChanged={() => activitySummary.reload(true)} />}
      </div>
      <footer className="pb-statbar">
        <div className="grp"><small>LỊCH HẸN</small><div><span><b>{s?.stats?.bookings ?? '—'}</b>Tổng lịch hẹn</span><span className="blue"><b>{s?.stats?.upcoming ?? '—'}</b>Sắp tới</span><span><b>{s?.stats?.cancelled ?? '—'}</b>Đã hủy</span><span><b>{s?.stats?.days_since_last_visit ?? '—'}</b>Ngày từ lần khám cuối</span></div></div>
        {canFinance && s?.finance && <div className="grp"><small>TÀI CHÍNH</small><div><span><b>{money(s.finance.billed)}</b>Tổng đã lập</span><span><b>{money(s.finance.paid)}</b>Đã thanh toán</span><span className={s.finance.outstanding ? 'hot' : ''}><b>{money(s.finance.outstanding)}</b>Còn nợ</span></div></div>}
      </footer>
    </main>
    <PatientFormModal open={editing} patient={patient} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); reloadAll(); toast('Đã cập nhật hồ sơ.'); }} />
    {notesOpen && <NotesModal patient={patient} onClose={() => setNotesOpen(false)} onChanged={() => { sum.reload(true); p.reload(true); }} />}
    {toastNode}
  </div>;
}
