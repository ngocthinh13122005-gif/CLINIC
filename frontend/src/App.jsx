import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import AppShell from './components/AppShell';
import PublicLayout from './components/public/PublicLayout';
import { useAuth } from './context/AuthContext';
import HomePage from './pages/HomePage';
import PublicServicesPage from './pages/PublicServicesPage';
import PublicBookingPage from './pages/PublicBookingPage';
import TicketPage from './pages/TicketPage';
import LoginPage from './pages/LoginPage';
import ContactPage from './pages/ContactPage';
import DashboardPage from './pages/DashboardPage';
import BookingsPage from './pages/BookingsPage';
import ServicesPage from './pages/ServicesPage';
import ChatPage from './pages/ChatPage';
import SupportInboxPage from './pages/SupportInboxPage';
import ProfilePage from './pages/ProfilePage';
import PatientPortalPage from './pages/PatientPortalPage';
import { SignupPage, MyVouchersPage } from './pages/ManagerOpsPages';
import { AdminOverviewPage, AdminCalendarPage, AdminCRMPage, AdminVouchersPage } from './pages/AdminOperationsPages';
import { AdminServicesPage } from './pages/AdminCommercialPages';
import { AdminStaffPage, AdminAttendancePage, AdminPayrollPage } from './pages/AdminHRPages';
import ClinicHome from './clinic/Home';
import ReceptionPage from './clinic/Reception';
import CalendarPage from './clinic/Calendar';
import DayBoardPage from './clinic/DayBoard';
import BookingListView from './clinic/BookingListView';
import { PatientsPage } from './clinic/Patients';
import ExamPage from './clinic/Exam';
import PlansPage from './clinic/Plans';
import PharmacyPage from './clinic/Stock';
import ReportsPage from './clinic/Reports';
import CarePage from './clinic/Care';
import AuditPage from './clinic/Audit';
import CompliancePage from './clinic/Compliance';
import MoneyPage from './clinic/Money';
import ClientProfilePage from './clinic/ClientProfile';
import SalePage, { AddPaymentPage } from './clinic/Sale';
import InvoiceEditPage from './clinic/InvoiceEdit';
import InvoiceRefundPage from './clinic/InvoiceRefund';
import { ChangePasswordPage, ForgotPasswordPage } from './pages/AuthSecurityPages';
import EmailMarketingPage from './pages/EmailMarketingPage';
import CRMPage from './pages/CRMPage';
import SettingsCenter from './clinic/SettingsCenter';
import ActivitiesPage from './clinic/Activities';

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

export default function App(){return <Routes>
  <Route element={<PublicLayout/>}>
    <Route path="/" element={<HomePage/>}/>
    <Route path="/dich-vu" element={<PublicServicesPage/>}/>
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
    <Route path="/admin/staff" element={<ManagerOnly><AdminStaffPage/></ManagerOnly>}/>
    <Route path="/admin/attendance" element={<ManagerOnly><AdminAttendancePage/></ManagerOnly>}/>
    <Route path="/admin/payroll" element={<ManagerOnly><AdminPayrollPage/></ManagerOnly>}/>
    <Route path="/admin/crm" element={<ManagerOnly><CRMPage/></ManagerOnly>}/>
    <Route path="/admin/vouchers" element={<ManagerOnly><AdminVouchersPage/></ManagerOnly>}/>
    <Route path="/admin/email-marketing" element={<ManagerOnly><EmailMarketingPage/></ManagerOnly>}/>
    <Route path="/manager-dashboard" element={<Navigate to="/admin/dashboard" replace/>}/>
    <Route path="/roster" element={<Navigate to="/admin/calendar" replace/>}/>
    <Route path="/staff-directory" element={<Navigate to="/admin/staff" replace/>}/>
    <Route path="/attendance-leave" element={<Navigate to="/admin/attendance" replace/>}/>
    <Route path="/payroll" element={<Navigate to="/admin/payroll" replace/>}/>
    <Route path="/crm" element={<Navigate to="/admin/crm" replace/>}/>
    <Route path="/vouchers" element={<Navigate to="/admin/vouchers" replace/>}/>
    <Route path="/my-vouchers" element={<MyVouchersPage/>}/>
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
    <Route path="/ho-so-suc-khoe" element={<Roles allow={['customer']}><PatientPortalPage/></Roles>}/>
  </Route>
  <Route path="*" element={<Navigate to="/" replace/>}/>
</Routes>}
