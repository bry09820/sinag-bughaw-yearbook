import api from './client';

export const authApi = {
  login:          (email, password) => api.post('/auth/login',             { email, password }),
  register:       (data)            => api.post('/auth/register',          data),
  verifyStudent:  (data)            => api.post('/auth/verify-student',    data),
  logout:         ()                => api.post('/auth/logout'),
  me:             ()                => api.get('/auth/me'),
  sendOtp:        (email)           => api.post('/auth/otp/send',          { email }),
  verifyOtp:      (email, otp)      => api.post('/auth/otp/verify',        { email, otp }),

  // Forgot password flow
  forgotPassword: (email)           => api.post('/auth/forgot-password',   { email }),
  verifyResetOtp: (email, otp)      => api.post('/auth/otp/verify-reset',  { email, otp }),
  resetPassword:  (data)            => api.post('/auth/reset-password',    data),
};

export const consentApi = {
  accept: (version = '1.0') => api.post('/consent/accept', { version }),
  status: ()                => api.get('/consent/status'),
};