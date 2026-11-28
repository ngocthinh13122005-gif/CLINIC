import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom';
const lazyNamed = (load, name) => lazy(async () => ({ default: (await load())[name] }));

const AppShell = lazy(() => import('./components/AppShell'));
const PublicLayout = lazy(() => import('./components/public/PublicLayout'));
import { useAuth } from './context/AuthContext';
const HomePage = lazy(() => import('./pages/HomePage'));
const PublicServicesPage = lazy(() => import('./pages/PublicServicesPage'));
const PublicBookingPage = lazy(() => import('./pages/PublicBookingPage'));
const TicketPage = lazy(() => import('./pages/TicketPage'));
const LoginPage = lazy(() => import('./pages/LoginPage'));
const ContactPage = lazy(() => import('./pages/ContactPage'));
const ServiceDetailPage = lazy(() => import('./pages/ServiceDetailPage'));
const DoctorsPage = lazyNamed(() => import('./pages/DoctorsPage'), 'DoctorsPage');
const DoctorProfilePage = lazyNamed(() => import('./pages/DoctorsPage'), 'DoctorProfilePage');
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const BookingsPage = lazy(() => import('./pages/BookingsPage'));
const ServicesPage = lazy(() => import('./pages/ServicesPage'));
const ChatPage = lazy(() => import('./pages/ChatPage'));
const SupportInboxPage = lazy(() => import('./pages/SupportInboxPage'));
const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const PatientPortalPage = lazy(() => import('./pages/PatientPortalPage'));
const PortalDashboard = lazy(() => import('./pages/portal/PortalDashboard'));
const PortalPayments = lazy(() => import('./pages/portal/PortalPayments'));
const PortalForms = lazy(() => import('./pages/portal/PortalForms'));
const SignupPage = lazyNamed(() => import('./pages/ManagerOpsPages'), 'SignupPage');
const AdminOverviewPage = lazyNamed(() => import('./pages/AdminOperationsPages'), 'AdminOverviewPage');
const AdminCalendarPage = lazyNamed(() => import('./pages/AdminOperationsPages'), 'AdminCalendarPage');
const AdminServicesPage = lazyNamed(() => import('./pages/AdminCommercialPages'), 'AdminServicesPage');
const AdminHRPage = lazyNamed(() => import('./pages/AdminHRPages'), 'AdminHRPage');
const ClinicHome = lazy(() => import('./clinic/Home'));
const ReceptionPage = lazy(() => import('./clinic/Reception'));
const CalendarPage = lazy(() => import('./clinic/Calendar'));
const DayBoardPage = lazy(() => import('./clinic/DayBoard'));
const BookingListView = lazy(() => import('./clinic/BookingListView'));
const PatientsPage = lazyNamed(() => import('./clinic/Patients'), 'PatientsPage');
const ExamPage = lazy(() => import('./clinic/Exam'));
const PlansPage = lazy(() => import('./clinic/Plans'));
const PharmacyPage = lazy(() => import('./clinic/Stock'));
const ReportsPage = lazy(() => import('./clinic/Reports'));
const CarePage = lazy(() => import('./clinic/Care'));
const AuditPage = lazy(() => import('./clinic/Audit'));
const CompliancePage = lazy(() => import('./clinic/Compliance'));
const MoneyPage = lazy(() => import('./clinic/Money'));
const ClientProfilePage = lazy(() => import('./clinic/ClientProfile'));
const SalePage = lazy(() => import('./clinic/Sale'));
const AddPaymentPage = lazyNamed(() => import('./clinic/Sale'), 'AddPaymentPage');
const InvoiceEditPage = lazy(() => import('./clinic/InvoiceEdit'));
const InvoiceRefundPage = lazy(() => import('./clinic/InvoiceRefund'));
const ChangePasswordPage = lazyNamed(() => import('./pages/AuthSecurityPages'), 'ChangePasswordPage');
const ForgotPasswordPage = lazyNamed(() => import('./pages/AuthSecurityPages'), 'ForgotPasswordPage');
const CRMPage = lazy(() => import('./pages/CRMPage'));
const SettingsCenter = lazy(() => import('./clinic/SettingsCenter'));
const ActivitiesPage = lazy(() => import('./clinic/Activities'));

