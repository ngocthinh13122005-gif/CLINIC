import { useCallback, useEffect, useState } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';

export const money = (v) => `${new Intl.NumberFormat('vi-VN').format(v || 0)}đ`;
export const dateText = (v) => (v ? new Date(v).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—');
export const dateTimeText = (v) => (v ? new Date(v).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

export const BOOKING_PILL = {
  pending: ['wait', 'Chờ xác nhận'], confirmed: ['ok', 'Đã xác nhận'], checked_in: ['ok', 'Đã đến'], in_progress: ['ok', 'Đang khám'],
  completed: ['done', 'Hoàn thành'], cancelled: ['bad', 'Đã hủy'], no_show: ['bad', 'Vắng mặt'],
};
export function Pill({ kind = 'done', children }) { return <span className={`cp-pill ${kind}`}><i/>{children}</span>; }
export function PageTitle({ title, sub, actions }) {
  return <div className="cp-title"><div><h1>{title}</h1>{sub && <p>{sub}</p>}</div>{actions && <div className="cp-title-act">{actions}</div>}</div>;
}
export function Card({ title, action, children, flush }) {
  return <section className="cp-card">{(title || action) && <header className="cp-card-h"><h2>{title}</h2>{action}</header>}<div className={flush ? 'cp-card-b flush' : 'cp-card-b'}>{children}</div></section>;
}

/** Tải một endpoint, tự làm mới khi có sự kiện realtime. */
export function useApi(url) {
  const { user } = useAuth();
  const [state, setState] = useState({ data: null, loading: true, error: '' });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ data: null, loading: true, error: '' });
    api.get(url, { signal: controller.signal })
      .then(({ data }) => { if (active) setState({ data, loading: false, error: '' }); })
      .catch((e) => { if (active && !controller.signal.aborted) setState({ data: null, loading: false, error: e.response?.data?.detail || 'Không tải được dữ liệu. Vui lòng thử lại.' }); });
    return () => { active = false; controller.abort(); };
  }, [url, user?.id, version]);
  useEffect(() => {
    let timer;
    const refresh = () => { clearTimeout(timer); timer = setTimeout(reload, 200); };
    window.addEventListener('ohio:realtime', refresh);
    return () => { clearTimeout(timer); window.removeEventListener('ohio:realtime', refresh); };
  }, [reload]);
  return { ...state, reload };
}
