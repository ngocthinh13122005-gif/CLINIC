import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import AddRounded from '@mui/icons-material/AddRounded';
import BlockRounded from '@mui/icons-material/BlockRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import PrintRounded from '@mui/icons-material/PrintRounded';
import ReceiptLongOutlined from '@mui/icons-material/ReceiptLongOutlined';
import ShareOutlined from '@mui/icons-material/ShareOutlined';
import VisibilityOutlined from '@mui/icons-material/VisibilityOutlined';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { MedPicker, useMedicines } from './Prescription';
import { printInvoice } from './Billing';
import { Loading, errMsg, fmtDate, fmtTime, money, useLoad, useToast } from './ui';
import './sale.css';

const TONE = { paid: '', partial: 'amber', unpaid: 'red', void: 'gray' };
const EINV = { none: ['gray', 'Không xuất HĐĐT'], requested: ['amber', 'Khách yêu cầu xuất HĐĐT'], issued: ['', 'Đã xuất HĐĐT'] };
const CLINIC_NAME = 'Phòng khám Da liễu OHIO';
const sig = (rows) => JSON.stringify(rows.map((i) => [i.kind, i.name, i.medicine || null, i.service || null, Number(i.quantity), Number(i.unit_price)]));

export default function InvoiceEditPage() {
  const { id } = useParams(); const [sp, setSp] = useSearchParams(); const nav = useNavigate(); const { user } = useAuth();
  const canBill = ['manager', 'consultant'].includes(user.role);
  const l = useLoad(async () => (await api.get(`/clinic/invoices/${id}/`)).data, [id]);
  const meds = useMedicines();
  const services = useLoad(async () => { const { data } = await api.get('/services/'); return data.results || data; }, []);
  const [toast, toastNode] = useToast();
  const inv = l.data;
  const tab = ['details', 'items', 'payments'].includes(sp.get('tab')) ? sp.get('tab') : 'details';
  const setTab = (t) => setSp(t === 'details' ? {} : { tab: t }, { replace: true });
  const [items, setItems] = useState([]); const [discount, setDiscount] = useState(0); const [note, setNote] = useState('');
  const [buyer, setBuyer] = useState({ buyer_name: '', buyer_tax_code: '', buyer_address: '', buyer_email: '', request: false });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [menu, setMenu] = useState(false);
  const menuRef = useRef(null);
  useEffect(() => { const h = (e) => menuRef.current && !menuRef.current.contains(e.target) && setMenu(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, []);
  useEffect(() => {
    if (!inv) return;
    setItems(inv.items.map((i) => ({ ...i }))); setDiscount(inv.discount); setNote(inv.note || '');
    setBuyer({ buyer_name: inv.buyer_name || '', buyer_tax_code: inv.buyer_tax_code || '', buyer_address: inv.buyer_address || '', buyer_email: inv.buyer_email || '', request: inv.einvoice_status === 'requested' });
  }, [inv]);

  const isVoid = inv?.status === 'void'; const hasPay = !!inv?.payments?.length; const issued = inv?.einvoice_status === 'issued';
  const hasPackage = inv?.items?.some((item) => item.kind === 'package');
  const lockItems = !canBill || isVoid || hasPay || hasPackage; const lockAll = !canBill || isVoid;
  const dirty = useMemo(() => {
    if (!inv) return false;
    const by = buyer.buyer_name !== (inv.buyer_name || '') || buyer.buyer_tax_code !== (inv.buyer_tax_code || '') || buyer.buyer_address !== (inv.buyer_address || '') || buyer.buyer_email !== (inv.buyer_email || '') || buyer.request !== (inv.einvoice_status === 'requested');
    return sig(inv.items) !== sig(items) || Number(discount) !== inv.discount || note !== (inv.note || '') || (by && !issued);
  }, [inv, items, discount, note, buyer, issued]);

  const svcList = (services.data || []).filter((s) => s.is_active);
  const upd = (i, p) => setItems((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const sub = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const total = Math.max(sub - Math.min(Number(discount) || 0, sub), 0);

  if (!inv) return <div className="sx-edit"><header className="sx-edit-head"><button className="bk" onClick={() => nav(-1)} aria-label="Quay lại"><ChevronRightRounded style={{ transform: 'scaleX(-1)' }} /></button><h1>Sửa hóa đơn</h1></header>{l.error ? <div className="sx-err">{l.error}</div> : <Loading />}</div>;

  const walk = inv.patient_code === 'KHACHLE';
  const save = async () => {
    setErr(''); setBusy(true);
    try {
      const body = { discount: Number(discount) || 0, note };
      if (!lockItems) body.items = items.map((i) => ({ kind: i.kind, name: i.name, medicine: i.medicine || null, service: i.service || null, quantity: Number(i.quantity), unit_price: Number(i.unit_price) }));
      await api.patch(`/clinic/invoices/${id}/`, body);
      if (!issued && !isVoid) await api.post(`/clinic/invoices/${id}/buyer/`, buyer);
      await l.reload(true); toast('Đã lưu hóa đơn.');
    } catch (e) { setErr(errMsg(e)); } finally { setBusy(false); }
  };
  const voidIt = async () => {
    const reason = window.prompt('Lý do hủy hóa đơn (tối thiểu 5 ký tự):'); if (!reason) return;
    try { await api.post(`/clinic/invoices/${id}/void/`, { reason }); await l.reload(true); toast('Đã hủy hóa đơn.'); } catch (e) { setErr(errMsg(e)); }
  };
  const share = () => { navigator.clipboard?.writeText(`Hóa đơn ${inv.code} — ${money(inv.total)} — ${CLINIC_NAME}`).then(() => toast('Đã sao chép thông tin hóa đơn.'), () => toast('Không sao chép được.', 'err')); };
  const e = EINV[inv.einvoice_status] || EINV.none;

  return <div className="sx-edit">
    <header className="sx-edit-head">
      <button className="bk" onClick={() => nav(-1)} aria-label="Quay lại"><ChevronRightRounded style={{ transform: 'scaleX(-1)' }} /></button>
      <div><h1>{canBill ? 'Sửa hóa đơn' : 'Hóa đơn'} #{inv.code}</h1>
        <div className="pills"><span className={`sx-pillx ${e[0]}`}><i />{e[1]}</span><span className={`sx-pillx ${TONE[inv.status]}`}>{inv.status_label}</span></div></div>
      <span className="sp" />
      <button className="sx-hbtn" onClick={() => printInvoice(inv)}><VisibilityOutlined fontSize="small" />Xem trước</button>
      <button className="sx-hbtn round" onClick={share} aria-label="Sao chép thông tin"><ShareOutlined fontSize="small" /></button>
      <div ref={menuRef} style={{ position: 'relative' }}>
        <button className="sx-hbtn" onClick={() => setMenu(!menu)}>Tùy chọn<ExpandMoreRounded fontSize="small" /></button>
        {menu && <div className="sx-pop">
          <button onClick={() => { setMenu(false); printInvoice(inv); }}><PrintRounded fontSize="small" />In hóa đơn</button>
          {inv.balance > 0 && !isVoid && canBill && <button onClick={() => nav(`/ban-hang/thu-tien/${id}`)}><ReceiptLongOutlined fontSize="small" />Thu tiền</button>}
          {user.role === 'manager' && !isVoid && !hasPay && <button className="dng" onClick={() => { setMenu(false); voidIt(); }}><BlockRounded fontSize="small" />Hủy hóa đơn</button>}
        </div>}
      </div>
      {canBill && <button className="sx-hbtn pri" disabled={busy || !dirty || isVoid || (!lockItems && !items.length)} onClick={save}>{busy ? 'Đang lưu…' : 'Lưu thay đổi'}</button>}
    </header>
    {err && <div className="sx-err">{err}</div>}
    <nav className="sx-edit-tabs">
      <button className={tab === 'details' ? 'on' : ''} onClick={() => setTab('details')}>Chi tiết</button>
      <button className={tab === 'items' ? 'on' : ''} onClick={() => setTab('items')}>Mặt hàng <i>{inv.items.length}</i></button>
      <button className={tab === 'payments' ? 'on' : ''} onClick={() => setTab('payments')}>Thanh toán <i>{money(inv.paid)}</i></button>
    </nav>

    <div className="sx-edit-body">
      {tab === 'details' && <section className="sx-panel"><header><h2>Chi tiết hóa đơn</h2></header>
        <div className="sx-form">
          <label>Khách hàng<span className="val">{walk ? 'Khách vãng lai' : <Link to={`/benh-nhan/${inv.patient}`}>{inv.patient_name}</Link>}</span></label>
          <label>Cơ sở<span className="val">{CLINIC_NAME}</span></label>
          <label>Ngày lập<span className="val">{fmtDate(inv.created_at)} {fmtTime(inv.created_at)}</span></label>
          <label>Người lập<span className="val">{inv.created_by_name || '—'}</span></label>
          <label>Giảm giá (đ)<input type="number" min={0} step={1000} disabled={lockAll} value={discount} onChange={(x) => setDiscount(x.target.value)} /></label>
          <label>Tổng cộng<span className="val">{money(total)}</span></label>
          <label className="span">Ghi chú<textarea disabled={lockAll} value={note} maxLength={255} onChange={(x) => setNote(x.target.value)} /></label>
          <h3>Xuất hóa đơn điện tử</h3>
          {issued && <div className="sx-note span" style={{ gridColumn: '1/-1', margin: 0 }}>Đã xuất hóa đơn điện tử {inv.einvoice_symbol}-{inv.einvoice_no}. Không sửa được thông tin người mua; cần lập hóa đơn điều chỉnh trên hệ thống của nhà cung cấp.</div>}
          <label>Tên đơn vị / người mua<input disabled={lockAll || issued} value={buyer.buyer_name} onChange={(x) => setBuyer({ ...buyer, buyer_name: x.target.value })} /></label>
          <label>Mã số thuế<input disabled={lockAll || issued} placeholder="10 hoặc 13 số" value={buyer.buyer_tax_code} onChange={(x) => setBuyer({ ...buyer, buyer_tax_code: x.target.value })} /></label>
          <label>Email nhận hóa đơn<input disabled={lockAll || issued} value={buyer.buyer_email} onChange={(x) => setBuyer({ ...buyer, buyer_email: x.target.value })} /></label>
          <label>Địa chỉ<input disabled={lockAll || issued} value={buyer.buyer_address} onChange={(x) => setBuyer({ ...buyer, buyer_address: x.target.value })} /></label>
          <label className="chk span"><input type="checkbox" disabled={lockAll || issued} checked={buyer.request} onChange={(x) => setBuyer({ ...buyer, request: x.target.checked })} />Khách yêu cầu xuất hóa đơn điện tử</label>
          {inv.void_reason && <label className="span">Lý do hủy<span className="val">{inv.void_reason}</span></label>}
        </div></section>}

      {tab === 'items' && <section className="sx-panel"><header><h2>Mặt hàng</h2></header>
        {hasPackage && !isVoid && <div className="sx-note">Hóa đơn có gói liệu trình; không thể sửa các dòng hàng để bảo toàn giá trị gói và số buổi.</div>}
        {!hasPackage && hasPay && !isVoid && <div className="sx-note">Hóa đơn đã thu tiền nên không sửa được các dòng hàng.</div>}
        <table className="sx-pt"><thead><tr><th>Nội dung</th><th style={{ width: 90 }}>SL</th><th style={{ width: 150 }}>Đơn giá</th><th className="r" style={{ width: 150 }}>Thành tiền</th><th style={{ width: 44 }} /></tr></thead>
          <tbody>{items.map((it, i) => <tr key={it.id || `n${i}`}>
            <td><input disabled={lockItems} value={it.name} onChange={(x) => upd(i, { name: x.target.value })} /><small style={{ color: 'var(--sx-muted)' }}>{{ service: 'Dịch vụ', medicine: 'Sản phẩm / thuốc', package: 'Gói liệu trình', other: 'Khác' }[it.kind]}</small></td>
            <td><input type="number" min={1} disabled={lockItems} value={it.quantity} onChange={(x) => upd(i, { quantity: x.target.value })} /></td>
            <td><input type="number" min={0} step={1000} disabled={lockItems} value={it.unit_price} onChange={(x) => upd(i, { unit_price: x.target.value })} /></td>
            <td className="r"><b>{money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))}</b></td>
            <td className="acts">{!lockItems && <button aria-label="Xóa dòng" onClick={() => setItems((a) => a.filter((_, j) => j !== i))}><DeleteOutlineRounded fontSize="small" /></button>}</td></tr>)}
            {!items.length && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--sx-muted)' }}>Chưa có dòng nào.</td></tr>}</tbody></table>
        {!lockItems && <div className="sx-addbar">
          <select value="" onChange={(x) => { const s = svcList.find((v) => String(v.id) === x.target.value); if (s) setItems((a) => [...a, { kind: 'service', service: s.id, name: s.name, quantity: 1, unit_price: s.price }]); }}>
            <option value="">+ Thêm dịch vụ…</option>{svcList.map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}</select>
          <MedPicker meds={meds.data} placeholder="+ Thêm sản phẩm từ kho…" onPick={(m) => setItems((a) => (a.some((x) => x.medicine === m.id) ? a.map((x) => (x.medicine === m.id ? { ...x, quantity: Number(x.quantity) + 1 } : x)) : [...a, { kind: 'medicine', medicine: m.id, name: m.name, quantity: 1, unit_price: m.price }]))} />
          <button className="sx-hbtn" onClick={() => setItems((a) => [...a, { kind: 'other', name: '', quantity: 1, unit_price: 0 }])}><AddRounded fontSize="small" />Khoản khác</button></div>}
        <div className="sx-foot3"><div><span>Tạm tính</span><b>{money(sub)}</b></div><div><span>Giảm giá</span><b>-{money(Math.min(Number(discount) || 0, sub))}</b></div><div><span>Tổng hóa đơn</span><b>{money(total)}</b></div></div>
      </section>}

      {tab === 'payments' && <section className="sx-panel"><header><h2>Thanh toán</h2>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}><span className="wallet">{CLINIC_NAME}</span>
          {canBill && inv.balance > 0 && !isVoid && <button className="sx-hbtn pri" onClick={() => nav(`/ban-hang/thu-tien/${id}`)}><AddRounded fontSize="small" />Thêm thanh toán</button>}</div></header>
        <table className="sx-pt"><thead><tr><th>Người trả</th><th>Phương thức</th><th className="r">Số tiền</th><th>Ngày</th><th style={{ width: 60 }} /></tr></thead>
          <tbody>{inv.payments.map((p) => <tr key={p.id}>
            <td><span className="ro">{walk ? 'Khách vãng lai' : inv.patient_name}</span></td>
            <td><span className="ro">{p.method_label}{p.reference ? ` · ${p.reference}` : ''}</span></td>
            <td className="r"><b>{money(p.amount)}</b></td><td>{fmtDate(p.paid_at)} {fmtTime(p.paid_at)}</td>
            <td className="acts"><button aria-label="In hóa đơn" onClick={() => printInvoice(inv)}><PrintRounded fontSize="small" /></button></td></tr>)}
            {!inv.payments.length && <tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--sx-muted)', padding: 28 }}>Chưa có thanh toán nào.</td></tr>}</tbody></table>
        <div className="sx-foot3"><div><span>Còn nợ</span><b className={inv.balance && !isVoid ? 'r' : ''}>{isVoid ? '—' : money(inv.balance)}</b></div><div><span>Đã phân bổ</span><b className="g">{money(inv.paid)}</b></div><div><span>Tổng hóa đơn</span><b>{money(inv.total)}</b></div></div>
      </section>}
    </div>
    {toastNode}
  </div>;
}
