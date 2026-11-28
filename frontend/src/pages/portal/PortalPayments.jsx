import { Fragment, useEffect, useMemo, useState } from 'react';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import SearchRounded from '@mui/icons-material/SearchRounded';
import { Card, PageTitle, Pill, dateText, money, useApi } from './portalKit';

const KIND = { unpaid: 'wait pay', partial: 'wait pay', paid: 'ok', void: 'bad' };

function InvoiceTable({ rows, empty, openId, setOpenId, onPrint }) {
  if (!rows.length) return <p className="cp-muted pad">{empty}</p>;
  return <div className="cp-table-wrap"><table className="cp-table">
    <thead><tr><th>Hóa đơn</th><th>Ngày</th><th className="r">Tổng</th><th className="r">Đã thanh toán</th><th className="r">Còn lại</th><th>Trạng thái</th></tr></thead>
    <tbody>{rows.map((r) => <Fragment key={r.id}>
      <tr className="click" aria-expanded={openId === r.id} onClick={() => setOpenId(openId === r.id ? null : r.id)} tabIndex={0} onKeyDown={(e) => { if (['Enter', ' '].includes(e.key)) { e.preventDefault(); setOpenId(openId === r.id ? null : r.id); } }}>
        <td><strong>{r.items[0]?.name || 'Thanh toán điều trị'}{r.items.length > 1 ? ` +${r.items.length - 1}` : ''}</strong><small>{r.code}</small></td>
        <td>{dateText(r.date)}</td><td className="r">{money(r.total)}</td><td className="r">{money(r.paid)}</td><td className="r"><b>{money(r.balance)}</b></td>
        <td><Pill kind={KIND[r.status]}>{r.status_label}</Pill></td></tr>
      {openId === r.id && <tr className="detail"><td colSpan={6}><div className="cp-inv">
        <div className="cp-inv-h"><b>Hóa đơn {r.code}</b><button type="button" className="cp-btn" onClick={() => onPrint(r)}><PrintOutlined/>In</button></div>
        <table className="cp-table mini"><thead><tr><th>Mục</th><th className="r">SL</th><th className="r">Đơn giá</th></tr></thead>
          <tbody>{r.items.map((i, n) => <tr key={n}><td>{i.name}</td><td className="r">{i.quantity}</td><td className="r">{money(i.unit_price)}</td></tr>)}</tbody></table>
        {r.discount > 0 && <p className="cp-muted">Giảm giá: {money(r.discount)}</p>}
        <div className="cp-pay"><p>Tổng hóa đơn: <b>{money(r.total)}</b></p><p>Đã thanh toán: <b>{money(r.paid)}</b></p><p>Còn lại: <b>{money(r.balance)}</b></p></div>
        {r.payments.length > 0 && <><b className="cp-sub">Các lần thanh toán</b>
          <ul className="cp-pay">{r.payments.map((p, n) => <li key={n}><span>{dateText(p.date)} · {p.method}</span><b>{money(p.amount)}</b></li>)}</ul></>}
        {r.due_date && r.balance > 0 && <p className="cp-muted">Hạn thanh toán: {dateText(r.due_date)}</p>}
      </div></td></tr>}
    </Fragment>)}</tbody></table></div>;
}

