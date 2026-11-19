import { useMemo, useState } from 'react';
import api from '../api/client';
import { Btn, Field, Modal, errMsg, money } from './ui';

const METHODS = [['cash', 'Tiền mặt'], ['transfer', 'Chuyển khoản'], ['card', 'Quẹt thẻ'], ['ewallet', 'Ví điện tử']];
export const payTone = { unpaid: 'red', partial: 'amber', paid: 'green', free: 'gray' };

export function PlanPaySummary({ plan }) {
  const payment = plan.payment;
  if (!payment || payment.state === 'free') return null;
  return <div className="cl-plan-pay">
    <div className="cl-plan-pay-totals">
      <span><small>Tổng liệu trình</small><b>{money(payment.total)}</b></span>
      <span><small>Đã thu</small><b>{money(payment.paid)}</b></span>
      <span><small>Còn nợ</small><b className={payment.balance ? 'cl-danger-text' : ''}>{money(payment.balance)}</b></span>
      {payment.due_now > 0 && <span><small>Đến hạn (tới buổi kế tiếp)</small><b className="cl-danger-text">{money(payment.due_now)}</b></span>}
    </div>
    {payment.refundable > 0 && <div className="cl-alert warn">
      Có thể yêu cầu hoàn tối đa {money(payment.refundable)} trên hóa đơn liệu trình.
    </div>}
  </div>;
}

export function PlanCollectModal({ plan, onClose, onDone }) {
  const payment = plan.payment;
  const unpaid = useMemo(
    () => payment.sessions.map((session) => session.amount - session.paid).filter((amount) => amount > 0),
    [payment],
  );
  const [mode, setMode] = useState('full');
  const [amount, setAmount] = useState('');
  const [count, setCount] = useState(1);
  const [method, setMethod] = useState('cash');
  const [reference, setReference] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const amountToCollect = mode === 'full'
    ? payment.balance
    : mode === 'session'
      ? Math.min(unpaid.slice(0, count).reduce((sum, value) => sum + value, 0), payment.balance)
      : Number(amount) || 0;
  const valid = amountToCollect > 0 && amountToCollect <= payment.balance
    && (mode !== 'session' || (count >= 1 && count <= unpaid.length));

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const { data } = await api.post(`/clinic/plans/${plan.id}/collect/`, {
        mode,
        amount: mode === 'partial' ? Number(amount) : undefined,
        count: mode === 'session' ? Number(count) : undefined,
        method,
        reference,
      });
      onDone(data);
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  return <Modal open portal backdropClassName="cl-plan-collect-backdrop" title="Thu tiền liệu trình" subtitle={`${plan.patient_name} · ${plan.title}`} onClose={onClose}
    footer={<><strong className="cl-pay-modal-total">Thu lần này: {money(amountToCollect)}</strong><Btn onClick={onClose}>Hủy</Btn>
      <Btn kind="primary" disabled={!valid || busy} onClick={submit}>{busy ? 'Đang ghi nhận…' : 'Xác nhận thu'}</Btn></>}>
    {error && <div className="cl-alert error">{error}</div>}
    <dl className="cl-inv-sum">
      <div><dt>Tổng liệu trình ({plan.total_sessions} buổi)</dt><dd>{money(payment.total)}</dd></div>
      <div><dt>Đã thu</dt><dd>{money(payment.paid)}</dd></div>
      <div className={`big ${payment.balance ? 'debt' : ''}`}><dt>Còn nợ</dt><dd>{money(payment.balance)}</dd></div>
    </dl>
    <div className="cl-pay-modes" role="radiogroup" aria-label="Hình thức thu tiền">
      <label className={mode === 'full' ? 'on' : ''}><input type="radio" name="plan-pay-mode" checked={mode === 'full'} onChange={() => setMode('full')} />
        <span><b>Thanh toán toàn bộ gói</b><small>Thu đủ {money(payment.balance)}</small></span></label>
      <label className={mode === 'partial' ? 'on' : ''}><input type="radio" name="plan-pay-mode" checked={mode === 'partial'} onChange={() => setMode('partial')} />
        <span><b>Thu một phần / đặt cọc</b><small>Nhập số tiền khách trả lần này</small></span></label>
      <label className={mode === 'session' ? 'on' : ''}><input type="radio" name="plan-pay-mode" checked={mode === 'session'}
        disabled={!unpaid.length} onChange={() => setMode('session')} />
        <span><b>Thu theo buổi</b><small>{money(payment.per_session)} / buổi · còn {unpaid.length} buổi chưa thu</small></span></label>
    </div>
    <div className="cl-form-grid">
      {mode === 'partial' && <Field label="Số tiền thu (VNĐ)" hint={`Tối đa ${money(payment.balance)}`}>
        <input autoFocus type="number" min={1} max={payment.balance} step={10000} value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>}
      {mode === 'session' && <Field label="Số buổi thu" hint="Tính từ buổi chưa thanh toán đầu tiên">
        <input type="number" min={1} max={unpaid.length} value={count}
          onChange={(e) => setCount(Math.max(1, Math.min(unpaid.length, Number(e.target.value) || 1)))} />
      </Field>}
      <Field label="Hình thức thanh toán">
        <select value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
      </Field>
      {method !== 'cash' && <Field label="Mã giao dịch" span="2">
        <input value={reference} onChange={(e) => setReference(e.target.value)} />
      </Field>}
    </div>
    <small className="cl-muted">Các lần thu được ghi vào cùng một hóa đơn của liệu trình{payment.invoice_code ? ` (${payment.invoice_code})` : ''}.</small>
  </Modal>;
}
