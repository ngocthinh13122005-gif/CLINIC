import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import SupportAgentRounded from '@mui/icons-material/SupportAgentRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import useChatThread from '../hooks/useChatThread';
import ChatMessages from '../components/chat/ChatMessages';
import ChatComposer from '../components/chat/ChatComposer';
import '../styles/support-inbox.css';

const when = (v) => {
  if (!v) return '';
  const d = new Date(v);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
};

export default function ChatPage() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [newSubject, setNewSubject] = useState('');
  const [creating, setCreating] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [error, setError] = useState('');
  const [mobileThread, setMobileThread] = useState(false);
  const [view, setView] = useState('all');
  const [q, setQ] = useState('');
  const activeId = useRef(null);

  const loadList = useCallback(async () => {
    try {
      const { data } = await api.get('/conversations/');
      const rows = data.results || data;
      setConversations(rows);
      return rows;
    } catch { setError('Không tải được hội thoại.'); return null; }
  }, []);

  const thread = useChatThread(active?.id, { userId: user?.id, onIncoming: loadList });

  const open = useCallback(async (id) => {
    activeId.current = id;
    try {
      const { data } = await api.get(`/conversations/${id}/`);
      if (activeId.current !== id) return;
      setActive(data);
      thread.seed(data.messages || []);
      setMobileThread(true);
      setConversations((rows) => rows.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
    } catch { setError('Không mở được hội thoại.'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.seed]);

  useEffect(() => {
    const wanted = Number(params.get('c')) || null;
    loadList().then((rows) => {
      if (!rows) return;
      const target = rows.find((c) => c.id === wanted) || rows[0];
      if (target) open(target.id);
    });
    const t = setInterval(() => { if (!document.hidden) loadList(); }, 15000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Khi CSKH đóng ca / mời đánh giá, cập nhật trạng thái ca đang mở.
  useEffect(() => {
    const last = thread.messages[thread.messages.length - 1];
    if (active && last && (last.message_type === 'csat' || last.message_type === 'system') && Number(last.sender) !== Number(user?.id)) {
      api.get(`/conversations/${active.id}/`).then(({ data }) => setActive((a) => (a && a.id === data.id ? { ...a, status: data.status, csat_score: data.csat_score } : a))).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.messages.length]);

  const handleSend = async (payload) => {
    const wasClosed = active?.status === 'closed';
    const res = await thread.send(payload);
    if (res.ok) {
      await loadList();
      if (wasClosed) await open(active.id);
    }
    return res;
  };
  const createConversation = async () => {
    setCreating(true); setError('');
    try {
      const { data } = await api.post('/conversations/', { subject: newSubject.trim() || 'Cần hỗ trợ từ phòng khám' });
      setNewSubject(''); setShowNew(false);
      await loadList();
      await open(data.id);
    } catch (e) { setError(e.response?.data?.detail || 'Không thể bắt đầu hội thoại.'); } finally { setCreating(false); }
  };
  const rate = async (score, comment, messageId) => {
    try {
      await api.post(`/conversations/${active.id}/csat/`, { score, comment, message_id: messageId });
      await open(active.id);
    } catch (e) { setError(e.response?.data?.detail || 'Không gửi được đánh giá.'); }
  };
  const selectConversation = (id) => { setParams(id ? { c: id } : {}, { replace: true }); open(id); };

  const closed = active?.status === 'closed';
  const shown = conversations.filter((c) => {
    if (view === 'open' && c.status === 'closed') return false;
    if (view === 'closed' && c.status !== 'closed') return false;
    const term = q.trim().toLowerCase();
    return !term || `${c.subject || ''} ${c.last_message || ''}`.toLowerCase().includes(term);
  });
  const staffName = (c) => c?.assigned_name || 'CSKH';
  const Face = ({ name, size = 36 }) => (
    <div className="cc-agent-avatar" style={{ '--cc-avatar-size': `${size}px` }} title={name} aria-label={`Nhân viên hỗ trợ ${name}`}>
      <SupportAgentRounded/>
      <i aria-hidden="true"/>
    </div>
  );

  return (
    <div className="cc-page">
      <div className="cc-head">
        <h1>Hỗ trợ khách hàng</h1>
        <p>Kết nối trực tiếp với đội ngũ chăm sóc của phòng khám.</p>
      </div>
      {error && <div className="cc-alert" role="alert">{error}<button type="button" onClick={() => setError('')}>Đóng</button></div>}
      <div className={`cc-shell ${mobileThread ? 'show-thread' : ''}`}>
        <aside className="cc-side">
          <div className="cc-side-head">
            <strong>Hội thoại của bạn</strong>
            <button type="button" className="cc-add" onClick={() => setShowNew((v) => !v)} title="Bắt đầu hội thoại mới"><AddRounded/>Mới</button>
          </div>
          <div className="cc-tabs">
            {[['all', 'Tất cả'], ['open', 'Đang mở'], ['closed', 'Đã đóng']].map(([key, label]) => (
              <button type="button" key={key} className={view === key ? 'active' : ''} onClick={() => setView(key)}>{label}</button>
            ))}
          </div>
          {showNew && (
            <div className="cc-new">
              <input autoFocus placeholder="Bạn cần hỗ trợ về vấn đề gì?" value={newSubject} onChange={(e) => setNewSubject(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createConversation()}/>
              <button type="button" onClick={createConversation} disabled={creating}>{creating ? 'Đang tạo...' : 'Bắt đầu hội thoại'}</button>
            </div>
          )}
          <input className="cc-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm hội thoại..." aria-label="Tìm hội thoại"/>
          <div className="cc-count">{shown.length} hội thoại</div>
          <div className="cc-list">
            {shown.map((c) => (
              <button type="button" key={c.id} className={`cc-item ${active?.id === c.id ? 'active' : ''} ${c.unread_count > 0 ? 'unread' : ''}`} onClick={() => selectConversation(c.id)}>
                <Face name={staffName(c)}/>
                <div>
                  <div className="cc-item-top"><strong>{c.assigned_name || 'Nhân viên CSKH'}</strong><time>{when(c.last_message_at)}</time></div>
                  <span className="prev">{c.last_message || c.subject || 'Chưa có tin nhắn'}</span>
                  {c.status === 'closed' && <span className="tag">Đã hoàn tất</span>}
                </div>
                {c.unread_count > 0 && <b>{c.unread_count}</b>}
              </button>
            ))}
            {!shown.length && <div className="cc-placeholder">{conversations.length ? 'Không có hội thoại phù hợp.' : 'Bạn chưa có hội thoại nào. Bấm “Mới” để bắt đầu.'}</div>}
          </div>
        </aside>
        <section className="cc-main">
          {active ? (
            <>
              <div className="cc-main-head">
                <button type="button" className="cc-back" onClick={() => setMobileThread(false)} aria-label="Quay lại danh sách"><ArrowBackRounded/></button>
                <Face name={staffName(active)} size={40}/>
                <div className="cc-main-agent">
                  <strong>{active.assigned_name || 'Nhân viên CSKH'}<small>CSKH</small></strong>
                  <span className="sub">{active.subject || 'Hỗ trợ trực tuyến từ AkinaClinic'}</span>
                </div>
                <span className={`cc-state ${closed ? 'closed' : ''}`}>{closed ? 'Hoàn tất' : 'Đang mở'}</span>
              </div>
              <ChatMessages messages={thread.messages} userId={user?.id} viewer="customer" csatScore={active.csat_score || 0} onRate={rate} emptyText="Hãy gửi tin nhắn đầu tiên để được hỗ trợ."/>
              {closed && <div className="cc-session-ended">Phiên trước đã hoàn tất. Tin nhắn mới của bạn sẽ tạo một phiên chăm sóc mới và giữ nguyên toàn bộ lịch sử.</div>}
              <ChatComposer key={`${active.id}-${active.status}`} placeholder={closed ? 'Nhắn tin để bắt đầu phiên chăm sóc mới...' : 'Nhập tin nhắn cho phòng khám...'} onSend={handleSend} onError={setError}/>
            </>
          ) : <div className="cc-placeholder big">Chọn một hội thoại hoặc bắt đầu hội thoại mới.</div>}
        </section>
      </div>
    </div>
  );
}
