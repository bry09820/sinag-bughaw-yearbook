import Echo   from 'laravel-echo';
import Pusher from 'pusher-js';

window.Pusher = Pusher;

const apiRoot = (import.meta.env.VITE_APP_URL
  || import.meta.env.VITE_API_URL?.replace(/\/api\/?$/, '')
  || ''
).replace(/\/+$/, '');

function getToken() {
  // Use whichever key YOUR app stores the token under
  return (
    localStorage.getItem('sb_token')    ??
    localStorage.getItem('token')       ??
    localStorage.getItem('auth_token')  ??
    sessionStorage.getItem('token')     ??
    ''
  );
}

const echo = new Echo({
  broadcaster:       'pusher',
  key:               import.meta.env.VITE_PUSHER_APP_KEY,
  cluster:           import.meta.env.VITE_PUSHER_APP_CLUSTER,
  forceTLS:          true,
  authEndpoint:      `${apiRoot}/broadcasting/auth`,
  auth: {
    headers: {
      Authorization: `Bearer ${getToken()}`,
      Accept:        'application/json',
    },
  },
});

export function refreshEchoAuthHeaders() {
  const token = getToken();
  const headers = {
    Authorization: token ? `Bearer ${token}` : '',
    Accept: 'application/json',
  };

  echo.options.auth.headers = headers;
  if (echo.connector?.options?.auth) {
    echo.connector.options.auth.headers = headers;
  }
}

window.Echo = echo;
export default echo;
