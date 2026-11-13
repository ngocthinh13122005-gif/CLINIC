import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import SearchRounded from '@mui/icons-material/SearchRounded';
import RefreshRounded from '@mui/icons-material/RefreshRounded';
import ChevronLeftRounded from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRounded from '@mui/icons-material/ChevronRightRounded';
import ArrowBackRounded from '@mui/icons-material/ArrowBackRounded';
import PersonAddAlt1Rounded from '@mui/icons-material/PersonAddAlt1Rounded';
import AssignmentReturnRounded from '@mui/icons-material/AssignmentReturnRounded';
import MedicalServicesRounded from '@mui/icons-material/MedicalServicesRounded';
import DoneAllRounded from '@mui/icons-material/DoneAllRounded';
import ReplayRounded from '@mui/icons-material/ReplayRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import VisibilityRounded from '@mui/icons-material/VisibilityRounded';
import CloseRounded from '@mui/icons-material/CloseRounded';
import FlagRounded from '@mui/icons-material/FlagRounded';
import OutlinedFlagRounded from '@mui/icons-material/OutlinedFlagRounded';
import MoreHorizRounded from '@mui/icons-material/MoreHorizRounded';
import ScheduleRounded from '@mui/icons-material/ScheduleRounded';
import VisibilityOffRounded from '@mui/icons-material/VisibilityOffRounded';
import WarningAmberRounded from '@mui/icons-material/WarningAmberRounded';
import CheckRounded from '@mui/icons-material/CheckRounded';
import DeleteOutlineRounded from '@mui/icons-material/DeleteOutlineRounded';
import AddRounded from '@mui/icons-material/AddRounded';
import StarRounded from '@mui/icons-material/StarRounded';
import RateReviewRounded from '@mui/icons-material/RateReviewRounded';
import AutoAwesomeRounded from '@mui/icons-material/AutoAwesomeRounded';
import ChatRounded from '@mui/icons-material/ChatRounded';
import AssessmentRounded from '@mui/icons-material/AssessmentRounded';
import RuleRounded from '@mui/icons-material/RuleRounded';
import SellRounded from '@mui/icons-material/SellRounded';
import TrendingUpRounded from '@mui/icons-material/TrendingUpRounded';
import TuneRounded from '@mui/icons-material/TuneRounded';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import useChatThread from '../hooks/useChatThread';
import ChatMessages, { Stars, initials, avatarTone } from '../components/chat/ChatMessages';
import ChatComposer from '../components/chat/ChatComposer';
import '../styles/support-inbox.css';

