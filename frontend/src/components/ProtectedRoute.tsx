import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';

/**
 * Signed-in users only. Waitlisted / rejected / banned accounts are sent to /waitlist,
 * and `adminOnly` routes send non-admins home. The server enforces all of this too.
 */
export default function ProtectedRoute({ isAuthed, adminOnly = false, children }: {
  isAuthed: boolean;
  adminOnly?: boolean;
  children: JSX.Element;
}) {
  const location = useLocation();
  const { isApproved, isAdmin } = useAuth();
  if (!isAuthed) {
    const redirectTo = encodeURIComponent(location.pathname === '/admin' ? '/admin' : '/input');
    return <Navigate to={`/login?redirect=${redirectTo}`} replace />;
  }
  if (!isApproved) return <Navigate to="/waitlist" replace />;
  if (adminOnly && !isAdmin) return <Navigate to="/input" replace />;
  return children;
}
