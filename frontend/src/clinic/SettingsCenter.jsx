import { useEffect, useMemo, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import PersonOutlineRounded from '@mui/icons-material/PersonOutlineRounded';
import MedicalServicesRounded from '@mui/icons-material/MedicalServicesRounded';
import CalendarMonthRounded from '@mui/icons-material/CalendarMonthRounded';
import MeetingRoomRounded from '@mui/icons-material/MeetingRoomRounded';
import VaccinesRounded from '@mui/icons-material/VaccinesRounded';
import ForumRounded from '@mui/icons-material/ForumRounded';
import SupportAgentRounded from '@mui/icons-material/SupportAgentRounded';
import PaymentsRounded from '@mui/icons-material/PaymentsRounded';
import MedicationRounded from '@mui/icons-material/MedicationRounded';
import ShieldRounded from '@mui/icons-material/ShieldRounded';
import AssessmentRounded from '@mui/icons-material/AssessmentRounded';
import ManageAccountsRounded from '@mui/icons-material/ManageAccountsRounded';
import MarkEmailReadRounded from '@mui/icons-material/MarkEmailReadRounded';
import HistoryRounded from '@mui/icons-material/HistoryRounded';
import SaveRounded from '@mui/icons-material/SaveRounded';
import { useAuth } from '../context/AuthContext';
import api from '../api/client';
import './settings-center.css';
import './settings-audit.css';

const groups = [
  { id: 'personal', label: 'Cá nhân', items: [{ id: 'preferences', label: 'Cài đặt cá nhân', icon: PersonOutlineRounded }] },
  { id: 'clinic', label: 'Phòng khám', items: [
    { id: 'clinic-info', label: 'Thông tin phòng khám', icon: MedicalServicesRounded },
    { id: 'appointments', label: 'Lịch hẹn & đặt lịch', icon: CalendarMonthRounded },
    { id: 'reception', label: 'Tiếp đón', icon: MeetingRoomRounded },
    { id: 'care', label: 'Chăm sóc sau khám', icon: SupportAgentRounded },
    { id: 'treatments', label: 'Bệnh án & liệu trình', icon: VaccinesRounded, to: '/lieu-trinh', note: 'Mở hồ sơ và liệu trình đang vận hành' },
    { id: 'support', label: 'CSKH & AI', icon: ForumRounded, note: 'Giờ hỗ trợ, SLA và nội dung phản hồi dùng trực tiếp trong hộp thư và chatbot' },
    { id: 'billing', label: 'Thu ngân & công nợ', icon: PaymentsRounded, to: '/thu-ngan' },
    { id: 'inventory', label: 'Kho thuốc & vật tư', icon: MedicationRounded, to: '/kho-thuoc' },
    { id: 'crm', label: 'Khách hàng & tích điểm', icon: PersonOutlineRounded },
    { id: 'marketing', label: 'Marketing & đồng ý nhận tin', icon: MarkEmailReadRounded },
  ] },
  { id: 'system', label: 'Hệ thống', items: [
    { id: 'access', label: 'Người dùng & phân quyền', icon: ManageAccountsRounded, note: 'Giới hạn thao tác bổ sung theo vai trò; không thể tự cấp quyền vượt giới hạn hệ thống' },
    { id: 'setting-audit', label: 'Nhật ký thay đổi cài đặt', icon: HistoryRounded },
    { id: 'reports', label: 'Nhật ký & tuân thủ', icon: AssessmentRounded, to: '/nhat-ky', note: 'Nhật ký vận hành và kiểm soát truy cập' },
    { id: 'security', label: 'Bảo mật tài khoản', icon: ShieldRounded, to: '/change-password', note: 'Đổi mật khẩu tài khoản' },
  ] },
];

const editableScope = (id) => id === 'preferences' ? 'user' : id === 'support' ? 'support' : ['clinic-info', 'appointments', 'reception', 'care', 'billing', 'inventory', 'crm', 'marketing', 'access'].includes(id) ? 'clinic' : null;
const errorText = (error) => error?.response?.data?.detail || 'Không tải được cài đặt. Vui lòng thử lại.';
const choiceLabel = (field, value) => {
  if (field.key === 'billing.default_due_days') return value === 0 ? 'Thanh toán ngay' : `Trong ${value} ngày`;
  if (field.key === 'booking.buffer_minutes') return value === 0 ? 'Không có thời gian đệm' : `${value} phút`;
  return ({ day: 'Ngày', week: 'Tuần', month: 'Tháng', calendar: 'Lịch theo bác sĩ', list: 'Danh sách lịch hẹn', '': 'Dùng trang mặc định theo vai trò' })[value] || String(value);
};

export default function SettingsCenter() {
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const [activeId, setActiveId] = useState(() => params.get('item') || 'preferences');
  const [documents, setDocuments] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [reason, setReason] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [audit, setAudit] = useState([]);
  const visibleGroups = groups
    .filter((group) => group.id !== 'clinic' || ['manager', 'doctor', 'consultant', 'staff'].includes(user?.role))
    .filter((group) => group.id !== 'system' || ['manager', 'sysadmin'].includes(user?.role))
    .map((group) => group.id === 'clinic' && user?.role !== 'manager'
      ? { ...group, items: group.items.filter((item) => item.id !== 'marketing') }
      : group)
    .map((group) => group.id === 'system' && user?.role === 'sysadmin'
      ? { ...group, items: group.items.filter((item) => item.id !== 'access') }
      : group);
  const scope = visibleGroups.some((group) => group.id === params.get('scope')) ? params.get('scope') : 'personal';
  const activeGroup = visibleGroups.find((group) => group.id === scope) || visibleGroups[0];
  const activeItem = useMemo(() => activeGroup.items.find((item) => item.id === activeId) || activeGroup.items[0], [activeGroup, activeId]);
  const apiScope = editableScope(activeItem.id);
  const document = apiScope ? documents[apiScope] : null;
  const editable = apiScope === 'user' || (['clinic', 'support'].includes(apiScope) && user?.role === 'manager');
  const definitionGroup = activeItem.id === 'preferences' ? 'personal' : activeItem.id === 'care' ? 'care-automation' : activeItem.id;
  const fields = (document?.definitions || []).filter((definition) => definition.group === definitionGroup);
  const currentValues = document?.values || {};
  const changedValues = Object.fromEntries(Object.entries(currentValues).filter(([key, value]) => value !== document?.originalValues?.[key]));
  const hasChanges = Object.keys(changedValues).length > 0;

  useEffect(() => {
    const requestedItem = params.get('item');
    if (requestedItem && activeGroup.items.some((item) => item.id === requestedItem)) {
      if (activeId !== requestedItem) setActiveId(requestedItem);
      return;
    }
    if (!activeGroup.items.some((item) => item.id === activeId)) {
      setActiveId(activeGroup.items[0]?.id || '');
    }
  }, [scope, params, activeGroup, activeId]);

  useEffect(() => {
    if (!apiScope || documents[apiScope]) return;
    let live = true;
    setLoading(true);
    setError('');
    api.get(apiScope === 'support' ? '/settings/support/' : `/settings/${apiScope}/`).then(({ data }) => {
      if (live) setDocuments((previous) => ({ ...previous, [apiScope]: { ...data, originalValues: { ...data.values } } }));
    }).catch((requestError) => {
      if (live) setError(errorText(requestError));
    }).finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [apiScope, documents, user?.role]);

  useEffect(() => {
    if (activeItem.id !== 'setting-audit') return;
    let live = true;
    setLoading(true); setError('');
    api.get('/settings/audit/').then(({ data }) => { if (live) setAudit(data.results || []); })
      .catch((requestError) => { if (live) setError(errorText(requestError)); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [activeItem.id]);

  const updateValue = (key, value) => {
    setDocuments((previous) => ({
      ...previous,
      [apiScope]: { ...previous[apiScope], values: { ...previous[apiScope]?.values, [key]: value } },
    }));
    setFieldErrors((previous) => { const next = { ...previous }; delete next[key]; return next; });
    setSaved(false);
  };

  const save = async () => {
    if (!document || !editable) return;
    if (!hasChanges) return;
    if (apiScope === 'clinic' && changedValues['booking.online_enabled'] === false) {
      setConfirmOpen(true);
      return;
    }
    if (apiScope === 'support' && ['chatbot.enabled', 'chatbot.ai_enabled', 'chatbot.automation_enabled'].some((key) => changedValues[key] === false)) {
      setConfirmOpen(true);
      return;
    }
    await persistChanges();
  };

  const persistChanges = async () => {
    if (!document || !editable || !hasChanges) return;
    setSaving(true); setSaved(false); setError('');
    setFieldErrors({});
    try {
      const versions = Object.fromEntries(Object.keys(changedValues).map((key) => [key, document.versions[key]]));
      const endpoint = apiScope === 'support' ? '/settings/support/' : `/settings/${apiScope}/`;
      const { data } = await api.put(endpoint, { values: changedValues, versions, reason: reason.trim() });
      setDocuments((previous) => ({ ...previous, [apiScope]: { ...data, originalValues: { ...data.values } } }));
      setReason('');
      setConfirmOpen(false);
      setSaved(true);
      if (apiScope === 'user') {
        window.dispatchEvent(new CustomEvent('akina-settings-updated', { detail: {
          compactNav: data.values['ui.compact_sidebar'],
          showDate: data.values['ui.show_date'],
          calendarView: data.values['ui.calendar_view'],
        } }));
      }
    } catch (requestError) {
      setError(errorText(requestError));
      setFieldErrors(requestError.response?.data?.errors || {});
      if (requestError.response?.status === 409) {
        try {
          const endpoint = apiScope === 'support' ? '/settings/support/' : `/settings/${apiScope}/`;
          const { data } = await api.get(endpoint);
          setDocuments((previous) => ({ ...previous, [apiScope]: {
            ...data,
            values: { ...data.values, ...changedValues },
            originalValues: { ...data.values },
          } }));
          setError('Có người khác vừa lưu thay đổi. Giá trị mới nhất đã được tải; các chỉnh sửa của bạn vẫn còn trên biểu mẫu để đối chiếu.');
        } catch (refreshError) {
          setError(`${errorText(requestError)} Không tải lại được giá trị mới: ${errorText(refreshError)}`);
        }
      }
    } finally { setSaving(false); }
  };

  const discardChanges = () => {
    if (!document) return;
    setDocuments((previous) => ({ ...previous, [apiScope]: { ...previous[apiScope], values: { ...previous[apiScope].originalValues } } }));
    setReason(''); setFieldErrors({}); setError(''); setSaved(false);
  };

  const selectItem = (group, item) => {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set('scope', group.id);
      next.delete('item');
      return next;
    });
    setActiveId(item.id); setSaved(false); setError('');
  };

  return <div className="sc-page">
    <div className="sc-layout">
      <aside className="sc-nav" aria-label="Danh mục cài đặt">
        {visibleGroups.map((group) => <section key={group.id}>
          <h3>{group.label}</h3>{group.items.map((item) => { const Icon = item.icon; return <button key={item.id} className={activeItem.id === item.id ? 'selected' : ''} onClick={() => selectItem(group, item)}><Icon/><span>{item.label}</span></button>; })}
        </section>)}
      </aside>
      <main className="sc-content"><div className="sc-content-head"><div><span>{activeGroup.label.toUpperCase()}</span><h1>{activeItem.label}</h1><p>{apiScope === 'user' ? 'Các lựa chọn được lưu theo tài khoản và dùng trên những thiết bị bạn đăng nhập.' : apiScope === 'support' ? 'Thiết lập lịch hỗ trợ, SLA và nội dung phản hồi đang dùng trực tiếp trong Hộp thư tư vấn và chatbot.' : apiScope === 'clinic' ? 'Cấu hình dùng chung cho hoạt động của phòng khám.' : 'Mở chức năng nghiệp vụ đang quản lý dữ liệu này.'}</p></div></div>
        {activeItem.id === 'setting-audit' ? <section className="sc-audit">
          {loading && <p className="sc-state">Đang tải nhật ký…</p>}{error && <p className="sc-error" role="alert">{error}</p>}
          {!loading && !error && <div className="sc-audit-table-wrap"><table><thead><tr><th>Thời điểm</th><th>Cấu hình</th><th>Giá trị cũ</th><th>Giá trị mới</th><th>Người thực hiện</th><th>Lý do</th></tr></thead><tbody>{audit.map((row) => <tr key={row.id}><td>{new Date(row.effective_at).toLocaleString('vi-VN')}</td><td><code>{row.key}</code></td><td>{JSON.stringify(row.old_value ?? '—')}</td><td>{JSON.stringify(row.new_value)}</td><td>{row.actor}</td><td>{row.reason || '—'}</td></tr>)}{!audit.length && <tr><td colSpan="6">Chưa có thay đổi cài đặt được ghi nhận.</td></tr>}</tbody></table></div>}
          <p className="sc-note">Danh sách hiển thị tối đa 200 thay đổi gần nhất. Quản lý xem nhật ký phòng khám; Quản trị hệ thống có thể xem mọi phạm vi.</p>
        </section> : apiScope ? <div className="sc-form">
          {loading && <p className="sc-state">Đang tải cài đặt…</p>}
          {error && <p className="sc-error" role="alert">{error}</p>}
          {!loading && document && fields.map((field) => <SettingField key={field.key} field={field} value={currentValues[field.key]} disabled={!editable} error={fieldErrors[field.key]?.[0]} onChange={(value) => updateValue(field.key, value)}/>)}
          {!editable && ['clinic', 'support'].includes(apiScope) && <p className="sc-state">Đang xem cấu hình ở chế độ chỉ đọc. Liên hệ Quản lý phòng khám nếu cần thay đổi.</p>}
          {apiScope === 'support' && document?.confirmation_required && <p className="sc-safety-note">Chatbot vẫn yêu cầu khách xác nhận trước thao tác làm thay đổi dữ liệu. Nội dung chuyên môn cần được chuyển nhân viên hoặc bác sĩ xử lý.</p>}
          {activeItem.id === 'care' && <p className="sc-safety-note">Hỏi thăm được tạo khi lượt khám hoàn tất; nhắc tái khám khi bác sĩ ký bệnh án có ngày tái khám. Nhắc liệu trình và công nợ được đối soát khi tải danh sách Chăm sóc. Tắt quy tắc chỉ ngăn việc mới, không xóa việc đã tạo.</p>}
          {['access', 'marketing'].includes(activeItem.id) && <p className="sc-safety-note">{activeItem.id === 'access' ? 'Các lựa chọn dưới đây chỉ thu hẹp quyền đang có. Quyền xem/ghi bệnh án và vai trò quản trị hệ thống vẫn theo giới hạn bảo mật bắt buộc.' : 'Hệ thống chỉ gửi tới người còn đồng ý nhận tin; khách đã hủy đăng ký hoặc rút đồng ý sẽ bị loại khỏi danh sách gửi.'}</p>}
          {editable && ['clinic', 'support'].includes(apiScope) && <label className="sc-field sc-reason">Lý do thay đổi<input required value={reason} onChange={(event) => setReason(event.target.value)} maxLength={255} placeholder={apiScope === 'support' ? 'Ví dụ: Điều chỉnh giờ trực CSKH' : activeItem.id === 'care' ? 'Ví dụ: Chuẩn hóa lịch gọi hỏi thăm sau điều trị' : 'Ví dụ: Cập nhật chính sách tiếp nhận lịch'}/></label>}
          {activeItem.id === 'preferences' && <div className="sc-security-links"><Link to="/profile">Thông tin liên hệ</Link><Link to="/change-password">Đổi mật khẩu</Link></div>}
          {editable && <footer><span role="status">{saved ? 'Đã lưu cài đặt.' : hasChanges ? 'Bạn có thay đổi chưa lưu.' : ['clinic', 'support'].includes(apiScope) ? 'Thay đổi sẽ được ghi nhật ký khi lưu.' : 'Cài đặt đồng bộ theo tài khoản của bạn.'}</span><div className="sc-form-actions">{hasChanges && <button type="button" disabled={saving} onClick={discardChanges}>Hủy thay đổi</button>}<button type="button" disabled={saving || loading || !hasChanges || (['clinic', 'support'].includes(apiScope) && !reason.trim())} onClick={save}><SaveRounded/>{saving ? 'Đang lưu…' : 'Lưu thay đổi'}</button></div></footer>}
          {confirmOpen && <div className="sc-confirm-backdrop"><section className="sc-confirm" role="dialog" aria-modal="true" aria-labelledby="sc-confirm-title"><h2 id="sc-confirm-title">{apiScope === 'clinic' ? 'Ngừng nhận đặt lịch trực tuyến?' : changedValues['chatbot.enabled'] === false ? 'Tắt chatbot trên website?' : changedValues['chatbot.ai_enabled'] === false ? 'Tắt trả lời bằng AI?' : 'Tắt thao tác tự động của chatbot?'}</h2><p>{apiScope === 'clinic' ? 'Khách hàng sẽ không thể gửi yêu cầu đặt lịch mới trên website. Lịch đã tạo vẫn được giữ nguyên.' : changedValues['chatbot.enabled'] === false ? 'Khách hàng sẽ không còn thấy cửa sổ chat trên website. Lịch sử hội thoại được giữ nguyên.' : changedValues['chatbot.ai_enabled'] === false ? 'Chatbot sẽ ngừng tạo câu trả lời AI; các chức năng tra cứu FAQ được giữ theo cấu hình hiện có.' : 'Chatbot chỉ trả lời thông tin; các thao tác đặt lịch và thay đổi dữ liệu sẽ bị tắt.'}</p><div className="sc-confirm-actions"><button type="button" disabled={saving} onClick={() => setConfirmOpen(false)}>Quay lại</button><button type="button" disabled={saving || !reason.trim()} onClick={persistChanges}>{saving ? 'Đang lưu…' : 'Xác nhận và lưu'}</button></div></section></div>}
        </div> : <div className="sc-links">
          {activeItem.to && (() => { const Icon = activeItem.icon; return <Link to={activeItem.to} className="sc-link-row"><Icon/><span><strong>{activeItem.label}</strong><small>{activeItem.note || 'Mở chức năng liên quan'}</small></span><b>›</b></Link>; })()}
          <p className="sc-note">Cài đặt nghiệp vụ được quản lý trong module tương ứng để sử dụng cùng dữ liệu và quy trình hiện có.</p>
        </div>}
      </main>
    </div>
  </div>;
}

function SettingField({ field, value, disabled, error, onChange }) {
  if (field.type === 'choice_list') return <fieldset className="sc-choice-list" disabled={disabled}><legend>{field.label}</legend>{field.help_text && <small>{field.help_text}</small>}<div>{(field.choices || []).map((choice) => <label key={choice.value}><input type="checkbox" checked={(value || []).includes(choice.value)} onChange={(event) => onChange(event.target.checked ? [...(value || []), choice.value] : (value || []).filter((item) => item !== choice.value))}/><span>{choice.label}</span></label>)}</div>{error && <em>{error}</em>}</fieldset>;
  if (field.type === 'boolean') return <label className="sc-option"><span><strong>{field.label}</strong>{field.help_text && <small>{field.help_text}</small>}{error && <em>{error}</em>}</span><input type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(event) => onChange(event.target.checked)}/></label>;
  if (field.type === 'choice' || field.type === 'route') return <label className="sc-field">{field.label}<select disabled={disabled} value={value ?? field.default} onChange={(event) => onChange(field.type === 'choice' && typeof field.choices?.[0] === 'number' ? Number(event.target.value) : event.target.value)}>{(field.choices || []).map((choice) => <option key={choice} value={choice}>{choiceLabel(field, choice)}</option>)}</select>{field.help_text && <small>{field.help_text}</small>}{error && <em>{error}</em>}</label>;
  if (field.type === 'timezone') return <label className="sc-field">{field.label}<input disabled={disabled} value={value ?? ''} placeholder="Asia/Ho_Chi_Minh" onChange={(event) => onChange(event.target.value)}/><small>{field.help_text || 'Nhập múi giờ IANA, ví dụ Asia/Ho_Chi_Minh.'}</small>{error && <em>{error}</em>}</label>;
  if (field.type === 'time') return <label className="sc-field">{field.label}<input disabled={disabled} required type="time" value={value ?? ''} onChange={(event) => onChange(event.target.value)}/>{field.help_text && <small>{field.help_text}</small>}{error && <em>{error}</em>}</label>;
  const longText = field.key.endsWith('greeting_message') || field.key.endsWith('offline_message') || field.key.endsWith('fallback_message');
  const onTextChange = (event) => onChange(field.type === 'integer' ? Number(event.target.value) : event.target.value);
  return <label className={`sc-field${longText ? ' sc-long-field' : ''}`}>{field.label}{longText ? <textarea disabled={disabled} required={Boolean(field.required)} maxLength={field.max_length} rows={3} value={value ?? ''} onChange={onTextChange}/> : <input disabled={disabled} required={Boolean(field.required)} type={field.type === 'integer' ? 'number' : field.type === 'email' ? 'email' : field.type === 'url' ? 'url' : 'text'} min={field.min} max={field.max} maxLength={field.max_length} value={value ?? ''} onChange={onTextChange}/>}{field.help_text && <small>{field.help_text}</small>}{error && <em>{error}</em>}</label>;
}
