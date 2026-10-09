import { Suspense, lazy, useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layouts/AppLayout';
import { PublicLayout } from './layouts/PublicLayout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { FullPageLoader } from './components/LoadingState';
import { useAuthStore } from './stores/authStore';
import { useUiStore } from './stores/uiStore';

const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Claims = lazy(() => import('./pages/Claims'));
const ClaimDetail = lazy(() => import('./pages/ClaimDetail'));
const IcdExtractor = lazy(() => import('./pages/IcdExtractor'));
const Denials = lazy(() => import('./pages/Denials'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Teams = lazy(() => import('./pages/Teams'));
const Users = lazy(() => import('./pages/Users'));
const Clients = lazy(() => import('./pages/Clients'));
const Connectors = lazy(() => import('./pages/Connectors'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Settings = lazy(() => import('./pages/Settings'));
const Members = lazy(() => import('./pages/Members'));
const Providers = lazy(() => import('./pages/Providers'));
const Plans = lazy(() => import('./pages/Plans'));
const BupaAnalytics = lazy(() => import('./pages/BupaAnalytics'));

function AppBootstrap() {
  const { isAuthenticated, accessToken, user, fetchMe, clearAuth } = useAuthStore();
  const theme = useUiStore((state) => state.theme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!isAuthenticated || !accessToken || user) {
      return;
    }

    fetchMe().catch(() => {
      clearAuth();
    });
  }, [accessToken, clearAuth, fetchMe, isAuthenticated, user]);

  return null;
}

export default function App() {
  return (
    <AppErrorBoundary>
      <AppBootstrap />
      <Suspense fallback={<FullPageLoader label="Loading workspace" />}>
        <Routes>
          <Route element={<PublicLayout />}>
            <Route path="/" element={<Landing />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
          </Route>

          <Route
            path="/app"
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/app/dashboard" replace />} />
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="claims" element={<Claims />} />
            <Route path="claims/:id" element={<ClaimDetail />} />
            <Route path="icd" element={<IcdExtractor />} />
            <Route path="denials" element={<Denials />} />
            <Route
              path="analytics"
              element={
                <ProtectedRoute permission="analytics:read">
                  <Analytics />
                </ProtectedRoute>
              }
            />
            <Route
              path="teams"
              element={
                <ProtectedRoute permission="teams:read">
                  <Teams />
                </ProtectedRoute>
              }
            />
            <Route
              path="users"
              element={
                <ProtectedRoute permission="users:read">
                  <Users />
                </ProtectedRoute>
              }
            />
            <Route
              path="clients"
              element={
                <ProtectedRoute permission="clients:read">
                  <Clients />
                </ProtectedRoute>
              }
            />
            <Route
              path="connectors"
              element={
                <ProtectedRoute permission="connectors:manage">
                  <Connectors />
                </ProtectedRoute>
              }
            />
            <Route
              path="audit"
              element={
                <ProtectedRoute permission="audit:read">
                  <AuditLog />
                </ProtectedRoute>
              }
            />
            <Route path="members" element={<Members />} />
            <Route path="providers" element={<Providers />} />
            <Route path="plans" element={<Plans />} />
            <Route path="bupa-analytics" element={<BupaAnalytics />} />
            <Route path="notifications" element={<Notifications />} />
            <Route path="settings" element={<Settings />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppErrorBoundary>
  );
}
