import { useState } from 'react';
import AddRounded from '@mui/icons-material/AddRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ErrorRounded from '@mui/icons-material/ErrorRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import api from '../api/client';
import { Link } from 'react-router-dom';
import { Btn, Card, Empty, Field, Loading, Modal, PageHead, Pill, errMsg, fmtDate, fmtDateTime, isoDay, money, useDebounce, useLoad, useToast } from './ui';
import { Avatar } from './ui';

const arr = (d) => d?.results || d || [];
const LV = { ok: ['green', CheckCircleRounded, 'Đạt'], warn: ['amber', WarningAmberRounded, 'Cần xem'], bad: ['red', ErrorRounded, 'Chưa đạt'] };
const bytes = (n) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`);

function Overview() {
  const l = useLoad(async () => (await api.get('/clinic/compliance/overview/')).data, []);
  if (l.loading && !l.data) return <Loading />;
  const d = l.data;
  return <>
    <div className="cl-stat-row" style={{ gridTemplateColumns: 'repeat(3,minmax(0,1fr))' }}>
      <div className="cl-stat green"><span>Đạt</span><strong>{d.score.ok}</strong><small>hạng mục đã đáp ứng</small></div>
      <div className="cl-stat amber"><span>Cần xem lại</span><strong>{d.score.warn}</strong><small>nên xử lý sớm</small></div>
      <div className="cl-stat" style={{ borderTopColor: '#c2410c' }}><span>Chưa đạt</span><strong>{d.score.bad}</strong><small>phải xử lý trước khi chạy thật</small></div>
    </div>
    <Card pad={false}><ul className="cp-list">{d.items.map((it) => { const [tone, Icon] = LV[it.level]; return <li key={it.title} className={`cp-${tone}`}>
      <Icon /><div><b>{it.title}</b><small>{it.detail}</small></div><Pill tone={tone}>{LV[it.level][2]}</Pill></li>; })}</ul></Card>
    <p className="cl-hint">Danh sách này là công cụ tự kiểm tra, <b>không thay thế tư vấn pháp lý</b>. Các hạng mục ghi "chưa tích hợp" cần bên thứ ba (nhà cung cấp chữ ký số, cơ quan quản lý).</p>
  </>;
}

function Requests({ toast }) {
  const l = useLoad(async () => arr((await api.get('/clinic/data-requests/')).data), []);
  const [open, setOpen] = useState(null);
  const [res, setRes] = useState('');
  const resolve = async (reject) => { try { await api.post(`/clinic/data-requests/${open.id}/resolve/`, { response: res, reject }); setOpen(null); setRes(''); l.reload(true); toast('Đã cập nhật yêu cầu.'); } catch (e) { toast(errMsg(e), 'err'); } };
  const rows = l.data || [];
  return <>
    <p className="cl-muted" style={{ marginBottom: 12 }}>Yêu cầu của bệnh nhân về dữ liệu của họ (xem, sửa, xóa, hạn chế, rút đồng ý). Lễ tân ghi nhận trong hồ sơ bệnh nhân → tab "Cam kết". Hạn xử lý nội bộ 72 giờ.</p>
    <Card pad={false}>{l.loading && !l.data ? <Loading /> : rows.length ? <div className="cl-table-wrap"><table className="cl-table">
      <thead><tr><th>Bệnh nhân</th><th>Yêu cầu</th><th>Nhận lúc</th><th>Hạn</th><th>Trạng thái</th><th /></tr></thead>
      <tbody>{rows.map((r) => <tr key={r.id}><td><Link to={`/benh-nhan/${r.patient}`} className="cl-visit-name"><Avatar name={r.patient_name} size={30} /><span><strong>{r.patient_name}</strong><small>{r.patient_code}</small></span></Link></td>
        <td><b>{r.kind_label}</b><small className="cl-sub">{r.detail}</small></td><td>{fmtDateTime(r.received_at)}</td><td>{fmtDateTime(r.due_at)} {r.overdue && <Pill tone="red">Quá hạn</Pill>}</td>
        <td><Pill tone={r.status === 'open' ? 'amber' : r.status === 'done' ? 'green' : 'gray'} dot>{r.status_label}</Pill>{r.response && <small className="cl-sub">{r.response}</small>}</td>
        <td>{r.status === 'open' && <Btn size="sm" onClick={() => setOpen(r)}>Xử lý</Btn>}{r.kind === 'access' && <a className="cl-link" style={{ marginLeft: 10 }} href="#x" onClick={async (e) => { e.preventDefault(); const x = await api.get(`/clinic/compliance/patient-export/${r.patient}/`, { responseType: 'blob' }); const a = document.createElement('a'); a.href = URL.createObjectURL(x.data); a.download = `du-lieu-${r.patient_code}.json`; a.click(); }}>Xuất dữ liệu</a>}</td></tr>)}</tbody></table></div>
      : <Empty title="Chưa có yêu cầu nào" />}</Card>
    {open && <Modal open title={`${open.kind_label} — ${open.patient_name}`} subtitle={open.detail} onClose={() => setOpen(null)}
      footer={<><Btn onClick={() => resolve(true)}>Từ chối / không thể thực hiện</Btn><Btn kind="primary" onClick={() => resolve(false)}>Đã xử lý xong</Btn></>}>
      <Field label="Phản hồi / căn cứ xử lý" required hint={open.kind === 'delete' ? 'Lưu ý: hồ sơ bệnh án phải được lưu trong thời hạn luật định nên thường không xóa được; ghi rõ căn cứ này khi từ chối.' : ''}>
        <textarea rows={4} value={res} onChange={(e) => setRes(e.target.value)} /></Field></Modal>}
  </>;
}

function Incidents({ toast }) {
  const l = useLoad(async () => arr((await api.get('/clinic/incidents/')).data), []);
  const [form, setForm] = useState(null);
  const save = async () => { try { form.id ? await api.patch(`/clinic/incidents/${form.id}/`, form) : await api.post('/clinic/incidents/', form); setForm(null); l.reload(true); toast('Đã lưu sự cố.'); } catch (e) { toast(errMsg(e), 'err'); } };
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const rows = l.data || [];
  const stamp = (k) => setForm({ ...form, [k]: new Date().toISOString() });
  return <>
    <div className="cl-toolbar-row cl-bar-top"><p className="cl-muted" style={{ margin: 0, maxWidth: 640 }}>Ghi nhận mọi sự cố lộ / mất / truy cập trái phép dữ liệu. Cần báo cơ quan có thẩm quyền trong <b>72 giờ</b> kể từ khi phát hiện (đối chiếu quy định hiện hành).</p>
      <Btn kind="primary" icon={<AddRounded />} onClick={() => setForm({ kind: 'other', title: '', description: '', affected_count: 0, measures: '', status: 'open' })}>Ghi nhận sự cố</Btn></div>
    <Card pad={false}>{l.loading && !l.data ? <Loading /> : rows.length ? <div className="cl-table-wrap"><table className="cl-table">
      <thead><tr><th>Sự cố</th><th>Phát hiện</th><th>Ảnh hưởng</th><th>Báo cơ quan</th><th>Trạng thái</th><th /></tr></thead>
      <tbody>{rows.map((i) => <tr key={i.id}><td><b>{i.title}</b><small className="cl-sub">{i.kind_label}</small></td><td>{fmtDateTime(i.detected_at)}<small className="cl-sub">Hạn báo: {fmtDateTime(i.authority_deadline)}</small></td><td>{i.affected_count} người</td>
        <td>{i.authority_notified_at ? fmtDate(i.authority_notified_at) : i.overdue ? <Pill tone="red">Quá hạn chưa báo</Pill> : '—'}</td><td><Pill tone={i.status === 'open' ? 'amber' : 'green'} dot>{i.status === 'open' ? 'Đang xử lý' : 'Đã đóng'}</Pill></td>
        <td><button className="cl-link" onClick={() => setForm({ ...i })}>Cập nhật</button></td></tr>)}</tbody></table></div> : <Empty title="Chưa ghi nhận sự cố nào" />}</Card>
    {form && <Modal open wide title={form.id ? 'Cập nhật sự cố' : 'Ghi nhận sự cố'} onClose={() => setForm(null)} footer={<><Btn onClick={() => setForm(null)}>Hủy</Btn><Btn kind="primary" disabled={!form.title.trim()} onClick={save}>Lưu</Btn></>}>
      <div className="cl-form-grid"><Field label="Tiêu đề" required span="2"><input value={form.title} onChange={set('title')} /></Field>
        <Field label="Loại"><select value={form.kind} onChange={set('kind')}>{[['leak', 'Lộ lọt dữ liệu'], ['loss', 'Mất dữ liệu / thiết bị'], ['unauth', 'Truy cập trái phép'], ['misuse', 'Sử dụng sai mục đích'], ['other', 'Khác']].map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
        <Field label="Số người bị ảnh hưởng (ước tính)"><input type="number" min={0} value={form.affected_count} onChange={set('affected_count')} /></Field>
        <Field label="Mô tả" span="2"><textarea rows={3} value={form.description} onChange={set('description')} /></Field>
        <Field label="Biện pháp khắc phục" span="2"><textarea rows={3} value={form.measures} onChange={set('measures')} /></Field>
        <Field label="Đã báo cơ quan có thẩm quyền"><div className="cl-actions-row" style={{ margin: 0 }}><span>{form.authority_notified_at ? fmtDateTime(form.authority_notified_at) : 'Chưa'}</span><Btn size="sm" onClick={() => stamp('authority_notified_at')}>Ghi nhận vừa báo</Btn></div></Field>
        <Field label="Đã báo người bị ảnh hưởng"><div className="cl-actions-row" style={{ margin: 0 }}><span>{form.subjects_notified_at ? fmtDateTime(form.subjects_notified_at) : 'Chưa'}</span><Btn size="sm" onClick={() => stamp('subjects_notified_at')}>Ghi nhận vừa báo</Btn></div></Field>
        <Field label="Trạng thái"><select value={form.status} onChange={set('status')}><option value="open">Đang xử lý</option><option value="closed">Đã đóng</option></select></Field></div></Modal>}
  </>;
}

function Retention() {
  const l = useLoad(async () => (await api.get('/clinic/compliance/retention/')).data, []);
  const [hold, setHold] = useState(null);
  if (l.loading && !l.data) return <Loading />;
  const d = l.data;
  const flag = async (r, body) => { await api.post(`/clinic/compliance/records/${r.id}/flags/`, body); l.reload(true); };
  return <>
    <div className="cl-stat-row">
      <div className="cl-stat"><span>Bệnh án đã ký</span><strong>{d.signed}</strong><small>tổng {d.total} hồ sơ</small></div>
      <div className="cl-stat amber"><span>Hết hạn lưu tối thiểu</span><strong>{d.expired}</strong><small>chỉ để xem xét, không tự xóa</small></div>
      <div className="cl-stat blue"><span>Tử vong / tai biến</span><strong>{d.adverse}</strong><small>lưu tối thiểu 20 năm</small></div>
      <div className="cl-stat green"><span>Đang giữ (tranh chấp)</span><strong>{d.holds}</strong></div>
    </div>
    <div className="cl-alert warn"><WarningAmberRounded /><span>{d.policy}</span></div>
    <Card pad={false} title="Mốc hết hạn lưu gần nhất" className="cp-gap"><div className="cl-table-wrap"><table className="cl-table">
      <thead><tr><th>Bệnh án</th><th>Bệnh nhân</th><th>Ngày ký</th><th>Lưu đến</th><th>Kết cục</th><th>Giữ</th></tr></thead>
      <tbody>{d.rows.slice(0, 40).map((r) => <tr key={r.id}><td><b>{r.code}</b></td><td>{r.patient}<small className="cl-sub">{r.patient_code}</small></td><td>{fmtDate(r.signed_at)}</td>
        <td>{fmtDate(r.retain_until)} {r.expired && <Pill tone="amber">Đã hết hạn lưu tối thiểu</Pill>}</td>
        <td><select className="cl-sel" style={{ height: 32, minWidth: 0 }} value={r.outcome} onChange={(e) => flag(r, { outcome: e.target.value })}><option value="normal">Bình thường</option><option value="adverse">Tử vong / tai biến</option></select></td>
        <td><label className="cl-check"><input type="checkbox" checked={r.legal_hold} onChange={(e) => flag(r, { legal_hold: e.target.checked })} /> Giữ</label></td></tr>)}</tbody></table></div></Card>
  </>;
}

function Backups({ toast }) {
  const l = useLoad(async () => (await api.get('/clinic/compliance/backups/')).data, []);
  const [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { const { data } = await api.post('/clinic/compliance/backups/', {}, { timeout: 120000 }); toast(data.verify.ok ? 'Đã sao lưu và kiểm tra đọc lại thành công.' : 'Sao lưu xong nhưng kiểm tra đọc lại thất bại!', data.verify.ok ? 'ok' : 'err'); l.reload(true); } catch (e) { toast(errMsg(e), 'err'); } finally { setBusy(false); } };
  const verify = async (r) => { try { const { data } = await api.post(`/clinic/compliance/backups/${r.id}/verify/`); toast(data.ok ? 'Bản sao lưu hợp lệ.' : `Lỗi: ${data.note}`, data.ok ? 'ok' : 'err'); l.reload(true); } catch (e) { toast(errMsg(e), 'err'); } };
  const d = l.data;
  return <>
    <div className="cl-toolbar-row cl-bar-top"><p className="cl-muted" style={{ margin: 0, maxWidth: 680 }}>Sao lưu được <b>mã hóa</b> trước khi lưu. File nằm trên máy chủ tại <code>{d?.dir}</code> — hãy sao chép định kỳ ra nơi lưu trữ khác (ổ ngoài / cloud) và cất khóa mã hóa riêng.</p>
      <Btn kind="primary" disabled={busy} onClick={run}>{busy ? 'Đang sao lưu…' : 'Sao lưu ngay'}</Btn></div>
    {d && !d.own_key && <div className="cl-alert warn"><WarningAmberRounded /><span>Chưa đặt <code>BACKUP_ENCRYPTION_KEY</code>: khóa đang suy ra từ SECRET_KEY. Tạo khóa bằng <code>python manage.py backup_data --genkey</code>.</span></div>}
    <Card pad={false}>{l.loading && !d ? <Loading /> : d.rows.length ? <div className="cl-table-wrap"><table className="cl-table">
      <thead><tr><th>Thời gian</th><th>Loại</th><th>Tệp</th><th>Dung lượng</th><th>Kết quả</th><th /></tr></thead>
      <tbody>{d.rows.map((r) => <tr key={r.id}><td>{fmtDateTime(r.created_at)}<small className="cl-sub">{r.by_name}</small></td><td>{r.kind === 'backup' ? 'Sao lưu' : 'Kiểm tra'}</td><td><small>{r.filename}</small></td><td>{bytes(r.size)}</td>
        <td><Pill tone={r.ok ? 'green' : 'red'} dot>{r.ok ? 'Thành công' : 'Lỗi'}</Pill><small className="cl-sub">{r.note}</small></td>
        <td>{r.kind === 'backup' && <button className="cl-link" onClick={() => verify(r)}>Kiểm tra lại</button>}</td></tr>)}</tbody></table></div> : <Empty title="Chưa có bản sao lưu" />}</Card>
    <p className="cl-hint">Chưa gồm: tệp ảnh trong thư mục <code>media/</code> (cần sao lưu thư mục riêng). Khôi phục bằng <code>python manage.py restore_backup &lt;tệp&gt; --yes</code>.</p>
  </>;
}

function Linking({ toast }) {
  const rx = useLoad(async () => (await api.get('/clinic/prescriptions/national/')).data, []);
  const [code, setCode] = useState({});
  const send = async (r) => { try { await api.post(`/clinic/prescriptions/${r.id}/mark_sent/`, { national_code: code[r.id] }); rx.reload(true); toast('Đã ghi nhận mã đơn quốc gia.'); } catch (e) { toast(errMsg(e), 'err'); } };
  const ei = useLoad(async () => arr((await api.get('/clinic/invoices/', { params: { einvoice: 'requested' } })).data), []);
  const [issue, setIssue] = useState(null);
  const doIssue = async () => { try { await api.post(`/clinic/invoices/${issue.id}/einvoice/`, issue); setIssue(null); ei.reload(true); toast('Đã ghi nhận hóa đơn điện tử.'); } catch (e) { toast(errMsg(e), 'err'); } };
  const dl = async () => { const x = await api.get('/clinic/einvoice-export/', { responseType: 'blob' }); const a = document.createElement('a'); a.href = URL.createObjectURL(x.data); a.download = 'hoa-don-can-xuat.xlsx'; a.click(); };
  return <>
    <Card title="Đơn thuốc chờ liên thông quốc gia" subtitle="Hệ thống chưa kết nối tự động. Sau khi gửi bằng công cụ của cơ quan quản lý, ghi lại mã đơn tại đây." pad={false} className="cp-gap">
      {rx.loading && !rx.data ? <Loading /> : (rx.data || []).length ? <div className="cl-table-wrap"><table className="cl-table"><thead><tr><th>Đơn</th><th>Bệnh nhân</th><th>Bác sĩ</th><th>Ngày kê</th><th>Mã đơn quốc gia</th><th /></tr></thead>
        <tbody>{rx.data.map((r) => <tr key={r.id}><td><b>{r.code}</b></td><td>{r.patient}</td><td>{r.doctor}</td><td>{fmtDateTime(r.issued_at)}</td>
          <td><input className="cl-sel" style={{ minWidth: 0, width: 180 }} value={code[r.id] || ''} onChange={(e) => setCode({ ...code, [r.id]: e.target.value })} placeholder="Mã được cấp" /></td>
          <td><Btn size="sm" disabled={!code[r.id]} onClick={() => send(r)}>Ghi nhận</Btn></td></tr>)}</tbody></table></div> : <Empty title="Không có đơn nào chờ gửi" />}
    </Card>
    <Card title="Hóa đơn điện tử cần xuất" subtitle="Hệ thống KHÔNG tự phát hành hóa đơn điện tử. Tải file, nhập vào phần mềm của nhà cung cấp hóa đơn điện tử, rồi ghi lại ký hiệu và số hóa đơn." pad={false}
      action={<Btn size="sm" onClick={dl}>Tải file Excel chuyển nhà cung cấp</Btn>}>
      {ei.loading && !ei.data ? <Loading /> : (ei.data || []).length ? <div className="cl-table-wrap"><table className="cl-table"><thead><tr><th>Phiếu thu</th><th>Người mua</th><th>MST</th><th>Tổng</th><th /></tr></thead>
        <tbody>{ei.data.map((i) => <tr key={i.id}><td><b>{i.code}</b></td><td>{i.buyer_name || i.patient_name}</td><td>{i.buyer_tax_code || '—'}</td><td>{money(i.total)}</td>
          <td><Btn size="sm" onClick={() => setIssue({ id: i.id, einvoice_symbol: '', einvoice_no: '', einvoice_lookup: '', code: i.code })}>Đã xuất — nhập số</Btn></td></tr>)}</tbody></table></div> : <Empty title="Không có hóa đơn nào cần xuất" />}
    </Card>
    {issue && <Modal open title={`Ghi nhận hóa đơn điện tử — ${issue.code}`} onClose={() => setIssue(null)} footer={<><Btn onClick={() => setIssue(null)}>Hủy</Btn><Btn kind="primary" disabled={!issue.einvoice_no || !issue.einvoice_symbol} onClick={doIssue}>Lưu</Btn></>}>
      <div className="cl-form-grid"><Field label="Ký hiệu hóa đơn" required><input value={issue.einvoice_symbol} onChange={(e) => setIssue({ ...issue, einvoice_symbol: e.target.value })} placeholder="VD: C26TAA" /></Field>
        <Field label="Số hóa đơn" required><input value={issue.einvoice_no} onChange={(e) => setIssue({ ...issue, einvoice_no: e.target.value })} /></Field>
        <Field label="Mã tra cứu" span="2"><input value={issue.einvoice_lookup} onChange={(e) => setIssue({ ...issue, einvoice_lookup: e.target.value })} /></Field></div></Modal>}
  </>;
}

const TABS = [['overview', 'Tổng quan tuân thủ'], ['requests', 'Yêu cầu dữ liệu'], ['incidents', 'Sự cố dữ liệu'], ['retention', 'Lưu trữ hồ sơ'], ['backup', 'Sao lưu'], ['link', 'Liên thông & hóa đơn điện tử']];

export default function CompliancePage() {
  const [tab, setTab] = useState('overview');
  const [toast, node] = useToast();
  return <>
    <PageHead />
    <nav className="cl-tabs" role="tablist">{TABS.map(([k, t]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{t}</button>)}</nav>
    {tab === 'overview' && <Overview />}{tab === 'requests' && <Requests toast={toast} />}{tab === 'incidents' && <Incidents toast={toast} />}
    {tab === 'retention' && <Retention />}{tab === 'backup' && <Backups toast={toast} />}{tab === 'link' && <Linking toast={toast} />}
    {node}
  </>;
}
