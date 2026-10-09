import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { notificationsApi } from '../api/notifications.api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { formatRelative } from '../utils/format';

export default function Notifications() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['notifications'], queryFn: () => notificationsApi.list({ limit: 50 }) });

  const markAllMutation = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      toast.success('All notifications marked as read');
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });

  const notifications = query.data?.notifications ?? query.data?.data ?? [];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Inbox"
        title="Notifications centre"
        description="Track events from claim workflow, escalations, and operational automations."
        actions={<button className="btn btn-secondary" onClick={() => markAllMutation.mutate()}>Mark all read</button>}
      />
      <section className="surface-card">
        {notifications.length > 0 ? (
          <div className="list-stack">
            {notifications.map((notification) => (
              <div key={notification.id} className={`list-item ${notification.readAt ? '' : 'unread'}`}>
                <div style={{ flex: 1 }}>
                  <strong>{notification.title}</strong>
                  <p className="muted-copy">{notification.body}</p>
                </div>
                <div className="list-actions no-shrink flex-center gap-sm">
                  <span className="list-meta">{formatRelative(notification.createdAt)}</span>
                  {!notification.readAt && (
                    <button
                      className="btn compact"
                      onClick={() => markReadMutation.mutate(notification.id)}
                      title="Mark as read"
                    >
                      Done
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No notifications" description="New claim and system events will appear here for the signed-in user." />
        )}
      </section>
    </div>
  );
}
