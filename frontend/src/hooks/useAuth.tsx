import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import api, { HttpError } from '@/lib/api';
import type { Me, ResourceType, Role } from '@/lib/types';

const ACCESS_KEY = 'auth_access';
const REFRESH_KEY = 'auth_refresh';


type AuthContextValue = {
  user: Me | null;
  isAuthenticated: boolean;
  isTeacher: boolean;
  /** Approved (past the waitlist) and allowed to use the app. */
  isApproved: boolean;
  isAdmin: boolean;
  /** Remaining credits for one resource type (0 when signed out). */
  creditsLeft: (type: ResourceType) => number;
  loading: boolean;
  login: (username: string, password: string, role?: Role) => Promise<void>;
  register: (username: string, email: string, password: string, role: Role) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Provides auth state to the app: loads the current user when a stored access token exists, refreshes
 * it when the tab becomes visible again, and exposes login/register/logout plus derived role, approval
 * and credit helpers.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<Me | null>(null);

  /** Load the current user from the API; clears the user only on 401/403 and always ends the loading state. */
  const fetchMe = useCallback(async () => {
    try {
      const me = await api.me();
      setUser(me);
    } catch (e) {
      // Only drop the user when the server rejects the credentials (expired/invalid token,
      // deactivated account). A network blip or 5xx keeps the current session on screen.
      if (e instanceof HttpError && (e.status === 401 || e.status === 403)) setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (localStorage.getItem(ACCESS_KEY)) fetchMe();
    else setLoading(false);
  }, [fetchMe]);

  // Pick up admin changes (approval, credit top-ups, bans) when the user returns to the tab.
  useEffect(() => {
    /** Re-fetch the user when the tab becomes visible and a token is stored. */
    const onVisible = () => {
      if (document.visibilityState === 'visible' && localStorage.getItem(ACCESS_KEY)) fetchMe();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [fetchMe]);

  /** Sign in (optionally as a specific role), then load the new user. Clears any previous user first. */
  const login = useCallback(async (username: string, password: string, role?: Role) => {
    setUser(null); // never keep showing a previous account while switching
    await api.login(username, password, role);
    await fetchMe();
  }, [fetchMe]);

  /** Create an account with the given role, then load the new user. Clears any previous user first. */
  const register = useCallback(async (username: string, email: string, password: string, role: Role) => {
    setUser(null);
    await api.register(username, email, password, role);
    await fetchMe();
  }, [fetchMe]);

  /** Sign out locally: remove the stored access and refresh tokens and clear the user. */
  const logout = useCallback(() => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
    setUser(null);
  }, []);

  const value = useMemo<AuthContextValue>(() => ({
    user,
    isAuthenticated: !!user,
    isTeacher: user?.role === 'teacher',
    isApproved: user?.status === 'approved',
    isAdmin: !!user?.is_admin,
    creditsLeft: (type: ResourceType) => user?.credits?.[type]?.remaining ?? 0,
    loading,
    login,
    register,
    logout,
    refreshUser: fetchMe,
  }), [user, loading, login, register, logout, fetchMe]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Access the auth context.
 * @throws If used outside an AuthProvider.
 */
export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}
