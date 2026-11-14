import { useEffect, useMemo, useState } from 'react';
import CloseRounded from '@mui/icons-material/CloseRounded';
import PrintRounded from '@mui/icons-material/PrintRounded';
import api from '../api/client';
import { CLINIC } from './clinicInfo';
import { fmtDate, fmtDateTime, money } from './ui';
import './invoice.css';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// Giá trị mẫu còn để trong ngoặc vuông (chưa cấu hình) thì không in ra giấy.
const real = (v) => (v && !/^\[.*\]$/.test(String(v).trim()) ? String(v).trim() : '');

const STATUS = { paid: ['Đã thanh toán', '#0f7a3d', '#e4f6ea'], partial: ['Thanh toán một phần', '#a15c07', '#fff3d6'], unpaid: ['Chưa thanh toán', '#b42323', '#fde8e8'], void: ['Đã hủy', '#4b5565', '#e9edf2'] };

const FALLBACK = { name: CLINIC.name, address: CLINIC.address, phone: CLINIC.phone, license: CLINIC.license, tax: CLINIC.taxCode, email: '' };
export async function loadClinicInfo() {
  try {
    const { data } = await api.get('/clinic/profile/');
    return { name: data.brand_name || FALLBACK.name, address: data.address || FALLBACK.address, phone: data.hotline || FALLBACK.phone, license: data.license || FALLBACK.license, tax: data.tax_code || FALLBACK.tax, email: data.email || '' };
  } catch { return FALLBACK; }
}

/** Thông tin phòng khám: ưu tiên cấu hình từ máy chủ, rơi về clinicInfo.js. */
export function useClinicInfo() {
  const [c, setC] = useState(FALLBACK);
  useEffect(() => { let off = false; loadClinicInfo().then((v) => !off && setC(v)); return () => { off = true; }; }, []);
  return c;
}

