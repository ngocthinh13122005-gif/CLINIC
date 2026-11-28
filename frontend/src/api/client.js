import axios from 'axios';
import { coalesceGets } from './coalescedAdapter';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 15000,
});

api.defaults.adapter = coalesceGets(axios.getAdapter(api.defaults.adapter), (config) => api.getUri(config));

api.interceptors.request.use((config) => {
  if (!config.skipAuth) {
    try {
      const token = localStorage.getItem('ohio_token');
      if (token) config.headers.Authorization = `Token ${token}`;
    } catch {
      // Browsers can deny site storage; public requests must still reach the API.
    }
  }
  return config;
});

api.interceptors.response.use(
  (response) => {
    const config = response.config || {};
    const method = (config.method || 'get').toLowerCase();
    if (method !== 'get' && /^\/?bookings(?:\/|$)/.test(config.url || '')) {
      window.dispatchEvent(new CustomEvent('akina:booking-updated'));
    }
    if (method !== 'get' && /^\/?conversations(?:\/|$)/.test(config.url || '')) {
      window.dispatchEvent(new CustomEvent('akina:conversation-updated'));
    }
    return response;
  },
  (error) => {
    if (error.response?.status === 401) {
      try {
        localStorage.removeItem('ohio_token');
        localStorage.removeItem('ohio_user');
      } catch { /* Site storage may be disabled. */ }
    }
    return Promise.reject(error);
  },
);

export default api;