/* ---------- helpers ---------- */
const timeAgo = (value) => {
  if (!value) return '';
  const sec = Math.max(0, (Date.now() - new Date(value).getTime()) / 1000);
  if (sec < 60) return 'Vừa xong';
  if (sec < 3600) return `${Math.floor(sec / 60)} phút`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} giờ`;
  return new Date(value).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });
};
const roleHint = (role) => (role === 'manager' ? 'Giám sát hội thoại, phân công và theo dõi chất lượng chăm sóc.'
  : role === 'doctor' ? 'Các hội thoại chuyên môn đã được CSKH chuyển đến bác sĩ.' : 'Tiếp nhận, trả lời và chăm sóc bệnh nhân.');
const maskEmail = (v) => { if (!v) return ''; const [u, d] = v.split('@'); return d ? `${u.slice(0, 2)}***@${d}` : v; };
const maskPhone = (v) => { const n = String(v || '').replace(/\s+/g, ''); return n.length >= 8 ? `${n.slice(0, 3)} *** ${n.slice(-3)}` : n; };
const dateVi = (v) => (v ? new Date(v).toLocaleDateString('vi-VN') : '');

// Màu nhãn: hỗ trợ mã hex và tên màu cũ (bootstrap) của dữ liệu mẫu.
const NAMED = { primary: '#2563eb', secondary: '#64748b', success: '#16805b', danger: '#c43f4f', warning: '#587086', info: '#0f8090' };
const tagColor = (c) => (c && c.startsWith('#') ? c : NAMED[c] || '#64748b');
export const PALETTE = ['#c43f4f', '#b04470', '#a65562', '#0f8090', '#16805b', '#2563eb', '#7357b3', '#64748b'];

function useOutside(ref, onClose, active) {
  useEffect(() => {
    if (!active) return undefined;
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [ref, onClose, active]);
}

function Avatar({ src, name, size = 40 }) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.36) };
  return src ? <img className="cs-avatar" src={src} alt="" style={style}/> : <div className="cs-avatar fallback" style={{ ...style, ...avatarTone(name) }}>{initials(name)}</div>;
}
const Flag = ({ color, size = 16, outline }) => (outline ? <OutlinedFlagRounded sx={{ fontSize: size, color: tagColor(color) }}/> : <FlagRounded sx={{ fontSize: size, color: tagColor(color) }}/>);

/* ---------- Quản lý nhãn hội thoại ---------- */
function TagManager({ tags, onClose, onChanged, onError }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState(PALETTE[5]);
  const [busy, setBusy] = useState(false);
  const run = async (fn) => { setBusy(true); try { await fn(); await onChanged(); } catch (e) { onError(e.response?.data?.detail || 'Không cập nhật được nhãn.'); } finally { setBusy(false); } };
  return (
    <div className="cs-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="cs-modal" role="dialog" aria-label="Quản lý nhãn hội thoại">
        <div className="cs-modal-head"><strong>Quản lý nhãn hội thoại</strong><button type="button" className="cs-icon" onClick={onClose} aria-label="Đóng"><CloseRounded/></button></div>
        <div className="cs-modal-body">
          <div className="cs-tag-new">
            <input value={name} maxLength={50} onChange={(e) => setName(e.target.value)} placeholder="Tên nhãn mới (VD: Tái khám)"
              onKeyDown={(e) => e.key === 'Enter' && name.trim() && run(async () => { await api.post('/tags/', { name, color }); setName(''); })}/>
            <button type="button" disabled={busy || !name.trim()} onClick={() => run(async () => { await api.post('/tags/', { name, color }); setName(''); })}><AddRounded/>Thêm</button>
          </div>
          <div className="cs-palette">{PALETTE.map((c) => <button type="button" key={c} className={color === c ? 'on' : ''} style={{ background: c }} onClick={() => setColor(c)} aria-label={`Màu ${c}`}>{color === c && <CheckRounded/>}</button>)}</div>
          <div className="cs-tag-list">
            {tags.map((t) => (
              <div className="cs-tag-item" key={t.id}>
                <div className="cs-tag-colors">{PALETTE.map((c) => <button type="button" key={c} title="Đổi màu" className={tagColor(t.color) === c ? 'on' : ''} style={{ background: c }} onClick={() => run(() => api.patch(`/tags/${t.id}/`, { color: c }))}/>)}</div>
                <input defaultValue={t.name} maxLength={50} aria-label="Tên nhãn" onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== t.name) run(() => api.patch(`/tags/${t.id}/`, { name: v })); else e.target.value = t.name; }}/>
                <button type="button" className="cs-tag-del" title="Xóa nhãn" onClick={() => window.confirm(`Xóa nhãn “${t.name}”? Nhãn sẽ bị gỡ khỏi mọi hội thoại.`) && run(() => api.delete(`/tags/${t.id}/`))}><DeleteOutlineRounded/></button>
              </div>
            ))}
            {!tags.length && <p className="cs-muted pad">Chưa có nhãn nào. Hãy tạo nhãn đầu tiên.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------- Xác nhận gửi mời đánh giá ---------- */
function CsatConfirm({ busy, onCancel, onSend }) {
  return (
    <div className="cs-modal-back" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="cs-modal narrow" role="dialog" aria-label="Xác nhận gửi">
        <div className="cs-modal-head"><strong>Xác nhận gửi</strong></div>
        <div className="cs-modal-body">
          <p className="cs-confirm-q">Gửi lời mời sẽ kết thúc phiên chăm sóc hiện tại. Mỗi phiên chỉ được gửi một lần.</p>
          <div className="cs-csat-preview">
            <div className="chat-csat-head"><StarRounded/><strong>Đánh giá phiên chăm sóc</strong></div>
            <p>Vui lòng dành một chút thời gian để đánh giá trải nghiệm gần đây của bạn với chúng tôi.</p>
            <Stars value={0} readOnly size={28}/>
          </div>
        </div>
        <div className="cs-modal-foot">
          <button type="button" className="ghost" onClick={onCancel}>Huỷ</button>
          <button type="button" className="primary" disabled={busy} onClick={onSend}>{busy ? 'Đang gửi...' : 'Gửi'}</button>
        </div>
      </div>
    </div>
  );
}

function ManagerNavigation({ view, onChange }) {
  const items = [
    ['inbox', 'Hội thoại', ChatRounded],
    ['feedback', 'Thống kê', AssessmentRounded],
    ['automation', 'Quy tắc tự động', RuleRounded],
    ['labels', 'Nhãn & mẫu trả lời', SellRounded],
  ];
  return <nav className="cs-manager-nav" aria-label="Quản trị chăm sóc khách hàng">{items.map(([key, label, Icon]) => (
    <button type="button" key={key} className={view === key ? 'active' : ''} onClick={() => onChange(key)}><Icon/><span>{label}</span></button>
  ))}</nav>;
}

function FeedbackDashboard({ analytics }) {
  const data = analytics || {};
  const maxInvited = Math.max(1, ...(data.daily || []).map((d) => d.invited || 0));
  const totalScores = Object.values(data.distribution || {}).reduce((sum, value) => sum + value, 0) || 1;
  return <section className="cs-manager-view">
    <div className="cs-view-heading"><div><span>VẬN HÀNH & CHẤT LƯỢNG CSKH</span><h2>Thống kê chăm sóc khách hàng</h2><p>Theo dõi hàng chờ, SLA, hiệu suất xử lý và mức độ hài lòng của khách hàng.</p></div><div className="cs-heading-icon"><AssessmentRounded/></div></div>
    <div className="cs-ops-kpi-grid">
      <article><span>Mới hôm nay</span><strong>{data.new || 0}</strong></article>
      <article><span>Chưa gán</span><strong>{data.unassigned || 0}</strong></article>
      <article className={data.overdue ? 'danger' : ''}><span>Quá SLA</span><strong>{data.overdue || 0}</strong></article>
      <article><span>Hoàn tất</span><strong>{data.closed || 0}</strong></article>
      <article><span>Hài lòng</span><strong>{data.avg_csat || 0}<small>/5</small></strong></article>
    </div>
    <div className="cs-kpi-grid">
      <article><span>Điểm hài lòng</span><strong>{data.avg_csat || 0}<small>/5</small></strong><em><TrendingUpRounded/> Trung bình toàn kỳ</em></article>
      <article><span>Lời mời đã gửi</span><strong>{data.invited || 0}</strong><em>Không lặp trong cùng ngày</em></article>
      <article><span>Tỷ lệ phản hồi</span><strong>{data.response_rate || 0}<small>%</small></strong><em>{data.responses || 0} phản hồi</em></article>
      <article><span>Tỷ lệ hài lòng</span><strong>{data.satisfaction_rate || 0}<small>%</small></strong><em>Đánh giá từ 4–5 sao</em></article>
    </div>
    <div className="cs-report-grid">
      <article className="cs-report-card">
        <div className="cs-report-head"><div><strong>Hiệu quả 7 ngày gần nhất</strong><span>Lời mời và phản hồi theo ngày</span></div></div>
        <div className="cs-daily-chart">{(data.daily || []).map((row) => (
          <div className="cs-day-col" key={row.date} title={`${row.invited} lời mời · ${row.responses} phản hồi`}>
            <div className="cs-bars"><i style={{ height: `${Math.max(5, (row.invited / maxInvited) * 100)}%` }}/><b style={{ height: `${Math.max(3, (row.responses / maxInvited) * 100)}%` }}/></div>
            <span>{new Date(`${row.date}T00:00:00`).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })}</span>
          </div>
        ))}</div>
        <div className="cs-chart-legend"><span><i/>Lời mời</span><span><b/>Phản hồi</span></div>
      </article>
      <article className="cs-report-card">
        <div className="cs-report-head"><div><strong>Phân bổ mức đánh giá</strong><span>Tổng hợp điểm khách hàng đã gửi</span></div></div>
        <div className="cs-score-list">{[5,4,3,2,1].map((score) => { const count = data.distribution?.[String(score)] || 0; return (
          <div key={score}><span>{score} sao</span><i><b style={{ width: `${(count / totalScores) * 100}%` }}/></i><strong>{count}</strong></div>
        ); })}</div>
      </article>
    </div>
  </section>;
}

function AutomationPanel({ settings, onChange, onSave, busy }) {
  if (!settings) return <div className="cs-manager-view cs-loading-view">Đang tải cấu hình...</div>;
  return <section className="cs-manager-view">
    <div className="cs-view-heading"><div><span>VẬN HÀNH TỰ ĐỘNG</span><h2>Quy tắc phiên chăm sóc</h2><p>Thiết lập cách hệ thống kết thúc phiên, gửi đánh giá và kiểm soát SLA.</p></div><div className="cs-heading-icon"><RuleRounded/></div></div>
    <div className="cs-rule-layout">
      <article className="cs-rule-card">
        <div className="cs-rule-title"><TuneRounded/><div><strong>Đánh giá phiên chăm sóc khách hàng</strong><span>Kích hoạt khi nhân viên bấm “Hoàn tất”</span></div><label className="cs-switch"><input type="checkbox" checked={!!settings.auto_csat_enabled} onChange={(e) => onChange({ ...settings, auto_csat_enabled: e.target.checked })}/><i/></label></div>
        <div className="cs-flow"><div><b>1</b><span>Khách nhắn tin<br/><small>Tạo phiên mới</small></span></div><em/><div><b>2</b><span>CSKH xử lý<br/><small>Phân công, tư vấn</small></span></div><em/><div><b>3</b><span>Hoàn tất<br/><small>Gửi đánh giá</small></span></div></div>
        <div className="cs-rule-note"><strong>Quy tắc an toàn</strong><p>Mỗi phiên chỉ có một lời mời; mỗi khách chỉ nhận một lời mời trong ngày. Gửi lời mời sẽ đóng phiên hiện tại.</p></div>
      </article>
      <article className="cs-settings-card">
        <label className="cs-setting-row"><span><strong>Tự kết thúc lúc 23:59</strong><small>Phiên chưa hoàn tất sẽ được đóng khi sang ngày mới</small></span><span className="cs-switch"><input type="checkbox" checked={!!settings.auto_close_daily} onChange={(e) => onChange({ ...settings, auto_close_daily: e.target.checked })}/><i/></span></label>
        <div className="cs-setting-grid"><label><span>Bắt đầu hỗ trợ</span><input type="time" value={settings.business_start} onChange={(e) => onChange({ ...settings, business_start: e.target.value })}/></label><label><span>Kết thúc hỗ trợ</span><input type="time" value={settings.business_end} onChange={(e) => onChange({ ...settings, business_end: e.target.value })}/></label><label><span>SLA phản hồi (phút)</span><input type="number" min="1" max="240" value={settings.sla_minutes} onChange={(e) => onChange({ ...settings, sla_minutes: e.target.value })}/></label></div>
        <button type="button" className="cs-save-settings" disabled={busy} onClick={onSave}>{busy ? 'Đang lưu...' : 'Lưu cấu hình'}</button>
      </article>
    </div>
  </section>;
}

function LabelsWorkspace({ tags, quickReplies, onManage }) {
  return <section className="cs-manager-view">
    <div className="cs-view-heading"><div><span>PHÂN LOẠI & NỘI DUNG</span><h2>Nhãn và mẫu trả lời</h2><p>Chuẩn hoá quy trình xử lý và nội dung phản hồi của đội ngũ CSKH.</p></div><button type="button" className="cs-primary-action" onClick={onManage}><AddRounded/>Quản lý nhãn</button></div>
    <div className="cs-report-grid">
      <article className="cs-report-card"><div className="cs-report-head"><div><strong>Nhãn hội thoại</strong><span>Dùng để lọc và theo dõi tiến độ xử lý</span></div><b>{tags.length}</b></div><div className="cs-label-board">{tags.map((tag) => <span key={tag.id}><Flag color={tag.color}/>{tag.name}</span>)}{!tags.length && <p>Chưa có nhãn nào.</p>}</div></article>
      <article className="cs-report-card"><div className="cs-report-head"><div><strong>Mẫu trả lời đang dùng</strong><span>Nội dung dùng chung cho nhân viên</span></div><b>{quickReplies.length}</b></div><div className="cs-reply-list">{quickReplies.map((reply) => <div key={reply.id}><strong>{reply.title}</strong><p>{reply.body}</p></div>)}{!quickReplies.length && <p>Chưa có mẫu trả lời.</p>}</div></article>
    </div>
  </section>;
}

function SearchPanel({ query, data, onClose, onSelect }) {
  const [kind, setKind] = useState('all');
  const tabs = [['all', 'Tất cả'], ['conversations', 'Hội thoại'], ['messages', 'Tin nhắn'], ['files', 'Tệp']];
  const groups = [['Hội thoại', 'conversations'], ['Tin nhắn', 'messages'], ['Tệp', 'files'], ['Khách hàng', 'customers'], ['Lịch hẹn', 'bookings']];
  const visible = kind === 'all' ? groups : groups.filter(([, key]) => key === kind);
  return (
    <div className="cs-search-panel">
      <div className="cs-search-head"><strong>Kết quả cho “{query}”</strong><button type="button" onClick={onClose} aria-label="Đóng"><CloseRounded/></button></div>
      <div className="cs-search-tabs">{tabs.map(([key, label]) => <button type="button" key={key} onClick={() => setKind(key)} className={kind === key ? 'active' : ''}>{label}</button>)}</div>
      <div className="cs-search-body">
        {visible.map(([label, key]) => {
          const rows = data?.[key] || [];
          if (kind === 'all' && !rows.length) return null;
          return (
            <section key={key}>
              <h4>{label}<span>{rows.length}</span></h4>
              {rows.slice(0, 20).map((r, i) => (
                <button type="button" className="cs-search-result" key={`${key}-${r.id || i}`} onClick={() => onSelect(key, r)}>
                  <strong>{r.customer_name || r.name || `Lịch #${r.id}`}</strong><span>{r.subject || r.text || r.phone || r.status || ''}</span>
                </button>
              ))}
              {!rows.length && <div className="cs-muted pad">Không có kết quả.</div>}
            </section>
          );
        })}
        {kind === 'all' && groups.every(([, key]) => !(data?.[key] || []).length) && <div className="cs-muted pad">Không tìm thấy kết quả phù hợp.</div>}
      </div>
    </div>
  );
}

