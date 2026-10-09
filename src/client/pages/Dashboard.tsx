import { useQuery } from '@tanstack/react-query';
import { Activity, Clock3, Layers3, ShieldCheck } from 'lucide-react';
import { analyticsApi } from '../api/analytics.api';
import { notificationsApi } from '../api/notifications.api';
import { processingApi } from '../api/processing.api';
import { EmptyState } from '../components/EmptyState';
import { SkeletonGrid } from '../components/LoadingState';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { formatDurationMs, formatNumber, formatRelative, formatPercent } from '../utils/format';
import { titleizeStatus } from '../utils/status';

export default function Dashboard() {
  const overviewQuery = useQuery({ queryKey: ['overview'], queryFn: () => analyticsApi.overview() });
  const pipelineQuery = useQuery({ queryKey: ['pipeline'], queryFn: () => analyticsApi.pipeline() });
  const queueQuery = useQuery({ queryKey: ['queue'], queryFn: () => processingApi.queueStats() });
  const notificationsQuery = useQuery({
    queryKey: ['notifications', 'dashboard'],
    queryFn: () => notificationsApi.list({ limit: 5, unreadOnly: false }),
  });

  const loading = overviewQuery.isLoading || pipelineQuery.isLoading;
  const overview = overviewQuery.data;
  const pipeline = pipelineQuery.data ?? {};
  const queueRaw = queueQuery.data;
  const queueTotals = queueRaw
    ? {
        waiting: (queueRaw.ingestion?.waiting ?? 0) + (queueRaw.processing?.waiting ?? 0) + (queueRaw.correspondence?.waiting ?? 0) + (queueRaw.notification?.waiting ?? 0),
        active: (queueRaw.ingestion?.active ?? 0) + (queueRaw.processing?.active ?? 0) + (queueRaw.correspondence?.active ?? 0) + (queueRaw.notification?.active ?? 0),
        completed: (queueRaw.ingestion?.completed ?? 0) + (queueRaw.processing?.completed ?? 0) + (queueRaw.correspondence?.completed ?? 0) + (queueRaw.notification?.completed ?? 0),
        failed: (queueRaw.ingestion?.failed ?? 0) + (queueRaw.processing?.failed ?? 0) + (queueRaw.correspondence?.failed ?? 0) + (queueRaw.notification?.failed ?? 0),
      }
    : null;
  const notifications = notificationsQuery.data?.notifications ?? notificationsQuery.data?.data ?? [];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Executive snapshot"
        title="Revenue cycle dashboard"
        description="A live view of queue pressure, automation throughput, in-review volume, and immediate operational signals."
      />

      {loading && !overviewQuery.isError ? (
        <SkeletonGrid />
      ) : overviewQuery.isError || !overview ? (
        <></>
      ) : (
        <div className="stats-grid ">
          <MetricCard label="Total claims" value={formatNumber(overview.totalClaims)} delta="Across the selected operational window" icon={<Layers3 size={18} />} />
          <MetricCard label="Straight-through rate" value={formatPercent(overview.stpRate, 2)} delta={`${formatNumber(overview.autoProcessed)} auto-completed claims`} accent="green" icon={<ShieldCheck size={18} />} />
          <MetricCard label="In review" value={formatNumber(overview.inReview)} delta={`${formatNumber(overview.escalations)} escalations raised`} accent="amber" icon={<Activity size={18} />} />
          <MetricCard label="Average processing time" value={formatDurationMs(overview.avgProcessingTimeMs)} delta="Completed claims only" accent="indigo" icon={<Clock3 size={18} />} />
        </div>
      )}

      <div className="dashboard-grid">
        <section className="surface-card">
          <div className="section-header">
            <h2>Pipeline distribution</h2>
          </div>
          <div className="status-grid">
            {pipelineQuery.isError ? (
              <EmptyState title="Distribution Unavailable" description="Pipeline metrics are restricted or unavailable." />
            ) : Object.keys(pipeline).length === 0 ? (
              <EmptyState title="No claim activity" description="Pipeline counts will appear once claims enter the organisation workspace." />
            ) : (
              Object.entries(pipeline).map(([status, count]) => (
                <div key={status} className="status-panel">
                  <strong>{formatNumber(count as number)}</strong>
                  <span>{titleizeStatus(status)}</span>
                </div>
              ))
            )}
          </div>
        </section>

        <section className="surface-card">
          <div className="section-header">
            <h2>Queue health</h2>
          </div>
          <div className="mini-metrics">
            <div>
              <span>Waiting : </span>
              <strong>{formatNumber(queueTotals?.waiting ?? 0)}</strong>
            </div>
            <div>
              <span>Active : </span>
              <strong>{formatNumber(queueTotals?.active ?? 0)}</strong>
            </div>
            <div>
              <span>Completed : </span>
              <strong>{formatNumber(queueTotals?.completed ?? 0)}</strong>
            </div>
            <div>
              <span>Failed : </span>
              <strong>{formatNumber(queueTotals?.failed ?? 0)}</strong>
            </div>
          </div>
        </section>

        <section className="surface-card">
          <div className="section-header">
            <h2>Recent notifications</h2>
          </div>
          {notifications.length === 0 ? (
            <EmptyState title="Inbox is clear" description="Notification events will appear here when the backend produces alerts for the current user." />
          ) : (
            <div className="list-stack">
              {notifications.map((notification) => (
                <div key={notification.id} className={`list-item ${notification.readAt ? '' : 'unread'}`}>
                  <div style={{ flex: 1 }}>
                    <strong>{notification.title}</strong>
                    <p className="muted-copy">{notification.body}</p>
                  </div>
                  <span className="list-meta">{formatRelative(notification.createdAt)}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
