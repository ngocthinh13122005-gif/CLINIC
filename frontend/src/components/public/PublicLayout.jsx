import { Outlet, useNavigate } from 'react-router-dom';
import ChatbotWidget from '../chatbot/ChatbotWidget';
import { useAuth } from '../../context/AuthContext';
import { CustomerFooter, CustomerHeader } from './CustomerChrome';
import '../../styles/public.css';
import '../../styles/operations.css';
import '../../styles/public-theme.css';

export default function PublicLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const customer = user?.role === 'customer';

  const doLogout = async () => {
    await logout();
    navigate('/');
  };

  return <div className="public-shell">
    <CustomerHeader user={user} onLogout={doLogout}/>
    <Outlet />
    <div className="floating-contact">
      {(!user || customer) && <ChatbotWidget/>}
    </div>
    <CustomerFooter/>
  </div>;
}
