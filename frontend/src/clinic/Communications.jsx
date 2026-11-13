import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ForumOutlined from '@mui/icons-material/ForumOutlined';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import DoneAllRounded from '@mui/icons-material/DoneAllRounded';
import ExpandMoreRounded from '@mui/icons-material/ExpandMoreRounded';
import ChatBubbleOutlineRounded from '@mui/icons-material/ChatBubbleOutlineRounded';
import MailOutlineRounded from '@mui/icons-material/MailOutlineRounded';
import MoreVertRounded from '@mui/icons-material/MoreVertRounded';
import OpenInFullRounded from '@mui/icons-material/OpenInFullRounded';
import MinimizeRounded from '@mui/icons-material/MinimizeRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import PrintOutlined from '@mui/icons-material/PrintOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';
import api from '../api/client';
import { Avatar, Empty, Loading, errMsg, fmtDate, fmtTime, useLoad } from './ui';
import { EmailComposer, SmsComposer } from './CommsComposer';
import { JumpCalendar, PrintModal, dayKey } from './CommsExtras';
import './communications.css';

const DOW = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];
const ago = (v) => {
  const days = Math.floor((Date.now() - new Date(v).getTime()) / 864e5);
  if (days < 1) return 'hôm nay';
  if (days < 7) return `${days} ngày trước`;
  if (days < 30) return `${Math.floor(days / 7)} tuần trước`;
  if (days < 365) return `${Math.floor(days / 30)} tháng trước`;
  return `${Math.floor(days / 365)} năm trước`;
};
const statusTone = { sent: null, simulated: 'amber', failed: 'red' };

function Bubble({ m }) {
  return <div className="cm-bubble-wrap"><time>{fmtDate(m.created_at)}, {fmtTime(m.created_at)}</time><div className="cm-bubble">{m.body}</div><small>Gửi tới {m.to_address}</small></div>;
}

function MailFrame({ html }) {
  const ref = useRef(null);
  const doc = useMemo(() => (/<head[\s>]/i.test(html) ? html.replace(/<head([^>]*)>/i, '<head$1><base target="_blank">') : `<base target="_blank">${html}`), [html]);
  const fit = () => { const d = ref.current?.contentDocument; if (d?.body) ref.current.style.height = `${Math.min(900, d.documentElement.scrollHeight + 4)}px`; };
  return <iframe ref={ref} className="cm-frame" title="Nội dung email" sandbox="allow-same-origin" srcDoc={doc} onLoad={fit} />;
}

function Thread({ m, onOpenInbox }) {
  return <div className="cm-thread">
    <div className="cm-thread-head"><span>{m.channel_label} · {m.message_count} tin · {m.status_label}</span>
      <button className="cm-link" onClick={() => onOpenInbox(m.conversation_id)}>Mở trong Hộp thư tư vấn<OpenInNewRounded /></button></div>
    {m.messages.map((x) => <div key={x.id} className={`cm-msg ${x.own ? 'cust' : 'staff'}`}>
      <small>{x.own ? x.name : `${x.name} (phòng khám)`} · {fmtDate(x.at)} {fmtTime(x.at)}</small>
      <div className="cm-bubble">{x.text}</div></div>)}
  </div>;
}

