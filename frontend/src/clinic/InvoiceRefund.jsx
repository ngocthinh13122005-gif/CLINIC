import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import api from '../api/client';
import { Loading, errMsg, fmtDate, money, useLoad, useToast } from './ui';
import './sale.css';
import './invoice.css';

const PCTS = [10, 20, 25, 30, 50, 75, 100];
const METHODS = { cash: 'Tiền mặt', transfer: 'Chuyển khoản', card: 'Quẹt thẻ', ewallet: 'Ví điện tử' };

/** Trang hoàn tiền: chọn tỷ lệ hoàn theo từng phương thức đã thu, tạo yêu cầu chờ quản lý duyệt. */
export default function InvoiceRefundPage() {
  const { id } = useParams(); const nav = useNavigate(); const [toast, toastNode] = useToast();
  const l = useLoad(async () => (await api.get(`/clinic/invoices/${id}/`)).data, [id]);
  const inv = l.data;
  const [pick, setPick] = useState({}); // method -> { pct: number|'custom', custom: string }
  const [reason, setReason] = useState(''); const [busy, setBusy] = useState(false); const [err, setErr] = useState('');

  // Số tiền còn có thể hoàn theo từng phương thức = đã thu − đã hoàn/đang chờ hoàn của phương thức đó.
  const rows = useMemo(() => {
    if (!inv) return [];
    const by = {};
    inv.payments.forEach((p) => { by[p.method] = (by[p.method] || 0) + p.amount; });
    (inv.refunds || []).filter((r) => ['pending', 'approved', 'completed'].includes(r.status)).forEach((r) => { by[r.method] = (by[r.method] || 0) - r.amount; });
    return Object.entries(by).map(([method, max]) => ({ method, max: Math.max(max, 0) })).filter((r) => r.max > 0);
  }, [inv]);

  if (!inv) return <div className="sx-edit"><header className="sx-edit-head"><button className="bk" onClick={() => nav(-1)} aria-label="Quay lại"><ChevronRightRounded style={{ transform: 'scaleX(-1)' }} /></button><h1>Hoàn tiền</h1></header>{l.error ? <div className="sx-err">{l.error}</div> : <Loading />}</div>;

  const amountOf = (r) => { const p = pick[r.method]; if (!p) return 0; if (p.pct === 'custom') return Math.min(Math.max(Number(p.custom) || 0, 0), r.max); return Math.round((r.max * p.pct) / 100); };
  const total = rows.reduce((n, r) => n + amountOf(r), 0);
  const set = (m, v) => setPick((o) => ({ ...o, [m]: v }));
  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      for (const r of rows) { const amount = amountOf(r); if (amount > 0) await api.post('/clinic/refunds/', { invoice: inv.id, amount, method: r.method, reason: reason.trim() }); }
      toast('Đã gửi yêu cầu hoàn tiền, chờ quản lý duyệt.'); setTimeout(() => nav(`/hoa-don/${id}?tab=payments`), 900);
    } catch (e) { setErr(errMsg(e)); setBusy(false); }
  };
  const noteOk = reason.trim().length >= 5;

  return <div className="sx-edit iv-refund">
    <header className="sx-edit-head"><button className="bk" onClick={() => nav(-1)} aria-label="Quay lại"><ChevronRightRounded style={{ transform: 'scaleX(-1)' }} /></button>
      <div><h1>Hoàn tiền · #{inv.code}</h1><div className="pills"><span className="sx-pillx gray"><i />{inv.patient_name}</span></div></div></header>
    <div className="iv-rf-body">
      {err && <div className="sx-err">{err}</div>}
      <section className="iv-card iv-rf-card"><header className="iv-rf-h"><h2>Mặt hàng trên hóa đơn</h2><span className="muted">Ngày lập {fmtDate(inv.created_at)}</span></header>
        <table className="iv-rf-items"><thead><tr><th>Nội dung</th><th className="r">Đơn giá</th><th className="r">SL</th><th className="r">Thành tiền</th></tr></thead>
          <tbody>{inv.items.map((i) => <tr key={i.id}><td>{i.name}{i.kind === 'package' && <em className="pkg">GÓI</em>}</td><td className="r">{money(i.unit_price)}</td><td className="r">{i.quantity}</td><td className="r"><b>{money(i.amount)}</b></td></tr>)}</tbody>
          <tfoot><tr><td colSpan={3}>Giảm giá</td><td className="r">{inv.discount ? `-${money(inv.discount)}` : money(0)}</td></tr><tr><td colSpan={3}><b>Tổng hóa đơn</b></td><td className="r"><b>{money(inv.total)}</b></td></tr></tfoot></table></section>

      <section className="iv-card iv-rf-card"><header className="iv-rf-h"><h2>Chi tiết hoàn tiền</h2><span className="muted">Đã thu ròng {money(inv.paid)}</span></header>
        {!rows.length ? <p className="muted pad">Hóa đơn này không còn khoản nào có thể hoàn (đã hoàn hoặc đang chờ duyệt hết).</p> : rows.map((r) => {
          const p = pick[r.method];
          return <div className="iv-rf-row" key={r.method}>
            <div className="lbl"><small>Phương thức</small><b>{METHODS[r.method] || r.method}</b><span>Còn hoàn được {money(r.max)}</span></div>
            <div className="chips" role="group" aria-label={`Tỷ lệ hoàn ${METHODS[r.method]}`}>
              {PCTS.map((n) => <button key={n} type="button" className={p?.pct === n ? 'on' : ''} onClick={() => set(r.method, p?.pct === n ? null : { pct: n })}><b>{n}%</b><small>{money(Math.round((r.max * n) / 100))}</small></button>)}
              <button type="button" className={`cus ${p?.pct === 'custom' ? 'on' : ''}`} onClick={() => set(r.method, { pct: 'custom', custom: p?.custom || '' })}><b>Tùy chỉnh</b></button>
              {p?.pct === 'custom' && <input className="amt" type="number" min={1} max={r.max} step={1000} autoFocus placeholder="Số tiền" value={p.custom} onChange={(e) => set(r.method, { pct: 'custom', custom: e.target.value })} aria-label="Số tiền hoàn tùy chỉnh" />}</div>
            <div className="val">{amountOf(r) ? money(amountOf(r)) : '—'}</div></div>;
        })}
        <div className="iv-rf-total"><span>TỔNG HOÀN</span><b>{money(total)}</b></div>
        <label className="iv-rf-note"><span>Lý do hoàn tiền <em>(bắt buộc)</em></span><textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ví dụ: khách đổi ý, dịch vụ không thực hiện, được quản lý cho phép…" />
          {!noteOk && total > 0 && <small className="bad">Nhập lý do (tối thiểu 5 ký tự) để gửi yêu cầu.</small>}</label>
        <div className="iv-rf-foot"><span className="muted">Yêu cầu sẽ được quản lý duyệt, sau đó thu ngân chi tiền.</span><span className="sp" />
          <button className="iv-btn" onClick={() => nav(-1)}>Hủy</button>
          <button className="iv-btn pri" disabled={busy || !total || !noteOk} onClick={submit}>{busy ? 'Đang gửi…' : 'Gửi yêu cầu hoàn tiền'}</button></div>
      </section>
    </div>{toastNode}
  </div>;
}
