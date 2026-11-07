import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AccountBalanceRounded from '@mui/icons-material/AccountBalanceRounded';
import AddCircleOutlineRounded from '@mui/icons-material/AddCircleOutlineRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import AttachMoneyRounded from '@mui/icons-material/AttachMoneyRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import ConfirmationNumberOutlined from '@mui/icons-material/ConfirmationNumberOutlined';
import CreditCardRounded from '@mui/icons-material/CreditCardRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import EventRepeatRounded from '@mui/icons-material/EventRepeatRounded';
import ExpandLessRounded from '@mui/icons-material/ExpandLessRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import FavoriteBorderRounded from '@mui/icons-material/FavoriteBorderRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import Inventory2Outlined from '@mui/icons-material/Inventory2Outlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded';
import MonetizationOnOutlined from '@mui/icons-material/MonetizationOnOutlined';
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import NotesRounded from '@mui/icons-material/NotesRounded';
import PercentRounded from '@mui/icons-material/PercentRounded';
import PermIdentityRounded from '@mui/icons-material/PermIdentityRounded';
import PersonAddAltRounded from '@mui/icons-material/PersonAddAltRounded';
import PersonPinCircleOutlined from '@mui/icons-material/PersonPinCircleOutlined';
import PrintRounded from '@mui/icons-material/PrintRounded';
import QrCode2Rounded from '@mui/icons-material/QrCode2Rounded';
import RemoveRounded from '@mui/icons-material/RemoveRounded';
import RoomOutlined from '@mui/icons-material/RoomOutlined';
import SearchRounded from '@mui/icons-material/SearchRounded';
import ShoppingBagOutlined from '@mui/icons-material/ShoppingBagOutlined';
import ShoppingCartOutlined from '@mui/icons-material/ShoppingCartOutlined';
import SmsOutlined from '@mui/icons-material/SmsOutlined';
import StarsRounded from '@mui/icons-material/StarsRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PatientFormModal } from './PatientForm';
import { useMedicines } from './Prescription';
import { printInvoice } from './Billing';
import { Btn, Loading, Modal, errMsg, fmtDate, initials, money, useDebounce, useLoad } from './ui';
import './sale.css';

const CLINIC_NAME = 'Phòng khám Da liễu OHIO';
const arr = (d) => d?.results || d || [];
const WALK = { walk: true };
const isWalk = (c) => !!c?.walk;

/* ------------------------------------------------------------------ giỏ hàng: thao tác thuần */
const keyOf = (it) => (it.kind === 'package' ? `k-${it.package_template || it.name}-${it.unit_price}` : it.kind === 'service' && it.service ? `s-${it.service}` : it.kind === 'medicine' && it.medicine ? `m-${it.medicine}` : `o-${it.name}-${it.unit_price}`);

function addTo(cart, item, stockMap) {
  const k = keyOf(item);
  const have = cart.find((x) => keyOf(x) === k);
  const cap = item.kind === 'medicine' ? stockMap?.[item.medicine] : item.kind === 'package' ? 5 : undefined;
  if (have) {
    const q = Number(have.quantity) + (Number(item.quantity) || 1);
    return cart.map((x) => (x === have ? { ...x, quantity: cap != null ? Math.min(q, cap) : q } : x));
  }
  return [...cart, { ...item, quantity: Number(item.quantity) || 1 }];
}

/* ------------------------------------------------------------------ các khối giao diện dùng chung */
function ClientHead({ client, debt, onClear }) {
  const walk = isWalk(client);
  return <div className="sx-client">
    <span className={`sx-av ${walk ? 'walk' : ''}`}>{walk ? <PersonPinCircleOutlined /> : initials(client.full_name)}</span>
    <div><h2>{walk ? 'Khách vãng lai' : client.full_name}</h2><p>{walk ? 'Chưa có hồ sơ khách' : (client.email || client.phone || client.code)}</p>
      {debt > 0 && <span className="sx-debt">Còn nợ {money(debt)}</span>}</div>
    {onClear && <button className="x" onClick={onClear} aria-label="Đổi khách"><CloseRounded /></button>}
  </div>;
}

function LocationBox({ open, setOpen, client, seller, locked }) {
  return <div className="sx-loc">
    <button onClick={() => !locked && setOpen(!open)}>{locked ? <LockOutlined /> : <RoomOutlined />}<span>{CLINIC_NAME}</span>{!locked && (open ? <ExpandLessRounded /> : <ExpandMoreRounded />)}</button>
    {open && !locked && <dl>
      <div><dt><RoomOutlined />Cơ sở</dt><dd>{CLINIC_NAME}</dd></div>
      <div><dt><PermIdentityRounded />Người bán</dt><dd>{seller}</dd></div>
      <div><dt><PersonPinCircleOutlined />Người trả tiền</dt><dd>{isWalk(client) ? 'Khách vãng lai' : client?.full_name}</dd></div>
    </dl>}
  </div>;
}

function CartList({ items, seller, onQty, onRemove, stockMap, readOnly }) {
  const svc = items.filter((i) => i.kind === 'service'); const prod = items.filter((i) => i.kind === 'medicine'); const oth = items.filter((i) => i.kind === 'other'); const pkg = items.filter((i) => i.kind === 'package');
  const Row = ({ it }) => {
    const cap = it.kind === 'medicine' ? stockMap?.[it.medicine] : it.kind === 'package' ? 5 : undefined;
    return <div className={`sx-line ${it.kind === 'service' ? 'svc' : ''} ${readOnly ? 'ro' : ''}`}>
      <span className="ic">{it.kind === 'service' ? <FavoriteBorderRounded /> : it.kind === 'medicine' ? <ShoppingBagOutlined /> : it.kind === 'package' ? <Inventory2Outlined /> : <AddCircleOutlineRounded />}</span>
      <span className="nm"><b>{it.name}</b><small>{it.kind === 'package' && (it.sessions || it.package) ? `${it.sessions || it.package.total_sessions} buổi · ` : ''}Bán bởi {seller}</small></span>
      <span className="pr"><b>{money(it.unit_price * it.quantity)}</b><small>{it.quantity}x</small></span>
      {!readOnly && <span className="ctl">
        <button aria-label="Giảm" onClick={() => onQty(it, -1)}><RemoveRounded fontSize="inherit" /></button>
        <button aria-label="Tăng" disabled={cap != null && it.quantity >= cap} onClick={() => onQty(it, 1)}><AddRounded fontSize="inherit" /></button>
        <button className="rm" aria-label="Xóa" onClick={() => onRemove(it)}><CloseRounded fontSize="inherit" /></button></span>}
    </div>;
  };
  const Sec = ({ title, rows, cls }) => rows.length ? <><div className={`sx-sec ${cls || ''}`}>{title}<i>{rows.length}</i></div>{rows.map((it) => <Row key={keyOf(it)} it={it} />)}</> : null;
  return <>
    <Sec title="Gói liệu trình" rows={pkg} /><Sec title="Dịch vụ" rows={svc} cls="svc" /><Sec title="Sản phẩm" rows={prod} /><Sec title="Khoản khác" rows={oth} />
  </>;
}

