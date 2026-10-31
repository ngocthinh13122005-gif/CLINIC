import { useEffect, useMemo, useRef, useState } from 'react';
import SearchRounded from '@mui/icons-material/SearchRounded';
import FilterAltRounded from '@mui/icons-material/FilterAltRounded';
import LayersRounded from '@mui/icons-material/LayersRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import KeyboardArrowDownRounded from '@mui/icons-material/KeyboardArrowDownRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import { useAuth } from '../context/AuthContext';

export default function SmartFilterBar({
  id, search, onSearch, placeholder = 'Tìm kiếm…', filters = [], groupBy = '', groupOptions = [], onGroupBy,
  onApplyFavorite, className = '',
}) {
  const { user } = useAuth();
  const root = useRef(null);
  const appliedDefault = useRef(false);
  const [open, setOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [name, setName] = useState('');
  const [makeDefault, setMakeDefault] = useState(false);
  const storageKey = `akina.smart-filter.${user?.id || 'anon'}.${id}`;
  const defaultKey = `${storageKey}.default`;
  const [favorites, setFavorites] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) || '[]'); } catch { return []; }
  });

  const snapshot = useMemo(() => ({
    search,
    filters: Object.fromEntries(filters.map((f) => [f.key, f.value || ''])),
    groupBy: groupBy || '',
  }), [search, filters, groupBy]);
  const active = filters.filter((f) => f.value);

  useEffect(() => {
    const close = (e) => { if (!root.current?.contains(e.target)) { setOpen(false); setSaveOpen(false); } };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);
  useEffect(() => {
    if (appliedDefault.current || !favorites.length || !onApplyFavorite) return;
    appliedDefault.current = true;
    const defaultId = localStorage.getItem(defaultKey);
    const favorite = favorites.find((f) => String(f.id) === defaultId);
    if (favorite) onApplyFavorite(favorite.state);
  }, [favorites, defaultKey, onApplyFavorite]);

  const persist = (next) => { setFavorites(next); localStorage.setItem(storageKey, JSON.stringify(next)); };
  const save = () => {
    const label = name.trim();
    if (!label) return;
    const favorite = { id: Date.now(), name: label, state: snapshot };
    persist([...favorites, favorite]);
    if (makeDefault) localStorage.setItem(defaultKey, String(favorite.id));
    setName(''); setMakeDefault(false); setSaveOpen(false);
  };
  const apply = (favorite) => { onApplyFavorite?.(favorite.state); setOpen(false); };
  const clear = () => { filters.forEach((f) => f.onChange('')); onGroupBy?.(''); };

  return <div className={`sf-wrap ${className}`} ref={root}>
    <div className="sf-bar">
      <SearchRounded/>
      <div className="sf-chips">{active.map((f) => <span key={f.key}><FilterAltRounded/>{f.label}: <b>{f.options.find((x) => x.value === f.value)?.label || f.value}</b><button onClick={() => f.onChange('')} aria-label={`Bỏ lọc ${f.label}`}><CloseRounded/></button></span>)}</div>
      <input value={search} onChange={(e) => onSearch(e.target.value)} placeholder={active.length ? 'Thêm điều kiện tìm kiếm…' : placeholder}/>
      <button className={`sf-toggle ${open ? 'on' : ''}`} onClick={() => setOpen((v) => !v)} aria-label="Mở bộ lọc"><KeyboardArrowDownRounded/></button>
    </div>
    {open && <div className="sf-panel">
      <section><header><FilterAltRounded/><strong>Bộ lọc</strong></header>
        {filters.map((f) => <div className="sf-filter-group" key={f.key}><label>{f.label}</label>{f.options.map((o) => <button key={o.value} className={f.value === o.value ? 'on' : ''} onClick={() => f.onChange(f.value === o.value ? '' : o.value)}>{o.label}</button>)}</div>)}
        {!!active.length && <button className="sf-text-action" onClick={clear}>Xóa toàn bộ bộ lọc</button>}
      </section>
      <section><header><LayersRounded/><strong>Nhóm theo</strong></header>
        {groupOptions.length ? groupOptions.map((o) => <button key={o.value} className={groupBy === o.value ? 'on' : ''} onClick={() => onGroupBy?.(groupBy === o.value ? '' : o.value)}>{o.label}</button>) : <p>Trang này đã có cách nhóm phù hợp với nghiệp vụ.</p>}
      </section>
      <section><header><StarRounded/><strong>Đã lưu</strong></header>
        {favorites.map((f) => <button key={f.id} onClick={() => apply(f)}>{f.name}{String(f.id) === localStorage.getItem(defaultKey) && <small>Mặc định</small>}</button>)}
        {!favorites.length && <p>Chưa có bộ lọc đã lưu.</p>}
        {!saveOpen ? <button className="sf-text-action" onClick={() => setSaveOpen(true)}>Lưu bộ lọc hiện tại</button> : <div className="sf-save"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên bộ lọc" autoFocus/><label><input type="checkbox" checked={makeDefault} onChange={(e) => setMakeDefault(e.target.checked)}/> Dùng làm mặc định</label><button disabled={!name.trim()} onClick={save}>Lưu</button></div>}
      </section>
    </div>}
  </div>;
}
