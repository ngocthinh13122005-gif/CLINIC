import { createPortal } from 'react-dom';
import { useEffect, useRef, useState, useCallback } from 'react';
import CloseRounded from '@mui/icons-material/CloseRounded';
import CheckCircleRounded from '@mui/icons-material/CheckCircleRounded';
import ErrorOutlineRounded from '@mui/icons-material/ErrorOutlineRounded';

export const money = (v) => new Intl.NumberFormat('vi-VN').format(v || 0) + 'đ';
export const fmtDate = (v) => v ? new Date(v).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
export const fmtTime = (v) => v ? new Date(v).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : '—';
export const fmtDateTime = (v) => v ? `${fmtTime(v)} · ${fmtDate(v)}` : '—';
export const isoDay = (d = new Date()) => { const x = new Date(d); x.setMinutes(x.getMinutes() - x.getTimezoneOffset()); return x.toISOString().slice(0, 10); };
export const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n); return isoDay(d); };
export const WEEKDAY = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
export const initials = (name = '') => { const p = name.replace(/^(BS\.?|ĐD\.?|CKI+\.?)\s*/i, '').trim().split(/\s+/); return ((p.length > 1 ? p[p.length - 2][0] : '') + (p[p.length - 1]?.[0] || '')).toUpperCase() || '?'; };
export const genderText = (g) => ({ male: 'Nam', female: 'Nữ', other: 'Khác' }[g] || '');
export const errMsg = (e, fallback = 'Có lỗi xảy ra, vui lòng thử lại.') => {
  const d = e?.response?.data;
  if (!d) return fallback;
  if (typeof d === 'string') return fallback;
  if (d.detail) return d.detail;
  const first = Object.values(d).flat()[0];
  return typeof first === 'string' ? first : fallback;
};

export function Avatar({ name, size = 36, tone = 'teal' }) {
  return <span className={`cl-avatar ${tone}`} style={{ width: size, height: size, fontSize: Math.max(11, size * 0.36) }}>{initials(name)}</span>;
}

export function Pill({ tone = 'neutral', children, dot = false }) {
  return <span className={`cl-pill ${tone}`}>{dot && <i />}{children}</span>;
}
export const visitTone = { waiting: 'amber', in_consult: 'blue', completed: 'green', cancelled: 'gray' };

export function PageHead({ actions, back }) {
  // Tiêu đề trang nằm trên thanh trên cùng (ClinicShell); nút thao tác chính cũng được đưa lên đó để không tốn thêm một hàng.
  const [slot, setSlot] = useState(() => document.getElementById('cl-top-actions'));
  useEffect(() => { setSlot(document.getElementById('cl-top-actions')); }, []);
  return <>
    {back && <div className="cl-pagebar">{back}</div>}
    {actions && (slot ? createPortal(<div className="cl-pagehead-actions">{actions}</div>, slot) : <div className="cl-pagebar"><div className="cl-pagehead-actions">{actions}</div></div>)}
  </>;
}

export function Card({ title, subtitle, action, children, className = '', pad = true }) {
  return <section className={`cl-card ${className}`}>
    {(title || action) && <header className="cl-card-head"><div>{title && <h2>{title}</h2>}{subtitle && <p>{subtitle}</p>}</div>{action}</header>}
    <div className={pad ? 'cl-card-body' : ''}>{children}</div>
  </section>;
}

export function Btn({ kind = 'secondary', size, icon, children, ...rest }) {
  return <button type="button" className={`cl-btn ${kind} ${size || ''}`} {...rest}>{icon}{children}</button>;
}

export function Modal({ open, title, subtitle, onClose, children, wide, footer }) {
  useEffect(() => {
    if (!open) return undefined;
    const fn = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open, onClose]);
  if (!open) return null;
  return <div className="cl-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
    <div className={`cl-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
      <header><div><h2>{title}</h2>{subtitle && <p>{subtitle}</p>}</div><button className="cl-icon-btn" onClick={onClose} aria-label="Đóng"><CloseRounded /></button></header>
      <div className="cl-modal-body">{children}</div>
      {footer && <footer>{footer}</footer>}
    </div>
  </div>;
}

export function Field({ label, hint, required, children, span }) {
  return <label className={`cl-field ${span ? 'span' + span : ''}`}><span>{label}{required && <b> *</b>}</span>{children}{hint && <small>{hint}</small>}</label>;
}

export function useToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const show = useCallback((text, kind = 'ok') => {
    setToast({ text, kind });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast(null), 3600);
  }, []);
  const node = toast ? <div className={`cl-toast ${toast.kind}`} role="status">{toast.kind === 'ok' ? <CheckCircleRounded /> : <ErrorOutlineRounded />}<span>{toast.text}</span></div> : null;
  return [show, node];
}

export function Empty({ title = 'Chưa có dữ liệu', hint, action, icon }) {
  return <div className="cl-empty">{icon}<strong>{title}</strong>{hint && <span>{hint}</span>}{action}</div>;
}

export function Loading({ text = 'Đang tải…' }) { return <div className="cl-loading"><i />{text}</div>; }

export function useDebounce(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}

export function useLoad(loader, deps = []) {
  const [state, setState] = useState({ data: null, error: '', loading: true });
  const run = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true }));
    try { const data = await loader(); setState({ data, error: '', loading: false }); }
    catch (e) { setState((s) => ({ data: s.data, error: errMsg(e, 'Không tải được dữ liệu.'), loading: false })); }
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { run(); }, [run]);
  return { ...state, reload: run };
}

export function useInterval(fn, ms) {
  const ref = useRef(fn);
  useEffect(() => { ref.current = fn; });
  useEffect(() => { const id = setInterval(() => ref.current(), ms); return () => clearInterval(id); }, [ms]);
}

export function ProgressDots({ total, done }) {
  return <div className="cl-steps">{Array.from({ length: total }, (_, i) => <span key={i} className={i < done ? 'done' : i === done ? 'next' : ''}>{i + 1}</span>)}</div>;
}
