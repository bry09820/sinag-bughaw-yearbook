import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { authApi } from '@/api/auth.api';
import { presenceApi } from '@/api/messaging.api';

const AuthContext = createContext(null);

function isVerifiedUser(user) {
  return Boolean(user?.email_verified);
}

export function AuthProvider({ children }) {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const token = localStorage.getItem('sb_token');
    if (token) {
      authApi.me()
        .then(({ data }) => {
          if (!isVerifiedUser(data)) {
            localStorage.removeItem('sb_token');
            setUser(null);
            return;
          }
          setUser(data);
        })
        .catch(() => {
          localStorage.removeItem('sb_token');
          setUser(null);
        })
        .finally(() => setLoading(false));
    } else {
      setLoading(false);
    }
  }, []);

  // Validates credentials only — does NOT store a token.
  // Access token is issued after OTP verification.
  const loginCredentials = async (email, password) => {
    const { data } = await authApi.login(email, password);
    return data;
  };

  const fetchUser = useCallback(async () => {
    const { data } = await authApi.me();
    if (!isVerifiedUser(data)) {
      localStorage.removeItem('sb_token');
      setUser(null);
      throw new Error('Email verification required');
    }
    setUser(data);
    return data;
  }, []);

  const logout = async () => {
    try { await authApi.logout(); } catch (_) {}
    localStorage.removeItem('sb_token');
    setUser(null);
  };

  const setToken = useCallback(async (token) => {
    localStorage.setItem('sb_token', token);
    try {
      const { data } = await authApi.me();
      if (!isVerifiedUser(data)) {
        localStorage.removeItem('sb_token');
        setUser(null);
        return null;
      }
      setUser(data);
      return data;
    } catch {
      localStorage.removeItem('sb_token');
      setUser(null);
      return null;
    }
  }, []);

  useEffect(() => {
    if (!user) return undefined;

    const markOnline = () => presenceApi.update(true).catch(() => {});
    const markOffline = () => presenceApi.update(false).catch(() => {});
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') markOnline();
    };

    markOnline();
    const interval = setInterval(markOnline, 60_000);
    window.addEventListener('beforeunload', markOffline);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', markOffline);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, loginCredentials, fetchUser, logout, setToken }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