/* ------------------------------------------------------------------ khu chọn phương thức thanh toán (dùng cho Bán hàng và Thu nhanh) */
const TILES = [
  { k: 'terminal', label: 'Máy POS thẻ', method: 'card', icon: CreditCardRounded, c: 'c-blue' },
  { k: 'manual', label: 'Thẻ (nhập tay)', method: 'card', icon: CreditCardRounded, c: 'c-blue', ref: true },
  { k: 'onfile', label: 'Thẻ đã lưu', icon: CreditCardRounded, c: 'c-gray', off: 'Sắp có' },
  { k: 'cardother', label: 'Thẻ (khác)', method: 'card', icon: CreditCardRounded, c: 'c-lblue', ref: true },
  { k: 'cash', label: 'Tiền mặt', method: 'cash', icon: AttachMoneyRounded, c: 'c-green' },
  { k: 'selfpay', label: 'Tự thanh toán (QR / ví)', method: 'ewallet', icon: QrCode2Rounded, c: 'c-gray', ref: true },
  { k: 'plan', label: 'Trả góp', icon: EventRepeatRounded, c: 'c-teal', off: 'Sắp có' },
  { k: 'bank', label: 'Chuyển khoản', method: 'transfer', icon: AccountBalanceRounded, c: 'c-pink', ref: true },
];
const PREPAID = [
  { k: 'acct', label: 'Số dư tài khoản', icon: MonetizationOnOutlined, c: 'c-gray', off: 'Sắp có' },
  { k: 'pkg', label: 'Liệu trình trả trước', icon: Inventory2Outlined, c: 'c-gray', off: 'Sắp có' },
  { k: 'pts', label: 'Điểm thưởng', icon: StarsRounded, c: 'c-gray', off: 'Sắp có' },
  { k: 'voucher', label: 'Voucher', icon: ConfirmationNumberOutlined, c: 'c-purple', voucher: true },
];

function PayArea({ due, lines, setLines, onVoucher, banner, onBanner }) {
  const add = (t) => {
    if (due <= 0) return;
    setLines((ls) => (ls.some((l) => l.k === t.k) ? ls.map((l) => (l.k === t.k ? { ...l, amount: Number(l.amount) + due } : l)) : [...ls, { id: `${t.k}-${Date.now()}`, k: t.k, label: t.label, method: t.method, amount: due, reference: '', ref: !!t.ref }]));
  };
  const Tile = (t) => {
    const sel = lines.some((l) => l.k === t.k); const Icon = t.icon;
    const disabled = !!t.off || (!t.voucher && due <= 0 && !sel) || (t.voucher && due <= 0);
    return <button key={t.k} className={`sx-tile ${sel ? 'sel' : ''}`} disabled={disabled} title={t.off} onClick={() => (t.voucher ? onVoucher?.() : add(t))}>
      <Icon className={t.c} /><span>{t.label}</span>{t.off && <em className="badge">{t.off}</em>}</button>;
  };
  const needRef = lines.filter((l) => l.ref);
  return <div className="sx-pay">
    {banner && <div className="sx-banner"><div><h3>Thanh toán nhanh, an toàn và gọn gàng</h3><p>Chọn phương thức bên dưới. Có thể chia khoản thanh toán thành nhiều phương thức.</p></div><button className="cls" onClick={onBanner} aria-label="Đóng"><CloseRounded /></button></div>}
    <div className="sx-tiles">{TILES.map(Tile)}</div>
    <div className="sx-sub">Trả trước & ưu đãi</div>
    <div className="sx-tiles">{PREPAID.filter((t) => t.voucher ? onVoucher : true).map(Tile)}</div>
    {!!needRef.length && <div style={{ marginTop: 22 }}>{needRef.map((l) => <div className="sx-ref" key={l.id}><span style={{ minWidth: 190 }}>Mã giao dịch · {l.label}</span>
      <input value={l.reference} placeholder="Không bắt buộc" onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, reference: e.target.value } : x)))} /></div>)}</div>}
  </div>;
}

function PayList({ lines, setLines }) {
  return <div className="sx-paylist">{lines.map((l) => <div key={l.id}>
    <span className="nm">{l.label}</span>
    <input type="number" min={1} value={l.amount} aria-label={`Số tiền ${l.label}`} onChange={(e) => setLines((ls) => ls.map((x) => (x.id === l.id ? { ...x, amount: e.target.value === '' ? '' : Math.max(0, Number(e.target.value)) } : x)))} />
    <button aria-label="Xóa khoản thanh toán" onClick={() => setLines((ls) => ls.filter((x) => x.id !== l.id))}><DeleteOutlineRounded fontSize="small" /></button></div>)}</div>;
}

