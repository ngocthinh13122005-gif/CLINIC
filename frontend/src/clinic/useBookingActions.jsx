import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/client';
import { errMsg, useToast } from './ui';
import { BookingPanel, DetailDrawer, ReasonDialog, SlotDialog } from './CalendarPanels';

/**
 * Gom toàn bộ thao tác trên một lịch hẹn (xác nhận, đón, sửa, hủy, đổi giờ, đặt lại, vắng mặt, đến trễ, liên hệ xác nhận)
 * và các hộp thoại/ngăn đi kèm. Dùng cho chế độ DANH SÁCH; bản timeline (Calendar.jsx) có logic tương đương.
 * Mọi ràng buộc vẫn do server quyết định (api/calendar_api.py).
 */
export function useBookingActions({ canBook, reload, doctors, services, bookings, blocks, hours }) {
  const nav = useNavigate();
  const [toast, toastNode] = useToast();
  const [alert, setAlert] = useState('');
  const [dlg, setDlg] = useState(null);
  const [panel, setPanel] = useState(null);
  const [drawerId, setDrawerId] = useState(null);

  const run = async (fn, msg) => {
    setAlert('');
    try { await fn(); if (msg) toast(msg); reload(); return true; } catch (e) { setAlert(errMsg(e)); return false; }
  };

  const act = (kind, b) => {
    if (kind === 'confirm') return run(() => api.post(`/bookings/${b.id}/confirm/`), 'Đã xác nhận lịch hẹn.');
    if (kind === 'arrive') return run(() => api.post('/clinic/visits/from-booking/', { booking_id: b.id }), 'Đã đón bệnh nhân — đang chờ ở sảnh.');
    if (kind === 'edit') { setDrawerId(null); return setPanel({ booking: b }); }
    if (kind === 'cancel') return setDlg({ type: 'cancel', b });
    if (kind === 'reschedule' || kind === 'rebook') return setDlg({ type: 'slot', kind, b });
    if (kind === 'late') return run(() => api.post(`/bookings/${b.id}/running-late/`, { late: !b.running_late }), b.running_late ? 'Đã bỏ đánh dấu đến trễ.' : 'Đã đánh dấu khách đến trễ.');
    if (kind === 'no_show') return run(() => api.post(`/bookings/${b.id}/no-show/`), 'Đã đánh dấu vắng mặt.');
    if (kind === 'undo_no_show') return run(() => api.post(`/bookings/${b.id}/no-show/`, { undo: true }), 'Đã bỏ đánh dấu vắng mặt.');
    if (kind.startsWith('state:')) return run(() => api.post(`/bookings/${b.id}/confirm-state/`, { state: kind.slice(6) }), 'Đã cập nhật tình trạng liên hệ.');
    if (kind === 'checkout') return nav('/thu-ngan');
    if (kind === 'expand' || kind === 'detail') return setDrawerId(b.id);
    return null;
  };

  const drawerB = drawerId && bookings.find((b) => b.id === drawerId);
  const overlays = <>
    {drawerB && <DetailDrawer b={drawerB} canBook={canBook} onClose={() => setDrawerId(null)} act={act} />}
    {panel && <BookingPanel key={panel.booking?.id || `${panel.staff}${panel.date}${panel.time}`} init={panel} doctors={doctors} services={services}
      bookings={bookings} blocks={blocks} hours={hours} onClose={() => setPanel(null)} onSaved={(m) => { setPanel(null); toast(m); reload(); }} />}
    {dlg?.type === 'cancel' && <ReasonDialog b={dlg.b} onCancel={() => setDlg(null)}
      onConfirm={async (reason) => { const b = dlg.b; setDlg(null); await run(() => api.post(`/bookings/${b.id}/cancel/`, { reason }), 'Đã hủy lịch hẹn.'); }} />}
    {dlg?.type === 'slot' && <SlotDialog kind={dlg.kind} b={dlg.b} doctors={doctors} bookings={bookings} blocks={blocks} hours={hours} onCancel={() => setDlg(null)}
      onConfirm={async (p) => { const { kind, b } = dlg; setDlg(null);
        await run(() => (kind === 'rebook' ? api.post(`/bookings/${b.id}/rebook/`, p) : api.post(`/bookings/${b.id}/edit/`, p)), kind === 'rebook' ? 'Đã đặt lại lịch hẹn.' : 'Đã đổi giờ lịch hẹn.'); }} />}
    {toastNode}
  </>;

  return { act, run, overlays, alert, setAlert, openCreate: (init) => setPanel(init) };
}
