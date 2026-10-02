import Echo from 'laravel-echo';
import Pusher from 'pusher-js';

window.Pusher = Pusher;

function getToken() {
  return (
    localStorage.getItem('admin_token') ??
    localStorage.getItem('sb_token') ??
    localStorage.getItem('token') ??
    ''
  );
}

const apiUrl = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '').replace(/\/api$/, '');

const echo = new Echo({
  broadcaster: 'pusher',
  key: import.meta.env.VITE_PUSHER_APP_KEY,
  cluster: import.meta.env.VITE_PUSHER_APP_CLUSTER,
  forceTLS: true,
  authEndpoint: `${apiUrl}/broadcasting/auth`,
  auth: {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept: 'application/json',
    },
  },
});

window.Echo = echo;

export default echo;
