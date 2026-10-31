import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AddRounded from '@mui/icons-material/AddRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import PrintRounded from '@mui/icons-material/PrintRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { PatientPicker } from './PatientForm';
import { MedPicker, printHtml, useMedicines } from './Prescription';
import { Avatar, Btn, Card, Empty, Field, Loading, Modal, PageHead, Pill, errMsg, fmtDate, fmtDateTime, fmtTime, isoDay, money, useDebounce, useLoad, useToast } from './ui';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const invTone = { unpaid: 'red', partial: 'amber', paid: 'green', void: 'gray' };
const METHODS = [['cash', 'Tiền mặt'], ['transfer', 'Chuyển khoản'], ['card', 'Quẹt thẻ'], ['ewallet', 'Ví điện tử']];

export function printInvoice(inv) {
  printHtml(`Hóa đơn ${inv.code}`, `<h1>HÓA ĐƠN THANH TOÁN</h1><div class="sub">Số: ${inv.code} · ${fmtDateTime(inv.created_at)}</div>
  <div class="meta"><div><b>Khách hàng:</b> ${esc(inv.patient_name)}</div><div><b>Mã BN:</b> ${esc(inv.patient_code)}</div><div><b>SĐT:</b> ${esc(inv.patient_phone)}</div><div><b>Thu ngân:</b> ${esc(inv.created_by_name)}</div><div><b>Điều khoản:</b> ${esc(inv.payment_term_label)}</div><div><b>Ngày đến hạn:</b> ${fmtDate(inv.due_date)}</div></div>
  <table><tr><th>#</th><th>Nội dung</th><th class="r">SL</th><th class="r">Đơn giá</th><th class="r">Thành tiền</th></tr>
  ${inv.items.map((i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}</td><td class="r">${i.quantity}</td><td class="r">${money(i.unit_price)}</td><td class="r">${money(i.amount)}</td></tr>`).join('')}
  <tr><td colspan="4" class="r">Tạm tính</td><td class="r">${money(inv.subtotal)}</td></tr>${inv.discount ? `<tr><td colspan="4" class="r">Giảm giá</td><td class="r">-${money(inv.discount)}</td></tr>` : ''}
  <tr class="tot"><td colspan="4" class="r">Tổng cộng</td><td class="r">${money(inv.total)}</td></tr><tr><td colspan="4" class="r">Đã thanh toán ròng</td><td class="r">${money(inv.paid)}</td></tr>${inv.refunded_total ? `<tr><td colspan="4" class="r">Đã hoàn tiền</td><td class="r">${money(inv.refunded_total)}</td></tr>` : ''}
  <tr class="tot"><td colspan="4" class="r">Còn lại</td><td class="r">${money(inv.balance)}</td></tr></table>
  ${inv.payments.length ? `<h3>Lịch sử thanh toán</h3><table>${inv.payments.map((p) => `<tr><td>${fmtDateTime(p.paid_at)}</td><td>${p.method_label}${p.reference ? ' · ' + esc(p.reference) : ''}</td><td class="r">${money(p.amount)}</td></tr>`).join('')}</table>` : ''}
  <div class="sign"><b>Người lập</b><div style="height:46px"></div></div>`);
}

function InvoiceForm({ patient, visitId, invoice, onClose, onSaved }) {
  const meds = useMedicines();
  const services = useLoad(async () => (await api.get('/services/')).data, []);
  const [items, setItems] = useState([]);
  const [discount, setDiscount] = useState(0);
  const [note, setNote] = useState('');
  const [paymentTerm, setPaymentTerm] = useState('immediate');
  const [dueDate, setDueDate] = useState('');
  const [err, setErr] = useState('');
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      if (invoice) { setItems(invoice.items); setDiscount(invoice.discount); setNote(invoice.note); setPaymentTerm(invoice.payment_term || 'immediate'); setDueDate(invoice.due_date || ''); }
      else if (visitId) { try { const { data } = await api.get('/clinic/invoices/draft-from-visit/', { params: { visit: visitId } }); setItems(data.items); } catch (e) { setErr(errMsg(e)); } }
      setReady(true);
    })();
  }, [invoice, visitId]);
  const svcList = (services.data?.results || services.data || []).filter((s) => s.is_active);
  const upd = (i, p) => setItems((a) => a.map((x, j) => (j === i ? { ...x, ...p } : x)));
  const sub = items.reduce((s, i) => s + (Number(i.quantity) || 0) * (Number(i.unit_price) || 0), 0);
  const total = Math.max(sub - (Number(discount) || 0), 0);
  const submit = async () => {
    setErr('');
    const body = { items: items.map((i) => ({ kind: i.kind, name: i.name, medicine: i.medicine || null, service: i.service || null, quantity: Number(i.quantity), unit_price: Number(i.unit_price) })), discount: Number(discount) || 0, note, payment_term: paymentTerm, due_date: paymentTerm === 'custom' ? dueDate : null };
    try {
      const { data } = invoice ? await api.patch(`/clinic/invoices/${invoice.id}/`, body) : await api.post('/clinic/invoices/', { ...body, patient: patient.id, visit: visitId || null });
      onSaved(data);
    } catch (e) { setErr(errMsg(e)); }
  };
  return <Modal open wide title={invoice ? `Sửa hóa đơn ${invoice.code}` : 'Lập hóa đơn'} subtitle={patient?.full_name || invoice?.patient_name} onClose={onClose}
    footer={<><strong style={{ marginRight: 'auto' }}>Tổng: {money(total)}</strong><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={!items.length} onClick={submit}>{invoice ? 'Lưu hóa đơn' : 'Tạo hóa đơn'}</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    {!ready ? <Loading /> : <>
      <div className="cl-lines">{items.map((it, i) => <div className="cl-line" key={i}>
        <div><input value={it.name} onChange={(e) => upd(i, { name: e.target.value })} aria-label="Nội dung" /><small className="cl-muted">{{ service: 'Dịch vụ', medicine: 'Thuốc', other: 'Khác' }[it.kind]}</small></div>
        <input type="number" min={1} value={it.quantity} onChange={(e) => upd(i, { quantity: e.target.value })} aria-label="Số lượng" />
        <input type="number" min={0} step={1000} value={it.unit_price} onChange={(e) => upd(i, { unit_price: e.target.value })} aria-label="Đơn giá" />
        <b>{money((Number(it.quantity) || 0) * (Number(it.unit_price) || 0))}</b>
        <button className="cl-icon-btn" aria-label="Xóa dòng" onClick={() => setItems((a) => a.filter((_, j) => j !== i))}><DeleteOutlineRounded /></button></div>)}
        {!items.length && <small className="cl-muted">Chưa có dòng nào — thêm dịch vụ, thuốc hoặc khoản khác bên dưới.</small>}</div>
      <div className="cl-line-add">
        <select value="" onChange={(e) => { const s = svcList.find((x) => String(x.id) === e.target.value); if (s) setItems((a) => [...a, { kind: 'service', service: s.id, name: s.name, quantity: 1, unit_price: s.price }]); }}>
          <option value="">+ Thêm dịch vụ…</option>{svcList.map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}</select>
        <MedPicker meds={meds.data} placeholder="+ Thêm thuốc từ kho…" onPick={(m) => setItems((a) => (a.some((x) => x.medicine === m.id) ? a.map((x) => (x.medicine === m.id ? { ...x, quantity: Number(x.quantity) + 1 } : x)) : [...a, { kind: 'medicine', medicine: m.id, name: m.name, quantity: 1, unit_price: m.price }]))} />
        <Btn size="sm" icon={<AddRounded />} onClick={() => setItems((a) => [...a, { kind: 'other', name: '', quantity: 1, unit_price: 0 }])}>Khoản khác</Btn>
      </div>
      <div className="cl-form-grid" style={{ marginTop: 14 }}>
        <Field label="Giảm giá (VNĐ)"><input type="number" min={0} step={1000} value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
        <Field label="Ghi chú"><input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Field label="Điều khoản thanh toán"><select value={paymentTerm} onChange={(e) => setPaymentTerm(e.target.value)}><option value="immediate">Thanh toán ngay</option><option value="7d">Trong 7 ngày</option><option value="15d">Trong 15 ngày</option><option value="30d">Trong 30 ngày</option><option value="custom">Ngày tùy chỉnh</option></select></Field>
        {paymentTerm === 'custom' && <Field label="Ngày đến hạn"><input required type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Field>}
      </div></>}
  </Modal>;
}

function RefundDialog({ invoice, onClose, onSaved }) {
  const [amount, setAmount] = useState(invoice.paid || 0);
  const [method, setMethod] = useState('cash');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const submit = async () => {
    try { await api.post('/clinic/refunds/', { invoice: invoice.id, amount: Number(amount), method, reason }); onSaved(); }
    catch (e) { setError(errMsg(e)); }
  };
  return <Modal open title="Yêu cầu hoàn tiền" subtitle={`${invoice.code} · Đã thu ${money(invoice.paid)}`} onClose={onClose}
    footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={!Number(amount) || reason.trim().length < 5} onClick={submit}>Gửi phê duyệt</Btn></>}>
    {error && <div className="cl-alert error">{error}</div>}
    <div className="cl-form-grid"><Field label="Số tiền hoàn"><input type="number" min={1} max={invoice.paid} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
      <Field label="Hình thức hoàn"><select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></Field>
      <Field label="Lý do hoàn tiền" span="2"><textarea rows="3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Mô tả rõ lý do để quản lý phê duyệt…" /></Field></div>
  </Modal>;
}

function FollowUpDialog({ invoice, onClose, onSaved }) {
  const [form, setForm] = useState({ action: 'call', note: '', promised_date: '', next_follow_up: '' });
  const [error, setError] = useState('');
  const set = (key) => (event) => setForm((old) => ({ ...old, [key]: event.target.value }));
  const submit = async () => {
    try { await api.post('/clinic/debt-followups/', { invoice: invoice.id, ...form }); onSaved(); }
    catch (e) { setError(errMsg(e)); }
  };
  return <Modal open title="Ghi nhận chăm sóc công nợ" subtitle={`${invoice.patient_name} · Còn nợ ${money(invoice.balance)}`} onClose={onClose}
    footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={form.note.trim().length < 3} onClick={submit}>Lưu lịch sử</Btn></>}>
    {error && <div className="cl-alert error">{error}</div>}
    <div className="cl-form-grid"><Field label="Kênh liên hệ"><select value={form.action} onChange={set('action')}><option value="call">Gọi điện</option><option value="zalo">Zalo</option><option value="sms">SMS</option><option value="email">Email</option><option value="promise">Khách hẹn thanh toán</option><option value="note">Ghi chú nội bộ</option></select></Field>
      <Field label="Ngày khách hẹn trả"><input type="date" value={form.promised_date} onChange={set('promised_date')} /></Field>
      <Field label="Kết quả liên hệ" span="2"><textarea rows="3" value={form.note} onChange={set('note')} placeholder="Đã trao đổi gì với khách hàng?" /></Field>
      <Field label="Nhắc lại vào ngày"><input type="date" value={form.next_follow_up} onChange={set('next_follow_up')} /></Field></div>
  </Modal>;
}

export function InvoiceModal({ id, onClose, onChanged }) {
  const { user } = useAuth();
  const l = useLoad(async () => (await api.get(`/clinic/invoices/${id}/`)).data, [id]);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [ref, setRef] = useState('');
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState(false);
  const [buyer, setBuyer] = useState(null);
  const [refund, setRefund] = useState(false);
  const [followUp, setFollowUp] = useState(false);
  const inv = l.data;
  useEffect(() => { if (inv) setAmount(String(inv.balance || '')); }, [inv?.balance]); // eslint-disable-line react-hooks/exhaustive-deps
  const canBill = ['consultant', 'manager'].includes(user.role);
  const act = async (fn) => { setErr(''); try { await fn(); await l.reload(true); onChanged?.(); } catch (e) { setErr(errMsg(e)); } };
  const pay = () => act(() => api.post(`/clinic/invoices/${id}/pay/`, { amount: Number(amount), method, reference: ref }).then(() => setRef('')));
  const voidIt = () => { const reason = window.prompt('Lý do hủy hóa đơn (tối thiểu 5 ký tự):'); if (reason) act(() => api.post(`/clinic/invoices/${id}/void/`, { reason })); };
  const refundAction = (item, actionName) => act(() => api.post(`/clinic/refunds/${item.id}/${actionName}/`, {}));
  if (edit && inv) return <InvoiceForm invoice={inv} onClose={() => setEdit(false)} onSaved={() => { setEdit(false); l.reload(true); onChanged?.(); }} />;
  return <Modal open wide title={inv ? `Hóa đơn ${inv.code}` : 'Hóa đơn'} subtitle={inv && `${inv.patient_name} · ${inv.patient_code} · ${fmtDateTime(inv.created_at)}`} onClose={onClose}
    footer={inv && <><Btn icon={<PrintRounded />} onClick={() => printInvoice(inv)}>In hóa đơn</Btn>
      {canBill && inv.status !== 'void' && !inv.payments.length && <Btn onClick={() => setEdit(true)}>Sửa</Btn>}
      {user.role === 'manager' && inv.status !== 'void' && !inv.payments.length && <Btn onClick={voidIt}>Hủy hóa đơn</Btn>}</>}>
    {!inv ? <Loading /> : <>
      {err && <div className="cl-alert error">{err}</div>}
      <div className="cl-inv-head"><Pill tone={invTone[inv.status]} dot>{inv.status_label}</Pill>{inv.void_reason && <small className="cl-muted">Lý do hủy: {inv.void_reason}</small>}</div>
      {inv.status !== 'void' && <div className={`cl-due-strip ${inv.due_status}`}><span><b>Điều khoản:</b> {inv.payment_term_label}</span><span><b>Đến hạn:</b> {fmtDate(inv.due_date)}</span>{inv.due_status === 'overdue' && <Pill tone="red">Quá hạn {inv.overdue_days} ngày</Pill>}</div>}
      <div className="cl-einv">
        <div><b>Hóa đơn điện tử:</b> {inv.einvoice_status === 'issued' ? <Pill tone="green" dot>Đã xuất · {inv.einvoice_symbol}-{inv.einvoice_no}</Pill> : inv.einvoice_status === 'requested' ? <Pill tone="amber" dot>Khách yêu cầu xuất</Pill> : <Pill tone="gray">Không xuất</Pill>}
          {inv.buyer_tax_code && <small className="cl-muted"> · {inv.buyer_name} · MST {inv.buyer_tax_code}</small>}</div>
        {canBill && inv.status !== 'void' && inv.einvoice_status !== 'issued' && <button className="cl-link" onClick={() => setBuyer({ buyer_name: inv.buyer_name, buyer_tax_code: inv.buyer_tax_code, buyer_address: inv.buyer_address, buyer_email: inv.buyer_email, request: inv.einvoice_status === 'requested' })}>Thông tin xuất hóa đơn</button>}
      </div>
      <table className="cl-table" style={{ minWidth: 0 }}><thead><tr><th>Nội dung</th><th>SL</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead>
        <tbody>{inv.items.map((i) => <tr key={i.id}><td>{i.name}</td><td>{i.quantity}</td><td>{money(i.unit_price)}</td><td>{money(i.amount)}</td></tr>)}</tbody></table>
      <dl className="cl-inv-sum"><div><dt>Tạm tính</dt><dd>{money(inv.subtotal)}</dd></div>{inv.discount > 0 && <div><dt>Giảm giá</dt><dd>-{money(inv.discount)}</dd></div>}
        <div className="big"><dt>Tổng cộng</dt><dd>{money(inv.total)}</dd></div><div><dt>Đã thu ròng</dt><dd>{money(inv.paid)}</dd></div>{inv.refunded > 0 && <div><dt>Đã hoàn</dt><dd>-{money(inv.refunded)}</dd></div>}<div className={`big ${inv.balance ? 'debt' : ''}`}><dt>Còn lại</dt><dd>{money(inv.balance)}</dd></div></dl>
      {!!inv.payments.length && <><h3 className="cl-h3">Lịch sử thanh toán</h3><ul className="cl-pay-list">{inv.payments.map((p) => <li key={p.id}><span>{fmtDateTime(p.paid_at)} · {p.method_label}{p.reference ? ` · ${p.reference}` : ''}<small>{p.received_by_name} · {p.reconciliation_status === 'reconciled' ? 'Đã đối soát' : 'Chờ đối soát'}</small></span><b>{money(p.amount)}</b></li>)}</ul></>}
      {!!inv.refunds.length && <><h3 className="cl-h3">Hoàn tiền / điều chỉnh</h3><div className="cl-refund-list">{inv.refunds.map((item) => <article key={item.id}><div><strong>{money(item.amount)} · {item.method_label}</strong><small>{item.reason} · {item.status_label}</small></div><div>{user.role === 'manager' && item.status === 'pending' && <><Btn size="sm" onClick={() => refundAction(item, 'reject')}>Từ chối</Btn><Btn size="sm" kind="primary" onClick={() => refundAction(item, 'approve')}>Duyệt</Btn></>}{canBill && item.status === 'approved' && <Btn size="sm" kind="primary" onClick={() => refundAction(item, 'complete')}>Xác nhận đã hoàn</Btn>}</div></article>)}</div></>}
      {canBill && inv.status !== 'void' && inv.paid > 0 && <div className="cl-actions-row"><Btn onClick={() => setRefund(true)}>Yêu cầu hoàn tiền</Btn></div>}
      {canBill && inv.status !== 'void' && inv.balance > 0 && <div className="cl-pay-box"><h3 className="cl-h3">Thu tiền</h3>
        <div className="cl-form-grid">
          <Field label="Số tiền (VNĐ)"><input type="number" min={1} max={inv.balance} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <Field label="Hình thức"><select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
          {method !== 'cash' && <Field label="Mã giao dịch" span="2"><input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>}
        </div>
        <div className="cl-actions-row"><Btn onClick={() => setAmount(String(inv.balance))}>Thu đủ {money(inv.balance)}</Btn><span style={{ flex: 1 }} /><Btn kind="primary" disabled={!Number(amount)} onClick={pay}>Xác nhận thu</Btn></div></div>}
      {inv.status !== 'void' && inv.balance > 0 && <div className="cl-followup"><div className="cl-section-inline"><div><h3 className="cl-h3">Chăm sóc công nợ</h3><small>Ghi lại lịch sử liên hệ và ngày khách cam kết thanh toán.</small></div>{canBill && <Btn size="sm" onClick={() => setFollowUp(true)}>Thêm lịch sử</Btn>}</div>
        {inv.followups.length ? <ul>{inv.followups.map((item) => <li key={item.id}><span><b>{item.action_label}</b> · {item.note}<small>{fmtDateTime(item.created_at)} · {item.created_by_name}{item.promised_date ? ` · Hẹn trả ${fmtDate(item.promised_date)}` : ''}{item.next_follow_up ? ` · Nhắc lại ${fmtDate(item.next_follow_up)}` : ''}</small></span></li>)}</ul> : <p>Chưa có lịch sử chăm sóc công nợ.</p>}</div>}
    </>}
    {buyer && <Modal open title="Thông tin xuất hóa đơn điện tử" subtitle="Dùng khi khách yêu cầu hóa đơn có mã số thuế. Hóa đơn điện tử phải được phát hành bằng phần mềm của nhà cung cấp hóa đơn điện tử." onClose={() => setBuyer(null)}
      footer={<><Btn onClick={() => setBuyer(null)}>Hủy</Btn><Btn kind="primary" onClick={() => act(async () => { await api.post(`/clinic/invoices/${id}/buyer/`, buyer); setBuyer(null); })}>Lưu</Btn></>}>
      <div className="cl-form-grid"><Field label="Tên đơn vị / người mua" span="2"><input value={buyer.buyer_name} onChange={(e) => setBuyer({ ...buyer, buyer_name: e.target.value })} /></Field>
        <Field label="Mã số thuế"><input value={buyer.buyer_tax_code} onChange={(e) => setBuyer({ ...buyer, buyer_tax_code: e.target.value })} placeholder="10 hoặc 13 số" /></Field>
        <Field label="Email nhận hóa đơn"><input value={buyer.buyer_email} onChange={(e) => setBuyer({ ...buyer, buyer_email: e.target.value })} /></Field>
        <Field label="Địa chỉ" span="2"><input value={buyer.buyer_address} onChange={(e) => setBuyer({ ...buyer, buyer_address: e.target.value })} /></Field>
        <label className="cl-check cl-field span2"><input type="checkbox" checked={buyer.request} onChange={(e) => setBuyer({ ...buyer, request: e.target.checked })} /> Khách yêu cầu xuất hóa đơn điện tử</label></div></Modal>}
    {refund && <RefundDialog invoice={inv} onClose={() => setRefund(false)} onSaved={() => { setRefund(false); l.reload(true); onChanged?.(); }} />}
    {followUp && <FollowUpDialog invoice={inv} onClose={() => setFollowUp(false)} onSaved={() => { setFollowUp(false); l.reload(true); onChanged?.(); }} />}
  </Modal>;
}

function ShiftPanel({ user, notify }) {
  const current = useLoad(async () => (await api.get('/clinic/cashier-shifts/current/')).data, []);
  const shifts = useLoad(async () => (await api.get('/clinic/cashier-shifts/')).data, []);
  const pending = useLoad(async () => (await api.get('/clinic/payments/', { params: { reconciliation: 'pending' } })).data, []);
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState('');
  const refresh = () => { current.reload(true); shifts.reload(true); pending.reload(true); };
  const openShift = async () => {
    try { await api.post('/clinic/cashier-shifts/open/', { opening_cash: Number(dialog.opening_cash) || 0 }); setDialog(null); refresh(); notify('Đã mở ca thu ngân.'); }
    catch (e) { setError(errMsg(e)); }
  };
  const closeShift = async () => {
    try { await api.post(`/clinic/cashier-shifts/${current.data.id}/close/`, { counted_cash: Number(dialog.counted_cash) || 0, note: dialog.note }); setDialog(null); refresh(); notify('Đã đóng và đối soát ca thu ngân.'); }
    catch (e) { setError(errMsg(e)); }
  };
  const reconcile = async (payment) => {
    try { await api.post(`/clinic/payments/${payment.id}/reconcile/`, {}); pending.reload(true); notify(`Đã đối soát ${payment.invoice_code}.`); }
    catch (e) { notify(errMsg(e)); }
  };
  const active = current.data;
  const rows = shifts.data?.results || shifts.data || [];
  const paymentRows = pending.data?.results || pending.data || [];
  const visiblePayments = paymentRows.slice(0, 20);
  return <>
    <div className="cl-shift-head">
      <div><span>CA THU NGÂN HIỆN TẠI</span>{active ? <><strong>Đang mở từ {fmtDateTime(active.opened_at)}</strong><small>Thu ngân: {active.cashier_name}</small></> : <><strong>Chưa mở ca</strong><small>Mở ca trước khi nhận hoặc hoàn tiền mặt.</small></>}</div>
      {active ? <Btn kind="primary" onClick={() => { setError(''); setDialog({ type: 'close', counted_cash: active.current_expected, note: '' }); }}>Đóng ca</Btn> : <Btn kind="primary" onClick={() => { setError(''); setDialog({ type: 'open', opening_cash: 0 }); }}>Mở ca thu ngân</Btn>}
    </div>
    {active && <div className="cl-shift-kpis"><article><span>Tiền đầu ca</span><strong>{money(active.opening_cash)}</strong></article><article><span>Tiền mặt đã thu</span><strong>{money(active.cash_received)}</strong></article><article><span>Tiền mặt đã hoàn</span><strong>{money(active.cash_refunded)}</strong></article><article><span>Tồn quỹ hệ thống</span><strong>{money(active.current_expected)}</strong></article></div>}
    <div className="cl-two cl-billing-ops">
      <Card title="Khoản thu chờ đối soát" subtitle={paymentRows.length > 20 ? `Hiển thị 20 khoản gần nhất trong ${paymentRows.length} khoản chờ.` : 'Chuyển khoản, thẻ và ví cần khớp với sao kê; tiền mặt được khớp khi đóng ca.'} pad={false}>
        {paymentRows.length ? <div className="cl-table-wrap"><table className="cl-table"><thead><tr><th>Hóa đơn</th><th>Khách hàng</th><th>Phương thức</th><th>Số tiền</th><th>Thời gian</th><th /></tr></thead><tbody>{visiblePayments.map((item) => <tr key={item.id}><td><b>{item.invoice_code}</b></td><td>{item.patient_name}</td><td>{item.method_label}<small className="cl-sub">{item.reference || 'Chưa có mã GD'}</small></td><td><b>{money(item.amount)}</b></td><td>{fmtDateTime(item.paid_at)}</td><td>{user.role === 'manager' && item.method !== 'cash' ? <button className="cl-link" onClick={() => reconcile(item)}>Đối soát</button> : <Pill tone="gray">Chờ</Pill>}</td></tr>)}</tbody></table></div> : <Empty title="Không có khoản thu chờ đối soát" />}
      </Card>
      <Card title="Lịch sử ca" subtitle="Số tiền hệ thống, kiểm đếm và chênh lệch khi đóng ca." pad={false}>
        {rows.length ? <div className="cl-table-wrap"><table className="cl-table"><thead><tr><th>Thu ngân</th><th>Mở ca</th><th>Hệ thống</th><th>Kiểm đếm</th><th>Chênh lệch</th></tr></thead><tbody>{rows.slice(0, 12).map((item) => <tr key={item.id}><td><b>{item.cashier_name}</b><small className="cl-sub">{item.status === 'open' ? 'Đang mở' : `Đóng ${fmtDateTime(item.closed_at)}`}</small></td><td>{money(item.opening_cash)}</td><td>{money(item.status === 'open' ? item.current_expected : item.expected_cash)}</td><td>{item.status === 'closed' ? money(item.counted_cash) : '—'}</td><td className={item.difference ? 'cl-danger-text' : ''}>{item.status === 'closed' ? money(item.difference) : '—'}</td></tr>)}</tbody></table></div> : <Empty title="Chưa có lịch sử ca thu ngân" />}
      </Card>
    </div>
    {dialog?.type === 'open' && <Modal open title="Mở ca thu ngân" subtitle="Nhập số tiền mặt thực tế có trong két tại thời điểm bắt đầu ca." onClose={() => setDialog(null)} footer={<><Btn onClick={() => setDialog(null)}>Hủy</Btn><Btn kind="primary" onClick={openShift}>Xác nhận mở ca</Btn></>}>
      {error && <div className="cl-alert error">{error}</div>}<Field label="Tiền đầu ca (VNĐ)"><input autoFocus type="number" min={0} step={1000} value={dialog.opening_cash} onChange={(e) => setDialog({ ...dialog, opening_cash: e.target.value })} /></Field></Modal>}
    {dialog?.type === 'close' && <Modal open title="Đóng và đối soát ca" subtitle={`Tồn quỹ theo hệ thống: ${money(active?.current_expected)}`} onClose={() => setDialog(null)} footer={<><Btn onClick={() => setDialog(null)}>Hủy</Btn><Btn kind="primary" onClick={closeShift}>Đóng ca</Btn></>}>
      {error && <div className="cl-alert error">{error}</div>}<div className="cl-form-grid"><Field label="Tiền mặt kiểm đếm"><input autoFocus type="number" min={0} step={1000} value={dialog.counted_cash} onChange={(e) => setDialog({ ...dialog, counted_cash: e.target.value })} /></Field><Field label="Chênh lệch dự kiến"><input readOnly value={money((Number(dialog.counted_cash) || 0) - Number(active?.current_expected || 0))} /></Field><Field label="Ghi chú chênh lệch" span="2"><textarea rows="2" value={dialog.note} onChange={(e) => setDialog({ ...dialog, note: e.target.value })} /></Field></div></Modal>}
  </>;
}

export function InvoiceTable({ rows, onOpen, showPatient = true }) {
  const [page, setPage] = useState(1);
  const pageSize = 20;
  const pages = Math.max(Math.ceil(rows.length / pageSize), 1);
  useEffect(() => setPage(1), [rows]);
  const visibleRows = rows.slice((page - 1) * pageSize, page * pageSize);
  return <div className="cl-table-wrap"><table className="cl-table"><thead><tr><th>Số HĐ</th>{showPatient && <th>Bệnh nhân</th>}<th>Ngày lập</th><th>Đến hạn</th><th>Tổng</th><th>Đã thu</th><th>Còn nợ</th><th>Trạng thái</th></tr></thead>
    <tbody>{visibleRows.map((i) => <tr key={i.id} className="click" onClick={() => onOpen(i.id)}><td><b>{i.code}</b></td>
      {showPatient && <td>{i.patient_name}<small className="cl-sub">{i.patient_code}</small></td>}<td>{fmtDate(i.created_at)}</td><td>{fmtDate(i.due_date)}{i.due_status === 'overdue' && <small className="cl-sub cl-danger-text">Quá {i.overdue_days} ngày</small>}</td><td>{money(i.total)}</td><td>{money(i.paid)}</td>
      <td style={{ color: i.balance && i.status !== 'void' ? '#c2410c' : undefined, fontWeight: i.balance ? 700 : 400 }}>{i.status === 'void' ? '—' : money(i.balance)}</td><td><Pill tone={invTone[i.status]} dot>{i.status_label}</Pill></td></tr>)}</tbody></table>
    {pages > 1 && <nav className="cl-pagination cl-billing-pagination" aria-label="Phân trang hóa đơn"><button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</button><div>{Array.from({ length: pages }, (_, i) => i + 1).map((p) => <button key={p} className={page === p ? 'on' : ''} onClick={() => setPage(p)}>{p}</button>)}</div><button disabled={page === pages} onClick={() => setPage((p) => p + 1)}>›</button></nav>}</div>;
}

/** Tab "Hóa đơn" trong hồ sơ bệnh nhân. */
export function InvoicesTab({ patient, canBill }) {
  const l = useLoad(async () => { const { data } = await api.get('/clinic/invoices/', { params: { patient: patient.id } }); return data.results || data; }, [patient.id]);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(false);
  const debt = (l.data || []).filter((i) => i.status !== 'void').reduce((s, i) => s + i.balance, 0);
  return <Card title="Hóa đơn & công nợ" subtitle={debt ? `Đang nợ ${money(debt)}` : 'Không có công nợ'} action={canBill && <Btn size="sm" icon={<AddRounded />} onClick={() => setForm(true)}>Lập hóa đơn</Btn>} pad={false}>
    {l.loading && !l.data ? <Loading /> : l.data?.length ? <InvoiceTable rows={l.data} onOpen={setOpen} showPatient={false} /> : <Empty title="Chưa có hóa đơn" />}
    {open && <InvoiceModal id={open} onClose={() => setOpen(null)} onChanged={() => l.reload(true)} />}
    {form && <InvoiceForm patient={patient} onClose={() => setForm(false)} onSaved={(d) => { setForm(false); l.reload(true); setOpen(d.id); }} />}
  </Card>;
}

export default function BillingPage() {
  const { user } = useAuth();
  const [view, setView] = useState('invoices');
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 250);
  const [open, setOpen] = useState(null);
  const [pick, setPick] = useState(null);       // {patient, visit}
  const [chooser, setChooser] = useState(false);
  const [patient, setPatient] = useState(null);
  const [toast, toastNode] = useToast();
  const sum = useLoad(async () => (await api.get('/clinic/invoices/summary/')).data, []);
  const list = useLoad(async () => { const { data } = await api.get('/clinic/invoices/', { params: { status: view === 'receivables' ? 'unpaid,partial' : status || undefined, q: dq.trim() || undefined } }); return data.results || data; }, [status, dq, view]);
  const today = isoDay();
  const todayVisits = useLoad(async () => { const { data } = await api.get('/clinic/visits/', { params: { date: today, status: 'completed,in_consult' } }); return data.results || data; }, []);
  const todayInv = useLoad(async () => { const { data } = await api.get('/clinic/invoices/', { params: { date: today } }); return data.results || data; }, []);
  const billed = new Set((todayInv.data || []).filter((i) => i.status !== 'void').map((i) => i.visit));
  const pending = (todayVisits.data || []).filter((v) => !billed.has(v.id));
  const refresh = () => { sum.reload(true); list.reload(true); todayInv.reload(true); todayVisits.reload(true); };
  const s = sum.data;
  const isMgr = user.role === 'manager';
  const debtRows = (list.data || []).filter((invoice) => invoice.status !== 'void' && Number(invoice.balance) > 0);
  const aging = debtRows.reduce((result, invoice) => {
    const days = Number(invoice.overdue_days || 0); const bucket = days === 0 ? 'fresh' : days <= 30 ? 'watch' : 'old';
    result[bucket].count += 1; result[bucket].amount += Number(invoice.balance || 0); return result;
  }, { fresh: { count: 0, amount: 0 }, watch: { count: 0, amount: 0 }, old: { count: 0, amount: 0 } });
  return <>
    <PageHead title="Thu ngân & công nợ" subtitle="Lập hóa đơn, thu tiền và theo dõi khách còn nợ."
      actions={<Btn kind="primary" icon={<AddRounded />} onClick={() => setChooser(true)}>Lập hóa đơn</Btn>} />
    {s && <div className="cl-stat-row">
      <div className="cl-stat teal"><span>Thu ròng hôm nay</span><strong>{money(s.today_revenue)}</strong><small>{s.today_invoices} hóa đơn · Hoàn {money(s.today_refunds)}</small></div>
      <div className="cl-stat blue"><span>Chuyển khoản / thẻ / ví</span><strong>{money(s.by_method.transfer + s.by_method.card + s.by_method.ewallet)}</strong><small>Hôm nay</small></div>
      <div className="cl-stat amber"><span>Công nợ phải thu</span><strong>{money(s.debt_total)}</strong><small>{s.overdue_count} quá hạn · {money(s.overdue_total)}</small></div>
      {isMgr ? <div className="cl-stat green"><span>Doanh thu tháng này</span><strong>{money(s.month_revenue)}</strong><small>{s.low_stock ? `${s.low_stock} thuốc sắp hết` : 'Kho ổn định'}</small></div>
        : <div className="cl-stat green"><span>Chờ lập hóa đơn</span><strong>{pending.length}</strong><small>Lượt khám hôm nay</small></div>}
    </div>}
    <nav className="cl-tabs" aria-label="Thu ngân và công nợ"><button className={view === 'invoices' ? 'on' : ''} onClick={() => setView('invoices')}>Hóa đơn & thu tiền</button><button className={view === 'receivables' ? 'on' : ''} onClick={() => setView('receivables')}>Công nợ phải thu</button><button className={view === 'shifts' ? 'on' : ''} onClick={() => setView('shifts')}>Ca thu ngân & đối soát</button></nav>
    {view === 'invoices' && !!pending.length && <Card title="Khách chờ thanh toán hôm nay" subtitle="Lượt khám chưa có hóa đơn — bấm để lập hóa đơn tự động từ dịch vụ và đơn thuốc.">
      <div className="cl-pending">{pending.map((v) => <button key={v.id} onClick={() => setPick({ patient: { id: v.patient, full_name: v.patient_detail.full_name }, visit: v.id })}>
        <Avatar name={v.patient_detail.full_name} size={34} /><span><strong>{v.patient_detail.full_name}</strong><small>#{v.ticket_no} · {fmtTime(v.check_in_at)} · {v.status === 'completed' ? 'Đã khám xong' : 'Đang khám'}</small></span></button>)}</div>
    </Card>}
    {view === 'receivables' && <div className="cl-debt-aging">
      <article><span>Chưa đến hạn / đến hạn</span><strong>{money(aging.fresh.amount)}</strong><small>{aging.fresh.count} hóa đơn trong hạn</small></article>
      <article><span>Quá hạn 1–30 ngày</span><strong>{money(aging.watch.amount)}</strong><small>{aging.watch.count} hóa đơn cần theo dõi</small></article>
      <article className={aging.old.count ? 'attention' : ''}><span>Trên 30 ngày</span><strong>{money(aging.old.amount)}</strong><small>{aging.old.count} hóa đơn cần ưu tiên thu hồi</small></article>
    </div>}
    {view === 'shifts' && <ShiftPanel user={user} notify={toast} />}
    {view !== 'shifts' && <Card pad={false}>
      <div className="cl-toolbar cl-toolbar-row"><div className="cl-input-icon"><SearchRounded /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo số hóa đơn, tên, số điện thoại…" /></div>
        {view === 'invoices' && <div className="cl-seg">{[['', 'Tất cả'], ['unpaid,partial', 'Còn nợ'], ['paid', 'Đã thu'], ['void', 'Đã hủy']].map(([k, t]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{t}</button>)}</div>}</div>
      {view === 'receivables' && <div className="cl-table-note"><strong>Danh sách đối soát công nợ</strong><span>Tuổi công nợ được tính từ ngày đến hạn; bấm vào hóa đơn để ghi nhận thanh toán hoặc lịch sử nhắc nợ.</span></div>}
      {list.loading && !list.data ? <Loading /> : list.data?.length ? <InvoiceTable rows={list.data} onOpen={setOpen} /> : <Empty title="Chưa có hóa đơn nào" />}
    </Card>}
    {open && <InvoiceModal id={open} onClose={() => setOpen(null)} onChanged={refresh} />}
    {pick && <InvoiceForm patient={pick.patient} visitId={pick.visit} onClose={() => setPick(null)} onSaved={(d) => { setPick(null); refresh(); setOpen(d.id); toast('Đã tạo hóa đơn.'); }} />}
    <Modal open={chooser} title="Lập hóa đơn" subtitle="Chọn bệnh nhân cần thanh toán" onClose={() => { setChooser(false); setPatient(null); }}
      footer={<><Btn onClick={() => { setChooser(false); setPatient(null); }}>Hủy</Btn><Btn kind="primary" disabled={!patient} onClick={() => { setPick({ patient }); setChooser(false); setPatient(null); }}>Tiếp tục</Btn></>}>
      <PatientPicker value={patient} onPick={setPatient} autoFocus />
    </Modal>
    {toastNode}
  </>;
}