/* ---------- Trang chính ---------- */
export default function SupportInboxPage() {
  const { user } = useAuth();
  const role = user?.role;
  const staff = ['consultant', 'doctor', 'manager'].includes(role);
  const [meta, setMeta] = useState({ tabs: [], quick_replies: [], tags: [], doctors: [], consultants: [], presence: '', sla_minutes: 15 });
  const [tab, setTab] = useState(role === 'consultant' ? 'mine' : role === 'doctor' ? 'doctor' : 'all');
  const [tagFilter, setTagFilter] = useState([]);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [active, setActive] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Màn hình hẹp (điện thoại/máy tính bảng): bảng thông tin là lớp phủ nên mặc định đóng.
  const [rightOpen, setRightOpen] = useState(() => {
    if (window.matchMedia('(max-width: 1000px)').matches) return false;
    try { return localStorage.getItem('ohio_support_right') !== '0'; } catch { return true; }
  });
  const [ctab, setCtab] = useState('customer');
  const [showContact, setShowContact] = useState(false);
  const [mobileThread, setMobileThread] = useState(false);
  const [filterOpen, setFilterOpen] = useState(false);
  const [tagPickOpen, setTagPickOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const [csatAsk, setCsatAsk] = useState(false);
  const [csatBusy, setCsatBusy] = useState(false);
  const [copilot, setCopilot] = useState(null);
  const [copilotBusy, setCopilotBusy] = useState(false);
  const [copilotError, setCopilotError] = useState('');
  const [picked, setPicked] = useState(-1);
  const [draftRequest, setDraftRequest] = useState(null);
  const [note, setNote] = useState('');
  const [search, setSearch] = useState('');
  const [searchData, setSearchData] = useState(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [showAssign, setShowAssign] = useState(false);
  const [transfer, setTransfer] = useState({ doctor_id: '', note: '' });
  const [reassign, setReassign] = useState('');
  const [analytics, setAnalytics] = useState(null);
  const [managerView, setManagerView] = useState('inbox');
  const [managerSettings, setManagerSettings] = useState(null);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const activeId = useRef(null);
  const listTimer = useRef(null);
  const filterRef = useRef(null);
  const tagPickRef = useRef(null);
  const autoKey = useRef('');
  const aiOff = useRef(false);
  const copilotRequest = useRef({ id: 0, controller: null });
  const filters = useRef({ tab, tagFilter, unreadOnly });
  filters.current = { tab, tagFilter, unreadOnly };

  useOutside(filterRef, useCallback(() => setFilterOpen(false), []), filterOpen);
  useOutside(tagPickRef, useCallback(() => setTagPickOpen(false), []), tagPickOpen);

  const loadMeta = useCallback(async () => {
    try {
      const { data } = await api.get('/conversations/meta/');
      setMeta(data);
      if (!data.tabs?.some((t) => t.key === filters.current.tab) && data.tabs?.[0]) setTab(data.tabs[0].key);
    } catch (e) { setError(e.response?.data?.detail || 'Không tải được cấu hình hộp thư.'); }
  }, []);

  const loadManagerSettings = useCallback(async () => {
    if (role !== 'manager') return;
    try {
      const { data } = await api.get('/conversations/manager-settings/');
      setManagerSettings(data);
    } catch (e) { setError(e.response?.data?.detail || 'Không tải được quy tắc tự động.'); }
  }, [role]);

  const loadList = useCallback(async () => {
    const f = filters.current;
    try {
      const { data } = await api.get('/conversations/', { params: { tab: f.tab, tag: f.tagFilter.join(',') || undefined, unread: f.unreadOnly ? 1 : undefined } });
      setConversations(data);
      return data;
    } catch (e) { setError(e.response?.data?.detail || 'Không tải được hàng chờ.'); return null; }
  }, []);

  const scheduleList = useCallback(() => {
    clearTimeout(listTimer.current);
    listTimer.current = setTimeout(() => { loadList(); loadMeta(); }, 400);
  }, [loadList, loadMeta]);

  const thread = useChatThread(active?.id, { userId: user?.id, onIncoming: scheduleList });

  const openConversation = useCallback(async (id, { showThread = true } = {}) => {
    if (activeId.current !== id) {
      copilotRequest.current.controller?.abort();
      copilotRequest.current = { id: copilotRequest.current.id + 1, controller: null };
      setCopilot(null);
      setCopilotBusy(false);
      setCopilotError('');
      setPicked(-1);
      setShowContact(false);
      setShowAssign(false);
      setCtab('customer');
    }
    activeId.current = id;
    try {
      const { data } = await api.get(`/conversations/${id}/`);
      if (activeId.current !== id) return;
      setActive(data);
      thread.seed(data.messages || []);
      setConversations((rows) => rows.map((c) => (c.id === id ? { ...c, unread_count: 0 } : c)));
      setShowTransfer(false); setTagPickOpen(false);
      if (showThread) setMobileThread(true);
    } catch (e) { setError(e.response?.data?.detail || 'Không mở được hội thoại.'); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.seed]);

  useEffect(() => {
    loadMeta();
    if (['manager', 'consultant'].includes(role)) api.get('/conversations/analytics/').then(({ data }) => setAnalytics(data)).catch(() => {});
    if (role === 'manager') loadManagerSettings();
    const t = setInterval(() => { if (!document.hidden) { loadList(); loadMeta(); } }, 15000);
    return () => {
      clearInterval(t);
      clearTimeout(listTimer.current);
      copilotRequest.current.controller?.abort();
    };
  }, [role, loadList, loadMeta, loadManagerSettings]);

  const tagKey = tagFilter.join(',');
  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadList().then((rows) => {
      if (!alive || !rows) return;
      setLoading(false);
      const wanted = Number(new URLSearchParams(window.location.search).get('c')) || null;
      if (wanted && !activeId.current) openConversation(wanted);
      else if (!activeId.current && rows[0] && window.matchMedia('(min-width: 721px)').matches) openConversation(rows[0].id, { showThread: false });
    });
    return () => { alive = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, tagKey, unreadOnly]);

  useEffect(() => { if (meta.tags?.length || tagFilter.length) setTagFilter((cur) => { const next = cur.filter((id) => (meta.tags || []).some((t) => t.id === id)); return next.length === cur.length ? cur : next; }); }, [meta.tags]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (window.matchMedia('(max-width: 1000px)').matches) return; try { localStorage.setItem('ohio_support_right', rightOpen ? '1' : '0'); } catch { /* bỏ qua */ } }, [rightOpen]);

  // Khách vừa đánh giá / ca vừa bị đóng: cập nhật trạng thái ca đang mở.
  useEffect(() => {
    const last = thread.messages[thread.messages.length - 1];
    if (active && last && last.message_type === 'system' && Number(last.sender) !== Number(user?.id)) {
      api.get(`/conversations/${active.id}/`).then(({ data }) => setActive((a) => (a && a.id === data.id ? { ...a, csat_score: data.csat_score, csat_comment: data.csat_comment, status: data.status } : a))).catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [thread.messages.length]);

  const refreshAll = async () => { await Promise.all([loadMeta(), loadList()]); if (activeId.current) openConversation(activeId.current, { showThread: false }); };

  const act = async (path, payload = {}) => {
    setError('');
    try {
      const { data } = await api.post(`/conversations/${active.id}/${path}/`, payload);
      setActive(data);
      if (data.messages) thread.seed(data.messages);
      scheduleList();
      return true;
    } catch (e) { setError(e.response?.data?.detail || 'Không thực hiện được thao tác.'); return false; }
  };
  const claim = async (id) => {
    try { await api.post(`/conversations/${id}/claim/`); await Promise.all([loadMeta(), loadList()]); await openConversation(id); }
    catch (e) { setError(e.response?.data?.detail || 'Ca này đã được người khác nhận.'); scheduleList(); }
  };
  const handleSend = async (payload) => { const res = await thread.send(payload); if (res.ok) scheduleList(); return res; };

  // AI Suggestions: tóm tắt nhu cầu + 2 bản nháp. Máy chủ lưu tạm kết quả theo tin nhắn cuối nên mở lại ca không tốn thêm lượt gọi.
  const requestCopilot = async (refresh = false) => {
    if (!active || (refresh && copilotBusy)) return;
    const conversationId = active.id;
    copilotRequest.current.controller?.abort();
    const controller = new AbortController();
    const requestId = copilotRequest.current.id + 1;
    copilotRequest.current = { id: requestId, controller };
    setCopilotBusy(true);
    setCopilotError('');
    setPicked(-1);
    if (refresh) setCopilot(null);
    try {
      const { data } = await api.post(
        `/conversations/${conversationId}/ai-copilot/`,
        refresh ? { refresh: true } : {},
        { timeout: 30000, signal: controller.signal },
      );
      if (activeId.current === conversationId && copilotRequest.current.id === requestId) setCopilot(data);
    } catch (e) {
      if (e.code === 'ERR_CANCELED') return;
      if (e.response?.data?.code === 'ai_not_configured') aiOff.current = true;
      const message = e.code === 'ECONNABORTED'
        ? 'AI phản hồi quá chậm. Bạn có thể thử lại hoặc tiếp tục trả lời thủ công.'
        : e.response?.data?.detail || 'Không tạo được gợi ý. Vui lòng thử lại.';
      if (activeId.current === conversationId && copilotRequest.current.id === requestId) setCopilotError(message);
    } finally {
      if (activeId.current === conversationId && copilotRequest.current.id === requestId) {
        copilotRequest.current.controller = null;
        setCopilotBusy(false);
      }
    }
  };
  const applyDraft = (text, index) => {
    if (!text) return;
    setPicked(index);
    setDraftRequest({ id: Date.now(), text });
  };
  const openDoctorTransfer = () => {
    setTransfer((current) => ({ ...current, note: copilot?.escalation_reason || 'Nội dung có thể cần bác sĩ xem xét chuyên môn.' }));
    setRightOpen(true);
    setCtab('customer');
    setShowTransfer(true);
  };
  const sendCsat = async () => {
    setCsatBusy(true);
    try { await api.post(`/conversations/${active.id}/csat-invite/`); setCsatAsk(false); await openConversation(active.id, { showThread: false }); scheduleList(); }
    catch (e) { setError(e.response?.data?.detail || 'Không gửi được lời mời đánh giá.'); setCsatAsk(false); }
    finally { setCsatBusy(false); }
  };
  const saveManagerSettings = async () => {
    setSettingsBusy(true);
    try {
      const { data } = await api.patch('/conversations/manager-settings/', managerSettings);
      setManagerSettings(data);
      setMeta((current) => ({ ...current, ...data }));
    } catch (e) { setError(e.response?.data?.detail || 'Không lưu được cấu hình.'); }
    finally { setSettingsBusy(false); }
  };
  const addNote = async (text) => {
    const value = (text || '').trim();
    if (!value) return false;
    try { await api.post(`/conversations/${active.id}/notes/`, { text: value }); await openConversation(active.id, { showThread: false }); return true; }
    catch (e) { setError(e.response?.data?.detail || 'Không thêm được ghi chú.'); return false; }
  };
  const toggleTag = async (id) => {
    try {
      const { data } = await api.post(`/conversations/${active.id}/toggle-tag/`, { tag_id: id });
      setActive((a) => ({ ...a, tags: data.tags, events: data.events }));
      setConversations((rows) => rows.map((c) => (c.id === active.id ? { ...c, tags: data.tags } : c)));
    } catch (e) { setError(e.response?.data?.detail || 'Không cập nhật được nhãn.'); }
  };
  const toggleFilterTag = (id) => setTagFilter((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));
  const doSearch = async () => {
    if (search.trim().length < 2) { setSearchData(null); return; }
    try { const { data } = await api.get('/conversations/search/', { params: { q: search.trim() } }); setSearchData(data); } catch { setSearchData({}); }
  };
  const chooseSearch = (type, row) => { setSearchData(null); const id = row.conversation_id || (type === 'conversations' ? row.id : null); if (id) openConversation(id); };
  const setPresence = async (value) => {
    try { await api.post('/conversations/presence/', { status: value }); setMeta((m) => ({ ...m, presence: value })); }
    catch (e) { setError(e.response?.data?.detail || 'Không đổi được trạng thái.'); }
  };
  const afterTagsChanged = async () => { await Promise.all([loadMeta(), loadList()]); if (activeId.current) openConversation(activeId.current, { showThread: false }); };

  const activeTags = useMemo(() => new Set((active?.tags || []).map((t) => t.id)), [active]);
  const canCompose = !!active && !active.read_only && active.status !== 'closed';
  const canTransfer = ['consultant', 'manager'].includes(role) && active && !active.read_only && active.status !== 'closed';
  const filterCount = tagFilter.length + (unreadOnly ? 1 : 0);
  const allTags = meta.tags || [];
  const canManageTags = ['consultant', 'manager'].includes(role);
  const lockedText = !active ? '' : active.status === 'closed' ? 'Ca tư vấn đã hoàn thành.'
    : role === 'manager' ? 'Hãy tiếp quản ca để gửi tin nhắn.'
      : role === 'consultant' && !active.assigned_to ? 'Hãy nhận ca để bắt đầu trả lời khách.'
        : 'Bạn chưa có quyền gửi tin trong ca này.';

  // Tự tạo gợi ý khi nhân viên đang phụ trách ca mở hội thoại hoặc khi khách vừa nhắn thêm.
  useEffect(() => {
    if (!active || !canCompose || aiOff.current) return;
    const last = thread.messages[thread.messages.length - 1];
    if (!last || last.pending || last.message_type !== 'text' || Number(last.sender) !== Number(active.customer)) return;
    const key = `${active.id}:${last.id}`;
    if (autoKey.current === key) return;
    autoKey.current = key;
    requestCopilot();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, canCompose, thread.messages.length]);

  const extraTools = canCompose && role !== 'customer' ? [
    { key: 'ai', accent: true, title: 'Tạo lại gợi ý trả lời', icon: <AutoAwesomeRounded/>, disabled: copilotBusy, onClick: () => requestCopilot(true) },
  ] : [];
  const statusLabel = active?.status === 'closed' ? 'Hoàn tất' : active?.status === 'escalated' ? 'Đã chuyển bác sĩ' : 'Đang mở';
  const transferEvent = active ? (active.events || []).find((e) => e.event_type === 'transferred') : null;
  const slaText = (c) => (c.sla_state === 'overdue' || c.sla_state === 'warning') && c.waiting_minutes != null ? `${c.waiting_minutes}p` : '';

  const TagPicker = ({ onPick, selected }) => (
    <>
      {allTags.map((t) => (
        <button type="button" key={t.id} className="cs-pop-item" onClick={() => onPick(t.id)}>
          <Flag color={t.color}/><span>{t.name}</span>{selected(t.id) && <CheckRounded className="tick"/>}
        </button>
      ))}
      {!allTags.length && <div className="cs-muted pad">Chưa có nhãn hội thoại.</div>}
    </>
  );

  return (
    <div className={`cs-page ${rightOpen ? '' : 'right-collapsed'}`}>
      <div className={`cs-topbar ${role === 'manager' ? 'manager' : ''}`}>
        <div className="cs-title"><h1>{role === 'doctor' ? 'Tư vấn bác sĩ' : role === 'manager' ? 'Trung tâm CSKH' : 'Hộp thư tư vấn'}</h1><p>{roleHint(role)}</p></div>
        {role === 'manager' && <ManagerNavigation view={managerView} onChange={setManagerView}/>}
        <div className="cs-top-actions">
          {staff && (
            <label className={`cs-presence ${meta.presence || 'offline'}`}><i/>
              <select value={meta.presence || 'offline'} onChange={(e) => setPresence(e.target.value)} aria-label="Trạng thái làm việc">
                <option value="online">Đang hoạt động</option><option value="busy">Bận</option><option value="offline">Ngoại tuyến</option>
              </select>
            </label>
          )}
          <button type="button" className="cs-icon" title="Làm mới" onClick={refreshAll}><RefreshRounded/></button>
        </div>
      </div>

      {error && <div className="cs-alert" role="alert"><span>{error}</span><button type="button" onClick={() => setError('')} aria-label="Đóng"><CloseRounded/></button></div>}

      {managerView === 'feedback' && <FeedbackDashboard analytics={analytics}/>} 
      {managerView === 'automation' && <AutomationPanel settings={managerSettings} onChange={setManagerSettings} onSave={saveManagerSettings} busy={settingsBusy}/>} 
      {managerView === 'labels' && <LabelsWorkspace tags={allTags} quickReplies={meta.quick_replies || []} onManage={() => setManageOpen(true)}/>} 

      {managerView === 'inbox' && <div className={`cs-workspace ${mobileThread ? 'show-thread' : ''}`}>
        {/* ===== Danh sách hội thoại ===== */}
        <aside className="cs-queue">
          <div className="cs-queue-head" ref={filterRef}>
            <h2>Hội thoại</h2>
            <button type="button" className={`cs-icon ${filterCount ? 'on' : ''}`} title="Lọc theo trạng thái và nhãn" onClick={() => setFilterOpen((v) => !v)}><MoreHorizRounded/></button>
            {filterOpen && (
              <div className="cs-pop cs-filter-pop">
                <div className="cs-pop-title">Theo trạng thái</div>
                <button type="button" className="cs-pop-item" onClick={() => setUnreadOnly(false)}><span className={`cs-radio ${!unreadOnly ? 'on' : ''}`}/><span>Tất cả</span></button>
                <button type="button" className="cs-pop-item" onClick={() => setUnreadOnly(true)}><span className={`cs-radio ${unreadOnly ? 'on' : ''}`}/><span>Chưa đọc</span></button>
                <div className="cs-pop-sep"/>
                <div className="cs-pop-title">Theo nhãn hội thoại</div>
                {allTags.map((t) => (
                  <button type="button" key={t.id} className="cs-pop-item" onClick={() => toggleFilterTag(t.id)}>
                    <span className={`cs-check ${tagFilter.includes(t.id) ? 'on' : ''}`}>{tagFilter.includes(t.id) && <CheckRounded/>}</span><Flag color={t.color}/><span>{t.name}</span>
                  </button>
                ))}
                {!allTags.length && <div className="cs-muted pad">Chưa có nhãn nào.</div>}
                {filterCount > 0 && <button type="button" className="cs-pop-link" onClick={() => { setTagFilter([]); setUnreadOnly(false); }}>Xóa bộ lọc</button>}
                {canManageTags && <><div className="cs-pop-sep"/><button type="button" className="cs-pop-manage" onClick={() => { setFilterOpen(false); setManageOpen(true); }}>Quản lý nhãn hội thoại</button></>}
              </div>
            )}
          </div>
          <div className="cs-tabs">{(meta.tabs || []).map((t) => (
            <button type="button" key={t.key} className={tab === t.key ? 'active' : ''} onClick={() => setTab(t.key)}>{t.label}{t.count > 0 && <b>{t.count}</b>}</button>
          ))}</div>
          <div className="cs-search">
            <SearchRounded/>
            <input value={search} onChange={(e) => { setSearch(e.target.value); if (!e.target.value) setSearchData(null); }} onKeyDown={(e) => e.key === 'Enter' && doSearch()} placeholder="Tìm kiếm hội thoại..."/>
            {search && <button type="button" onClick={() => { setSearch(''); setSearchData(null); }} aria-label="Xóa"><CloseRounded/></button>}
            {searchData && <SearchPanel query={search} data={searchData} onClose={() => setSearchData(null)} onSelect={chooseSearch}/>}
          </div>
          {filterCount > 0 && (
            <div className="cs-active-flags" style={{ paddingTop: 8 }}>
              {unreadOnly && <button type="button" className="cs-chip" onClick={() => setUnreadOnly(false)}>Chưa đọc<CloseRounded/></button>}
              {tagFilter.map((id) => { const t = allTags.find((x) => x.id === id); return t ? <button type="button" key={id} className="cs-chip" onClick={() => toggleFilterTag(id)}>{t.name}<CloseRounded/></button> : null; })}
            </div>
          )}
          <div className="cs-listmeta"><span>{conversations.length} hội thoại</span></div>

          <div className="cs-list">
            {loading && !conversations.length && <div className="cs-empty">Đang tải...</div>}
            {conversations.map((c) => (
              <div key={c.id} role="button" tabIndex={0} className={`cs-case ${active?.id === c.id ? 'active' : ''} ${c.unread_count > 0 ? 'unread' : ''}`}
                onClick={() => openConversation(c.id)} onKeyDown={(e) => e.key === 'Enter' && openConversation(c.id)}>
                <Avatar src={c.customer_avatar_url} name={c.customer_name} size={36}/>
                <div className="cs-case-main">
                  <div className="cs-case-line"><strong>{c.customer_name}</strong><time>{timeAgo(c.last_message_at)}</time></div>
                  <div className="cs-case-preview"><p>{c.last_message || c.subject}</p>
                    {c.unread_count > 0 && <span className="cs-unread">{c.unread_count > 9 ? '9+' : c.unread_count}</span>}
                  </div>
                  <div className="cs-case-badges">
                    {c.channel === 'facebook' && <span className="cs-channel facebook">Facebook</span>}
                    {(c.tags || []).slice(0, 2).map((t) => <span className="cs-pill cs-pill-tag" key={t.id} style={{ '--cs-tag-color': tagColor(t.color) }}><Flag color={t.color} size={12}/>{t.name}</span>)}
                    {c.priority === 'urgent' && <span className="cs-pill" style={{ background: '#fdecea', color: '#b3322a' }}>Khẩn cấp</span>}
                    {c.escalated_to && <span className="cs-pill" style={{ background: '#edf0fb', color: '#4c4f91' }}>Đã chuyển BS</span>}
                    {slaText(c) && <span className={`cs-sla ${c.sla_state === 'warning' ? 'warn' : ''}`} title={c.sla_state === 'overdue' ? 'Quá thời gian phản hồi' : 'Sắp quá thời gian phản hồi'}><ScheduleRounded/>{slaText(c)}</span>}
                    {role === 'consultant' && tab === 'unassigned' && <button type="button" className="cs-claim" onClick={(e) => { e.stopPropagation(); claim(c.id); }}>Nhận ca</button>}
                  </div>
                </div>
              </div>
            ))}
            {!loading && !conversations.length && <div className="cs-empty">{filterCount ? 'Không có ca nào khớp bộ lọc.' : 'Không có hội thoại nào trong mục này.'}</div>}
          </div>
        </aside>

        {/* ===== Khung hội thoại ===== */}
        <section className="cs-thread">
          {!active ? (
            <div className="cs-thread-empty"><div><ForumRounded/><h3>Chọn một hội thoại</h3><p>Nội dung trao đổi và thông tin bệnh nhân sẽ hiển thị tại đây.</p></div></div>
          ) : (
            <>
              <header className="cs-thread-head">
                <button type="button" className="cs-icon cs-back" onClick={() => setMobileThread(false)} aria-label="Quay lại danh sách"><ArrowBackRounded/></button>
                <div className="cs-thread-person">
                  <Avatar src={active.customer_avatar_url} name={active.customer_name} size={36}/>
                  <div>
                    <strong>{active.customer_name}</strong>
                    <span className="cs-sub">{active.subject}{active.channel === 'facebook' && <em className="cs-channel facebook">Facebook</em>}</span>
                  </div>
                </div>
                <div className="cs-thread-actions">
                  <em className={`cs-status ${active.status}`}>{statusLabel}</em>
                  {slaText(active) && <span className={`cs-sla ${active.sla_state === 'warning' ? 'warn' : ''}`}><ScheduleRounded/>{slaText(active)}</span>}
                  {staff && (
                    <div className="cs-pop-wrap" ref={tagPickRef}>
                      <button type="button" className={`cs-icon ${tagPickOpen ? 'on' : ''}`} title="Gắn nhãn hội thoại" onClick={() => setTagPickOpen((v) => !v)}>
                        {(active.tags || []).length ? <FlagRounded sx={{ color: tagColor(active.tags[0].color) }}/> : <OutlinedFlagRounded/>}
                      </button>
                      {tagPickOpen && (
                        <div className="cs-pop cs-tag-pop">
                          <div className="cs-pop-title">Gắn nhãn hội thoại</div>
                          <TagPicker onPick={toggleTag} selected={(id) => activeTags.has(id)}/>
                          {canManageTags && <><div className="cs-pop-sep"/><button type="button" className="cs-pop-manage" onClick={() => { setTagPickOpen(false); setManageOpen(true); }}>Quản lý nhãn hội thoại</button></>}
                        </div>
                      )}
                    </div>
                  )}
                  <button type="button" className="cs-icon" title={rightOpen ? 'Ẩn thông tin hội thoại' : 'Hiện thông tin hội thoại'} onClick={() => setRightOpen((v) => !v)}>{rightOpen ? <ChevronRightRounded/> : <ChevronLeftRounded/>}</button>
                </div>
              </header>
              {role === 'manager' && active.read_only && active.status !== 'closed' && (
                <div className="cs-banner"><VisibilityRounded/><span>Bạn đang xem ở chế độ giám sát. Cần tiếp quản ca trước khi gửi tin cho bệnh nhân.</span><button type="button" onClick={() => act('takeover')}>Tiếp quản ca</button></div>
              )}
              {role === 'consultant' && !active.assigned_to && active.status !== 'closed' && (
                <div className="cs-banner"><PersonAddAlt1Rounded/><span>Ca này chưa có người phụ trách.</span><button type="button" onClick={() => claim(active.id)}>Nhận ca</button></div>
              )}
              {role === 'doctor' && active.escalated_to && (
                <div className="cs-banner"><MedicalServicesRounded/><span>Hội thoại do CSKH chuyển đến bác sĩ.{transferEvent?.meta ? ` Ghi chú chuyển ca: ${transferEvent.meta}` : ''}</span></div>
              )}
              <ChatMessages messages={thread.messages} userId={user?.id} viewer="staff" csatScore={active.csat_score || 0}/>
              {copilotError && <div className="cs-ai-error" role="alert"><span>{copilotError}</span><button type="button" onClick={() => requestCopilot(true)} disabled={copilotBusy}>Thử lại</button></div>}
              {copilotBusy && <div className="cs-ai-loading" role="status"><AutoAwesomeRounded/> Đang soạn gợi ý trả lời...</div>}
              {copilot && !copilotBusy && (
                <section className="cs-ai-panel" aria-label="AI Suggestions">
                  <div className="cs-ai-head">
                    <span><AutoAwesomeRounded/> AI Suggestions <small>Gợi ý an toàn — duyệt trước khi gửi</small></span>
                    <button type="button" onClick={() => setCopilot(null)} title="Ẩn gợi ý" aria-label="Ẩn gợi ý"><CloseRounded/></button>
                  </div>
                  <p className="cs-ai-need"><b>Nhu cầu:</b> {copilot.summary}</p>
                  {copilot.needs_doctor && (
                    <div className="cs-ai-escalation" role="status">
                      <WarningAmberRounded/>
                      <p><b>Cần bác sĩ xem xét.</b> {copilot.escalation_reason || 'Nội dung có thể liên quan chuyên môn y khoa.'} Hệ thống không đưa lời khuyên y tế; nhân viên vui lòng kiểm tra lại.</p>
                      {canTransfer && <button type="button" onClick={openDoctorTransfer}>Chuyển bác sĩ</button>}
                    </div>
                  )}
                  <div className="cs-ai-grid">
                    {(copilot.suggestions || []).map((item, index) => (
                      <button type="button" className={`cs-ai-option ${picked === index ? 'picked' : ''}`} key={`${index}-${item.label}`} onClick={() => applyDraft(item.text, index)} title="Chèn vào ô soạn, chưa gửi">
                        <span>Phương án {index + 1} · <b>{item.label}</b></span><p>{item.text}</p>
                      </button>
                    ))}
                  </div>
                  <p className="cs-ai-foot">Chọn một phương án để chèn vào ô soạn. Tin chỉ được gửi khi bạn bấm “Gửi tin”.</p>
                </section>
              )}
              <ChatComposer key={active.id} disabled={!canCompose} disabledText={lockedText} placeholder="Soạn nội dung phản hồi..." quickReplies={meta.quick_replies} extraTools={extraTools} draftRequest={draftRequest} onSend={handleSend} onNote={staff ? addNote : undefined} onError={setError}/>
            </>
          )}
        </section>

        {/* ===== Thông tin bên phải ===== */}
        {rightOpen && (
          <aside className="cs-context">
            {!active ? <div className="cs-empty">Chọn hội thoại để xem hồ sơ.</div> : (
              <>
                <div className="cs-ctabs" role="tablist">
                  <button type="button" role="tab" aria-selected={ctab === 'customer'} className={ctab === 'customer' ? 'active' : ''} onClick={() => setCtab('customer')}>Khách hàng</button>
                  <button type="button" role="tab" aria-selected={ctab === 'notes'} className={ctab === 'notes' ? 'active' : ''} onClick={() => setCtab('notes')}>Ghi chú{active.notes?.length ? ` (${active.notes.length})` : ''}</button>
                </div>

                {ctab === 'customer' && (
                  <>
                    <section className="cs-block">
                      <div className="cs-identity">
                        <Avatar src={active.customer_avatar_url} name={active.customer_name} size={44}/>
                        <div>
                          <strong>{active.customer_name}</strong>
                          <span>{showContact ? (active.customer_email || 'Chưa có email') : (maskEmail(active.customer_email) || 'Chưa có email')}</span>
                          <span>{showContact ? (active.customer_phone || '—') : (maskPhone(active.customer_phone) || '—')}
                            {(active.customer_email || active.customer_phone) && (
                              <button type="button" className="cs-reveal" onClick={() => setShowContact((v) => !v)} title={showContact ? 'Ẩn thông tin liên hệ' : 'Hiện thông tin liên hệ'} aria-label={showContact ? 'Ẩn thông tin liên hệ' : 'Hiện thông tin liên hệ'}>
                                {showContact ? <VisibilityOffRounded/> : <VisibilityRounded/>}
                              </button>
                            )}
                          </span>
                        </div>
                      </div>
                      <div className="cs-facts">
                        <div><span>Hạng thành viên</span><strong>{active.customer_tier || 'Bronze'}</strong></div>
                        <div><span>Điểm tích lũy</span><strong>{active.customer_loyalty_points || 0} điểm</strong></div>
                      </div>
                    </section>

                    <section className="cs-block">
                      <div className="cs-block-title"><strong>Thông tin hỗ trợ</strong><span>#{active.id}</span></div>
                      <dl className="cs-details">
                        <div><dt>Phiên CSKH</dt><dd>#{active.session_number || 1}</dd></div>
                        <div><dt>Tình trạng</dt><dd>{statusLabel}</dd></div>
                        <div><dt>CSKH phụ trách</dt><dd>{active.assigned_name || 'Chưa gán'}</dd></div>
                        <div><dt>Bác sĩ</dt><dd>{active.escalated_name || 'Chưa chuyển'}</dd></div>
                        <div><dt>Độ ưu tiên</dt><dd className={active.priority === 'urgent' ? 'warn' : ''}>{active.priority === 'urgent' ? 'Khẩn cấp' : 'Bình thường'}</dd></div>
                        <div><dt>Thời gian chờ</dt><dd className={active.sla_state === 'overdue' ? 'warn' : ''}>{active.waiting_minutes != null ? `${active.waiting_minutes} phút` : 'Đang chờ khách'}</dd></div>
                        {active.csat_score ? <div><dt>Khách đánh giá</dt><dd>{active.csat_score}/5 sao</dd></div> : null}
                      </dl>
                      {active.csat_comment && <div className="cs-callout">“{active.csat_comment}”</div>}
                      <div className="cs-actions">
                        {role === 'manager' && active.status !== 'closed' && <button type="button" className={showAssign ? 'on' : ''} onClick={() => setShowAssign((v) => !v)}><PersonAddAlt1Rounded/>Phân công</button>}
                        {role === 'consultant' && active.assigned_to === user.id && active.status !== 'closed' && <button type="button" onClick={() => act('return')}><AssignmentReturnRounded/>Trả ca</button>}
                        {!active.read_only && active.status !== 'closed' && <button type="button" onClick={() => act('close')}><DoneAllRounded/>Hoàn tất</button>}
                        {canTransfer && <button type="button" className={showTransfer ? 'on' : ''} onClick={() => setShowTransfer((v) => !v)}><MedicalServicesRounded/>Chuyển bác sĩ</button>}
                        {canCompose && role !== 'customer' && <button type="button" disabled={!active.csat_can_invite} title={active.csat_block_reason || 'Gửi một lời mời và kết thúc phiên'} onClick={() => setCsatAsk(true)}><RateReviewRounded/>Mời đánh giá</button>}
                        {role === 'manager' && active.status === 'closed' && <button type="button" onClick={() => act('reopen')}><ReplayRounded/>Mở lại ca</button>}
                      </div>
                      {canTransfer && showTransfer && (
                        <div className="cs-form">
                          <label>Chuyển cho bác sĩ</label>
                          <select value={transfer.doctor_id} onChange={(e) => setTransfer({ ...transfer, doctor_id: e.target.value })}>
                            <option value="">Chọn bác sĩ</option>{(meta.doctors || []).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                          </select>
                          <textarea value={transfer.note} onChange={(e) => setTransfer({ ...transfer, note: e.target.value })} placeholder="Ghi chú chuyển ca..."/>
                          <button type="button" disabled={!transfer.doctor_id} onClick={async () => { if (await act('escalate', transfer)) { setTransfer({ doctor_id: '', note: '' }); setShowTransfer(false); } }}>Xác nhận chuyển</button>
                        </div>
                      )}
                      {role === 'manager' && showAssign && (
                        <div className="cs-form">
                          <label>Phân công cho CSKH</label>
                          <select value={reassign} onChange={(e) => setReassign(e.target.value)}>
                            <option value="">Bỏ gán / đưa về hàng chờ</option>{(meta.consultants || []).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.status} · {a.active_cases} ca</option>)}
                          </select>
                          <button type="button" onClick={async () => { if (await act('reassign', { agent_id: reassign || null })) setShowAssign(false); }}>Cập nhật phân công</button>
                        </div>
                      )}
                    </section>

                    {staff && (
                      <section className="cs-block">
                        <div className="cs-block-title"><strong>Nhãn hội thoại</strong>{canManageTags && <button type="button" className="cs-link-btn" onClick={() => setManageOpen(true)}>Quản lý</button>}</div>
                        <div className="cs-tags">{allTags.map((t) => (
                          <button type="button" key={t.id} className={activeTags.has(t.id) ? 'selected' : ''} style={activeTags.has(t.id) ? { borderColor: tagColor(t.color), background: `${tagColor(t.color)}18` } : undefined} onClick={() => toggleTag(t.id)}>
                            {t.name}
                          </button>
                        ))}{!allTags.length && <p className="cs-muted">Chưa có nhãn nào.</p>}</div>
                      </section>
                    )}

                    <section className="cs-block">
                      <div className="cs-block-title"><strong>Lịch sử khám &amp; tái khám</strong></div>
                      <dl className="cs-details">
                        <div><dt>Buổi khám gần nhất</dt><dd>{dateVi(active.customer_last_visit) || 'Chưa có'}</dd></div>
                        <div><dt>Lịch sắp tới</dt><dd>{dateVi(active.customer_next_visit) || 'Chưa có'}</dd></div>
                      </dl>
                    </section>
                  </>
                )}

                {ctab === 'notes' && (
                  <>
                    <section className="cs-block">
                      <div className="cs-block-title"><strong>Ghi chú nội bộ</strong><span>Khách không nhìn thấy</span></div>
                      <div className="cs-notes">
                        {(active.notes || []).map((n) => <div key={n.id}><p>{n.text}</p><span>{n.author_name} · {timeAgo(n.created_at)}</span></div>)}
                        {!active.notes?.length && <p className="cs-muted">Chưa có ghi chú.</p>}
                      </div>
                      {staff && (
                        <div className="cs-note-compose">
                          <input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={async (e) => { if (e.key === 'Enter' && await addNote(note)) setNote(''); }} placeholder="Thêm ghi chú nội bộ..."/>
                          <button type="button" onClick={async () => { if (await addNote(note)) setNote(''); }} disabled={!note.trim()}>Lưu</button>
                        </div>
                      )}
                    </section>
                    <section className="cs-block">
                      <div className="cs-block-title"><strong>Nhật ký xử lý</strong></div>
                      <div className="cs-timeline">
                        {(active.events || []).slice(0, 10).map((e) => (
                          <div key={e.id}><i/><p><strong>{e.event_label}</strong>{e.meta ? ` · ${e.meta}` : ''}<small>{e.actor_name} · {timeAgo(e.created_at)}</small></p></div>
                        ))}
                        {!active.events?.length && <p className="cs-muted">Chưa có thao tác nào.</p>}
                      </div>
                    </section>
                    <section className="cs-block">
                      <div className="cs-block-title"><strong>Lịch sử phiên CSKH</strong><span>{active.session_history?.length || 0} phiên</span></div>
                      <div className="cs-session-list">
                        {(active.session_history || []).slice().reverse().map((session) => (
                          <div key={session.id}><b>Phiên #{session.sequence}</b><span>{session.ended_at ? session.end_label : 'Đang hoạt động'}{session.csat_score ? ` · ${session.csat_score}/5 sao` : ''}</span></div>
                        ))}
                      </div>
                    </section>
                  </>
                )}
              </>
            )}
          </aside>
        )}
        {rightOpen && active && <div className="cs-scrim" onClick={() => setRightOpen(false)}/>}
      </div>}

      {manageOpen && <TagManager tags={allTags} onClose={() => setManageOpen(false)} onChanged={afterTagsChanged} onError={setError}/>}
      {csatAsk && <CsatConfirm busy={csatBusy} onCancel={() => setCsatAsk(false)} onSend={sendCsat}/>}
    </div>
  );
}
