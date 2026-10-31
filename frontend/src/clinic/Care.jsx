import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import AddRounded from '@mui/icons-material/AddRounded';
import SearchRounded from '@mui/icons-material/SearchRounded';
import AccessTimeRounded from '@mui/icons-material/AccessTimeRounded';
import CalendarTodayRounded from '@mui/icons-material/CalendarTodayRounded';
import LocalHospitalRounded from '@mui/icons-material/LocalHospitalRounded';
import TaskAltRounded from '@mui/icons-material/TaskAltRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import api from '../api/client';
import SmartFilterBar from './SmartFilterBar';
import { Avatar, Btn, Card, Empty, Field, Loading, Modal, PageHead, Pill, errMsg, fmtDate, isoDay, useDebounce, useLoad, useToast } from './ui';

const arr = (d) => d?.results || d || [];
const KINDS = [['post_care', 'Hỏi thăm sau điều trị'], ['revisit', 'Nhắc lịch tái khám'], ['session', 'Nhắc buổi liệu trình'], ['payment', 'Nhắc công nợ'], ['other', 'Khác']];
const CHANNELS = [['call', 'Điện thoại'], ['zalo', 'Zalo'], ['messenger', 'Messenger'], ['sms', 'SMS'], ['email', 'Email'], ['in_person', 'Tại phòng khám']];
const RESULTS = [['contacted', 'Đã liên hệ'], ['no_answer', 'Không nghe máy / chưa phản hồi'], ['rescheduled', 'Hẹn liên hệ lại'], ['needs_doctor', 'Cần bác sĩ đánh giá'], ['completed', 'Hoàn tất chăm sóc']];
const STATUS_LABELS = { pending: 'Chờ xử lý', escalated: 'Chờ bác sĩ', done: 'Đã xử lý', skipped: 'Bỏ qua' };
const PAGE_SIZE = 15;

