import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import ForumRounded from '@mui/icons-material/ForumRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import SmartToyRounded from '@mui/icons-material/SmartToyRounded';
import SpaRounded from '@mui/icons-material/SpaRounded';
import EventAvailableRounded from '@mui/icons-material/EventAvailableRounded';
import LocalOfferRounded from '@mui/icons-material/LocalOfferRounded';
import SupportAgentRounded from '@mui/icons-material/SupportAgentRounded';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import api from '../../api/client';
import '../../styles/chatbot.css';

const KEY = 'ohio_visitor_key';
const ICONS = { services: SpaRounded, booking: EventAvailableRounded, promotions: LocalOfferRounded, human: SupportAgentRounded };
const FALLBACK_ACTIONS = [
  { key: 'services', label: 'Dịch vụ' }, { key: 'booking', label: 'Đặt lịch' },
  { key: 'promotions', label: 'Khuyến mãi' }, { key: 'human', label: 'Gặp tư vấn viên' },
];

const newKey = () => {
  try { if (crypto?.randomUUID) return crypto.randomUUID().replace(/-/g, ''); } catch { /* bỏ qua */ }
  return Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
};
const readKey = () => { try { return localStorage.getItem(KEY) || ''; } catch { return ''; } };
const saveKey = (k) => { try { localStorage.setItem(KEY, k); } catch { /* bỏ qua */ } };

// Tách nội dung thành đoạn chữ + nút liên kết  [[link:/duong-dan|Nhãn]]
const LINK = /\[\[link:([^|\]]+)\|([^\]]+)\]\]/g;
// Nút lựa chọn của quy trình đặt lịch:  [[choice:bk:time:1000|10:00]]
const CHOICE = /\[\[choice:([^|\]]+)\|([^\]]+)\]\]/g;
function parse(content) {
  const links = [];
  const choices = [];
  const text = (content || '')
    .replace(LINK, (_, url, label) => { links.push({ url, label }); return ''; })
    .replace(CHOICE, (_, action, label) => { choices.push({ action, label }); return ''; })
    .replace(/\n{3,}/g, '\n\n').trim();
  return { text, links, choices };
}
const PRIMARY = new Set(['bk:confirm']);
const DANGER = new Set(['bk:cancel']);

function BotMessage({ m, onLink, onChoice, active }) {
  const mine = m.role === 'user';
  const { text, links, choices } = parse(m.content);
  return (
    <div className={`cb-row ${mine ? 'mine' : ''}`}>
      {!mine && <div className="cb-avatar"><AutoAwesomeRounded/></div>}
      <div className="cb-col">
        <div className="cb-bubble">{text && <div className="cb-text">{text}</div>}</div>
        {choices.length > 0 && (
          <div className="cb-choices">
            {choices.map((c) => (
              <button type="button" key={c.action + c.label} disabled={!active}
                className={PRIMARY.has(c.action) ? 'primary' : DANGER.has(c.action) ? 'danger' : ''}
                onClick={() => onChoice(c)}>{c.label}</button>
            ))}
          </div>
        )}
        {links.length > 0 && (
          <div className="cb-links">
            {links.map((l) => <button type="button" key={l.url + l.label} onClick={() => onLink(l.url)}>{l.label}<OpenInNewRounded/></button>)}
          </div>
        )}
      </div>
    </div>
  );
}

