import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api from '@/lib/api';

const ACCESS_KEY = 'auth_access';
const REFRESH_KEY = 'auth_refresh';

type Me = { id: number; username: string; email: string; credits: number };

type AuthContextValue = {
  user: Me | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (username: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<Me | null>(null);

  const fetchMe = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (localStorage.getItem(ACCESS_KEY)) fetchMe();
    else setLoading(false);
  }, [fetchMe]);

  const login = useCallback(async (username: string, password: string) => {
    await api.login(username, password);
    await fetchMe();
  }, [fetchMe]);

  const register = useCallback(async (username: string, email: string, password: string) => {
    await api.register(username, email, password);
    await fetchMe();
  }, [fetchMe]);

  const logout = useCallback(() => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isAuthenticated: !!user,
    loading,
    login,
    register,
    logout,
    refreshUser: fetchMe,
  }), [user, loading, login, register, logout, fetchMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
