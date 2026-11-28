import { useEffect, useMemo, useRef, useState } from 'react';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import DoneAllRounded from '@mui/icons-material/DoneAllRounded';
import api from '../api/client';
import { useNavigate } from 'react-router-dom';

export default function NotificationBell({ user }) {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const load = () => api.get('/notifications/').then(({data}) => setItems(data.results || data || [])).catch(()=>{});
  useEffect(() => {
    if (!user?.id) return undefined;
    load();
    let alive = true;
    let unsub = () => {};
    const poll = () => { if (alive && !timer.current) timer.current = setInterval(load, 8000); };
    const configured = Boolean(import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_PROJECT_ID && import.meta.env.VITE_FIREBASE_APP_ID);
    if (configured) {
      import('../services/firebase').then(async ({ ensureFirebaseAuth, subscribeNotifications }) => {
        if (!alive) return;
        if (await ensureFirebaseAuth()) {
          if (!alive) return;
          unsub = subscribeNotifications(user.id, rows => {
            if (alive) { setItems(rows); window.dispatchEvent(new CustomEvent('ohio:realtime', { detail: rows?.[0] || null })); }
          }, poll);
        } else poll();
      }).catch(poll);
    } else poll();
    return () => { alive = false; unsub(); if (timer.current) clearInterval(timer.current); timer.current = null; };
  }, [user?.id]);
  const unread = useMemo(()=>items.filter(i=>!i.is_read && !i.isRead).length,[items]);
  const readOne = async(item)=>{
    setOpen(false);
    const bookingId = Number(item.data?.booking_id);
    if (Number.isSafeInteger(bookingId) && bookingId > 0 && ['manager', 'doctor', 'consultant', 'staff'].includes(user?.role)) {
      navigate(`/lich-hen?booking=${bookingId}`);
    }
    if(item.id) try { await api.post(`/notifications/${item.id}/read/`); } catch {}
    load();
  };
  const readAll = async()=>{ try{await api.post('/notifications/read_all/');}catch{} load(); };
  return <div className="notif-wrap">
    <button className="ap-icon-btn notif-button" onClick={()=>setOpen(v=>!v)} aria-label="Thông báo"><NotificationsNoneRounded/>{unread>0&&<span className="notif-badge">{unread>99?'99+':unread}</span>}</button>
    {open&&<div className="notif-panel">
      <div className="notif-head"><div><strong>Thông báo</strong><span>{unread} chưa đọc</span></div><button className="notif-read-all" onClick={readAll}><DoneAllRounded sx={{fontSize:17}}/>Đọc hết</button></div>
      <div className="notif-list">{items.slice(0,12).map((n,idx)=><button className={`notif-item ${(!n.is_read&&!n.isRead)?'unread':''}`} onClick={()=>readOne(n)} key={n.id||idx}><strong>{n.title}</strong><span>{n.message}</span><small>{n.created_at ? new Date(n.created_at).toLocaleString('vi-VN') : (n.createdAt ? new Date(n.createdAt).toLocaleString('vi-VN') : '')}</small></button>)}{!items.length&&<div className="notif-empty">Chưa có thông báo.</div>}</div>
    </div>}
  </div>;
}
