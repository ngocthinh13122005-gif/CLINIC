import { useState } from 'react';
import SearchRounded from '@mui/icons-material/SearchRounded';
import api from '../api/client';
import { Card, Empty, Loading, PageHead, Pill, fmtDateTime, useDebounce, useLoad } from './ui';
import { roleLabel } from '../utils/roles';

const LABEL = { 'record.sign': 'Ký bệnh án', 'record.addendum': 'Bổ sung bệnh án', 'patient.view': 'Xem hồ sơ', 'patient.create': 'Tạo bệnh nhân', 'stock.scrap': 'Hủy hàng',
  'po.create': 'Tạo đơn nhập', 'po.confirm': 'Xác nhận đơn nhập', 'po.receive': 'Nhận hàng', 'count.start': 'Bắt đầu kiểm kho', 'count.validate': 'Chốt kiểm kho',
  'consent.create': 'Tạo phiếu cam kết', 'consent.sign': 'Ký cam kết', 'consent.revoke': 'Thu hồi cam kết', 'report.view': 'Xem báo cáo', 'report.export': 'Xuất báo cáo', 'care.done': 'Xử lý chăm sóc', 'record.create': 'Tạo bệnh án', 'record.update': 'Sửa bệnh án', 'record.view': 'Xem bệnh án', 'record.unlock': 'Mở khóa bệnh án',
  'patient.update': 'Sửa hồ sơ bệnh nhân', 'patient.archive': 'Lưu trữ bệnh nhân', 'image.upload': 'Tải hình ảnh', 'invoice.create': 'Lập hóa đơn', 'invoice.pay': 'Thu tiền', 'invoice.update': 'Sửa hóa đơn',
  'invoice.void': 'Hủy hóa đơn', 'medicine.disable': 'Ngừng thuốc', 'plan.activate': 'Kích hoạt liệu trình', 'plan.create': 'Tạo liệu trình', 'plan.session': 'Thực hiện buổi liệu trình',
  'rx.cancel': 'Hủy đơn thuốc', 'rx.issue': 'Kê đơn', 'stock.adjust': 'Điều chỉnh tồn', 'stock.in': 'Nhập kho', 'visit.checkin': 'Check-in' };

export default function AuditPage() {
  const [q, setQ] = useState('');
  const [prefix, setPrefix] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const dq = useDebounce(q, 300);
  const l = useLoad(async () => (await api.get('/clinic/audit/', { params: { q: dq || undefined, prefix: prefix || undefined, from: from || undefined, to: to || undefined, limit: 200 } })).data, [dq, prefix, from, to]);
  const d = l.data;
  return <>
    <PageHead />
    <Card pad={false}>
      <div className="cl-toolbar cl-toolbar-row">
        <div className="cl-input-icon"><SearchRounded /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo người dùng, thao tác, nội dung…" /></div>
        <select className="cl-sel" value={prefix} onChange={(e) => setPrefix(e.target.value)}><option value="">Mọi nhóm thao tác</option>{(d?.groups || []).map((g) => <option key={g} value={g}>{g}</option>)}</select>
        <input className="cl-sel" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Từ ngày" />
        <input className="cl-sel" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Đến ngày" />
      </div>
      {l.loading && !d ? <Loading /> : d?.rows.length ? <div className="cl-table-wrap"><table className="cl-table">
        <thead><tr><th>Thời gian</th><th>Người thực hiện</th><th>Thao tác</th><th>Chi tiết</th></tr></thead>
        <tbody>{d.rows.map((r) => <tr key={r.id}><td>{fmtDateTime(r.at)}</td><td><b>{r.user}</b>{r.role && <small className="cl-sub">{roleLabel(r.role)}</small>}</td>
          <td><Pill tone="teal">{LABEL[r.action] || r.action}</Pill></td><td>{r.detail || '—'}</td></tr>)}</tbody></table></div> : <Empty title="Không có bản ghi" />}
      {d && <p className="cl-hint" style={{ padding: '0 18px 14px' }}>Hiển thị {d.rows.length} / {d.total} bản ghi mới nhất. Nhật ký không thể sửa hoặc xóa.</p>}
    </Card>
  </>;
}
