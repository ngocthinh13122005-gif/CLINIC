import { useCallback, useEffect, useRef, useState } from 'react';
import api from '../api/client';
import { ensureFirebaseAuth, firebaseEnabled, subscribeConversation } from '../services/firebase';

const POLL_MS = 3000;

const fromFirebase = (r) => ({
  id: r.id,
  sender: r.senderId,
  sender_name: r.senderName,
  sender_role: r.senderRole,
  text: r.text,
  message_type: r.messageType || 'text',
  attachment_url: r.attachmentUrl || '',
  attachment_name: r.attachmentName || '',
  attachment_mime: r.attachmentMime || '',
  attachment_size: r.attachmentSize || 0,
  created_at: r.createdAt,
});

const stamp = (m) => new Date(m.created_at || m.createdAt || 0).getTime() || 0;

// Gộp tin theo id: không mất, không nhân đôi, luôn đúng thứ tự.
export function mergeMessages(prev, incoming) {
  const map = new Map();
  prev.forEach((m) => map.set(String(m.id), m));
  incoming.forEach((m) => map.set(String(m.id), { ...map.get(String(m.id)), ...m, pending: false }));
  return Array.from(map.values()).sort((a, b) => (stamp(a) - stamp(b)) || (Number(a.id) || 0) - (Number(b.id) || 0));
}

export default function useChatThread(conversationId, { userId, onIncoming } = {}) {
  const [messages, setMessages] = useState([]);
  const [mode, setMode] = useState('rest');
  const [sending, setSending] = useState(false);
  const messagesRef = useRef([]);
  const incomingRef = useRef(onIncoming);
  incomingRef.current = onIncoming;
  messagesRef.current = messages;

  const apply = useCallback((rows, { notify = true } = {}) => {
    if (!rows.length) return;
    const known = new Set(messagesRef.current.map((m) => String(m.id)));
    const fresh = rows.filter((m) => !known.has(String(m.id)));
    setMessages((prev) => mergeMessages(prev, rows));
    if (notify && fresh.some((m) => Number(m.sender) !== Number(userId))) incomingRef.current?.(fresh);
  }, [userId]);

  const seed = useCallback((rows) => setMessages(mergeMessages([], rows || [])), []);
  const append = useCallback((message) => setMessages((prev) => mergeMessages(prev, [message])), []);

  useEffect(() => {
    if (!conversationId) return undefined;
    let alive = true;
    let unsub = () => {};
    let timer = null;
    let busy = false;

    const lastId = () => messagesRef.current.reduce((n, m) => (Number(m.id) > n ? Number(m.id) : n), 0);
    const pollOnce = async () => {
      if (busy || document.hidden) return;
      busy = true;
      try {
        const { data } = await api.get(`/conversations/${conversationId}/messages/`, { params: { after: lastId(), mark_read: 1 } });
        if (alive && data.length) apply(data);
      } catch { /* mạng chập chờn: thử lại ở lượt sau */ } finally { busy = false; }
    };
    const startPolling = () => {
      if (timer || !alive) return;
      setMode('rest');
      timer = setInterval(pollOnce, POLL_MS);
    };

    (async () => {
      if (!firebaseEnabled) { startPolling(); return; }
      try {
        if (!(await ensureFirebaseAuth())) { startPolling(); return; }
        await api.post(`/conversations/${conversationId}/realtime/`);
        if (!alive) return;
        let first = true;
        unsub = subscribeConversation(conversationId, (rows) => {
          if (!alive) return;
          apply(rows.map(fromFirebase), { notify: !first });
          first = false;
          api.post(`/conversations/${conversationId}/mark_read/`).catch(() => {});
        }, () => { if (timer) clearInterval(timer); timer = null; startPolling(); });
        setMode('firebase');
        timer = setInterval(pollOnce, 15000); // lưới an toàn nếu Firestore im lặng
      } catch { startPolling(); }
    })();

    const onVisible = () => { if (!document.hidden) pollOnce(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      unsub();
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [conversationId, apply]);

  const send = useCallback(async ({ text, file }) => {
    if (!conversationId || (!text?.trim() && !file)) return { ok: false };
    const tmpId = `tmp-${Date.now()}`;
    setMessages((prev) => [...prev, {
      id: tmpId, sender: userId, text: (text || '').trim(), created_at: new Date().toISOString(), pending: true,
      message_type: file ? (String(file.type).startsWith('image/') ? 'image' : 'file') : 'text',
      attachment_name: file?.name || '', attachment_size: file?.size || 0,
    }]);
    const fd = new FormData();
    if (text?.trim()) fd.append('text', text.trim());
    if (file) fd.append('attachment', file);
    setSending(true);
    try {
      const { data } = await api.post(`/conversations/${conversationId}/messages/`, fd, { timeout: 60000 });
      setMessages((prev) => mergeMessages(prev.filter((m) => m.id !== tmpId), [data]));
      return { ok: true, message: data };
    } catch (e) {
      setMessages((prev) => prev.filter((m) => m.id !== tmpId));
      return { ok: false, error: e.response?.data?.detail || 'Gửi tin nhắn thất bại. Vui lòng thử lại.' };
    } finally { setSending(false); }
  }, [conversationId, userId]);

  return { messages, mode, sending, send, seed, append };
}
