import { Card, PageTitle, Pill, dateText, useApi } from './portalKit';

export default function PortalForms() {
  const { data, loading, error, reload } = useApi('/clinic/my-portal/forms/');
  const rows = data?.forms || [];
  return <>
    <PageTitle title="Phiếu cam kết" sub="Phiếu đồng ý điều trị, chụp ảnh và bảo hành do phòng khám lập cho bạn."/>
    {error && <div className="cp-error" role="alert">{error} <button type="button" onClick={reload}>Thử lại</button></div>}
    {!loading && data && !data.patient_linked && <div className="cp-note">Tài khoản chưa được liên kết với hồ sơ bệnh nhân. Vui lòng liên hệ phòng khám.</div>}
    <Card flush>
      {rows.length ? <div className="cp-table-wrap"><table className="cp-table"><thead><tr><th>Phiếu</th><th>Loại</th><th>Ngày lập</th><th>Ngày ký</th><th>Trạng thái</th></tr></thead>
        <tbody>{rows.map((f) => <tr key={f.id}><td><strong>{f.title}</strong><small>{f.code}</small>{f.body && <details className="cp-form-content"><summary>Xem nội dung phiếu</summary><p>{f.body}</p></details>}</td><td>{f.kind}</td><td>{dateText(f.created_at)}</td><td>{dateText(f.signed_at)}</td>
          <td><Pill kind={f.status === 'signed' ? 'ok' : 'wait'}>{f.status_label}</Pill>{f.valid_until && <small>Bảo hành đến {dateText(f.valid_until)}</small>}</td></tr>)}</tbody></table></div>
        : <p className="cp-muted pad">{loading ? 'Đang tải…' : error ? 'Dữ liệu chưa tải được.' : 'Chưa có phiếu cam kết nào.'}</p>}
      {rows.some((f) => f.status === 'pending') && <p className="cp-muted pad">Phiếu “Chờ ký” sẽ được ký trực tiếp tại phòng khám trong buổi hẹn của bạn.</p>}
    </Card>
  </>;
}
