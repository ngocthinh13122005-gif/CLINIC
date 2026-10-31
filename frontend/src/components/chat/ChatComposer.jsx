import { useEffect, useRef, useState } from 'react';
import AttachFileRounded from '@mui/icons-material/AttachFileRounded';
import SendRounded from '@mui/icons-material/SendRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import InsertDriveFileRounded from '@mui/icons-material/InsertDriveFileRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import { fileSize } from './ChatMessages';

const MAX_MB = 15;

/**
 * Ô soạn tin dùng chung.
 * - Nhân viên: có tab "Trả lời" / "Ghi chú nội bộ" (truyền onNote) và nút gợi ý AI (extraTools).
 * - Khách hàng: chỉ gửi tin, không có tab.
 */
export default function ChatComposer({
  disabled, disabledText = 'Bạn chưa thể gửi tin trong hội thoại này.', placeholder = 'Nhập tin nhắn...',
  quickReplies = [], extraTools = [], draftRequest, onSend, onNote, onError,
}) {
  const [text, setText] = useState('');
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [mode, setMode] = useState('reply'); // reply | note
  const [pop, setPop] = useState(false);
  const [busy, setBusy] = useState(false);
  const taRef = useRef(null);
  const fileRef = useRef(null);
  const noteMode = mode === 'note' && !!onNote;

  useEffect(() => {
    if (!file || !String(file.type).startsWith('image/')) { setPreview(''); return undefined; }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const el = taRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 130)}px`;
  }, [text]);

  // Bản nháp AI được chèn vào ô soạn (chưa gửi), luôn ở tab "Trả lời".
  useEffect(() => {
    if (!draftRequest?.text) return;
    setMode('reply');
    setText(draftRequest.text);
    setFile(null);
    setPop(false);
    taRef.current?.focus({ preventScroll: true });
  }, [draftRequest]);

  const pick = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > MAX_MB * 1024 * 1024) { onError?.(`Tệp vượt quá giới hạn ${MAX_MB} MB.`); return; }
    setFile(f);
  };

  const submit = async () => {
    if (disabled || busy || (!text.trim() && !file)) return;
    if (noteMode) {
      if (!text.trim()) return;
      setBusy(true);
      const ok = await onNote(text.trim());
      setBusy(false);
      if (ok) setText('');
      return;
    }
    const payload = { text, file };
    setText('');
    setFile(null);
    setPop(false);
    taRef.current?.focus();
    const res = await onSend(payload);
    if (res && res.ok === false) {
      setText(payload.text);
      setFile(payload.file);
      if (res.error) onError?.(res.error);
    }
  };

  if (disabled) return <div className="chat-composer locked">{disabledText}</div>;

  return (
    <div className="chat-composer">
      {onNote && (
        <div className={`chat-modes ${noteMode ? 'note-on' : ''}`} role="tablist">
          <button type="button" role="tab" aria-selected={!noteMode} className={!noteMode ? 'on' : ''} onClick={() => setMode('reply')}>Trả lời</button>
          <button type="button" role="tab" aria-selected={noteMode} className={noteMode ? 'on' : ''} onClick={() => { setMode('note'); setFile(null); setPop(false); }}>Ghi chú nội bộ</button>
        </div>
      )}
      {file && !noteMode && (
        <div className="chat-attach-preview">
          {preview ? <img src={preview} alt=""/> : <InsertDriveFileRounded/>}
          <span><strong>{file.name}</strong><small>{fileSize(file.size)}</small></span>
          <button type="button" onClick={() => setFile(null)} aria-label="Bỏ tệp đính kèm"><CloseRounded/></button>
        </div>
      )}
      {pop && quickReplies.length > 0 && !noteMode && (
        <div className="chat-pop chat-quick-pop">
          {quickReplies.map((q) => (
            <button type="button" key={q.id} onClick={() => { setText(q.body); setPop(false); taRef.current?.focus(); }}>
              <strong>{q.title}</strong><span>{q.body}</span>
            </button>
          ))}
        </div>
      )}
      <div className="chat-input-row">
        <textarea
          ref={taRef}
          rows={1}
          value={text}
          placeholder={noteMode ? 'Ghi chú chỉ nhân viên nhìn thấy...' : placeholder}
          onFocus={() => setPop(false)}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
          maxLength={noteMode ? 1000 : 2000}
        />
      </div>
      <div className="chat-bar">
        <input ref={fileRef} hidden type="file" onChange={pick} accept=".pdf,.doc,.docx,.xls,.xlsx,.txt,.zip,image/*"/>
        {!noteMode && <button type="button" className="chat-tool" onClick={() => fileRef.current?.click()} title="Đính kèm ảnh hoặc tệp"><AttachFileRounded/></button>}
        {!noteMode && quickReplies.length > 0 && (
          <button type="button" className={`chat-tool ${pop ? 'on' : ''}`} onClick={() => setPop((v) => !v)} title="Mẫu trả lời nhanh"><AddRounded/></button>
        )}
        {!noteMode && extraTools.map((t) => (
          <button type="button" key={t.key} className={`chat-tool ${t.accent ? 'ai' : ''}`} title={t.title} disabled={t.disabled} onClick={() => { setPop(false); t.onClick(); }}>{t.icon}</button>
        ))}
        <button type="button" className={`chat-send ${noteMode ? 'note' : ''}`} onClick={submit} disabled={busy || (!text.trim() && !file)} title="Gửi (Enter)">
          {noteMode ? 'Lưu ghi chú' : 'Gửi tin'}{!noteMode && <SendRounded/>}
        </button>
      </div>
    </div>
  );
}
