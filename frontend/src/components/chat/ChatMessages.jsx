import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import InsertDriveFileRounded from '@mui/icons-material/InsertDriveFileRounded';
import OpenInNewRounded from '@mui/icons-material/OpenInNewRounded';
import DoneRounded from '@mui/icons-material/DoneRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import StarBorderRounded from '@mui/icons-material/StarBorderRounded';
import RateReviewRounded from '@mui/icons-material/RateReviewRounded';

export const fileSize = (v) => {
  const n = Number(v || 0);
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
};

// Ảnh đại diện chữ cái: 2 chữ cuối của tên (Nguyễn Thu Hà -> TH), màu cố định theo tên.
const AV_COLORS = [['#e7eefc', '#2a4f9c'], ['#fdeee3', '#a2551c'], ['#e5f4ec', '#23704a'], ['#f3e9f8', '#7a3d94'], ['#fbe9ee', '#a23a58'], ['#e6f3f6', '#1f6477']];
export const initials = (name) => {
  const w = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!w.length) return 'K';
  return (w.length === 1 ? w[0].slice(0, 2) : w[w.length - 2][0] + w[w.length - 1][0]).toUpperCase();
};
export const avatarTone = (name) => {
  let h = 0;
  for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const [bg, fg] = AV_COLORS[h % AV_COLORS.length];
  return { background: bg, color: fg };
};

const dayKey = (d) => d.toDateString();
const dayLabel = (d) => {
  if (dayKey(d) === dayKey(new Date())) return 'Hôm nay';
  if (dayKey(d) === dayKey(new Date(Date.now() - 86400000))) return 'Hôm qua';
  return d.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' });
};
const hhmm = (d) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });
const LABELS = ['Rất tệ', 'Chưa tốt', 'Bình thường', 'Hài lòng', 'Rất hài lòng'];

export function Stars({ value = 0, onChange, size = 30, readOnly }) {
  const [hover, setHover] = useState(0);
  const shown = hover || value;
  return (
    <div className={`chat-stars ${readOnly ? 'ro' : ''}`} onMouseLeave={() => setHover(0)}>
      {[1, 2, 3, 4, 5].map((n) => {
        const Icon = n <= shown ? StarRounded : StarBorderRounded;
        return (
          <button type="button" key={n} disabled={readOnly} aria-label={`${n} sao`} className={n <= shown ? 'on' : ''}
            onMouseEnter={() => !readOnly && setHover(n)} onClick={() => onChange?.(n)}>
            <Icon sx={{ fontSize: size }}/>
          </button>
        );
      })}
    </div>
  );
}

// Thẻ mời đánh giá phiên chăm sóc (giống tin mời đánh giá của Zalo OA).
function CsatCard({ viewer, score, isLatest, onRate }) {
  const [pick, setPick] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  if (viewer !== 'customer') {
    return (
      <div className="chat-csat-card staff">
        <RateReviewRounded/>
        <span>{score ? <>Khách đã đánh giá <b>{score}/5</b> sao</> : 'Đã gửi lời mời đánh giá phiên chăm sóc'}</span>
      </div>
    );
  }
  if (score) {
    return (
      <div className="chat-csat-card done">
        <strong>Cảm ơn bạn đã đánh giá</strong>
        <Stars value={score} readOnly size={26}/>
      </div>
    );
  }
  if (!isLatest) return <div className="chat-csat-card staff"><RateReviewRounded/><span>Lời mời đánh giá phiên chăm sóc</span></div>;
  const submit = async () => { setBusy(true); await onRate?.(pick, comment); setBusy(false); };
  return (
    <div className="chat-csat-card">
      <div className="chat-csat-head"><StarRounded/><strong>Đánh giá phiên chăm sóc</strong></div>
      <p>Vui lòng dành một chút thời gian để đánh giá trải nghiệm gần đây của bạn với chúng tôi.</p>
      <Stars value={pick} onChange={setPick}/>
      {pick > 0 && (
        <>
          <div className="chat-csat-label">{LABELS[pick - 1]}</div>
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={500} rows={2} placeholder="Nhận xét thêm (không bắt buộc)"/>
          <button type="button" className="chat-csat-send" disabled={busy} onClick={submit}>{busy ? 'Đang gửi...' : 'Gửi đánh giá'}</button>
        </>
      )}
    </div>
  );
}

