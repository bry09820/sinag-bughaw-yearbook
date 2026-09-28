import api from './client';

export const messagesApi = {
  conversations: ()                     => api.get('/messages/conversations'),
  unreadCount:   ()                     => api.get('/messages/unread-count'),
  searchUsers:   (params = {})          => api.get('/messages/search', { params }),
  start:         (userId)               => api.post('/messages/start', { user_id: userId }),
  participant:   (userId)               => api.get(`/messages/users/${userId}`),
  thread:        (userId)               => api.get(`/messages/${userId}`),
  send:          (receiverId, body, image = null) => {
    if (image) {
      const form = new FormData();
      form.append('receiver_id', receiverId);
      form.append('body', body ?? '');
      form.append('image', image);
      return api.post('/messages', form, { headers: { 'Content-Type': 'multipart/form-data' } });
    }

    return api.post('/messages', { receiver_id: receiverId, body });
  },
  markRead:      (id)                   => api.patch(`/messages/${id}/read`),
  typing:        (receiverId, isTyping) => api.post('/messages/typing', {
                                            receiver_id: receiverId,
                                            is_typing:   isTyping,
                                          }),
};

export const presenceApi = {
  update: (isOnline) => api.post('/presence',      { is_online: isOnline }),
  bulk:   (userIds)  => api.post('/presence/bulk', { user_ids: userIds }),
};

export const voiceNotesApi = {
  inbox:      ()         => api.get('/voice-notes/inbox'),
  outbox:     ()         => api.get('/voice-notes/outbox'),
  forProfile: (userId)   => api.get(`/voice-notes/profile/${userId}`),
  send:       (formData) => api.post('/voice-notes', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  delete:     (id)       => api.delete(`/voice-notes/${id}`),
};

export const voiceNoteAdminApi = {
  list:    (status = 'pending') => api.get('/admin/voice-notes', { params: { status } }),
  stats:   ()                   => api.get('/admin/voice-notes/stats'),
  approve: (id)                 => api.post(`/admin/voice-notes/${id}/approve`),
  reject:  (id, reason)         => api.post(`/admin/voice-notes/${id}/reject`, { reason }),
};
