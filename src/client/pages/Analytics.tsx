import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { analyticsApi } from '../api/analytics.api';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { formatDurationMs, formatNumber, formatPercent } from '../utils/format';

function todayRange() {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  return {
    dateFrom: start.toISOString(),
    dateTo: end.toISOString(),
  };
}

export default function Analytics() {
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const range = todayRange();

  const overviewQuery = useQuery({ queryKey: ['analytics-overview'], queryFn: () => analyticsApi.overview(range) });
  const teamsQuery = useQuery({ queryKey: ['analytics-teams'], queryFn: () => analyticsApi.teams() });
  const codingQuery = useQuery({ queryKey: ['analytics-coding'], queryFn: () => analyticsApi.coding(range) });
  const slaQuery = useQuery({ queryKey: ['analytics-sla'], queryFn: () => analyticsApi.sla() });
  const volumeQuery = useQuery({ queryKey: ['analytics-volume', groupBy], queryFn: () => analyticsApi.volume({ ...range, groupBy }) });
  const handlersQuery = useQuery({ queryKey: ['analytics-handlers'], queryFn: () => analyticsApi.handlers() });

  const overview = overviewQuery.data;
  const teams = teamsQuery.data;
  const coding = codingQuery.data;
  const sla = slaQuery.data;
  const volume = volumeQuery.data;
  const handlers = handlersQuery.data;

  const pieData = useMemo(
    () =>
      Object.entries(coding?.codesByType ?? {}).map(([name, value]) => ({
        name,
        value,
      })),
    [coding],
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Operational intelligence"
        title="Analytics and reporting"
        description="A combined view of throughput, coding quality, client SLA risk, and team-level execution performance."
        actions={
          <select className="input" value={groupBy} onChange={(event) => setGroupBy(event.target.value as 'day' | 'week' | 'month')}>
            <option value="day">Daily volume</option>
            <option value="week">Weekly volume</option>
            <option value="month">Monthly volume</option>
          </select>
        }
      />

      {overview ? (
        <div className="stats-grid">
          <MetricCard label="Claims processed" value={formatNumber(overview.totalClaims)} />
          <MetricCard label="STP rate" value={formatPercent(overview.stpRate, 2)} accent="green" />
          <MetricCard label="Escalations" value={formatNumber(overview.escalations)} accent="amber" />
          <MetricCard label="Average processing" value={formatDurationMs(overview.avgProcessingTimeMs)} accent="indigo" />
        </div>
      ) : null}

      <div className="analytics-grid">
        <section className="surface-card">
          <div className="section-header">
            <h2>Volume trend</h2>
          </div>
          {volume && volume.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={volume}>
                <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                <XAxis dataKey="period" stroke="var(--color-text-muted)" />
                <YAxis stroke="var(--color-text-muted)" />
                <Tooltip />
                <Bar dataKey="count" fill="var(--color-accent-blue)" radius={[10, 10, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No volume data" description="Claims must exist inside the selected date range before trend data can render." />
          )}
        </section>

        <section className="surface-card">
          <div className="section-header">
            <h2>Coding mix</h2>
          </div>
          {pieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie data={pieData} dataKey="value" nameKey="name" outerRadius={95} fill="var(--color-accent-indigo)" />
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState title="No coding analytics" description="Coding data appears after processed claims create coding rows in the database." />
          )}
        </section>

        <section className="surface-card">
          <div className="section-header">
            <h2>Top codes</h2>
          </div>
          <div className="list-stack">
            {(coding?.topCodes ?? []).map((code) => (
              <div key={code.code} className="list-item">
                <div>
                  <strong>{code.code}</strong>
                  <p className="muted-copy">{code.description}</p>
                </div>
                <span className="list-meta">{formatNumber(code.count)}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-card">
          <div className="section-header">
            <h2>Team performance</h2>
          </div>
          <div className="list-stack">
            {(teams ?? []).map((team) => (
              <div key={team.teamId} className="list-item">
                <div>
                  <strong>{team.teamName}</strong>
                  <p className="muted-copy">{team.activeClaims} active · {team.completedClaims} completed</p>
                </div>
                <span className="list-meta">{team.avgConfidence.toFixed(1)} avg conf.</span>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-card">
          <div className="section-header">
            <h2>Client SLA risk</h2>
          </div>
          <div className="list-stack">
            {(sla ?? []).map((client) => (
              <div key={client.clientId} className="list-item">
                <div>
                  <strong>{client.clientName}</strong>
                  <p className="muted-copy">{client.completedClaims}/{client.totalClaims} completed</p>
                </div>
                <span className="list-meta">{client.breachCount} breaches</span>
              </div>
            ))}
          </div>
        </section>

        <section className="surface-card">
          <div className="section-header">
            <h2>Handler quality signals</h2>
          </div>
          <div className="list-stack">
            {(handlers ?? []).map((handler) => (
              <div key={handler.userId} className="list-item">
                <div>
                  <strong>{handler.userName}</strong>
                  <p className="muted-copy">{handler.activeClaims} active · {handler.completedClaims} completed</p>
                </div>
                <span className="list-meta">{handler.correctionsMade} corrections</span>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