function Protected(){
  const {user}=useAuth(); const location=useLocation();
  if(!user) return <Navigate to="/login" replace state={{from:location.pathname}}/>;
  if(user.must_change_password && location.pathname !== '/change-password') return <Navigate to="/change-password" replace/>;
  return <AppShell/>;
}

const CLINIC_ROLES=['manager','doctor','consultant','staff'];
function DashboardRoute(){
  const {user}=useAuth();
  if(CLINIC_ROLES.includes(user?.role)) return <ClinicHome/>;
  if(user?.role==='customer') return <PortalDashboard/>;
  return <DashboardPage/>;
}
function Roles({allow,children}){
  const {user}=useAuth();
  return allow.includes(user?.role) ? children : <Navigate to="/dashboard" replace/>;
}


function ChatRoute(){
  const {user}=useAuth();
  if(user?.role==='customer') return <ChatPage/>;
  return <SupportInboxPage/>;
}

function ManagerOnly({children}){
  const {user}=useAuth();
  return user?.role==='manager' ? children : <Navigate to="/dashboard" replace/>;
}

function LegacyDoctorProfileRedirect(){
  const {id}=useParams();
  return <Navigate to={`/doi-ngu-bac-si/${id}`} replace/>;
}

export default function App(){return <Suspense fallback={<div role="status" style={{ padding: 24 }}>Đang tải…</div>}><Routes>
  <Route element={<PublicLayout/>}>
    <Route path="/" element={<HomePage/>}/>
    <Route path="/dich-vu" element={<PublicServicesPage/>}/>
    <Route path="/dich-vu/:id" element={<ServiceDetailPage/>}/>
    <Route path="/gioi-thieu" element={<Navigate to="/doi-ngu-bac-si" replace/>}/>
    <Route path="/gioi-thieu/:id" element={<LegacyDoctorProfileRedirect/>}/>
    <Route path="/doi-ngu-bac-si" element={<DoctorsPage/>}/>
    <Route path="/doi-ngu-bac-si/:id" element={<DoctorProfilePage/>}/>
    <Route path="/book" element={<PublicBookingPage/>}/>
    <Route path="/ticket/:code" element={<TicketPage/>}/>
    <Route path="/contact" element={<ContactPage/>}/>
    <Route path="/login" element={<LoginPage/>}/>
    <Route path="/signup" element={<SignupPage/>}/>
    <Route path="/forgot-password" element={<ForgotPasswordPage/>}/>
  </Route>
  <Route element={<Protected/>}>
    <Route path="/change-password" element={<ChangePasswordPage/>}/>
    <Route path="/dashboard" element={<DashboardRoute/>}/>
    <Route path="/tiep-don" element={<Roles allow={['manager','doctor','consultant']}><ReceptionPage/></Roles>}/>
    <Route path="/lich-hom-nay" element={<Roles allow={['manager','doctor','consultant']}><DayBoardPage/></Roles>}/>
    <Route path="/lich-hen" element={<Roles allow={CLINIC_ROLES}><CalendarPage/></Roles>}/>
    <Route path="/lich-hen/danh-sach" element={<Roles allow={CLINIC_ROLES}><BookingListView/></Roles>}/>
    <Route path="/benh-nhan" element={<Roles allow={CLINIC_ROLES}><PatientsPage/></Roles>}/>
    <Route path="/benh-nhan/:id" element={<Roles allow={CLINIC_ROLES}><ClientProfilePage/></Roles>}/>
    <Route path="/kham/:visitId" element={<Roles allow={['doctor']}><ExamPage/></Roles>}/>
    <Route path="/thu-ngan" element={<Roles allow={['manager','consultant']}><MoneyPage/></Roles>}/>
    <Route path="/ban-hang" element={<Roles allow={['manager','consultant']}><SalePage/></Roles>}/>
    <Route path="/ban-hang/thu-tien/:id" element={<Roles allow={['manager','consultant']}><AddPaymentPage/></Roles>}/>
    <Route path="/hoa-don/:id/hoan-tien" element={<Roles allow={['manager','consultant']}><InvoiceRefundPage/></Roles>}/>
    <Route path="/hoa-don/:id" element={<Roles allow={['manager','consultant','doctor']}><InvoiceEditPage/></Roles>}/>
    <Route path="/kho-thuoc" element={<Roles allow={['manager','doctor','consultant']}><PharmacyPage/></Roles>}/>
    <Route path="/bao-cao" element={<Roles allow={['manager']}><ReportsPage/></Roles>}/>
    <Route path="/tuan-thu" element={<Roles allow={['manager']}><CompliancePage/></Roles>}/>
    <Route path="/nhat-ky" element={<Roles allow={['manager']}><AuditPage/></Roles>}/>
    <Route path="/cham-soc" element={<Roles allow={['manager','doctor','consultant']}><CarePage/></Roles>}/>
    <Route path="/hoat-dong" element={<Roles allow={['manager','doctor','consultant']}><ActivitiesPage/></Roles>}/>
    <Route path="/lieu-trinh" element={<Roles allow={CLINIC_ROLES}><PlansPage/></Roles>}/>
    <Route path="/admin/dashboard" element={<ManagerOnly><AdminOverviewPage/></ManagerOnly>}/>
    <Route path="/admin/calendar" element={<ManagerOnly><AdminCalendarPage/></ManagerOnly>}/>
    <Route path="/admin/services" element={<ManagerOnly><AdminServicesPage/></ManagerOnly>}/>
    <Route path="/admin/staff" element={<ManagerOnly><AdminHRPage/></ManagerOnly>}/>
    <Route path="/admin/attendance" element={<ManagerOnly><Navigate to="/admin/staff?section=attendance" replace/></ManagerOnly>}/>
    <Route path="/admin/payroll" element={<ManagerOnly><Navigate to="/admin/staff?section=payroll" replace/></ManagerOnly>}/>
    <Route path="/admin/crm" element={<ManagerOnly><CRMPage/></ManagerOnly>}/>
    <Route path="/manager-dashboard" element={<Navigate to="/admin/dashboard" replace/>}/>
    <Route path="/roster" element={<Navigate to="/admin/calendar" replace/>}/>
    <Route path="/staff-directory" element={<Navigate to="/admin/staff" replace/>}/>
    <Route path="/attendance-leave" element={<Navigate to="/admin/attendance" replace/>}/>
    <Route path="/payroll" element={<Navigate to="/admin/payroll" replace/>}/>
    <Route path="/crm" element={<Navigate to="/admin/crm" replace/>}/>
    <Route path="/bookings" element={<BookingsPage/>}/>
    <Route path="/services" element={<ServicesPage/>}/>
    <Route path="/chat" element={<ChatRoute/>}/>
    <Route path="/cskh" element={<SupportInboxPage/>}/>
    <Route path="/cskh/" element={<SupportInboxPage/>}/>
    <Route path="/bac-si/tu-van" element={<SupportInboxPage/>}/>
    <Route path="/bac-si/tu-van/" element={<SupportInboxPage/>}/>
    <Route path="/admin/conversations" element={<SupportInboxPage/>}/>
    <Route path="/profile" element={<ProfilePage/>}/>
    <Route path="/settings" element={<SettingsCenter/>}/>
    <Route path="/thanh-toan" element={<Roles allow={['customer']}><PortalPayments/></Roles>}/>
    <Route path="/bieu-mau" element={<Roles allow={['customer']}><PortalForms/></Roles>}/>
    <Route path="/ho-so-suc-khoe" element={<Roles allow={['customer']}><PatientPortalPage/></Roles>}/>
  </Route>
  <Route path="*" element={<Navigate to="/" replace/>}/>
</Routes></Suspense>}
