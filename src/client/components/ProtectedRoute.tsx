import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';

interface ProtectedRouteProps {
  permission?: string;
  children?: ReactNode;
}

export function ProtectedRoute({ permission, children }: ProtectedRouteProps) {
  const location = useLocation();
  const { isAuthenticated, user } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (permission && user && !user.permissions.includes('*') && !user.permissions.includes(permission)) {
    return (
      <div className="centered-screen">
        <div className="surface-card auth-card">
          <div className="eyebrow">Restricted</div>
          <h1>Permission required</h1>
          <p className="muted-copy">
            Your role does not include <code>{permission}</code>. Use another account or update the role mapping.
          </p>
        </div>
      </div>
    );
  }

  return <>{children ?? <Outlet />}</>;
}
