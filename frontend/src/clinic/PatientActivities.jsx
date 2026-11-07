import { useEffect, useMemo, useState } from 'react';
import api from '../api/client';
import { Loading, errMsg, useLoad, useToast } from './ui';
import { fmtDay, groupForClient } from './activityKit';
import { fireConfetti } from './confetti';
import { AcModal, ActivityDrawer, ActivityForm, ImplicitLinks, NoteView, TypeIcon, usePopMenu } from './ActivityDialogs';
import './activities.css';

/**
 * Tab "Hoạt động" trong hồ sơ bệnh nhân (ảnh 1, 2, 5): Quá hạn / Đã lên lịch / Hoàn thành.
 * Dùng:  <PatientActivities patient={patient} />   (patient = { id, full_name, code })
 */
export default function PatientActivities({ patient, onChanged }) {
  const [typeCode, setTypeCode] = useState('');
  const [form, setForm] = useState(null);
  const [drawer, setDrawer] = useState(null);
  const [del, setDel] = useState(null);
  const [toast, toastNode] = useToast();
  const [menuOpen, menuNode] = usePopMenu();
  const open = useLoad(async () => (await api.get('/clinic/activities/', { params: { patient: patient.id, tab: 'todo', page_size: 200 } })).data.results, [patient.id]);
  const closed = useLoad(async () => (await api.get('/clinic/activities/', { params: { patient: patient.id, tab: 'completed', page_size: 200 } })).data.results, [patient.id]);
  const reload = () => { open.reload(true); closed.reload(true); };
  useEffect(() => { const fn = () => reload(); window.addEventListener('akina:activity-saved', fn); return () => window.removeEventListener('akina:activity-saved', fn); }); // eslint-disable-line react-hooks/exhaustive-deps
  const all = useMemo(() => [...(open.data || []), ...(closed.data || [])], [open.data, closed.data]);
  const types = useMemo(() => [...new Map(all.map((a) => [a.type_code, a])).values()].filter((a) => a.type_code), [all]);
  const groups = groupForClient(all.filter((a) => !typeCode || a.type_code === typeCode));
  const ok = (m = 'Đã cập nhật hoạt động.') => { toast(m); reload(); onChanged?.(); };
  const fail = (e) => toast(errMsg(e), 'err');
  const toggle = (a) => (a.status === 'pending' ? api.post(`/clinic/activities/${a.id}/complete/`).then(() => { fireConfetti(); ok(); }).catch(fail)
    : api.post(`/clinic/activities/${a.id}/reopen/`).then(() => ok('Đã mở lại hoạt động.')).catch(fail));
  const menu = (e, a) => menuOpen(e, [
    { label: a.status === 'pending' ? 'Đánh dấu hoàn thành' : 'Mở lại', onClick: () => toggle(a) },
    { label: 'Sửa', onClick: () => setForm({ item: a }) },
    { sep: true },
    { label: 'Xóa', danger: true, disabled: !a.can_delete, onClick: () => setDel(a) },
  ]);
  const Section = ({ id, label, tone, list }) => list.length > 0 && <div className="ac-cl-sec" key={id}>
    <div className="ac-cl-div"><span className={`ac-cl-badge ${tone}`}>{label}</span></div>
    {list.map((a) => <article key={a.id} className={`ac-cl-card ${a.overdue ? 'overdue' : ''} ${a.status !== 'pending' ? 'done' : ''}`} onClick={() => setDrawer(a.id)}>
      <button className={`ac-tick ${a.status !== 'pending' ? 'on' : ''}`} aria-label={a.status === 'pending' ? 'Đánh dấu hoàn thành' : 'Mở lại'} onClick={(e) => { e.stopPropagation(); toggle(a); }}>{a.status !== 'pending' && '✓'}</button>
      <span className="ac-cl-ic"><TypeIcon icon={a.type_icon} size={20} color="#6b5bd2" /></span>
      <div className="ac-cl-main">
        <h3>{a.title}{a.overdue && <span className="ac-tag red">⏱ QUÁ HẠN</span>}</h3>
        <p className={a.overdue ? 'ac-red' : ''}>Hạn: {fmtDay(a.end_at)} • {a.assigned_name || 'Chưa giao'}</p>
        {(a.note || a.links.length > 0) && <div className="ac-cl-note"><NoteView note={a.note} links={a.links} empty="" /><ImplicitLinks links={a.links} /></div>}
      </div>
      <button className="ac-more" aria-label="Thao tác" onClick={(e) => menu(e, a)}>⋮</button>
    </article>)}
  </div>;
  return <div className="ac-cl">
    <div className="ac-cl-bar">
      <div className="ac-chipsrow">
        <button className={`ac-fchip ${!typeCode ? 'on' : ''}`} onClick={() => setTypeCode('')}>TẤT CẢ</button>
        {types.map((t) => <button key={t.type_code} className={`ac-fchip ${typeCode === t.type_code ? 'on' : ''}`} onClick={() => setTypeCode(typeCode === t.type_code ? '' : t.type_code)}>
          <TypeIcon icon={t.type_icon} size={15} color={t.type_color} />{t.type_name}</button>)}
      </div>
      <button className="ac-btn primary" onClick={() => setForm({ preset: { patient: { id: patient.id, full_name: patient.full_name, code: patient.code } } })}>＋ Thêm hoạt động</button>
    </div>
    {open.loading && !open.data ? <Loading /> : <>
      <Section id="o" label="Quá hạn" tone="red" list={groups.overdue} />
      <Section id="s" label="Đã lên lịch" tone="gray" list={groups.scheduled} />
      <Section id="d" label="Hoàn thành" tone="gray" list={groups.done} />
      {!all.length && <div className="ac-cl-empty"><TypeIcon icon="task" size={36} color="#9db4c8" /><b>Chưa có hoạt động nào</b><span>Thêm cuộc gọi, email hay nhắc lịch cho bệnh nhân này.</span></div>}</>}
    {menuNode}
    {drawer && <ActivityDrawer id={drawer} onClose={() => setDrawer(null)} onChanged={ok} onEdit={(a) => { setDrawer(null); setForm({ item: a }); }} />}
    {form && <ActivityForm item={form.item} preset={form.preset} onClose={() => setForm(null)} onSaved={(d, o) => { setForm(null); ok(o.created ? 'Đã thêm hoạt động.' : 'Đã cập nhật hoạt động.'); }} />}
    {del && <AcModal title="Xóa hoạt động" width={440} onClose={() => setDel(null)} footer={<><button className="ac-btn" onClick={() => setDel(null)}>Hủy</button>
      <button className="ac-btn danger solid" onClick={async () => { const a = del; setDel(null); try { await api.delete(`/clinic/activities/${a.id}/`); ok('Đã xóa hoạt động.'); } catch (e) { fail(e); } }}>Xóa</button></>}>
      <p>Xóa hoạt động <b>“{del.title}”</b>?</p></AcModal>}
    {toastNode}
  </div>;
}
