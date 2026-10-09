import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  Bell,
  Boxes,
  Building2,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FileHeart,
  FileStack,
  Heart,
  LayoutDashboard,
  LogOut,
  MailCheck,
  Menu,
  Moon,
  Settings,
  Shield,
  Stethoscope,
  Sun,
  Users,
  UserSquare2,
  X,
} from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';
import { notificationsApi } from '../api/notifications.api';

const sections = [
  {
    label: 'Operations',
    items: [
      { to: '/app/dashboard', label: 'Dashboard', icon: LayoutDashboard },
      { to: '/app/claims', label: 'Claims', icon: FileStack },
      { to: '/app/icd', label: 'ICD Extractor', icon: FileHeart },
      { to: '/app/denials', label: 'Denials', icon: Shield },
    ],
  },
  {
    label: 'Bupa Global',
    items: [
      { to: '/app/members', label: 'Members', icon: Heart },
      { to: '/app/providers', label: 'Providers', icon: Stethoscope },
      { to: '/app/plans', label: 'Health Plans', icon: ClipboardList },
      { to: '/app/bupa-analytics', label: 'Bupa Analytics', icon: Activity },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { to: '/app/analytics', label: 'Analytics', icon: Boxes, requiredPermission: 'analytics:read' },
      { to: '/app/notifications', label: 'Notifications', icon: Bell },
      { to: '/app/audit', label: 'Audit Log', icon: Shield, requiredPermission: 'audit:read' },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/app/teams', label: 'Teams', icon: Users, requiredPermission: 'teams:read' },
      { to: '/app/users', label: 'Users', icon: UserSquare2, requiredPermission: 'users:read' },
      { to: '/app/clients', label: 'Clients', icon: Building2, requiredPermission: 'clients:read' },
      { to: '/app/connectors', label: 'Connectors', icon: MailCheck, requiredPermission: 'connectors:manage' },
    ],
  },
];

export function AppLayout() {
  const { user, logout } = useAuthStore();
  const { sidebarCollapsed, toggleSidebar, theme, toggleTheme, sidebarWidth, setSidebarWidth } = useUiStore();
  const [isResizing, setIsResizing] = useState(false);

  const unreadQuery = useQuery({
    queryKey: ['notifications', 'unread-count'],
    queryFn: () => notificationsApi.getUnreadCount(),
    enabled: !!user,
    refetchInterval: 30000,
  });

  const unreadCount = unreadQuery.data?.count ?? 0;

  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth <= 1024 && !sidebarCollapsed) {
        toggleSidebar();
      }
    };
    
    // Initial check
    if (window.innerWidth <= 1024 && !sidebarCollapsed) {
       toggleSidebar();
    }
    
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const hasPermission = (required?: string) => {
    if (!required) return true;
    if (!user) return false;
    if (user.permissions.includes('*')) return true;
    return user.permissions.includes(required);
  };

  const startResizing = (e: React.MouseEvent) => {
    e.preventDefault();
    setIsResizing(true);
  };

  const stopResizing = () => {
    setIsResizing(false);
  };

  const resize = (e: MouseEvent) => {
    if (isResizing) {
      const newWidth = e.clientX;
      if (newWidth >= 240 && newWidth <= 480) {
        setSidebarWidth(newWidth);
      }
    }
  };

  useEffect(() => {
    if (isResizing) {
      window.addEventListener('mousemove', resize);
      window.addEventListener('mouseup', stopResizing);
    } else {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    }
    return () => {
      window.removeEventListener('mousemove', resize);
      window.removeEventListener('mouseup', stopResizing);
    };
  }, [isResizing]);

  return (
    <div
      className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''} ${isResizing ? 'resizing' : ''}`}
      style={{ '--sidebar-width': `${sidebarWidth}px` } as any}
    >
      <aside className="app-sidebar glass">
        <div className="brand-lockup">
          <div className="brand-group">
            <div className="brand-mark">CI</div>
            {!sidebarCollapsed && (
              <div className="brand-info">
                <div className="brand-title">ClaimsIntell</div>
                <div className="brand-subtitle">Operating System</div>
              </div>
            )}
          </div>
          <button className="sidebar-toggle-btn" onClick={toggleSidebar}>
            {sidebarCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        <nav className="sidebar-nav">
          {sections.map((section) => {
            const visibleItems = section.items.filter((item) => hasPermission(item.requiredPermission));
            if (visibleItems.length === 0) return null;
            
            return (
              <div key={section.label} className="nav-section">
                {!sidebarCollapsed ? <div className="nav-section-label">{section.label}</div> : null}
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink key={item.to} to={item.to} className={({ isActive }: { isActive: boolean }) => `nav-link ${isActive ? 'active' : ''}`}>
                      <Icon size={18} />
                      {!sidebarCollapsed ? <span>{item.label}</span> : null}
                      {item.to === '/app/notifications' && unreadCount > 0 && (
                        <span className="count-badge">{unreadCount}</span>
                      )}
                    </NavLink>
                  );
                })}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button className="nav-link subtle" onClick={toggleTheme}>
            {theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}
            {!sidebarCollapsed ? <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span> : null}
          </button>
          <NavLink to="/app/settings" className="nav-link subtle">
            <Settings size={18} />
            {!sidebarCollapsed ? <span>Settings</span> : null}
          </NavLink>
          <button className="nav-link subtle" onClick={logout}>
            <LogOut size={18} />
            {!sidebarCollapsed ? <span>Sign out</span> : null}
          </button>
        </div>

        {!sidebarCollapsed && <div className="sidebar-resize-handle" onMouseDown={startResizing} />}
      </aside>

      <div className="app-main">
        <header className="app-header">
          <div className="mobile-nav-toggle">
            <button className="btn-icon" onClick={toggleSidebar}>
              <Menu size={20} />
            </button>
          </div>
          <div>
            <div className="eyebrow">Operational workspace</div>
            <div className="header-user-row">
              <strong>{user?.orgName ?? 'Organisation'}</strong>
              <span className="header-dot" />
              <span>{user?.name}</span>
            </div>
          </div>
          <div className="header-actions">
            <NavLink to="/app/notifications" className="btn-icon header-bell-btn" title="Notifications">
              <Bell size={18} />
              {unreadCount > 0 && <span className="bell-badge" />}
            </NavLink>
            <div className="user-chip">
              <span className="user-chip-avatar">{user?.name?.slice(0, 1) ?? 'U'}</span>
              {!sidebarCollapsed ? <span>{user?.email}</span> : null}
            </div>
          </div>
        </header>

        <main className="app-content page-enter">
          <Outlet />
        </main>
      </div>
      {!sidebarCollapsed && (
        <div className="mobile-overlay" onClick={toggleSidebar}></div>
      )}
    </div>
  );
}