/* ------------------------------------------------------------------ trang Bán hàng mới */
export default function SalePage() {
  const { user } = useAuth(); const nav = useNavigate(); const loc = useLocation(); const [sp] = useSearchParams();
  const seller = user?.full_name || user?.username || '';
  const services = useLoad(async () => arr((await api.get('/services/')).data), []);
  const meds = useMedicines();
  const tpls = useLoad(async () => arr((await api.get('/clinic/package-templates/')).data), []);
  const [pkgDlg, setPkgDlg] = useState(null);
  const [client, setClient] = useState(null);
  const [cart, setCart] = useState([]);
  const [tab, setTab] = useState('svc');
  const [cat, setCat] = useState('');
  const [q, setQ] = useState(''); const dq = useDebounce(q, 150);
  const [discount, setDiscount] = useState(0); const [note, setNote] = useState('');
  const [tipOn, setTipOn] = useState(false); const [tip, setTip] = useState('');
  const [paying, setPaying] = useState(false); const [lines, setLines] = useState([]);
  const [banner, setBanner] = useState(true);
  const [locOpen, setLocOpen] = useState(true);
  const [menu, setMenu] = useState(false); const [dlg, setDlg] = useState(null); const [dv, setDv] = useState('');
  const [visit, setVisit] = useState(null);
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const [debt, setDebt] = useState(0); const [prev, setPrev] = useState([]);
  const [creating, setCreating] = useState(false);
  const menuRef = useRef(null);

  const svcAll = useMemo(() => arr(services.data).filter((s) => s.is_active), [services.data]);
  const medAll = useMemo(() => arr(meds.data).filter((m) => m.is_active && !m.is_controlled), [meds.data]);
  const stockMap = useMemo(() => Object.fromEntries(arr(meds.data).map((m) => [m.id, m.stock])), [meds.data]);

  /* nạp sẵn khách / lượt khám từ đường dẫn */
  useEffect(() => {
    const pid = sp.get('patient'); const vid = sp.get('visit');
    (async () => {
      try {
        if (vid) {
          const { data } = await api.get('/clinic/invoices/draft-from-visit/', { params: { visit: vid } });
          setVisit(Number(vid)); setCart(data.items.map((i) => ({ ...i }))); setLocOpen(false);
          const p = await api.get(`/clinic/patients/${data.patient}/`); setClient(p.data);
        } else if (pid) { const p = await api.get(`/clinic/patients/${pid}/`); setClient(p.data); }
      } catch (e) { setErr(errMsg(e)); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* công nợ + mục đã mua trước đây của khách */
  useEffect(() => {
    setDebt(0); setPrev([]);
    if (!client || isWalk(client)) return;
    api.get(`/clinic/patients/${client.id}/summary/`).then(({ data }) => setDebt(data?.finance?.outstanding || 0)).catch(() => {});
    api.get('/clinic/invoices/', { params: { patient: client.id } }).then(({ data }) => {
      const seen = new Set(); const out = [];
      arr(data).filter((i) => i.status !== 'void').forEach((inv) => inv.items.forEach((it) => { const k = keyOf(it); if (!seen.has(k) && it.kind !== 'other' && out.length < 3) { seen.add(k); out.push({ it, at: inv.created_at, by: inv.created_by_name }); } }));
      setPrev(out);
    }).catch(() => {});
  }, [client?.id, client?.walk]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { const h = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenu(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);

  /* thanh toán thay đổi → đồng bộ khi giỏ đổi */
  const tipAmt = tipOn ? Math.max(Number(tip) || 0, 0) : 0;
  const items = useMemo(() => (tipAmt ? [...cart, { kind: 'other', name: 'Tiền tip', quantity: 1, unit_price: tipAmt }] : cart), [cart, tipAmt]);
  const itemsSum = cart.reduce((s, i) => s + i.quantity * i.unit_price, 0);
  const sub = itemsSum + tipAmt; const disc = Math.min(Number(discount) || 0, sub); const total = sub - disc;
  const paid = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0); const due = Math.max(total - paid, 0); const over = paid > total;
  const count = cart.reduce((s, i) => s + i.quantity, 0);
  useEffect(() => { if (!paying) return; if (!cart.length) setPaying(false); }, [cart.length, paying]);

  const addItem = (item) => { setCart((c) => { if (!c.length) setLocOpen(false); return addTo(c, item, stockMap); }); setPaying(false); setLines([]); };
  const onQty = (it, d) => setCart((c) => c.map((x) => (x === it ? { ...x, quantity: Math.max(1, Math.min(x.quantity + d, it.kind === 'package' ? 5 : it.kind === 'medicine' && stockMap[it.medicine] != null ? stockMap[it.medicine] : 9999)) } : x)));
  const onRemove = (it) => setCart((c) => c.filter((x) => x !== it));
  const clear = () => { setCart([]); setLines([]); setDiscount(0); setNote(''); setTipOn(false); setTip(''); setPaying(false); setLocOpen(true); setErr(''); };
  const goBack = () => { if (cart.length && !window.confirm('Hủy giao dịch đang làm dở?')) return; if (loc.key !== 'default') nav(-1); else nav('/thu-ngan'); };

  const submit = async (withPay) => {
    setErr(''); setBusy(true);
    try {
      const body = { items: items.map((i) => ({ kind: i.kind, name: i.name, medicine: i.medicine || null, service: i.service || null, package_template: i.package_template || null, package: i.package || null, quantity: Number(i.quantity), unit_price: Number(i.unit_price) })), discount: disc, note,
        ...(isWalk(client) ? { walk_in: true } : { patient: client.id, visit: visit || null }),
        ...(withPay && lines.length ? { payments: lines.map((l) => ({ amount: Number(l.amount), method: l.method, reference: l.reference })) } : {}) };
      const { data } = await api.post('/clinic/invoices/', body);
      setDone({ inv: data, tip: tipAmt, client }); setPaying(false);
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };

  const reset = () => { clear(); setDone(null); setClient(null); setVisit(null); setQ(''); setTab('svc'); setCat(''); };

  /* danh mục */
  const tplAll = useMemo(() => arr(tpls.data).filter((t) => t.is_active), [tpls.data]);
  const cats = useMemo(() => { const m = {}; (tab === 'svc' ? svcAll : tab === 'pkg' ? tplAll : medAll).forEach((x) => { const c = tab === 'svc' || tab === 'pkg' ? (x.category_name || 'Khác') : (x.form || 'Khác'); m[c] = (m[c] || 0) + 1; }); return m; }, [tab, svcAll, medAll, tplAll]);
  const shownPkg = tplAll.filter((t) => (!cat || (t.category_name || 'Khác') === cat) && (!dq.trim() || t.name.toLowerCase().includes(dq.trim().toLowerCase())));
  const shownSvc = svcAll.filter((s) => (!cat || s.category_name === cat) && (!dq.trim() || s.name.toLowerCase().includes(dq.trim().toLowerCase())));
  const shownMed = medAll.filter((m) => (!cat || (m.form || 'Khác') === cat) && (!dq.trim() || `${m.name} ${m.code} ${m.active_ingredient}`.toLowerCase().includes(dq.trim().toLowerCase())));

  const step = done ? 'done' : !client ? 'who' : paying ? 'pay' : 'pos';
  const svcById = Object.fromEntries(svcAll.map((s) => [s.id, s])); const medById = Object.fromEntries(medAll.map((m) => [m.id, m]));
  const addPrev = ({ it }) => { if (it.kind === 'service' && svcById[it.service]) addItem({ kind: 'service', service: it.service, name: it.name, unit_price: svcById[it.service].price, quantity: 1 }); else if (it.kind === 'medicine' && medById[it.medicine]) { const m = medById[it.medicine]; if (m.stock > 0) addItem({ kind: 'medicine', medicine: m.id, name: m.name, unit_price: m.price, quantity: 1 }); } };

  const rail = [['svc', 'Dịch vụ', FavoriteBorderRounded], ['prod', 'Sản phẩm', ShoppingBagOutlined], ['pkg', 'Liệu trình', Inventory2Outlined], ['other', 'Khác', AddCircleOutlineRounded]];
  const [cu, setCu] = useState({ name: '', price: '', qty: 1 });

  return <div className="sx" role="application" aria-label="Bán hàng">
    <header className="sx-top"><button onClick={goBack} aria-label="Quay lại"><ChevronRightRounded style={{ transform: 'scaleX(-1)' }} /></button><h1>Bán hàng mới</h1></header>
    <div className="sx-body">
      <nav className="sx-rail">
        {rail.map(([k, t, Ic]) => <button key={k} className={tab === k && step !== 'pay' ? 'on' : ''} onClick={() => { setTab(k); setCat(''); setQ(''); setPaying(false); }}><Ic />{t}</button>)}
        <span className="sp" />
        <button className={step === 'pay' ? 'on' : ''} disabled={!cart.length || !client} onClick={() => setPaying(true)}><ShoppingCartOutlined />Thanh toán</button>
      </nav>

      <div className={`sx-main ${step === 'who' ? 'blur' : ''}`}>
        {step === 'pay'
          ? <PayArea due={due} lines={lines} setLines={setLines} banner={banner} onBanner={() => setBanner(false)} onVoucher={() => { setDv(String(disc || '')); setDlg('discount'); }} />
          : <div className="sx-catalog">
            {tab !== 'other' && <>
              <div className="sx-chips"><button className={`sx-chip ${!cat ? 'on' : ''}`} onClick={() => setCat('')}>Tất cả <i>{Object.values(cats).reduce((a, b) => a + b, 0)}</i></button>
                {Object.entries(cats).map(([c, n]) => <button key={c} className={`sx-chip ${cat === c ? 'on' : ''}`} onClick={() => setCat(c)}>{c} <i>{n}</i></button>)}</div>
              <div className="sx-search-row"><label className="sx-search"><input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'svc' ? 'Tìm dịch vụ theo tên' : tab === 'pkg' ? 'Tìm gói liệu trình theo tên' : 'Tìm theo tên, mã sản phẩm hoặc quét mã'} /><SearchRounded /></label>
                {tab === 'pkg' && user?.role === 'manager' && <button className="sx-btn-ghost" onClick={() => setPkgDlg('manage')}>Quản lý gói mẫu</button>}
                {tab === 'pkg' && <button className="sx-btn-blue" onClick={() => setPkgDlg('custom')}><AddRounded />Gói tùy chỉnh</button>}</div></>}
            <div className="sx-grid">
              {(services.loading && !services.data) || (tab === 'prod' && meds.loading && !meds.data) ? <div className="sx-empty"><Loading /></div> : null}
              {(tab === 'svc' || tab === 'prod') && !!prev.length && !q && !cat && <div className="sx-prev">{prev.map((p) => <button key={keyOf(p.it)} className="sx-card prev" onClick={() => addPrev(p)}>
                <span className="tag"><HistoryRounded />Đã mua trước đây</span><strong>{p.it.name}</strong><small>{fmtDate(p.at)} · bởi {p.by}</small><span className="price">{money(p.it.unit_price)}</span></button>)}</div>}
              {tab === 'svc' && shownSvc.map((s) => <button key={s.id} className="sx-card" onClick={() => addItem({ kind: 'service', service: s.id, name: s.name, unit_price: s.price, quantity: 1 })}>
                <strong>{s.name}</strong><span className="price">{money(s.price)}</span><i className="bar" /></button>)}
              {tab === 'prod' && shownMed.map((m) => { const out = m.stock <= 0; const inCart = cart.find((c) => c.medicine === m.id)?.quantity || 0;
                return <button key={m.id} className={`sx-card prod ${out ? 'out' : ''}`} disabled={out || inCart >= m.stock} title={[m.active_ingredient, m.strength].filter(Boolean).join(' · ')} onClick={() => addItem({ kind: 'medicine', medicine: m.id, name: m.name, unit_price: m.price, quantity: 1 })}>
                  <span className={`stock ${out ? 'out' : m.low_stock ? 'low' : ''}`}>{out ? 'Hết hàng' : `Còn ${m.stock}`}</span><strong>{m.name}{m.strength ? ` ${m.strength}` : ''}</strong>
                  <span className="price">{money(m.price)}</span>{(m.active_ingredient || m.default_usage) && <InfoOutlined className="info" />}</button>; })}
              {tab === 'svc' && !services.loading && !shownSvc.length && <div className="sx-empty">Không có dịch vụ phù hợp.</div>}
              {tab === 'prod' && !meds.loading && !shownMed.length && <div className="sx-empty">Không có sản phẩm phù hợp.</div>}
              {tab === 'pkg' && isWalk(client) && <div className="sx-empty">Gói liệu trình cần gắn với hồ sơ khách. Hãy đổi sang khách có hồ sơ (nút × ở góc phải) để bán gói.</div>}
              {tab === 'pkg' && !isWalk(client) && shownPkg.map((t) => <button key={t.id} className="sx-card" onClick={() => addItem({ kind: 'package', package_template: t.id, name: t.name, unit_price: t.price, quantity: 1, sessions: t.total_sessions })}>
                <span className="stock">{t.total_sessions} buổi</span><strong>{t.name}</strong><small style={{ color: 'var(--sx-muted)', marginTop: 4 }}>{t.validity_months ? `Hiệu lực ${t.validity_months} tháng` : 'Không giới hạn thời gian'}{t.interval_days ? ` · cách ${t.interval_days} ngày` : ''}</small>
                <span className="price">{money(t.price)}</span><i className="bar" /></button>)}
              {tab === 'pkg' && !isWalk(client) && !tpls.loading && !shownPkg.length && <div className="sx-empty">Chưa có gói mẫu phù hợp.{user?.role === 'manager' ? ' Bấm “Quản lý gói mẫu” để tạo, hoặc dùng “Gói tùy chỉnh”.' : ' Dùng “Gói tùy chỉnh” hoặc nhờ quản lý tạo gói mẫu.'}</div>}
              {tab === 'other' && <div className="sx-custom"><h3>Khoản tùy chỉnh</h3><label>Nội dung<input value={cu.name} onChange={(e) => setCu({ ...cu, name: e.target.value })} placeholder="Ví dụ: Phí tái khám ngoài giờ" /></label>
                <div className="two"><label>Đơn giá (đ)<input type="number" min={0} step={1000} value={cu.price} onChange={(e) => setCu({ ...cu, price: e.target.value })} /></label><label>Số lượng<input type="number" min={1} value={cu.qty} onChange={(e) => setCu({ ...cu, qty: e.target.value })} /></label></div>
                <button className="sx-btn-blue" style={{ justifyContent: 'center' }} disabled={!cu.name.trim() || !(Number(cu.price) >= 0) || cu.price === ''} onClick={() => { addItem({ kind: 'other', name: cu.name.trim(), unit_price: Number(cu.price), quantity: Math.max(1, Number(cu.qty) || 1) }); setCu({ name: '', price: '', qty: 1 }); }}><AddRounded />Thêm vào giỏ</button></div>}
            </div>
          </div>}
      </div>

      {/* ----------------------------------------------------- bảng bên phải */}
      <aside className="sx-side">
        {step === 'who' && <WhoPanel onPick={setClient} onWalk={() => { setClient(WALK); setCart((c) => c.filter((x) => x.kind !== 'package')); }} onCreate={() => setCreating(true)} />}
        {step !== 'who' && client && <>
          <ClientHead client={client} debt={debt} onClear={() => { setClient(null); setVisit(null); setPaying(false); setLines([]); }} />
          <LocationBox open={locOpen} setOpen={setLocOpen} client={client} seller={seller} />
          <div className="sx-cart">
            {!cart.length ? <div className="sx-cart-empty"><span className="ic"><ShoppingCartOutlined /></span><b>Giỏ hàng đang trống</b><span>Thêm dịch vụ hoặc sản phẩm để thanh toán</span></div>
              : <CartList items={cart} seller={seller} onQty={onQty} onRemove={onRemove} stockMap={stockMap} readOnly={step === 'pay'} />}
          </div>
          {!!cart.length && <div className="sx-foot">
            {err && <div className="sx-err">{err}</div>}
            <div className="sx-sum">
              <div><span>Tạm tính ({count} mục)</span><b>{money(itemsSum)}</b></div>
              {disc > 0 && <div><span>Giảm giá</span><b>-{money(disc)}</b></div>}
              <div><span>Thuế (đã gồm trong giá)</span><b>0đ</b></div>
              <div><span className="sx-tip">Tiền tip <button className={`sx-switch ${tipOn ? 'on' : ''}`} role="switch" aria-checked={tipOn} aria-label="Bật tiền tip" disabled={step === 'pay'} onClick={() => setTipOn(!tipOn)} /></span>
                {tipOn && step !== 'pay' ? <input type="number" min={0} step={1000} style={{ width: 110, height: 28, border: '1px solid var(--sx-line)', borderRadius: 7, textAlign: 'right', padding: '0 8px' }} value={tip} placeholder="0" onChange={(e) => setTip(e.target.value)} /> : <b>{money(tipAmt)}</b>}</div>
            </div>
            {lines.length ? <>
              <div className={`sx-total ${over ? '' : due ? '' : 'paid'}`}><span>{due ? 'Đã nhận một phần' : 'Đã thanh toán đủ'}</span><em>{money(over ? total : paid)}</em></div>
              <PayList lines={lines} setLines={setLines} />
              <div className={`sx-due ${due ? 'bad' : 'ok'}`}><span>Còn lại</span><span>{over ? `Thừa ${money(paid - total)}` : money(due)}</span></div>
            </> : <div className="sx-total"><span>Tổng cộng</span><em>{money(total)}</em></div>}
            <div className="sx-actions" ref={menuRef}>
              <button className="more" aria-label="Thêm tùy chọn" onClick={() => setMenu(!menu)}><MoreHorizRounded /></button>
              {menu && <div className="sx-menu">
                <button onClick={() => { setMenu(false); setDv(String(disc || '')); setDlg('discount'); }}><PercentRounded fontSize="small" />Giảm giá…</button>
                <button onClick={() => { setMenu(false); setDv(note); setDlg('note'); }}><NotesRounded fontSize="small" />Ghi chú hóa đơn…</button>
                {disc > 0 && <button onClick={() => { setMenu(false); setDiscount(0); }}><CloseRounded fontSize="small" />Bỏ giảm giá</button>}</div>}
              <button className="clear" onClick={clear}><DeleteOutlineRounded fontSize="small" />Xóa</button>
              {step === 'pos' && <button className="go" disabled={!cart.length || total <= 0} onClick={() => { setErr(''); setPaying(true); }}>Tiếp tục</button>}
              {step === 'pay' && (lines.length
                ? <button className="go green" disabled={busy || over || paid <= 0} onClick={() => submit(true)}>{busy ? 'Đang xử lý…' : 'Xác nhận'}</button>
                : <button className="go" disabled={busy} onClick={() => submit(false)}>{busy ? 'Đang lưu…' : 'Lưu chưa thanh toán'}</button>)}
            </div>
          </div>}
        </>}
      </aside>

      {step === 'done' && <DoneScreen done={done} onNew={reset} onClose={() => nav('/thu-ngan')} onNext={() => nav('/lich-hen')} onPay={(id) => nav(`/ban-hang/thu-tien/${id}`)} onPlans={(pid) => nav(`/benh-nhan/${pid}?tab=pkg`)} />}
    </div>

    <Modal open={dlg === 'discount'} title="Giảm giá / Voucher" subtitle="Nhập số tiền giảm cho hóa đơn này." onClose={() => setDlg(null)}
      footer={<><Btn onClick={() => setDlg(null)}>Hủy</Btn><Btn kind="primary" onClick={() => { setDiscount(Math.max(Number(dv) || 0, 0)); setDlg(null); }}>Áp dụng</Btn></>}>
      <label className="cl-field"><span>Số tiền giảm (đ)</span><input type="number" min={0} step={1000} autoFocus value={dv} onChange={(e) => setDv(e.target.value)} /></label></Modal>
    <Modal open={dlg === 'note'} title="Ghi chú hóa đơn" onClose={() => setDlg(null)}
      footer={<><Btn onClick={() => setDlg(null)}>Hủy</Btn><Btn kind="primary" onClick={() => { setNote(dv.slice(0, 255)); setDlg(null); }}>Lưu</Btn></>}>
      <label className="cl-field"><span>Ghi chú</span><input autoFocus value={dv} maxLength={255} onChange={(e) => setDv(e.target.value)} /></label></Modal>
    <CustomPackageModal open={pkgDlg === 'custom'} onClose={() => setPkgDlg(null)} onAdd={(it) => { addItem(it); setPkgDlg(null); }} />
    {pkgDlg === 'manage' && <PackageManager onClose={() => setPkgDlg(null)} onChanged={() => tpls.reload(true)} />}
    <PatientFormModal open={creating} initial={{}} onClose={() => setCreating(false)} onSaved={(p) => { setCreating(false); setClient(p); }} />
  </div>;
}

/* ------------------------------------------------------------------ "Giao dịch này cho ai?" */
function WhoPanel({ onPick, onWalk, onCreate }) {
  const [q, setQ] = useState(''); const dq = useDebounce(q, 250); const [rows, setRows] = useState([]);
  useEffect(() => { if (dq.trim().length < 2) { setRows([]); return; } api.get('/clinic/patients/', { params: { q: dq.trim(), limit: 8 } }).then(({ data }) => setRows(arr(data))).catch(() => setRows([])); }, [dq]);
  return <div className="sx-who">
    <h2>Giao dịch này cho ai?</h2>
    <label className="box"><SearchRounded /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm khách theo tên, SĐT hoặc mã hồ sơ" /></label>
    {q.trim().length >= 2 && <div className="sx-found">{rows.map((p) => <button key={p.id} onClick={() => onPick(p)}><span className="sx-av">{initials(p.full_name)}</span><span><b>{p.full_name}</b><small>{p.code} · {p.phone}</small></span></button>)}
      {!rows.length && <div className="none">Chưa có khách khớp “{q}”.</div>}</div>}
    <div className="sx-or">HOẶC</div>
    <button className="sx-opt" onClick={onWalk}><span className="ic"><PersonPinCircleOutlined style={{ fontSize: 28 }} /></span><span><b>Khách vãng lai</b><span>Bán hàng không cần hồ sơ khách</span></span></button>
    <button className="sx-opt" onClick={onCreate}><span className="ic g"><PersonAddAltRounded style={{ fontSize: 28 }} /></span><span><b>Thêm khách mới</b><span>Tạo hồ sơ khách ngay tại quầy</span></span></button>
  </div>;
}

/* ------------------------------------------------------------------ màn hoàn tất */
export function InvoiceCard({ inv, tip = 0 }) {
  const st = inv.status === 'paid' ? ['Hoàn tất', ''] : inv.status === 'partial' ? ['Còn nợ', 'warn'] : inv.status === 'void' ? ['Đã hủy', 'bad'] : ['Chưa thanh toán', 'warn'];
  const walk = inv.patient_code === 'KHACHLE'; const byMethod = {};
  (inv.payments || []).forEach((p) => { byMethod[p.method_label] = (byMethod[p.method_label] || 0) + p.amount; });
  const lines = inv.items.filter((i) => !(tip && i.name === 'Tiền tip'));
  return <div className="sx-inv">
    <header><h3>Hóa đơn #{inv.code}</h3><span className={`st ${st[1]}`}>{st[0]}</span></header>
    <div className="meta" style={{ textAlign: 'center' }}>{fmtDate(inv.created_at)}<br />Xuất cho {walk ? 'khách vãng lai' : inv.patient_name}</div>
    <table><thead><tr><th>Mục</th><th>Thành tiền</th></tr></thead>
      <tbody>{lines.map((i) => <tr key={i.id}><td><b>{i.name}</b><small>với {inv.created_by_name}</small></td><td>{i.quantity}× {money(i.unit_price)}</td></tr>)}</tbody></table>
    <div className="rows">
      <div><span>Tạm tính</span><span>{money(inv.subtotal)}</span></div>
      <div><span>Giảm giá</span><span>{money(inv.discount)}</span></div>
      {tip > 0 && <div><span>Tiền tip</span><span>{money(tip)}</span></div>}
      <div><span>Thuế</span><span>0đ</span></div>
      {Object.entries(byMethod).map(([m, a]) => <div key={m}><span>{m}</span><span>{money(a)}</span></div>)}
      {inv.balance > 0 && <div className="debt"><span>Còn nợ</span><span>{money(inv.balance)}</span></div>}
    </div>
    <div className="grand"><span>Tổng cộng</span><span>{money(inv.total)}</span></div>
  </div>;
}

function DoneScreen({ done, onNew, onClose, onNext, onPay, onPlans }) {
  const { inv, tip, client } = done; const walk = isWalk(client); const paid = inv.status === 'paid'; const first = walk ? '' : (client.full_name || '').split(' ').slice(-1)[0];
  const msg = `Hóa đơn ${inv.code} - ${money(inv.total)} tại ${CLINIC_NAME}.`;
  return <div className="sx-done">
    <button className="cls" onClick={onClose} aria-label="Đóng"><CloseRounded /></button>
    <div className="sx-done-l">
      <span className={`sx-ok ${paid ? '' : 'warn'}`}>{paid ? <CheckRounded /> : <HistoryRounded />}</span>
      <h2>{paid ? 'Đã thanh toán đủ.' : 'Đã lưu hóa đơn.'}</h2>
      <p>{paid ? `Cảm ơn${first ? `, ${first}` : ''} — hóa đơn đã sẵn sàng.` : `Còn nợ ${money(inv.balance)}. Có thể thu tiền bất cứ lúc nào.`}</p>
      <div className="big">{money(paid ? inv.total : inv.balance)}</div><div className="tot">{paid ? `Tổng ${money(inv.total)}` : 'Số tiền còn phải thu'}</div>
      {!paid && <button className="next" onClick={() => onPay(inv.id)}>Thu tiền ngay <ChevronRightRounded /></button>}
      {!walk && inv.items.some((i) => i.kind === 'package') && <button className="next" onClick={() => onPlans(client.id)}>Xem gói liệu trình <ChevronRightRounded /></button>}
      {paid && !walk && !inv.items.some((i) => i.kind === 'package') && <button className="next" onClick={onNext}>Đặt lịch hẹn tiếp theo <ChevronRightRounded /></button>}
      <button className="again" onClick={onNew}>Bắt đầu giao dịch mới</button>
    </div>
    <div className="sx-done-r">
      <InvoiceCard inv={inv} tip={tip} />
      <div className="sx-share">
        {!walk && client.email ? <a href={`mailto:${client.email}?subject=${encodeURIComponent(`Hóa đơn ${inv.code}`)}&body=${encodeURIComponent(msg)}`}><MailOutlineRounded />Email</a> : <button disabled title="Khách chưa có email"><MailOutlineRounded />Email</button>}
        {!walk && client.phone ? <a href={`sms:${client.phone}?&body=${encodeURIComponent(msg)}`}><SmsOutlined />SMS</a> : <button disabled title="Khách chưa có số điện thoại"><SmsOutlined />SMS</button>}
        <button onClick={() => printInvoice(inv)}><PrintRounded />In</button>
      </div>
      <Link to={`/hoa-don/${inv.id}`} style={{ color: 'var(--sx-pri)', fontWeight: 600, fontSize: 14 }}>Mở trang hóa đơn</Link>
    </div>
  </div>;
}

/* ------------------------------------------------------------------ Thu tiền cho hóa đơn có sẵn (Quick pay) */
export function AddPaymentPage() {
  const { id } = useParams(); const nav = useNavigate(); const { user } = useAuth();
  const l = useLoad(async () => (await api.get(`/clinic/invoices/${id}/`)).data, [id]);
  const inv = l.data; const seller = user?.full_name || user?.username || '';
  const [lines, setLines] = useState([]); const [banner, setBanner] = useState(true); const [menu, setMenu] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => { const h = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenu(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  if (!inv) return <div className="sx"><header className="sx-top"><h1>Thêm thanh toán</h1></header>{l.error ? <div className="sx-err" style={{ margin: 20 }}>{l.error}</div> : <Loading />}</div>;
  const walk = inv.patient_code === 'KHACHLE'; const client = walk ? WALK : { full_name: inv.patient_name, phone: inv.patient_phone, code: inv.patient_code };
  const balance = inv.balance; const paid = lines.reduce((s, x) => s + (Number(x.amount) || 0), 0); const due = Math.max(balance - paid, 0); const over = paid > balance;
  const confirm = async () => {
    setErr(''); setBusy(true);
    const rest = [...lines];
    try { while (rest.length) { const x = rest[0]; await api.post(`/clinic/invoices/${id}/pay/`, { amount: Number(x.amount), method: x.method, reference: x.reference }); rest.shift(); } nav(`/hoa-don/${id}?tab=payments`, { replace: true }); }
    catch (e) { setErr(errMsg(e)); setLines(rest); l.reload(true); } finally { setBusy(false); }
  };
  const blocked = inv.status === 'void' || balance <= 0;
  return <div className="sx" role="application">
    <header className="sx-top"><button onClick={() => nav(-1)} aria-label="Quay lại"><ChevronRightRounded style={{ transform: 'scaleX(-1)' }} /></button><h1>Thêm thanh toán cho hóa đơn #{inv.code}</h1></header>
    <div className="sx-body">
      <div className="sx-main">{blocked ? <div className="sx-empty" style={{ padding: 60, textAlign: 'center' }}><b>{inv.status === 'void' ? 'Hóa đơn đã hủy.' : 'Hóa đơn đã thanh toán đủ.'}</b><div style={{ marginTop: 12 }}><Link to={`/hoa-don/${id}`}>Mở trang hóa đơn</Link></div></div>
        : <PayArea due={due} lines={lines} setLines={setLines} banner={banner} onBanner={() => setBanner(false)} />}</div>
      <aside className="sx-side">
        <ClientHead client={client} debt={0} />
        <LocationBox locked client={client} seller={seller} />
        <div className="sx-cart"><CartList items={inv.items} seller={inv.created_by_name || seller} readOnly /></div>
        <div className="sx-foot">
          {err && <div className="sx-err">{err}</div>}
          <div className="sx-sum"><div><span>Tạm tính ({inv.items.reduce((s, i) => s + i.quantity, 0)} mục)</span><b>{money(inv.subtotal)}</b></div>
            {inv.discount > 0 && <div><span>Giảm giá</span><b>-{money(inv.discount)}</b></div>}<div><span>Thuế (đã gồm trong giá)</span><b>0đ</b></div>
            <div><span>Tổng hóa đơn</span><b>{money(inv.total)}</b></div>{inv.paid > 0 && <div><span>Đã thu trước đó</span><b>{money(inv.paid)}</b></div>}</div>
          {lines.length ? <>
            <div className={`sx-total ${due ? '' : 'paid'}`}><span>{due ? 'Đã nhận một phần' : 'Đã thanh toán đủ'}</span><em>{money(over ? balance : paid)}</em></div>
            <PayList lines={lines} setLines={setLines} />
            <div className={`sx-due ${due ? 'bad' : 'ok'}`}><span>Còn lại</span><span>{over ? `Vượt ${money(paid - balance)}` : money(due)}</span></div></>
            : <div className="sx-total"><span style={{ color: 'var(--sx-red)' }}>Cần thu</span><em style={{ color: 'var(--sx-red)' }}>{money(balance)}</em></div>}
          <div className="sx-actions" ref={menuRef}>
            <button className="more" aria-label="Thêm tùy chọn" onClick={() => setMenu(!menu)}><MoreHorizRounded /></button>
            {menu && <div className="sx-menu"><button onClick={() => printInvoice(inv)}><PrintRounded fontSize="small" />In hóa đơn</button><button onClick={() => nav(`/hoa-don/${id}`)}><NotesRounded fontSize="small" />Mở trang hóa đơn</button></div>}
            <button className="clear" onClick={() => { setLines([]); setErr(''); }}><DeleteOutlineRounded fontSize="small" />Xóa</button>
            {lines.length ? <button className="go green" disabled={busy || over || paid <= 0 || blocked} onClick={confirm}>{busy ? 'Đang xử lý…' : 'Xác nhận'}</button>
              : <button className="go" onClick={() => nav(`/hoa-don/${id}`)}>Lưu chưa thanh toán</button>}
          </div>
        </div>
      </aside>
    </div>
  </div>;
}


/* ------------------------------------------------------------------ gói tùy chỉnh (bán một lần) + quản lý gói mẫu */
function CustomPackageModal({ open, onClose, onAdd }) {
  const [f, setF] = useState({ name: '', total_sessions: 5, interval_days: 14, validity_months: 12, price: '' });
  useEffect(() => { if (open) setF({ name: '', total_sessions: 5, interval_days: 14, validity_months: 12, price: '' }); }, [open]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ok = f.name.trim() && Number(f.total_sessions) >= 1 && Number(f.total_sessions) <= 60 && f.price !== '' && Number(f.price) >= 0;
  return <Modal open={open} title="Gói liệu trình tùy chỉnh" subtitle="Chỉ áp dụng cho lần bán này, không lưu vào danh sách gói mẫu." onClose={onClose}
    footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={!ok} onClick={() => onAdd({ kind: 'package', name: f.name.trim(), unit_price: Number(f.price), quantity: 1, sessions: Number(f.total_sessions),
      package: { total_sessions: Number(f.total_sessions), interval_days: Number(f.interval_days) || 0, validity_months: Number(f.validity_months) || 0 } })}>Thêm vào giỏ</Btn></>}>
    <div className="cl-form-grid">
      <label className="cl-field" style={{ gridColumn: '1/-1' }}><span>Tên gói</span><input autoFocus value={f.name} onChange={set('name')} placeholder="VD: Gói trị nám 6 buổi" /></label>
      <label className="cl-field"><span>Số buổi</span><input type="number" min={1} max={60} value={f.total_sessions} onChange={set('total_sessions')} /></label>
      <label className="cl-field"><span>Cách nhau (ngày)</span><input type="number" min={0} value={f.interval_days} onChange={set('interval_days')} /></label>
      <label className="cl-field"><span>Hiệu lực (tháng, 0 = không giới hạn)</span><input type="number" min={0} max={60} value={f.validity_months} onChange={set('validity_months')} /></label>
      <label className="cl-field"><span>Giá trọn gói (đ)</span><input type="number" min={0} step={50000} value={f.price} onChange={set('price')} /></label>
    </div>
  </Modal>;
}

function PackageManager({ onClose, onChanged }) {
  const l = useLoad(async () => arr((await api.get('/clinic/package-templates/', { params: { all: 1 } })).data), []);
  const services = useLoad(async () => arr((await api.get('/services/')).data).filter((s) => s.is_active), []);
  const blank = { id: null, name: '', service: '', total_sessions: 5, interval_days: 14, validity_months: 12, price: '', is_active: true };
  const [f, setF] = useState(blank); const [err, setErr] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const pickSvc = (e) => { const sv = (services.data || []).find((x) => String(x.id) === e.target.value); setF((x) => ({ ...x, service: e.target.value, name: x.name || (sv ? `Liệu trình ${sv.name}` : ''), price: x.price === '' && sv ? sv.price * Number(x.total_sessions || 1) : x.price })); };
  const save = async (body, id) => { setErr(''); try { if (id) await api.patch(`/clinic/package-templates/${id}/`, body); else await api.post('/clinic/package-templates/', body); setF(blank); await l.reload(true); onChanged(); } catch (e) { setErr(errMsg(e)); } };
  const submit = () => save({ name: f.name, service: f.service || null, total_sessions: Number(f.total_sessions), interval_days: Number(f.interval_days) || 0, validity_months: Number(f.validity_months) || 0, price: Number(f.price) || 0, is_active: f.is_active }, f.id);
  return <Modal open wide title="Quản lý gói liệu trình mẫu" subtitle="Gói mẫu hiện ở tab “Liệu trình” khi bán hàng. Gói đã bán không bị ảnh hưởng khi bạn sửa hoặc ngừng bán." onClose={onClose} footer={<Btn onClick={onClose}>Đóng</Btn>}>
    {err && <div className="cl-alert error">{err}</div>}
    <div className="cl-table-wrap" style={{ maxHeight: 240, overflow: 'auto', marginBottom: 14 }}><table className="cl-table"><thead><tr><th>Tên gói</th><th>Buổi</th><th>Hiệu lực</th><th>Giá</th><th>Trạng thái</th><th /></tr></thead>
      <tbody>{(l.data || []).map((t) => <tr key={t.id}><td><b>{t.name}</b></td><td>{t.total_sessions}</td><td>{t.validity_months ? `${t.validity_months} tháng` : 'Không giới hạn'}</td><td>{money(t.price)}</td><td>{t.is_active ? 'Đang bán' : 'Ngừng bán'}</td>
        <td style={{ whiteSpace: 'nowrap' }}><button className="cl-link" onClick={() => setF({ ...t, service: t.service || '' })}>Sửa</button> · <button className="cl-link" onClick={() => save({ is_active: !t.is_active }, t.id)}>{t.is_active ? 'Ngừng bán' : 'Bán lại'}</button></td></tr>)}
        {l.data && !l.data.length && <tr><td colSpan={6} style={{ textAlign: 'center', padding: 18 }}>Chưa có gói mẫu nào.</td></tr>}</tbody></table></div>
    <div className="cl-form-grid">
      <label className="cl-field" style={{ gridColumn: '1/-1' }}><span>{f.id ? 'Sửa gói' : 'Thêm gói mới'} — dịch vụ áp dụng (không bắt buộc)</span><select value={f.service || ''} onChange={pickSvc}><option value="">— Không gắn dịch vụ —</option>{(services.data || []).map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}</select></label>
      <label className="cl-field" style={{ gridColumn: '1/-1' }}><span>Tên gói</span><input value={f.name} onChange={set('name')} placeholder="VD: Liệu trình peel trị mụn 5 buổi" /></label>
      <label className="cl-field"><span>Số buổi</span><input type="number" min={1} max={60} value={f.total_sessions} onChange={set('total_sessions')} /></label>
      <label className="cl-field"><span>Cách nhau (ngày)</span><input type="number" min={0} value={f.interval_days} onChange={set('interval_days')} /></label>
      <label className="cl-field"><span>Hiệu lực (tháng, 0 = không giới hạn)</span><input type="number" min={0} max={60} value={f.validity_months} onChange={set('validity_months')} /></label>
      <label className="cl-field"><span>Giá trọn gói (đ)</span><input type="number" min={0} step={50000} value={f.price} onChange={set('price')} /></label>
    </div>
    <div style={{ display: 'flex', gap: 10, marginTop: 14 }}><Btn kind="primary" disabled={!f.name.trim() || f.price === ''} onClick={submit}>{f.id ? 'Lưu gói' : 'Thêm gói'}</Btn>{f.id && <Btn onClick={() => setF(blank)}>Hủy sửa</Btn>}</div>
  </Modal>;
}
