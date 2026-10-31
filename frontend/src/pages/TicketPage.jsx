import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import CheckRounded from '@mui/icons-material/CheckRounded';
import ContentCopyRounded from '@mui/icons-material/ContentCopyRounded';
import api from '../api/client';
const money=(v)=>new Intl.NumberFormat('vi-VN').format(v||0)+'đ';
export default function TicketPage(){
  const {code}=useParams(); const [ticket,setTicket]=useState(null); const [error,setError]=useState(''); const [copied,setCopied]=useState(false); const [copyError,setCopyError]=useState('');
  useEffect(()=>{api.get(`/tickets/${code}/`).then(({data})=>setTicket(data)).catch(()=>setError('Không tìm thấy vé hoặc mã xác nhận không hợp lệ.'));},[code]);
  if(error)return <div className="public-page narrow"><div className="alert-box error">{error}</div></div>;
  if(!ticket)return <div className="public-page narrow"><div className="public-card muted">Đang tải vé điện tử...</div></div>;
  const copy=async()=>{setCopyError('');try{await navigator.clipboard.writeText(ticket.confirm_code);setCopied(true);setTimeout(()=>setCopied(false),1600);}catch{setCopyError('Không thể sao chép tự động. Vui lòng chọn và sao chép mã vé.')}};
  return <div className="public-page narrow">
    <div className="ticket-success-heading"><div className="ticket-success-icon"><CheckRounded sx={{fontSize:38}}/></div><div className="ticket-success-label">Đã giữ lịch thành công</div><h1 className="public-page-title">Cảm ơn bạn, {ticket.customer_name}!</h1><p className="public-page-subtitle">AkinaClinic đã nhận yêu cầu đặt lịch và sẽ sớm xác nhận.</p></div>
    <div className="ticket-card"><div className="ticket-card-header"><div><div className="ticket-card-eyebrow">AkinaClinic electronic appointment ticket</div><div className="ticket-card-title">Chi tiết lịch hẹn</div></div><span className={`ap-badge ${ticket.status}`}>{ticket.status_label}</span></div><div className="ticket-card-body">
      <table className="ap-table"><tbody><Row label="Loại lịch" value={ticket.appointment_type_label||'Khám / tư vấn'}/>{ticket.treatment_session_label&&<Row label="Bu\u1ed5i li\u1ec7u tr\u00ecnh" value={ticket.treatment_session_label}/>}<Row label="Dịch vụ" value={ticket.services.join(', ')}/><Row label="Chuyên viên" value={ticket.staff_name||'AkinaClinic sẽ sắp xếp'}/><Row label="Ngày hẹn" value={new Date(ticket.appointment).toLocaleDateString('vi-VN')}/><Row label="Giờ hẹn" value={new Date(ticket.appointment).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})}/><Row label="Khách hàng" value={ticket.customer_name}/><Row label="Tạm tính" value={money(ticket.subtotal ?? ticket.total)}/>{ticket.discount_total>0&&<Row label={`Voucher ${ticket.applied_voucher_code||''}`} value={`-${money(ticket.discount_total)}`}/>}<Row label="Tổng thanh toán" value={ticket.treatment_session_label?'\u0110\u00e3 n\u1eb1m trong li\u1ec7u tr\u00ecnh':money(ticket.total)} strong/>{ticket.loyalty_points_earned>0&&<Row label="Điểm thưởng" value={`+${ticket.loyalty_points_earned} điểm`}/>}</tbody></table>
      <div className="ticket-code"><div className="ticket-code-label">Mã vé / mã xác nhận</div><div className="ticket-code-value">{ticket.confirm_code}</div><button onClick={copy} className="ticket-copy"><ContentCopyRounded sx={{fontSize:15,verticalAlign:'middle',marginRight:4}}/>{copied?'Đã sao chép':'Sao chép mã'}</button>{copyError&&<div className="ticket-copy-error" role="status">{copyError}</div>}</div>
    </div></div><div className="ticket-actions"><Link to="/bookings" className="ohio-btn ohio-btn-primary">Xem lịch hẹn của tôi</Link><Link to="/book" className="ohio-btn ohio-btn-outline">Đặt thêm lịch khác</Link></div>
  </div>;
}
function Row({label,value,strong=false}){return <tr><td className="ticket-row-label">{label}</td><td className={`ticket-row-value${strong?' strong':''}`}>{value}</td></tr>}
