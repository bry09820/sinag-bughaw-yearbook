import axios from 'axios';

const BASE_URL         = import.meta.env.VITE_API_URL             || '/api';
const STORAGE_ROOT     = import.meta.env.VITE_APP_URL             || '';
const FRONTEND_URL     = import.meta.env.VITE_FRONTEND_URL        || '';
const CLOUDINARY_CLOUD = import.meta.env.VITE_CLOUDINARY_CLOUD_NAME;

export function storageUrl(path) {
  if (!path) return null;

  // Already a full Cloudinary or any http URL — return as-is
  if (path.startsWith('http://') || path.startsWith('https://')) return path;

  // Reconstruct Cloudinary URL from stored public_id / relative path
  if (CLOUDINARY_CLOUD) {
    return `https://res.cloudinary.com/${CLOUDINARY_CLOUD}/image/upload/${path}`;
  }

  // Last resort fallback local storage (development only)
  return `${STORAGE_ROOT}/storage/${path}`;
}

const api = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
  },
});

api.interceptors.request.use(config => {
  const token = localStorage.getItem('auth_token') || localStorage.getItem('sb_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 503 && err.response?.data?.code === 'MAINTENANCE') {
      if (!window.location.pathname.startsWith('/maintenance')) {
        window.location.href = `${FRONTEND_URL}/maintenance`;
      }
      return Promise.reject(err);
    }
    if (err.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('sb_token');
      window.location.href = `${FRONTEND_URL}/login`;
    }
    return Promise.reject(err);
  }
);

export default api;
