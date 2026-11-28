import { lazy } from 'react';
import { useAuth } from '../context/AuthContext';

const ClinicShell = lazy(() => import('../clinic/ClinicShell'));
const CustomerShell = lazy(() => import('./public/CustomerShell'));
const LegacyAppShell = lazy(() => import('./LegacyAppShell'));

export default function AppShell() {
  const { user } = useAuth();
  if (['manager', 'doctor', 'consultant', 'staff'].includes(user?.role)) return <ClinicShell />;
  if (user?.role === 'customer') return <CustomerShell />;
  return <LegacyAppShell />;
}
