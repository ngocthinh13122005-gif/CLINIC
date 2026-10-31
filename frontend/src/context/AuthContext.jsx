import { createContext, useContext, useMemo, useState } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(localStorage.getItem('ohio_user') || 'null'); } catch { return null; }
  });

  const updateSession = (nextUser, token=null) => {
    if (token) localStorage.setItem('ohio_token', token);
    if (nextUser) localStorage.setItem('ohio_user', JSON.stringify(nextUser));
    else localStorage.removeItem('ohio_user');
    setUser(nextUser || null);
  };
  const login = async (username, password) => {
    const { data } = await api.post('/auth/login/', { username, password });
    updateSession(data.user, data.token);
    return data.user;
  };
  const register = async (payload) => {
    const { data } = await api.post('/auth/register/', payload);
    updateSession(data.user, data.token);
    return data.user;
  };
  const refreshMe = async () => {
    const { data } = await api.get('/auth/me/');
    updateSession(data);
    return data;
  };
  const logout = async () => {
    try { await api.post('/auth/logout/'); } catch { /* ignore */ }
    localStorage.removeItem('ohio_token');
    updateSession(null);
  };
  const value = useMemo(() => ({ user, login, register, refreshMe, updateSession, logout }), [user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