function Bubble({ m, mine, first, last, showName }) {
  const image = m.message_type === 'image' || String(m.attachment_mime || '').startsWith('image/');
  const when = new Date(m.created_at || m.createdAt);
  return (
    <div className={`chat-row ${mine ? 'mine' : ''} ${first ? 'first' : ''}`}>
      {!mine && <div className={`chat-av ${last ? 'show' : ''}`} style={avatarTone(m.sender_name)} aria-hidden="true">{initials(m.sender_name)}</div>}
      <div className="chat-col">
        <div className={`chat-bubble ${m.pending ? 'pending' : ''} ${first ? 'is-first' : ''} ${last ? 'is-last' : ''}`}>
          {image && m.attachment_url && (
            <a href={m.attachment_url} target="_blank" rel="noreferrer" className="chat-image"><img src={m.attachment_url} alt={m.attachment_name || 'Ảnh đính kèm'} loading="lazy"/></a>
          )}
          {!image && (m.attachment_url || m.attachment_name) && (
            <a href={m.attachment_url || undefined} target="_blank" rel="noreferrer" className="chat-file">
              <InsertDriveFileRounded/>
              <span><strong>{m.attachment_name || 'Tệp đính kèm'}</strong><small>{fileSize(m.attachment_size)}</small></span>
              <OpenInNewRounded/>
            </a>
          )}
          {m.text && <div className="chat-text">{m.text}</div>}
        </div>
        {last && (
          <div className="chat-meta">
            {hhmm(when)}
            {mine && (m.pending ? <ScheduleRounded titleAccess="Đang gửi"/> : <DoneRounded titleAccess="Đã gửi"/>)}
          </div>
        )}
      </div>
      {mine && <div className={`chat-av ${last ? 'show' : ''}`} style={avatarTone(m.sender_name)} aria-hidden="true">{initials(m.sender_name)}</div>}
    </div>
  );
}

export default function ChatMessages({ messages, userId, viewer = 'staff', csatScore = 0, onRate, showNames = true, emptyText = 'Chưa có tin nhắn nào.' }) {
  const ref = useRef(null);
  const stick = useRef(true);

  const { items, lastCsat } = useMemo(() => {
    const out = [];
    let prevDay = '';
    let lastCsatId = null;
    const special = (m) => m.message_type === 'csat' || m.message_type === 'system';
    const near = (a, b) => a && b && !special(a) && !special(b) && a.sender === b.sender
      && dayKey(new Date(a.created_at)) === dayKey(new Date(b.created_at))
      && Math.abs(new Date(b.created_at) - new Date(a.created_at)) < 5 * 60000;
    messages.forEach((m, i) => {
      const d = new Date(m.created_at || m.createdAt);
      const key = dayKey(d);
      if (key !== prevDay) { out.push({ type: 'day', key: `d-${key}`, label: dayLabel(d) }); prevDay = key; }
      if (m.message_type === 'csat') { lastCsatId = m.id; out.push({ type: 'csat', key: `m-${m.id}`, m }); }
      else if (m.message_type === 'system') out.push({ type: 'system', key: `m-${m.id}`, m });
      else out.push({ type: 'msg', key: `m-${m.id}`, m, first: !near(messages[i - 1], m), last: !near(m, messages[i + 1]) });
    });
    return { items: out, lastCsat: lastCsatId };
  }, [messages]);

  const onScroll = () => {
    const el = ref.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  };

  // Cuộn tức thì (không smooth) để không bị giật khi tin liên tục tới.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const last = messages[messages.length - 1];
    if (stick.current || (last && Number(last.sender) === Number(userId))) el.scrollTop = el.scrollHeight;
  }, [messages, userId, csatScore]);

  return (
    <div className="chat-scroll" ref={ref} onScroll={onScroll}>
      {!items.length && <div className="chat-empty-line">{emptyText}</div>}
      {items.map((it) => {
        if (it.type === 'day') return <div className="chat-day" key={it.key}><span>{it.label}</span></div>;
        if (it.type === 'system') return <div className="chat-system" key={it.key}><span>{it.m.text}</span></div>;
        if (it.type === 'csat') {
          const isLatest = it.m.id === lastCsat;
          const score = it.m.csat_score ?? (isLatest ? csatScore : 0);
          return <div className="chat-csat-row" key={it.key}><CsatCard viewer={viewer} score={score} isLatest={isLatest} onRate={(value, comment) => onRate?.(value, comment, it.m.id)}/></div>;
        }
        return <Bubble key={it.key} m={it.m} mine={Number(it.m.sender) === Number(userId)} first={it.first} last={it.last} showName={showNames}/>;
      })}
    </div>
  );
}