export default function ChatbotWidget() {
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [cfg, setCfg] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [unseen, setUnseen] = useState(false);
  const keyRef = useRef('');
  const scrollRef = useRef(null);
  const inputRef = useRef(null);
  const loaded = useRef(false);

  const scrollDown = () => requestAnimationFrame(() => { const el = scrollRef.current; if (el) el.scrollTop = el.scrollHeight; });

  const load = useCallback(async () => {
    let key = readKey();
    if (!key) { key = newKey(); saveKey(key); }
    keyRef.current = key;
    try {
      const { data } = await api.get('/chatbot/session/', { params: { visitor_key: key, page: location.pathname } });
      if (data.visitor_key && data.visitor_key !== key) { keyRef.current = data.visitor_key; saveKey(data.visitor_key); }
      setCfg(data);
      setMessages(data.messages || []);
      loaded.current = true;
      setError('');
    } catch (e) {
      setError(e.response?.data?.detail || 'Không kết nối được Trợ lý AkinaClinic. Vui lòng thử lại.');
    }
  }, [location.pathname]);

  useEffect(() => { if (open && !loaded.current) load(); }, [open, load]);
  useEffect(() => { if (open) { scrollDown(); setUnseen(false); } }, [open, messages, busy]);
  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 120); }, [open]);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  // Khi mở trên điện thoại, khóa cuộn trang phía sau.
  useEffect(() => {
    if (!open) return undefined;
    const small = window.matchMedia('(max-width: 600px)').matches;
    if (!small) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  const go = (url) => {
    setOpen(false);
    if (/^https?:/i.test(url)) window.open(url, '_blank', 'noreferrer'); else navigate(url);
  };

  const send = async ({ action = '', label = '' } = {}) => {
    const content = action ? label : text.trim();
    if (!content || busy) return;
    setError('');
    setBusy(true);
    const tmp = { id: `tmp-${Date.now()}`, role: 'user', content };
    setMessages((m) => [...m, tmp]);
    if (!action) setText('');
    try {
      const { data } = await api.post('/chatbot/message/', { visitor_key: keyRef.current, text: content, action, page: location.pathname }, { timeout: 40000 });
      if (data.visitor_key && data.visitor_key !== keyRef.current) { keyRef.current = data.visitor_key; saveKey(data.visitor_key); }
      setMessages((m) => [...m.filter((x) => x.id !== tmp.id), ...(data.user_message ? [data.user_message] : [tmp]), ...(data.reply ? [data.reply] : [])]);
      if (data.navigate) setTimeout(() => go(data.navigate), 900);
    } catch (e) {
      setMessages((m) => m.filter((x) => x.id !== tmp.id));
      if (!action) setText(content);
      setError(e.response?.data?.detail || 'Gửi không thành công. Vui lòng thử lại.');
    } finally { setBusy(false); }
  };

  const actions = cfg?.actions?.length ? cfg.actions : FALLBACK_ACTIONS;
  const name = cfg?.name || 'Trợ lý AkinaClinic';
  const greeting = cfg?.greeting || 'Xin chào, tôi là Trợ lý AkinaClinic. Tôi có thể hỗ trợ bạn về dịch vụ, đặt lịch và thông tin chăm sóc khách hàng.';
  const disabled = cfg && cfg.enabled === false;

  // Ẩn hoàn toàn trên trang chat với CSKH (đã có khung chat riêng).
  if (location.pathname.startsWith('/chat')) return null;

  return (
    <>
      <button type="button" className={`floating-action cb-fab ${open ? 'open' : ''}`} aria-label={open ? 'Đóng Trợ lý AkinaClinic' : 'Mở Trợ lý AkinaClinic'} aria-expanded={open}
        onClick={() => { setOpen((v) => !v); setUnseen(false); }}>
        {open ? <CloseRounded sx={{ fontSize: 26 }}/> : <ForumRounded sx={{ fontSize: 26 }}/>}
        {!open && unseen && <i className="cb-dot"/>}
      </button>

      {open && createPortal(
        <section className="cb-panel" role="dialog" aria-label={name}>
          <header className="cb-head">
            <div className="cb-head-icon"><SmartToyRounded/></div>
            <div className="cb-head-text"><strong>{name}</strong><span><i/>AI trực tuyến · Tư vấn &amp; đặt lịch</span></div>
            <button type="button" className="cb-close" onClick={() => setOpen(false)} aria-label="Đóng"><CloseRounded/></button>
          </header>

          <div className="cb-actions">
            {actions.map((a) => {
              const Icon = ICONS[a.key] || AutoAwesomeRounded;
              return <button type="button" key={a.key} disabled={busy || disabled} onClick={() => send({ action: a.key, label: a.label })}><Icon/>{a.label}</button>;
            })}
          </div>

          <div className="cb-body" ref={scrollRef}>
            <BotMessage m={{ role: 'assistant', content: greeting }} onLink={go}/>
            {messages.map((m, i) => <BotMessage key={m.id} m={m} onLink={go} active={!busy && i === messages.length - 1} onChoice={(c) => send({ action: c.action, label: c.label })}/>)}
            {busy && <div className="cb-row"><div className="cb-avatar"><AutoAwesomeRounded/></div><div className="cb-bubble cb-typing"><i/><i/><i/></div></div>}
            {disabled && <div className="cb-note">Trợ lý AkinaClinic đang tạm ngưng. Bạn vui lòng liên hệ CSKH trực tiếp.</div>}
          </div>

          {error && <div className="cb-error" role="alert">{error}</div>}

          <form className="cb-input" onSubmit={(e) => { e.preventDefault(); send(); }}>
            <input ref={inputRef} value={text} maxLength={500} onChange={(e) => setText(e.target.value)} placeholder="Nhập câu hỏi..." disabled={disabled} autoComplete="off"/>
            <button type="submit" disabled={busy || !text.trim() || disabled}><SendRounded/><span>Gửi</span></button>
          </form>
        </section>,
        document.body
      )}
    </>
  );
}