function Item({ m, open, onToggle, onResend, onDelete, canDelete, onOpenInbox }) {
  const [menu, setMenu] = useState(false);
  const ref = useRef(null);
  useEffect(() => { if (!menu) return undefined; const h = (e) => ref.current && !ref.current.contains(e.target) && setMenu(false); document.addEventListener('mousedown', h); return () => document.removeEventListener('mousedown', h); }, [menu]);
  const isSms = m.channel === 'sms';
  const isChat = m.channel === 'chat';
  const preview = (m.body || '').replace(/\s+/g, ' ').slice(0, 160);
  const tone = statusTone[m.status];
  return <article className={`cm-item ${m.channel} ${open ? 'open' : ''}`}>
    <div className="cm-item-head" onClick={onToggle}>
      <span className={`cm-ico ${m.channel}`}>{isChat ? <ForumOutlined /> : isSms ? <ChatBubbleOutlineRounded /> : <MailOutlineRounded />}</span>
      <div className="cm-item-main">
        <h4>{isChat ? `Chat · ${m.subject}` : isSms ? 'SMS' : m.subject || 'Email'}
          {m.status === 'sent' && (isSms ? <DoneAllRounded className="ok" /> : <CheckRounded className="ok" />)}
          {tone && <em className={tone}>{m.status === 'failed' ? <ErrorOutlineRounded /> : null}{m.status_label}</em>}</h4>
        <p className="cm-meta">{fmtDate(m.created_at)}, {fmtTime(m.created_at)} · {isChat ? `${m.channel_label} · ${m.message_count} tin nhắn` : `Từ: ${m.from_address || '—'} · Đến: ${m.to_address}${m.sent_by_name ? ` · Gửi bởi ${m.sent_by_name}` : ''}`}</p>
        {m.error && <p className="cm-err">{m.error}</p>}
        {!open && <p className="cm-prev">{preview}</p>}
      </div>
      <button className="cm-icon-btn" aria-label={open ? 'Thu gọn' : 'Mở rộng'}><ExpandMoreRounded className="cm-chev" /></button>
      {!isChat && <div className="cm-menu-wrap" ref={ref} onClick={(e) => e.stopPropagation()}>
        <button className="cm-icon-btn" aria-label="Thao tác" onClick={() => setMenu(!menu)}><MoreVertRounded /></button>
        {menu && <div className="cm-menu"><button onClick={() => { setMenu(false); onResend(m); }}>Gửi lại</button>{canDelete && <button className="red" onClick={() => { setMenu(false); onDelete(m); }}>Xóa</button>}</div>}
      </div>}
    </div>
    {open && <div className="cm-item-body">{isChat ? <Thread m={m} onOpenInbox={onOpenInbox} /> : isSms ? <Bubble m={m} /> : <div className="cm-mail">
      <dl><dt>Tiêu đề:</dt><dd><b>{m.subject}</b></dd><dt>Từ:</dt><dd>{m.from_address}</dd><dt>Tới:</dt><dd>{m.to_address}</dd><dt>Lúc:</dt><dd>{fmtDate(m.created_at)}, {fmtTime(m.created_at)}</dd></dl>
      <MailFrame html={m.html_full || `<p>${m.body}</p>`} /></div>}</div>}
  </article>;
}