export function invoiceDocHtml(inv, clinic) {
  const st = STATUS[inv.status] || STATUS.unpaid;
  const lines = [real(clinic.address), real(clinic.phone) && `ĐT: ${real(clinic.phone)}`, real(clinic.email), real(clinic.tax) && `MST: ${real(clinic.tax)}`].filter(Boolean);
  const rows = inv.items.map((i, n) => `<tr><td class="n">${n + 1}</td><td><b>${esc(i.name)}</b><small>${esc({ service: 'Dịch vụ', medicine: 'Sản phẩm / thuốc', package: 'Gói liệu trình', other: 'Khác' }[i.kind] || '')}</small></td><td class="r">${i.quantity}</td><td class="r">${money(i.unit_price)}</td><td class="r"><b>${money(i.amount ?? i.quantity * i.unit_price)}</b></td></tr>`).join('');
  const refunded = inv.refunded || 0;
  const pays = inv.payments.map((p) => `<tr><td>${fmtDateTime(p.paid_at)}</td><td>${esc(p.method_label)}${p.reference ? ` · ${esc(p.reference)}` : ''}</td><td class="r"><b>${money(p.amount)}</b></td></tr>`).join('');
  return `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Hóa đơn ${esc(inv.code)}</title><style>
  *{box-sizing:border-box}body{margin:0;background:#fff;color:#1c2a3e;font:14px/1.5 "Be Vietnam Pro","Segoe UI",Roboto,Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .sheet{max-width:820px;margin:0 auto;padding:36px 44px 40px;position:relative}
  .top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;padding-bottom:20px;border-bottom:3px solid #0a5964}
  .brand b{display:block;font-size:20px;color:#0a5964;letter-spacing:.01em}.brand span{display:block;color:#5d6b7e;font-size:12.5px;margin-top:2px}
  .ttl{text-align:right}.ttl h1{margin:0;font-size:26px;letter-spacing:.14em;color:#12233b;font-weight:700}.ttl .st{display:inline-block;margin-top:8px;padding:3px 12px;border-radius:99px;font-size:12px;font-weight:700;background:${st[2]};color:${st[1]}}
  .meta{display:grid;grid-template-columns:1.2fr 1fr 1fr;gap:20px;margin:22px 0}.meta h6{margin:0 0 5px;font-size:10.5px;letter-spacing:.1em;text-transform:uppercase;color:#7a8799;font-weight:700}.meta p{margin:0;font-size:13.5px}.meta p+p{margin-top:2px}.meta .big{font-weight:700;font-size:15px;color:#12233b}
  table{width:100%;border-collapse:collapse}.items thead th{background:#eef5f6;color:#37495e;font-size:11px;letter-spacing:.07em;text-transform:uppercase;text-align:left;padding:10px 12px;border-bottom:1px solid #d5e3e6}
  .items td{padding:11px 12px;border-bottom:1px solid #edf1f5;vertical-align:top}.items small{display:block;color:#7a8799;font-size:11.5px;margin-top:1px}.r{text-align:right}.n{color:#94a0b1;width:34px}
  .items th.r,.items td.r{text-align:right;white-space:nowrap}
  .sum{display:flex;justify-content:flex-end;margin-top:14px}.sum table{width:330px}.sum td{padding:6px 12px;font-size:13.5px;color:#4a586b}.sum td:last-child{text-align:right;color:#1c2a3e;font-variant-numeric:tabular-nums}
  .sum tr.g td{border-top:2px solid #0a5964;padding-top:12px;font-size:15px;font-weight:700;color:#0a5964}.sum tr.g td:last-child{font-size:21px}
  .sum tr.o td{background:${inv.balance && inv.status !== 'void' ? '#fff3f3' : '#f1f8f3'};font-weight:700;color:${inv.balance && inv.status !== 'void' ? '#b42323' : '#0f7a3d'}}
  h3{margin:26px 0 8px;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:#0a5964}.pay td{padding:8px 12px;border-bottom:1px dashed #dbe3ea;font-size:13px}.pay{background:#f8fafb;border-radius:10px}
  .note{margin-top:18px;padding:12px 14px;background:#f8fafb;border-radius:10px;font-size:13px;color:#4a586b}
  .foot{margin-top:30px;padding-top:14px;border-top:1px solid #e3e9ef;text-align:center;color:#6b788b;font-size:12.5px}.foot b{display:block;color:#0a5964;font-size:14px;margin-bottom:2px}
  .void{position:absolute;inset:0;display:grid;place-items:center;pointer-events:none}.void span{font-size:84px;font-weight:800;color:rgba(180,35,35,.12);transform:rotate(-22deg);letter-spacing:.1em}
  @page{margin:12mm}@media print{.sheet{padding:0}}
  </style></head><body><div class="sheet">${inv.status === 'void' ? '<div class="void"><span>ĐÃ HỦY</span></div>' : ''}
  <div class="top"><div class="brand"><b>${esc(clinic.name)}</b>${lines.map((l) => `<span>${esc(l)}</span>`).join('')}</div><div class="ttl"><h1>HÓA ĐƠN</h1><span class="st">${st[0]}</span></div></div>
  <div class="meta"><div><h6>Khách hàng</h6><p class="big">${esc(inv.patient_code === 'KHACHLE' ? 'Khách vãng lai' : inv.patient_name)}</p>${inv.patient_code !== 'KHACHLE' ? `<p>Mã: ${esc(inv.patient_code)}</p>` : ''}${inv.patient_phone ? `<p>${esc(inv.patient_phone)}</p>` : ''}</div>
  <div><h6>Số hóa đơn</h6><p class="big">#${esc(inv.code)}</p><h6 style="margin-top:10px">Ngày lập</h6><p>${fmtDate(inv.created_at)}</p></div>
  <div><h6>Người lập</h6><p>${esc(inv.created_by_name || '—')}</p><h6 style="margin-top:10px">Hạn thanh toán</h6><p>${inv.due_date ? fmtDate(inv.due_date) : esc(inv.payment_term_label || 'Thanh toán ngay')}</p></div></div>
  <table class="items"><thead><tr><th>#</th><th>Nội dung</th><th class="r">SL</th><th class="r">Đơn giá</th><th class="r">Thành tiền</th></tr></thead><tbody>${rows}</tbody></table>
  <div class="sum"><table><tr><td>Tạm tính</td><td>${money(inv.subtotal)}</td></tr>${inv.discount ? `<tr><td>Giảm giá</td><td>-${money(inv.discount)}</td></tr>` : ''}
  <tr class="g"><td>Tổng cộng</td><td>${money(inv.total)}</td></tr><tr><td>Đã thanh toán</td><td>${money(inv.paid)}</td></tr>${refunded ? `<tr><td>Đã hoàn tiền</td><td>${money(refunded)}</td></tr>` : ''}
  <tr class="o"><td>Còn lại</td><td>${inv.status === 'void' ? '—' : money(inv.balance)}</td></tr></table></div>
  ${pays ? `<h3>Chi tiết thanh toán</h3><table class="pay">${pays}</table>` : ''}
  ${inv.note ? `<div class="note"><b>Ghi chú:</b> ${esc(inv.note)}</div>` : ''}
  <div class="foot"><b>Cảm ơn quý khách đã tin tưởng ${esc(clinic.name)}!</b>Vui lòng giữ hóa đơn để đối chiếu khi cần.</div></div></body></html>`;
}

export function printInvoiceDoc(inv, clinic) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  f.srcdoc = invoiceDocHtml(inv, clinic);
  f.onload = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1500); };
}

export function InvoicePreviewModal({ inv, onClose }) {
  const clinic = useClinicInfo();
  const html = useMemo(() => invoiceDocHtml(inv, clinic), [inv, clinic]);
  useEffect(() => { const k = (e) => e.key === 'Escape' && onClose(); window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
  return <div className="iv-modal-wrap" role="dialog" aria-modal="true" aria-label="Xem trước hóa đơn" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
    <div className="iv-modal">
      <header><h2>Xem trước hóa đơn</h2><span className="sp" />
        <button className="iv-btn" onClick={() => printInvoiceDoc(inv, clinic)}><PrintRounded fontSize="small" />In</button>
        <button className="iv-ico" aria-label="Đóng" onClick={onClose}><CloseRounded /></button></header>
      <iframe title="Hóa đơn" srcDoc={html} sandbox="allow-same-origin" />
    </div>
  </div>;
}
