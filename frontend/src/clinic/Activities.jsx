import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import api from '../api/client';
import { Loading, errMsg, initials, useDebounce, useLoad, useToast } from './ui';
import { COLUMNS, DEFAULT_COLS, TABS, fmtDue } from './activityKit';
import { fireConfetti } from './confetti';
import { AcModal, ActivityDrawer, ActivityForm, StatusPill, TypeIcon, usePopMenu } from './ActivityDialogs';
import './activities.css';

const COLS_KEY = 'akina.activity.cols';
const loadCols = () => { try { const v = JSON.parse(localStorage.getItem(COLS_KEY)); return Array.isArray(v) && v.length ? v : DEFAULT_COLS; } catch { return DEFAULT_COLS; } };
const SORT = { due: 'due', activity: 'title', assigned: 'assignee', status: 'state' };

export default function ActivitiesPage() {
  const [sp, setSp] = useSearchParams();
  const [tab, setTab] = useState('todo');
  const [type, setType] = useState('');
  const [scope, setScope] = useState('all');
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 300);
  const [ordering, setOrdering] = useState('-due');
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(50);
  const [sel, setSel] = useState([]);
  const [cols, setCols] = useState(loadCols);
  const [colMenu, setColMenu] = useState(false);
  const [form, setForm] = useState(null);                // {item?, preset?}
  const [drawer, setDrawer] = useState(() => Number(sp.get('open')) || null);
  const [editing, setEditing] = useState(null);          // {id, value}
  const [del, setDel] = useState(null);
  const [toast, toastNode] = useToast();
  const [menuOpen, menuNode] = usePopMenu();

  const types = useLoad(async () => (await api.get('/clinic/activity-types/')).data, []);
  const list = useLoad(async () => (await api.get('/clinic/activities/', { params: { tab, type: type || undefined, scope: scope === 'mine' ? 'mine' : undefined, q: dq || undefined, ordering, page, page_size: size } })).data,
    [tab, type, scope, dq, ordering, page, size]);
  const rows = list.data?.results || [];
  const counts = list.data?.counts || {};
  const total = list.data?.count || 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const typeList = types.data?.results || types.data || [];

  const refresh = useCallback(() => list.reload(true), [list]);
  useEffect(() => { setPage(1); setSel([]); }, [tab, type, scope, dq, size]);
  useEffect(() => { const fn = () => list.reload(true); window.addEventListener('akina:activity-saved', fn); return () => window.removeEventListener('akina:activity-saved', fn); }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (sp.get('open')) { setSp({}, { replace: true }); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const saveCols = (c) => { setCols(c); try { localStorage.setItem(COLS_KEY, JSON.stringify(c)); } catch { /* bỏ qua */ } };
  const show = (k) => cols.includes(k);

  const done = (msg = 'Đã cập nhật hoạt động.') => { toast(msg); refresh(); };
  const fail = (e) => toast(errMsg(e), 'err');
  const setState = async (a, k) => { try { await api.patch(`/clinic/activities/${a.id}/`, { set_state: k }); if (k === 'done') fireConfetti(); done(); } catch (e) { fail(e); } };
  const toggle = (a) => (a.status === 'pending' ? api.post(`/clinic/activities/${a.id}/complete/`).then(() => { fireConfetti(); done(); }).catch(fail)
    : api.post(`/clinic/activities/${a.id}/reopen/`).then(() => done('Đã mở lại hoạt động.')).catch(fail));
  const rename = async () => {
    const e = editing; setEditing(null);
    if (!e || !e.value.trim()) return;
    const a = rows.find((r) => r.id === e.id);
    if (a && a.title === e.value.trim()) return;
    try { await api.patch(`/clinic/activities/${e.id}/`, { title: e.value.trim() }); done(); } catch (er) { fail(er); }
  };
  const duplicate = (a) => api.post(`/clinic/activities/${a.id}/duplicate/`).then(() => done('Đã nhân bản hoạt động.')).catch(fail);
  const remove = async () => { const a = del; setDel(null); try { await api.delete(`/clinic/activities/${a.id}/`); setSel((s) => s.filter((x) => x !== a.id)); done('Đã xóa hoạt động.'); } catch (e) { fail(e); } };
  const bulk = async (op, extra = {}) => {
    try {
      const { data } = await api.post('/clinic/activities/bulk/', { op, ids: sel, ...extra });
      if (op === 'done' && data.ok.length) fireConfetti();
      setSel([]); done(data.skipped.length ? `Đã xử lý ${data.ok.length}, bỏ qua ${data.skipped.length} (${data.skipped[0].reason}).` : `Đã xử lý ${data.ok.length} hoạt động.`);
    } catch (e) { fail(e); }
  };
  const staff = useLoad(async () => (sel.length ? (await api.get('/clinic/activities/assignees/')).data : []), [sel.length > 0]);

  const rowMenu = (e, a) => menuOpen(e, [
    { label: 'Mở hoạt động', icon: '⤢', onClick: () => setDrawer(a.id) },
    { label: 'Sửa', icon: '✎', onClick: () => setForm({ item: a }) },
    { label: 'Nhân bản', icon: '⧉', onClick: () => duplicate(a) },
    { sep: true },
    { label: 'Xóa', icon: '🗑', danger: true, disabled: !a.can_delete, onClick: () => setDel(a) },
  ]);
  const sortBy = (k) => setOrdering((o) => (o === SORT[k] ? `-${SORT[k]}` : SORT[k]));
  const arrow = (k) => (ordering === SORT[k] ? ' ▲' : ordering === `-${SORT[k]}` ? ' ▼' : '');
  const allOnPage = rows.length > 0 && rows.every((r) => sel.includes(r.id));
  const emptyText = useMemo(() => ({ todo: 'Không có hoạt động nào cần làm.', overdue: 'Không có hoạt động quá hạn 🎉', completed: 'Chưa có hoạt động nào hoàn thành.' }[tab] || 'Không có hoạt động trong khoảng này.'), [tab]);

  return <div className="ac">
    <section className="ac-card">
      <div className="ac-head">
        <div><small className="ac-crumb">Hoạt động</small><h1>Hoạt động</h1></div>
        <div className="ac-head-r">
          <b className="ac-count">{counts.todo ?? 0} <span>hoạt động đang mở</span></b>
          <select className="ac-select" value={scope} onChange={(e) => setScope(e.target.value)} aria-label="Phạm vi"><option value="all">Tất cả hoạt động</option><option value="mine">Hoạt động của tôi</option></select>
          <button className="ac-btn primary lg" onClick={() => setForm({})}>＋ Thêm hoạt động</button>
        </div>
      </div>
      <nav className="ac-tabs" role="tablist">{TABS.map(([k, label, badge]) => <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
        {label}{badge && <em className={k === 'overdue' && counts.overdue ? 'red' : ''}>{counts[k] ?? 0}</em>}</button>)}</nav>

      <div className="ac-filter">
        <div className="ac-chipsrow">
          <button className={`ac-fchip ${!type ? 'on' : ''}`} onClick={() => setType('')}><span aria-hidden>▦</span>Tất cả</button>
          {typeList.map((t) => <button key={t.id} className={`ac-fchip ${String(type) === String(t.id) ? 'on' : ''}`} onClick={() => setType(String(type) === String(t.id) ? '' : t.id)}>
            <TypeIcon icon={t.icon} size={16} color={t.color} />{t.name}</button>)}
        </div>
        <label className="ac-searchbox"><span aria-hidden>⌕</span><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm theo tên hoạt động, bệnh nhân, SĐT…" />{q && <button onClick={() => setQ('')} aria-label="Xóa">×</button>}</label>
        <div className="ac-relative"><button className="ac-btn pillbtn" onClick={() => setColMenu(!colMenu)}>Cột hiển thị</button>
          {colMenu && <div className="ac-colmenu" onMouseLeave={() => setColMenu(false)}>{COLUMNS.map(([k, l]) => <label key={k}><input type="checkbox" checked={show(k)} disabled={k === 'activity'}
            onChange={() => saveCols(show(k) ? cols.filter((c) => c !== k) : COLUMNS.map(([c]) => c).filter((c) => c === k || cols.includes(c)))} />{l}</label>)}
            <button className="ac-link-btn" onClick={() => saveCols(DEFAULT_COLS)}>Đặt lại mặc định</button></div>}</div>
      </div>

      {sel.length > 0 && <div className="ac-bulk"><b>{sel.length} đã chọn</b>
        <button className="ac-btn sm" onClick={() => bulk('done')}>✓ Hoàn thành</button><button className="ac-btn sm" onClick={() => bulk('reopen')}>↺ Mở lại</button>
        <select className="ac-select sm" value="" onChange={(e) => e.target.value && bulk('assign', { assigned_to: Number(e.target.value) })}><option value="">Giao cho…</option>{(staff.data || []).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
        <button className="ac-btn sm danger" onClick={() => window.confirm(`Xóa ${sel.length} hoạt động đã chọn?`) && bulk('delete')}>Xóa</button>
        <button className="ac-btn ghost sm" onClick={() => setSel([])}>Bỏ chọn</button></div>}

      {list.loading && !list.data ? <Loading /> : <div className="ac-tablewrap"><table className="ac-table">
        <thead><tr>
          <th className="c-sel"><input type="checkbox" aria-label="Chọn tất cả" checked={allOnPage} onChange={() => setSel(allOnPage ? [] : rows.map((r) => r.id))} /></th>
          {show('done') && <th className="c-done">Xong</th>}
          {show('due') && <th className="c-due sortable" onClick={() => sortBy('due')}>Hạn{arrow('due') || ' ▼'}</th>}
          <th className="c-title sortable" onClick={() => sortBy('activity')}>Hoạt động{arrow('activity')}</th>
          {show('linked') && <th className="c-linked">Khách hàng</th>}
          {show('assigned') && <th className="c-owner sortable" onClick={() => sortBy('assigned')}>Phụ trách{arrow('assigned')}</th>}
          {show('status') && <th className="c-status sortable" onClick={() => sortBy('status')}>Trạng thái{arrow('status')}</th>}
          {show('created') && <th className="c-created">Tạo bởi</th>}
          <th className="c-act" />
        </tr></thead>
        <tbody>{rows.map((a) => <tr key={a.id} className={`${a.status !== 'pending' ? 'is-done' : ''} ${a.overdue ? 'is-overdue' : ''} ${sel.includes(a.id) ? 'is-sel' : ''}`} onClick={() => setDrawer(a.id)}>
          <td className="c-sel" onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label="Chọn" checked={sel.includes(a.id)} onChange={() => setSel((s) => (s.includes(a.id) ? s.filter((x) => x !== a.id) : [...s, a.id]))} /></td>
          {show('done') && <td className="c-done" onClick={(e) => e.stopPropagation()}><button className={`ac-tick ${a.status !== 'pending' ? 'on' : ''}`} aria-label={a.status === 'pending' ? 'Đánh dấu hoàn thành' : 'Mở lại'} aria-pressed={a.status !== 'pending'} onClick={() => toggle(a)}>{a.status !== 'pending' && '✓'}</button></td>}
          {show('due') && <td className="c-due">{fmtDue(a.end_at)}{a.overdue && <span className="ac-tag red">QUÁ HẠN</span>}</td>}
          <td className="c-title">{editing?.id === a.id
            ? <input autoFocus className="ac-inline" value={editing.value} onClick={(e) => e.stopPropagation()} onChange={(e) => setEditing({ ...editing, value: e.target.value })} onBlur={rename}
              onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(null); }} maxLength={200} />
            : <span className="ac-act-name"><span className="ac-ticon" title={a.type_name}><TypeIcon icon={a.type_icon} size={18} color={a.type_color} /></span>
              <span className="ac-act-t" onDoubleClick={(e) => { e.stopPropagation(); if (a.status === 'pending') setEditing({ id: a.id, value: a.title }); }}>{a.title}</span>
              {a.auto && <em className="ac-auto" title="Hệ thống tự tạo">Tự động</em>}</span>}</td>
          {show('linked') && <td className="c-linked" onClick={(e) => e.stopPropagation()}>{a.patient ? <Link to={`/benh-nhan/${a.patient}`} className="ac-person"><span className="ac-av sm">{initials(a.patient_name)}</span>
            <span><b>{a.patient_name}</b><small>{a.patient_code}</small></span></Link>
            : a.conversation ? <Link to={`/admin/conversations?c=${a.conversation}`} className="ac-person"><span className="ac-av sm lead">KT</span><span><b>{a.conversation_label.split(' · ')[1] || 'Khách tiềm năng'}</b><small>Ca tư vấn #{a.conversation}</small></span></Link> : '—'}</td>}
          {show('assigned') && <td className="c-owner">{a.assigned_to ? <span className="ac-person"><span className="ac-av sm">{initials(a.assigned_name)}</span><b>{a.assigned_name}</b></span> : <span className="ac-muted">Chưa giao</span>}</td>}
          {show('status') && <td className="c-status" onClick={(e) => e.stopPropagation()}><StatusPill state={a.state} onChange={(k) => setState(a, k)} /></td>}
          {show('created') && <td className="c-created ac-muted">{a.created_by_name || '—'}</td>}
          <td className="c-act" onClick={(e) => e.stopPropagation()}><button className="ac-more" aria-label="Thao tác" onClick={(e) => rowMenu(e, a)}>⋯</button></td>
        </tr>)}
          {!rows.length && <tr className="ac-empty"><td colSpan={12}><div><TypeIcon icon="task" size={34} color="#9db4c8" /><b>{q || type ? 'Không có hoạt động khớp bộ lọc' : emptyText}</b>
            {(q || type) ? <button className="ac-btn" onClick={() => { setQ(''); setType(''); }}>Xóa bộ lọc</button> : tab === 'todo' && <button className="ac-btn primary" onClick={() => setForm({})}>＋ Thêm hoạt động</button>}</div></td></tr>}</tbody>
      </table></div>}

      <footer className="ac-foot">
        <span>Hiển thị {rows.length} / {total} hoạt động</span>
        <span className="ac-foot-r">Số dòng mỗi trang
          <select className="ac-select sm" value={size} onChange={(e) => setSize(Number(e.target.value))}>{[25, 50, 100].map((n) => <option key={n}>{n}</option>)}</select>
          <button className="ac-pg" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Trang trước">‹</button><span>{page}/{pages}</span>
          <button className="ac-pg" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Trang sau">›</button></span>
      </footer>
    </section>

    {menuNode}
    {drawer && <ActivityDrawer id={drawer} onClose={() => setDrawer(null)} onChanged={done} onEdit={(a) => { setDrawer(null); setForm({ item: a }); }} />}
    {form && <ActivityForm item={form.item} preset={form.preset} onClose={() => setForm(null)} onSaved={(data, o) => { setForm(null); done(o.created ? 'Đã thêm hoạt động.' : 'Đã cập nhật hoạt động.'); }} />}
    {del && <AcModal title="Xóa hoạt động" width={440} onClose={() => setDel(null)}
      footer={<><button className="ac-btn" onClick={() => setDel(null)}>Hủy</button><button className="ac-btn danger solid" onClick={remove}>Xóa</button></>}>
      <p>Xóa hoạt động <b>“{del.title}”</b>? Thao tác này không thể hoàn tác.</p></AcModal>}
    {toastNode}
  </div>;
}