export default function PortalPayments() {
  const { data, loading, error, reload } = useApi('/clinic/my-portal/billing/');
  const [openId, setOpenId] = useState(null);
  const [q, setQ] = useState('');
  const [printing, setPrinting] = useState(null);
  useEffect(() => {
    if (!printing) return undefined;
    const done = () => setPrinting(null);
    window.addEventListener('afterprint', done);
    const timer = setTimeout(() => window.print(), 0);
    return () => { clearTimeout(timer); window.removeEventListener('afterprint', done); };
  }, [printing]);
  const tx = useMemo(() => (data?.transactions || []).filter((t) => !q.trim() || `${t.invoice_code} ${t.method}`.toLowerCase().includes(q.trim().toLowerCase())), [data, q]);
  const totalPaid = (data?.paid || []).concat(data?.due || []).reduce((n, r) => n + r.paid, 0);

  const exportCsv = () => {
    const lines = [['Ngày', 'Hóa đơn', 'Phương thức', 'Số tiền']].concat(tx.map((t) => [dateText(t.date), t.invoice_code, t.method, t.amount]));
    const cell = (value) => { const s = String(value); return `"${(/^[=+\-@\t\r]/.test(s) ? "'" + s : s).replace(/"/g, '""')}"`; };
    const blob = new Blob(['\uFEFF' + lines.map((line) => line.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'giao-dich-akinaclinic.csv'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 0);
  };

  return <>
    <PageTitle title="Thanh toán" sub="Hóa đơn, giao dịch và số dư của bạn tại một nơi."
      actions={<button type="button" className="cp-btn" onClick={exportCsv} disabled={!tx.length}><FileDownloadOutlined/>Xuất CSV</button>}/>
    {error && <div className="cp-error" role="alert">{error} <button type="button" onClick={reload}>Thử lại</button></div>}
    {!loading && data && !data.patient_linked && <div className="cp-note">Tài khoản chưa được liên kết với hồ sơ bệnh nhân nên chưa có dữ liệu thanh toán. Vui lòng liên hệ phòng khám.</div>}
    <div className="cp-grid2 stat">
      <div className="cp-stat"><small>SỐ DƯ CÒN NỢ</small><b className={data?.outstanding ? 'dark' : 'good'}>{loading ? '…' : error ? '—' : money(data?.outstanding)}</b><span>{error ? '—' : data?.due_count || 0} hóa đơn cần thanh toán</span></div>
      <div className="cp-stat"><small>TỔNG ĐÃ THANH TOÁN</small><b>{loading ? '…' : error ? '—' : money(totalPaid)}</b><span>{error ? '—' : data?.transactions?.length || 0} giao dịch</span></div>
    </div>
    <Card title="Hóa đơn cần thanh toán" action={<span className="cp-muted">Thanh toán trực tiếp tại quầy hoặc liên hệ phòng khám.</span>} flush>
      <InvoiceTable rows={data?.due || []} empty={loading ? 'Đang tải…' : error ? 'Dữ liệu chưa tải được.' : 'Bạn không có hóa đơn nào cần thanh toán.'} openId={openId} setOpenId={setOpenId} onPrint={setPrinting}/>
    </Card>
    <Card title="Biên nhận" action={<span className="cp-muted">Hóa đơn đã thanh toán đủ.</span>} flush>
      <InvoiceTable rows={data?.paid || []} empty={loading ? 'Đang tải…' : error ? 'Dữ liệu chưa tải được.' : 'Chưa có hóa đơn đã thanh toán.'} openId={openId} setOpenId={setOpenId} onPrint={setPrinting}/>
    </Card>
    <Card title="Giao dịch" action={<label className="cp-search"><SearchRounded/><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm giao dịch…"/></label>} flush>
      {tx.length ? <div className="cp-table-wrap"><table className="cp-table"><thead><tr><th>Ngày</th><th>Hóa đơn</th><th>Phương thức</th><th>Trạng thái</th><th className="r">Số tiền</th></tr></thead>
        <tbody>{tx.map((t, i) => <tr key={i}><td>{dateText(t.date)}</td><td><strong>{t.invoice_code}</strong></td><td>{t.method}</td><td><Pill kind="ok">Đã thu</Pill></td><td className="r">{money(t.amount)}</td></tr>)}</tbody></table></div>
      : <p className="cp-muted pad">{loading ? 'Đang tải…' : error ? 'Dữ liệu chưa tải được.' : q ? 'Không có giao dịch phù hợp.' : 'Chưa có giao dịch.'}</p>}
    </Card>
    {printing && <section className="cp-print-sheet"><h1>AkinaClinic</h1><h2>Hóa đơn {printing.code}</h2><p>Ngày lập: {dateText(printing.date)}</p><table className="cp-table"><thead><tr><th>Nội dung</th><th>Số lượng</th><th>Đơn giá</th></tr></thead><tbody>{printing.items.map((item, index) => <tr key={index}><td>{item.name}</td><td>{item.quantity}</td><td>{money(item.unit_price)}</td></tr>)}</tbody></table><p>Giảm giá: {money(printing.discount)}</p><p>Tổng: {money(printing.total)}</p><p>Đã thanh toán: {money(printing.paid)}</p><p>Còn lại: {money(printing.balance)}</p><p>{printing.status_label}</p></section>}
  </>;
}