/* ------------------------------------------------------------- tab */
export default function Communications({ patient, role, onChanged, toast }) {
  const navigate = useNavigate();
  const [channel, setChannel] = useState('all');
  const [open, setOpen] = useState({}); const [fab, setFab] = useState(false);
  const [composer, setComposer] = useState(null); const [calOpen, setCalOpen] = useState(false); const [printOpen, setPrintOpen] = useState(false);
  const { data, loading, error, reload } = useLoad(async () => (await api.get('/clinic/messages/', { params: { patient: patient.id, channel: channel === 'all' ? undefined : channel } })).data, [patient.id, channel]);
  const all = useLoad(async () => (await api.get('/clinic/messages/', { params: { patient: patient.id } })).data, [patient.id]);
  const info = all.data || data;
  const rows = data?.results || [];
  const groups = useMemo(() => {
    const days = {};
    rows.forEach((m) => { (days[dayKey(m.created_at)] = days[dayKey(m.created_at)] || []).push(m); });
    return Object.entries(days).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rows]);
  const months = useMemo(() => groups.reduce((acc, [k, items]) => { const mk = k.slice(0, 7); (acc[mk] = acc[mk] || []).push([k, items]); return acc; }, {}), [groups]);
  const refresh = () => { reload(true); all.reload(true); onChanged?.(); };
  const sent = (d) => { refresh();
    toast?.(d.status === 'sent' ? 'Đã gửi.' : d.status === 'simulated' ? 'Đã ghi nhật ký (chưa gửi thật: chưa cấu hình nhà cung cấp).' : `Gửi lỗi: ${d.error || 'không rõ'}`, d.status === 'failed' ? 'err' : undefined);
    if (d.channel === 'email') setComposer(null); };
  const resend = async (m) => { try { const { data: d } = await api.post(`/clinic/messages/${m.id}/resend/`); sent(d); } catch (e) { toast?.(errMsg(e), 'err'); } };
  const del = async (m) => { if (!window.confirm('Xóa mục này khỏi nhật ký liên lạc?')) return; try { await api.delete(`/clinic/messages/${m.id}/`); refresh(); } catch (e) { toast?.(errMsg(e), 'err'); } };
  const dayset = useMemo(() => new Set((all.data?.results || []).map((m) => dayKey(m.created_at))), [all.data]);
  const jumpTo = (v) => { if (channel !== 'all') setChannel('all'); setTimeout(() => document.getElementById(`cm-day-${v}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80); };
  const counts = info?.counts || { all: 0, email: 0, sms: 0, chat: 0 };
  const tabs = [['all', 'Tất cả', counts.all, null], ['email', 'Email', counts.email, MailOutlineRounded], ['sms', 'SMS', counts.sms, ChatBubbleOutlineRounded], ['chat', 'Chat', counts.chat, ForumOutlined]];
  return <div className="cm">
    {info && (!info.email_live || !info.sms_live) && <div className="cm-banner"><ErrorOutlineRounded /><span>
      {!info.email_live && <>Email chưa cấu hình SMTP nên thư chỉ được lưu nhật ký, chưa gửi thật. </>}
      {!info.sms_live && <>SMS chưa kết nối nhà cung cấp nên tin nhắn chỉ được lưu nhật ký, chưa gửi thật.</>}</span></div>}
    {info && !info.contact_consent && <div className="cm-banner soft"><ErrorOutlineRounded /><span>Khách chưa có đồng ý nhận liên hệ nhắc lịch / chăm sóc. Chỉ gửi nội dung phục vụ điều trị; tin quảng bá cần đồng ý riêng.</span></div>}
    <div className="cm-bar">
      <nav className="cm-tabs" role="tablist">{tabs.map(([k, t, n, Ic]) => <button key={k} role="tab" aria-selected={channel === k} className={channel === k ? 'on' : ''} onClick={() => setChannel(k)}>{Ic && <Ic />}{t}<i>{n}</i></button>)}</nav>
      <div className="cm-right"><span className="cm-chip green"><i />{(all.data?.results || []).filter((m) => m.status === 'sent').length} đã gửi thật / {counts.all} mục</span>
        <span className="cm-cal-anchor"><button className={`cm-btn ${calOpen ? 'on' : ''}`} onClick={() => setCalOpen(!calOpen)}><CalendarMonthOutlined />Nhảy tới ngày</button>
          {calOpen && <JumpCalendar days={dayset} onPick={jumpTo} onClose={() => setCalOpen(false)} />}</span>
        <button className="cm-btn" onClick={() => setPrintOpen(true)}><PrintOutlined />In tất cả</button></div>
    </div>
    {error && <div className="cl-alert error">{error}</div>}
    {loading && !data ? <Loading /> : !rows.length ? <Empty title={channel === 'chat' && info && !info.has_account ? 'Khách chưa có tài khoản liên kết' : 'Chưa có liên lạc nào'} hint={channel === 'chat' ? (info?.has_account ? 'Khách chưa nhắn tin với phòng khám.' : 'Chỉ khách có tài khoản (hoặc nhắn qua Messenger) mới chat được. Liên kết hồ sơ với tài khoản để xem chat tại đây.') : 'Bấm nút + ở góc phải để gửi email hoặc SMS cho khách.'} />
      : <div className="cm-timeline">{Object.entries(months).sort((a, b) => b[0].localeCompare(a[0])).map(([mk, days]) => <section key={mk}>
        <h3 className="cm-month">THÁNG {mk.slice(5)}/{mk.slice(0, 4)}</h3>
        {days.map(([k, items]) => { const d = new Date(`${k}T00:00:00`); return <div key={k} className="cm-day" id={`cm-day-${k}`} data-day={k}>
          <div className="cm-day-head"><i />{DOW[d.getDay()]} {fmtDate(d)}<small> · {ago(d)} · {items.length} mục</small></div>
          {items.map((m) => <Item key={m.id} m={m} open={!!open[m.id]} onToggle={() => setOpen((o) => ({ ...o, [m.id]: !o[m.id] }))} onResend={resend} onDelete={del} canDelete={role === 'manager'} onOpenInbox={(id) => navigate(`/cskh?c=${id}`)} />)}</div>; })}
      </section>)}</div>}

    <div className="cm-fab-wrap">
      {fab && <div className="cm-fab-menu"><header><b>Liên lạc</b></header>
        <button onClick={() => { setFab(false); setComposer('email'); }}><span className="cm-ico email"><MailOutlineRounded /></span><span><b>Email</b><small>Gửi email</small></span></button>
        <button onClick={() => { setFab(false); setComposer('sms'); }}><span className="cm-ico sms"><ChatBubbleOutlineRounded /></span><span><b>SMS</b><small>Gửi tin nhắn SMS</small></span></button></div>}
      <button className="cm-fab" aria-label="Soạn liên lạc" aria-expanded={fab} onClick={() => setFab(!fab)}>{fab ? <CloseRounded /> : <AddRounded />}</button>
    </div>
    {composer === 'email' && info && <EmailComposer patient={patient} info={info} role={role} onClose={() => setComposer(null)} onSent={sent} onToast={toast} />}
    {composer === 'sms' && info && <SmsComposer patient={patient} info={info} role={role} history={all.data?.results || []} onClose={() => setComposer(null)} onSent={sent} onToast={toast} />}
    {printOpen && <PrintModal patient={patient} items={all.data?.results || []} counts={counts} onClose={() => setPrintOpen(false)} />}
  </div>;
}
