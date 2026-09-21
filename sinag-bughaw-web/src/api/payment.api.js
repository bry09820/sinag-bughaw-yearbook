import api from './client';

export const paymentsApi = {
  createIntent: (plan, extras = {}) =>
    api.post('/payments/create-intent', { plan, ...extras }),
  /** Preferred checkout endpoint — returns checkout_url (GCash / PayMaya / card). */
  checkout: (plan, extras = {}) =>
    api.post('/billing/checkout', { plan, redirect: false, ...extras }),
  confirm: (sessionId) => api.post('/payments/confirm', { session_id: sessionId }),
  subscriptionStatus: () => api.get('/payments/status'),
  history: () => api.get('/payments/history'),
};

export const consentApi = {
  accept: (version) => api.post('/consent/accept', { version }),
  status: () => api.get('/consent/status'),
};
