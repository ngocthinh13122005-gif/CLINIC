import { useEffect, useMemo, useRef, useState } from 'react';
import NotificationsNoneRounded from '@mui/icons-material/NotificationsNoneRounded';
import DoneAllRounded from '@mui/icons-material/DoneAllRounded';
import api from '../api/client';
import { ensureFirebaseAuth, firebaseEnabled, subscribeNotifications } from '../services/firebase';

export default function NotificationBell({ user }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const timer = useRef(null);
  const load = () => api.get('/notifications/').then(({data}) => setItems(data.results || data || [])).catch(()=>{});
  useEffect(()=>{ load(); let unsub=()=>{}; let alive=true; (async()=>{ if(firebaseEnabled && await ensureFirebaseAuth()) { unsub=subscribeNotifications(user?.id, rows=>{ if(alive){ setItems(rows); window.dispatchEvent(new CustomEvent('ohio:realtime',{detail:rows?.[0]||null})); } }, ()=>{timer.current=setInterval(load,8000)}); } else timer.current=setInterval(load,8000); })(); return()=>{alive=false;unsub();if(timer.current)clearInterval(timer.current)}; },[user?.id]);
  const unread = useMemo(()=>items.filter(i=>!i.is_read && !i.isRead).length,[items]);
  const readOne = async(item)=>{ setOpen(false); if(item.id) try { await api.post(`/notifications/${item.id}/read/`); } catch {} load(); };
  const readAll = async()=>{ try{await api.post('/notifications/read_all/');}catch{} load(); };
  return <div className="notif-wrap">
    <button className="ap-icon-btn notif-button" onClick={()=>setOpen(v=>!v)} aria-label="Thông báo"><NotificationsNoneRounded/>{unread>0&&<span className="notif-badge">{unread>99?'99+':unread}</span>}</button>
    {open&&<div className="notif-panel">
      <div className="notif-head"><div><strong>Thông báo</strong><span>{unread} chưa đọc</span></div><button className="notif-read-all" onClick={readAll}><DoneAllRounded sx={{fontSize:17}}/>Đọc hết</button></div>
      <div className="notif-list">{items.slice(0,12).map((n,idx)=><button className={`notif-item ${(!n.is_read&&!n.isRead)?'unread':''}`} onClick={()=>readOne(n)} key={n.id||idx}><strong>{n.title}</strong><span>{n.message}</span><small>{n.created_at ? new Date(n.created_at).toLocaleString('vi-VN') : (n.createdAt ? new Date(n.createdAt).toLocaleString('vi-VN') : '')}</small></button>)}{!items.length&&<div className="notif-empty">Chưa có thông báo.</div>}</div>
    </div>}
  </div>;
}