const fmtDateTime = (value) => value ? new Intl.DateTimeFormat('vi-VN', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—';

function NewTask({ onClose, onSaved }) {
  const [q, setQ] = useState('');
  const dq = useDebounce(q, 250);
  const [pt, setPt] = useState(null);
  const [f, setF] = useState({ kind: 'post_care', priority: 'normal', title: '', due_date: isoDay() });
  const [err, setErr] = useState('');
  const l = useLoad(async () => (dq.trim().length >= 2 ? arr((await api.get('/clinic/patients/', { params: { q: dq.trim(), limit: 6 } })).data) : []), [dq]);
  const save = async () => { try { await api.post('/clinic/care-tasks/', { ...f, patient: pt.id }); onSaved(); } catch (e) { setErr(errMsg(e)); } };
  return <Modal open title="Thêm việc chăm sóc" onClose={onClose} footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={!pt || !f.title.trim()} onClick={save}>Lưu</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    {pt ? <div className="cl-picked"><Avatar name={pt.full_name} /><div><strong>{pt.full_name}</strong><small>{pt.code}</small></div><button className="cl-link" onClick={() => setPt(null)}>Đổi</button></div>
      : <div className="cl-picker"><div className="cl-input-icon"><SearchRounded /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm bệnh nhân (tên, SĐT, mã)…" autoFocus /></div>
        <div className="cl-picker-list">{(l.data || []).map((p) => <button key={p.id} onClick={() => setPt(p)}><Avatar name={p.full_name} size={30} /><span><strong>{p.full_name}</strong><small>{p.code}</small></span></button>)}</div></div>}
    <div className="cl-form-grid" style={{ marginTop: 14 }}>
      <Field label="Loại việc"><select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></Field>
      <Field label="Hạn xử lý"><input type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
      <Field label="Mức ưu tiên"><select value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="normal">Bình thường</option><option value="high">Ưu tiên cao</option><option value="urgent">Khẩn cấp</option></select></Field>
      <Field label="Nội dung" required span="2"><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="VD: Hỏi thăm tình trạng da sau peel" /></Field>
    </div>
  </Modal>;
}

function Contact({ t, onClose, onDone }) {
  const [f, setF] = useState({ channel: 'call', result: 'contacted', note: '', next_contact_at: '', clinical_alert: false });
  const [err, setErr] = useState('');
  const save = async () => {
    if (f.result === 'rescheduled' && !f.next_contact_at) { setErr('Vui lòng chọn thời gian liên hệ lại.'); return; }
    try { await api.post(`/clinic/care-tasks/${t.id}/contact/`, f); onDone(); } catch (e) { setErr(errMsg(e)); }
  };
  return <Modal open title="Ghi nhận lần chăm sóc" subtitle={`${t.patient_name} · ${t.title}`} onClose={onClose}
    footer={<><Btn onClick={onClose}>Hủy</Btn><Btn kind="primary" disabled={!f.note.trim()} onClick={save}>Lưu kết quả</Btn></>}>
    {err && <div className="cl-alert error">{err}</div>}
    <div className="cl-form-grid">
      <Field label="Kênh liên hệ"><select value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{CHANNELS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Kết quả"><select value={f.result} onChange={(e) => setF({ ...f, result: e.target.value, clinical_alert: e.target.value === 'needs_doctor' || f.clinical_alert })}>{RESULTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
      <Field label="Nội dung trao đổi / tình trạng" required span="2"><textarea rows={4} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ghi rõ triệu chứng, phản ứng sau điều trị, hướng dẫn đã cung cấp và phản hồi của bệnh nhân." /></Field>
      <Field label="Liên hệ lại lúc"><input type="datetime-local" value={f.next_contact_at} onChange={(e) => setF({ ...f, next_contact_at: e.target.value })} /></Field>
      <label className="cl-check" style={{ alignSelf: 'end', paddingBottom: 10 }}><input type="checkbox" checked={f.clinical_alert} onChange={(e) => setF({ ...f, clinical_alert: e.target.checked })} /> Có dấu hiệu cần bác sĩ đánh giá</label>
    </div>
    {(f.clinical_alert || f.result === 'needs_doctor') && <div className="cl-alert warn">Ca sẽ được chuyển sang trạng thái “Chờ bác sĩ” và đánh dấu khẩn cấp. Không đưa kết luận y khoa qua CSKH.</div>}
  </Modal>;
}

function TaskDetail({ task, onClose, onContact }) {
  const l = useLoad(async () => (await api.get(`/clinic/care-tasks/${task.id}/`)).data, [task.id]);
  const t = l.data || task;
  const history = t.contact_history || [];
  return <Modal open wide title="Hồ sơ chăm sóc" subtitle={`${t.patient_name} · ${t.patient_code}`} onClose={onClose}
    footer={<><Btn onClick={onClose}>Đóng</Btn>{['pending', 'escalated'].includes(t.status) && <Btn kind="primary" onClick={() => onContact(t)}>{t.status === 'escalated' ? 'Bác sĩ ghi nhận' : 'Ghi nhận liên hệ'}</Btn>}</>}>
    {l.loading && !l.data ? <Loading /> : <div className="care-detail-grid">
      <section className="care-case-card">
        <div className="care-patient-line"><Avatar name={t.patient_name} size={42}/><div><Link to={`/benh-nhan/${t.patient}`}><strong>{t.patient_name}</strong></Link><small>{t.patient_code} · {t.patient_phone}</small></div></div>
        <dl className="care-case-kv">
          <div><dt>Trạng thái</dt><dd><Pill tone={t.status === 'escalated' ? 'red' : t.status === 'done' ? 'green' : 'blue'}>{STATUS_LABELS[t.status]}</Pill></dd></div>
          <div><dt>Hạn xử lý</dt><dd>{fmtDate(t.due_date)} {t.overdue && <Pill tone="red">Quá hạn</Pill>}</dd></div>
          <div><dt>Loại công việc</dt><dd>{t.kind_label}</dd></div>
          <div><dt>Phụ trách</dt><dd>{t.assigned_name || 'Chưa phân công'}</dd></div>
          <div className="span2"><dt>Nội dung</dt><dd>{t.title}</dd></div>
          {t.escalation_reason && <div className="span2 clinical"><dt>Lý do chuyển bác sĩ</dt><dd>{t.escalation_reason}</dd></div>}
        </dl>
      </section>
      <section className="care-history">
        <header><HistoryRounded/><div><strong>Nhật ký chăm sóc</strong><small>{history.length} lần liên hệ</small></div></header>
        {history.length ? <div className="care-history-list">{history.map((h) => <article key={h.id}>
          <i className={h.clinical_alert ? 'alert' : ''}/><div><div className="care-history-head"><strong>{h.channel_label} · {h.result_label}</strong><time>{fmtDateTime(h.created_at)}</time></div><p>{h.note}</p><small>{h.created_by}{h.next_contact_at ? ` · Hẹn lại ${fmtDateTime(h.next_contact_at)}` : ''}</small></div>
        </article>)}</div> : <Empty title="Chưa có lần liên hệ" hint="Nhật ký sẽ được lưu sau mỗi lần gọi, nhắn tin hoặc gặp trực tiếp."/>}
      </section>
    </div>}
  </Modal>;
}

export default function CarePage() {
  const [st, setSt] = useState('pending');
  const [mine, setMine] = useState(false);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('');
  const [priority, setPriority] = useState('');
  const [dueScope, setDueScope] = useState('all');
  const [groupBy, setGroupBy] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState(null);
  const [toast, toastNode] = useToast();
  const sum = useLoad(async () => (await api.get('/clinic/care-tasks/summary/')).data, []);
  const dq = useDebounce(q, 250);
  const l = useLoad(async () => arr((await api.get('/clinic/care-tasks/', { params: { status: st, mine: mine ? 1 : undefined, q: dq || undefined, kind: kind || undefined, priority: priority || undefined } })).data), [st, mine, dq, kind, priority]);
  const rows = l.data || [];
  const s = sum.data;
  const today = isoDay();
  const filteredRows = useMemo(() => rows.filter((t) => {
    if (st !== 'pending' || dueScope === 'all') return true;
    if (dueScope === 'overdue') return t.due_date < today;
    if (dueScope === 'today') return t.due_date === today;
    return t.due_date > today;
  }), [rows, st, dueScope, today]);
  const pages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const visibleRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const groupedRows = useMemo(() => {
    if (!groupBy) return [['', visibleRows]];
    const groups = new Map();
    visibleRows.forEach((t) => {
      let label = 'Chưa xác định';
      if (groupBy === 'kind') label = t.kind_label;
      if (groupBy === 'assignee') label = t.assigned_name || 'Chưa phân công';
      if (groupBy === 'priority') label = t.priority_label;
      if (groupBy === 'due') label = t.due_date < today ? 'Quá hạn' : t.due_date === today ? 'Hôm nay' : 'Sắp tới';
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(t);
    });
    return [...groups.entries()];
  }, [visibleRows, groupBy, today]);
  useEffect(() => setPage(1), [st, mine, dq, kind, priority, dueScope]);
  useEffect(() => { if (page > pages) setPage(pages); }, [page, pages]);
  const refresh = (msg) => () => { setModal(null); l.reload(true); sum.reload(true); if (msg) toast(msg); };
  const reopen = async (t) => { try { await api.post(`/clinic/care-tasks/${t.id}/reopen/`); refresh('Đã mở lại việc.')(); } catch (e) { toast(errMsg(e), 'err'); } };
  const smartFilters = [
    { key: 'kind', label: 'Loại công việc', value: kind, onChange: setKind, options: KINDS.map(([value, label]) => ({ value, label })) },
    { key: 'priority', label: 'Mức ưu tiên', value: priority, onChange: setPriority, options: [{ value: 'urgent', label: 'Khẩn cấp' }, { value: 'high', label: 'Ưu tiên cao' }, { value: 'normal', label: 'Bình thường' }] },
    { key: 'due', label: 'Thời hạn', value: dueScope === 'all' ? '' : dueScope, onChange: (v) => setDueScope(v || 'all'), options: [{ value: 'overdue', label: 'Quá hạn' }, { value: 'today', label: 'Hôm nay' }, { value: 'upcoming', label: 'Sắp tới' }] },
  ];
  const applyFavorite = (state) => { setQ(state.search || ''); setKind(state.filters?.kind || ''); setPriority(state.filters?.priority || ''); setDueScope(state.filters?.due || 'all'); setGroupBy(state.groupBy || ''); };
  return <>
    <PageHead actions={<Btn kind="primary" icon={<AddRounded />} onClick={() => setModal({ t: 'new' })}>Thêm việc</Btn>} />
    {s && <div className="care-kpis">
      <button className="care-kpi blue" onClick={() => { setSt('pending'); setDueScope('all'); }}><AccessTimeRounded/><span><small>Đang chờ xử lý</small><strong>{s.pending}</strong><em>Tất cả công việc mở</em></span></button>
      <button className={`care-kpi ${s.overdue ? 'danger' : ''}`} onClick={() => { setSt('pending'); setDueScope('overdue'); }}><AccessTimeRounded/><span><small>Quá hạn</small><strong>{s.overdue}</strong><em>Cần ưu tiên xử lý</em></span></button>
      <button className="care-kpi" onClick={() => { setSt('pending'); setDueScope('today'); }}><CalendarTodayRounded/><span><small>Đến hạn hôm nay</small><strong>{s.today}</strong><em>Kế hoạch trong ngày</em></span></button>
      <button className={`care-kpi ${s.escalated ? 'danger' : ''}`} onClick={() => { setSt('escalated'); setDueScope('all'); }}><LocalHospitalRounded/><span><small>Chờ bác sĩ</small><strong>{s.escalated}</strong><em>Cần xác nhận chuyên môn</em></span></button>
      <button className="care-kpi success" onClick={() => { setSt('done'); setDueScope('all'); }}><TaskAltRounded/><span><small>Đã xử lý 7 ngày</small><strong>{s.done_week}</strong><em>Hiệu suất gần đây</em></span></button>
    </div>}
    <div className="cl-toolbar-row cl-bar-top care-viewbar">
      <div className="cl-tabs-pill" style={{ margin: 0 }}>{[['pending', 'Chờ xử lý', s?.pending], ['escalated', 'Chờ bác sĩ', s?.escalated], ['done', 'Đã xử lý'], ['skipped', 'Bỏ qua']].map(([k, t, n]) => <button key={k} className={st === k ? 'on' : ''} onClick={() => { setSt(k); setDueScope('all'); }}>{t}{Number.isFinite(n) && <b>{n}</b>}</button>)}</div>
      <label className="cl-check"><input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} /> Việc của tôi</label>
    </div>
    <SmartFilterBar id="care" search={q} onSearch={setQ} placeholder="Tìm bệnh nhân, mã hồ sơ, số điện thoại, nội dung…" filters={smartFilters} groupBy={groupBy} onGroupBy={setGroupBy}
      groupOptions={[{ value: 'due', label: 'Thời hạn' }, { value: 'assignee', label: 'Người phụ trách' }, { value: 'kind', label: 'Loại công việc' }, { value: 'priority', label: 'Mức ưu tiên' }]} onApplyFavorite={applyFavorite}/>
    <Card pad={false}>
      {l.loading && !l.data ? <Loading /> : visibleRows.length ? <><div className="cl-table-wrap"><table className="cl-table care-table">
        <thead><tr><th>Bệnh nhân</th><th>Việc cần làm</th><th>Loại</th><th>Hạn</th><th>Phụ trách</th>{st !== 'pending' && <th>Kết quả</th>}<th /></tr></thead>
        <tbody>{groupedRows.map(([label, items]) => <Fragment key={label || 'all'}>{label && <tr className="sf-group-row"><td colSpan={st !== 'pending' ? 7 : 6}><strong>{label}</strong><span>{items.length}</span></td></tr>}{items.map((t) => <tr key={t.id} className="click" onClick={() => setModal({ t: 'detail', task: t })}>
          <td><Link to={`/benh-nhan/${t.patient}`} className="cl-visit-name"><Avatar name={t.patient_name} size={32} /><span><strong>{t.patient_name}</strong><small>{t.patient_code} · {t.patient_phone}</small></span></Link></td>
          <td>{t.title}{t.auto && <small className="cl-sub">Tạo tự động</small>}{t.last_contact && <small className="cl-sub">Lần gần nhất: {t.last_contact.channel_label} · {t.last_contact.result_label}</small>}</td><td><Pill tone="teal">{t.kind_label}</Pill>{t.priority !== 'normal' && <Pill tone={t.priority === 'urgent' ? 'red' : 'amber'}>{t.priority_label}</Pill>}</td>
          <td>{fmtDate(t.due_date)} {t.overdue && st === 'pending' && <Pill tone="red">Quá hạn</Pill>}</td><td>{t.assigned_name || '—'}</td>
          {st !== 'pending' && <td>{t.outcome || '—'}</td>}
          <td onClick={(e) => e.stopPropagation()}>{['pending', 'escalated'].includes(st) ? <Btn size="sm" onClick={() => setModal({ t: 'contact', task: t })}>{st === 'escalated' ? 'Bác sĩ xử lý' : 'Ghi nhận'}</Btn> : <button className="cl-link" onClick={() => reopen(t)}>Mở lại</button>}</td></tr>)}</Fragment>)}</tbody></table></div>
        <nav className="care-pagination" aria-label="Phân trang công việc"><span>{filteredRows.length} công việc</span><div><button disabled={page === 1} onClick={() => setPage((p) => p - 1)}><ChevronLeftRounded/></button>{Array.from({ length: pages }, (_, i) => i + 1).filter((p) => pages <= 7 || p === 1 || p === pages || Math.abs(p - page) <= 1).map((p, i, a) => <span key={p}>{i && p - a[i - 1] > 1 ? <i>…</i> : null}<button className={page === p ? 'on' : ''} onClick={() => setPage(p)}>{p}</button></span>)}<button disabled={page === pages} onClick={() => setPage((p) => p + 1)}><ChevronRightRounded/></button></div></nav></>
        : <Empty title={st === 'pending' ? 'Không còn việc chăm sóc nào' : 'Chưa có dữ liệu'} hint="Việc nhắc tái khám, hỏi thăm sau điều trị và nhắc công nợ được tạo tự động." />}
    </Card>
    {modal?.t === 'new' && <NewTask onClose={() => setModal(null)} onSaved={refresh('Đã thêm việc chăm sóc.')} />}
    {modal?.t === 'contact' && <Contact t={modal.task} onClose={() => setModal(null)} onDone={refresh('Đã ghi nhận lần chăm sóc.')} />}
    {modal?.t === 'detail' && <TaskDetail task={modal.task} onClose={() => setModal(null)} onContact={(task) => setModal({ t: 'contact', task })} />}
    {toastNode}
  </>;
}
