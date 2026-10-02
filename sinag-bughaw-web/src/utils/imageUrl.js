const API_BASE = import.meta.env.VITE_API_URL || '/api';
const APP_BASE = import.meta.env.VITE_APP_URL || API_BASE.replace(/\/api\/?$/, '');

export function imageUrl(path) {
  if (!path) return null;
  if (
    path.startsWith('http://') ||
    path.startsWith('https://') ||
    path.startsWith('blob:') ||
    path.startsWith('data:')
  ) return path;

  const cleanPath = String(path).replace(/^\/+/, '');
  if (cleanPath.startsWith('storage/')) return `${APP_BASE}/${cleanPath}`;

  return `${APP_BASE}/storage/${cleanPath}`;
}

export function avatarUrl(name = '') {
  return `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=1d2b4b&color=fdb813&bold=true&size=400`;
}
