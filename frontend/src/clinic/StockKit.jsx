import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { Grid } from './Money';
import { useLoad } from './ui';

export const arr = (d) => d?.results || d || [];
export const nf = (v) => new Intl.NumberFormat('vi-VN').format(Math.round(v || 0));

export const expTone = (d) => (d == null ? 'gray' : d < 0 ? 'red' : d <= 30 ? 'red' : d <= 90 ? 'amber' : 'green');
export const expText = (d) => (d == null ? 'Không có HSD' : d < 0 ? `Quá hạn ${-d} ngày` : d === 0 ? 'Hết hạn hôm nay' : `Còn ${d} ngày`);

export function useLocations() {
  const l = useLoad(async () => arr((await api.get('/clinic/stock/locations/')).data), []);
  const list = useMemo(() => (l.data || []).filter((x) => x.is_active), [l.data]);
  return { ...l, list };
}

export function useMeds() {
  const l = useLoad(async () => arr((await api.get('/clinic/medicines/', { params: { limit: 1000 } })).data), []);
  return { ...l, list: useMemo(() => (l.data || []).filter((m) => m.is_active !== false), [l.data]) };
}

/** Bảng Pabau với phân trang phía client (dành cho danh sách ngắn). */
export function LGrid({ rows, ...rest }) {
  const [page, setPage] = useState(1); const [size, setSize] = useState(25);
  useEffect(() => { setPage(1); }, [rows.length, size]);
  return <Grid {...rest} rows={rows.slice((page - 1) * size, page * size)} meta={{ count: rows.length, page, page_size: size }} onPage={setPage} onSize={setSize} />;
}

/** Tải tệp (CSV) qua API có xác thực. */
export async function download(path, params = {}, fallback = 'export.csv') {
  const res = await api.get(path, { params: { ...params, export: 1 }, responseType: 'blob' });
  const cd = res.headers?.['content-disposition'] || ''; const m = /filename="?([^"]+)"?/.exec(cd);
  const url = URL.createObjectURL(res.data); const a = document.createElement('a');
  a.href = url; a.download = m?.[1] || fallback; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}

export function Seg({ value, onChange, options }) {
  return <div className="st-seg">{options.map(([k, t, ic]) => <button key={k} type="button" className={value === k ? 'on' : ''} onClick={() => onChange(k)} title={t}>{ic}{t}</button>)}</div>;
}

export function StatusTabs({ value, onChange, options, counts }) {
  return <nav className="st-status">{options.map(([k, t]) => <button key={k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{t}{counts?.[k] != null && <i>{counts[k]}</i>}</button>)}</nav>;
}

export function ProductPicker({ meds, value, onChange, placeholder = '— Chọn sản phẩm —' }) {
  return <select className="st-in" value={value || ''} onChange={(e) => onChange(e.target.value)}><option value="">{placeholder}</option>
    {meds.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.unit}) · tồn {m.stock}</option>)}</select>;
}
