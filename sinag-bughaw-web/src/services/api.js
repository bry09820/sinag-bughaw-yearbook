import axios from 'axios';

// VITE_API_URL already includes /api  e.g. https://example.com/api
const BASE_URL = import.meta.env.VITE_API_URL || '/api';

// Storage URL is the root (no /api)
const STORAGE_ROOT = import.meta.env.VITE_APP_URL || '';

/** Convert a relative storage path to a full URL */
export function storageUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
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
    if (err.response?.status === 401) {
      localStorage.removeItem('auth_token');
      localStorage.removeItem('sb_token');
      window.location.href = '/login';
    }
    if (err.response?.status === 402) {
      window.location.href = '/premium';
    }
    return Promise.reject(err);
  }
);

// Auth
export const authApi = {
  login:     (email, password) => api.post('/auth/login', { email, password }),
  register:  (data)            => api.post('/auth/register', data),
  me:        ()                => api.get('/auth/me'),
  sendOtp:   (email)           => api.post('/auth/otp/send', { email }),
  verifyOtp: (email, otp)      => api.post('/auth/otp/verify', { email, otp }),
};

// Students
export const studentsApi = {
  list:              (params)  => api.get('/students', { params }),
  show:              (id)      => api.get(`/students/${id}`),
  search:            (params={})=> api.get('/search/students', { params }),
  suggest:           (params={})=> api.get('/search/students/suggest', { params }),
  filters:           ()        => api.get('/search/students/filters'),
  getAchievements:   (id)      => api.get(`/students/${id}/achievements`),
  getTaggedPhotos:   (id)      => api.get(`/students/${id}/tagged-photos`),
  addTaggedPhoto:    (fd)      => api.post('/students/profile/tagged-photos', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  removeTaggedPhoto: (photoId) => api.delete(`/students/profile/tagged-photos/${photoId}`),
  updateBio:         (bio)     => api.post('/students/profile/bio', { bio }),
  updatePhoto:       (fd)      => api.post('/students/profile/photo', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  updatePassword:    (payload) => api.put('/students/profile/password', payload),
};

// Face Recognition
export const faceApi = {
  syncStudents:  ()               => api.post('/face/sync'),
  search:        (fd)             => api.post('/face/search', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  photoTags:     (photoId)        => api.get(`/face/photos/${photoId}/tags`),
  analyzePhoto:  (photoId)        => api.post(`/face/photos/${photoId}/analyze`),
  analyzeAlbum:  (albumId)        => api.post(`/face/albums/${albumId}/analyze`),
  studentPhotos: (userId, page=1) => api.get(`/face/students/${userId}/photos`, { params: { page } }),
};

// Gallery
export const galleryApi = {
  list:       ()   => api.get('/gallery'),
  show:       (id) => id ? api.get(`/gallery/${id}`) : Promise.reject(new Error('ID required')),
  faceSearch: (fd) => api.post('/gallery/face-search', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
};

// Albums
export const albumsApi = {
  list:   ()         => api.get('/albums'),
  show:   (id)       => api.get(`/albums/${id}`),
  create: (data)     => api.post('/albums', data),
  update: (id, data) => api.put(`/albums/${id}`, data),
  delete: (id)       => api.delete(`/albums/${id}`),
};

// Sections
export const sectionsApi = {
  list: ()   => api.get('/sections'),
  show: (id) => api.get(`/sections/${id}`),
};

// Faculty
export const facultyApi = {
  list: ()   => api.get('/faculty'),
  show: (id) => api.get(`/faculty/${id}`),
};

// Search
export const searchApi = {
  search: (q, type='all') => api.get('/search', { params: { q, type } }),
};

// Messages
export const messagesApi = {
  conversations: ()                 => api.get('/messages/conversations'),
  thread:        (userId)           => api.get(`/messages/${userId}`),
  send:          (receiverId, body) => api.post('/messages', { receiver_id: receiverId, body }),
  markRead:      (id)               => api.patch(`/messages/${id}/read`),
};

// Transcripts
export const transcriptsApi = {
  list:   ()   => api.get('/transcripts'),
  show:   (id) => api.get(`/transcripts/${id}`),
  upload: (fd) => api.post('/transcripts', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
};

// Yearbook
export const yearbookApi = {
  flipbookData:      ()       => api.get('/yearbook/flipbook'),
  exportStudentPdf:  (userId) => api.get(`/yearbook/export/${userId}`, { responseType: 'blob' }),
  exportCertificate: ()       => api.get('/yearbook/certificate', { responseType: 'blob' }),
};

// Payments
export const paymentsApi = {
  createIntent:       (plan) => api.post('/payments/create-intent', { plan }),
  subscriptionStatus: ()     => api.get('/payments/status'),
  history:            ()     => api.get('/payments/history'),
};

// Announcements
export const announcementsApi = {
  list:   ()     => api.get('/announcements'),
  create: (data) => api.post('/announcements', data),
};

// Notifications
export const notificationsApi = {
  list:          ()         => api.get('/notifications'),
  registerToken: (fcmToken) => api.post('/notifications/register-token', { fcm_token: fcmToken }),
  markRead:      (id)       => api.post(`/notifications/${id}/read`),
  markAll:       ()         => api.post('/notifications/read-all'),
};

// Consent
export const consentApi = {
  accept: (version) => api.post('/consent/accept', { version }),
  status: ()        => api.get('/consent/status'),
};

// Profile Settings
export const profileSettingsApi = {
  updateVisibility: (visibility) => api.post('/profile/visibility', { visibility }),
  updateMotto:      (motto)      => api.post('/profile/motto', { motto }),
  trackView:        (id)         => api.post(`/students/${id}/view`),
  topViewed:        ()           => api.get('/analytics/top-viewed'),
};

// Voice Notes
export const voiceNotesApi = {
  list:   ()   => api.get('/voice-notes'),
  upload: (fd) => api.post('/voice-notes', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  delete: (id) => api.delete(`/voice-notes/${id}`),
};

// Graduation
export const graduationApi = {
  list:          (category) => api.get('/graduation', { params: { category } }),
  show:          (id)       => api.get(`/graduation/${id}`),
  createAlbum:   (data)     => api.post('/graduation/album', data),
  uploadPhoto:   (fd)       => api.post('/graduation/upload-photo', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  uploadVideo:   (fd)       => api.post('/graduation/upload-video', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  uploadProgram: (fd)       => api.post('/graduation/upload-program', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  delete:        (id)       => api.delete(`/graduation/${id}`),
};

// Media (Bulk Upload + HD Video)
export const mediaApi = {
  bulkUpload:  (fd)  => api.post('/media/bulk-upload', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  uploadVideo: (fd)  => api.post('/media/upload-video', fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  deletePhoto: (id)  => api.delete(`/media/photo/${id}`),
};

// Analytics
export const analyticsApi = {
  summary:    () => api.get('/analytics'),
  myStats:    () => api.get('/analytics/my-stats'),
  topViewed:  () => api.get('/analytics/top-viewed'),
  batchmates: () => api.get('/analytics/batchmates'),
};

export default api;