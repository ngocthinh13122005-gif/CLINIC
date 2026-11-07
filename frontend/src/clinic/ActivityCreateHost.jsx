import { useEffect, useState } from 'react';
import { useToast } from './ui';
import { ActivityForm } from './ActivityDialogs';

/** Mở hộp "Thêm hoạt động" từ bất cứ đâu (menu "Tạo mới", nút ở hóa đơn, hồ sơ…):  openCreateActivity({ patient: {id, full_name, code}, note: '…' }) */
export function openCreateActivity(preset = {}) {
  window.dispatchEvent(new CustomEvent('akina:create-activity', { detail: preset }));
}

/**
 * Gắn MỘT lần trong ClinicShell (ví dụ ngay trước </main>): <ActivityCreateHost />
 * Phím tắt Shift + A (giống Pabau). Lưu xong sẽ phát sự kiện 'akina:activity-saved' để các trang đang mở tự tải lại.
 */
export default function ActivityCreateHost() {
  const [preset, setPreset] = useState(null);
  const [toast, toastNode] = useToast();
  useEffect(() => {
    const on = (e) => setPreset({ ...(e.detail || {}), _k: Date.now() });
    const key = (e) => {
      if (!e.shiftKey || e.key.toLowerCase() !== 'a' || e.ctrlKey || e.metaKey || e.altKey) return;
      if (/INPUT|TEXTAREA|SELECT/.test(e.target.tagName) || e.target.isContentEditable) return;
      e.preventDefault(); setPreset({ _k: Date.now() });
    };
    window.addEventListener('akina:create-activity', on); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('akina:create-activity', on); window.removeEventListener('keydown', key); };
  }, []);
  return <>
    {preset && <ActivityForm key={preset._k} preset={preset} onClose={() => setPreset(null)}
      onSaved={() => { setPreset(null); toast('Đã thêm hoạt động.'); window.dispatchEvent(new CustomEvent('akina:activity-saved')); }} />}
    {toastNode}
  </>;
}
