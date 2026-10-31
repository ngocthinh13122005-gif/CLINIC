import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || '/api',
  timeout: 15000,
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('ohio_token');
  if (token && !config.skipAuth) config.headers.Authorization = `Token ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      localStorage.removeItem('ohio_token');
      localStorage.removeItem('ohio_user');
    }
    return Promise.reject(error);
  },
);

export default api;
