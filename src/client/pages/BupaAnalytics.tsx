import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BarChart3, Users, XCircle, Building2, Activity } from 'lucide-react';
import { bupaAnalyticsApi } from '../api/bupaAnalytics.api';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { PageHeader } from '../components/PageHeader';
import { formatCurrency, formatDurationMs, formatNumber, formatPercent } from '../utils/format';

// ─── Helpers ──────────────────────────────────────────

function defaultDateRange(): { dateFrom: string; dateTo: string } {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - 30);
  return {
    dateFrom: start.toISOString().slice(0, 10),
    dateTo: end.toISOString().slice(0, 10),
  };
}

function stpAccentColor(rate: number): string {
  if (rate >= 65) return 'green';
  if (rate >= 40) return 'amber';
  return 'red';
}

function formatCurrencyWithCode(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${formatNumber(value)}`;
  }
}

const TIER_LABELS: Record<string, string> = {
  MAJOR_MEDICAL: 'Major Medical',
  SELECT: 'Select',
  PREMIER: 'Premier',
  ELITE: 'Elite',
  ULTIMATE: 'Ultimate',
};

function tierLabel(tier: string): string {
  return TIER_LABELS[tier] ?? tier;
}

// ─── Sub-Components ───────────────────────────────────

function DateRangeFilter({
  dateFrom,
  dateTo,
  onChange,
}: {
  readonly dateFrom: string;
  readonly dateTo: string;
  readonly onChange: (from: string, to: string) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <input
        type="date"
        className="input"
        value={dateFrom}
        onChange={(e) => onChange(e.target.value, dateTo)}
        aria-label="Date from"
      />
      <span className="muted-copy">to</span>
      <input
        type="date"
        className="input"
        value={dateTo}
        onChange={(e) => onChange(dateFrom, e.target.value)}
        aria-label="Date to"
      />
    </div>
  );
}

function SimpleBar({ value, maxValue, color }: { readonly value: number; readonly maxValue: number; readonly color: string }) {
  const width = maxValue > 0 ? Math.max(2, (value / maxValue) * 100) : 0;
  return (
    <div style={{ width: '100%', backgroundColor: 'rgba(148,163,184,0.1)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
      <div style={{ width: `${width}%`, backgroundColor: color, height: '100%', borderRadius: 4, transition: 'width 0.3s' }} />
    </div>
  );
}

// ─── Main Component ───────────────────────────────────

export default function BupaAnalytics() {
  const defaults = defaultDateRange();
  const [dateFrom, setDateFrom] = useState(defaults.dateFrom);
  const [dateTo, setDateTo] = useState(defaults.dateTo);

  const dashboardQuery = useQuery({
    queryKey: ['bupa-analytics-dashboard', dateFrom, dateTo],
    queryFn: () => bupaAnalyticsApi.getDashboard({ dateFrom, dateTo }),
  });

  const dashboard = dashboardQuery.data;
  const stp = dashboard?.stpMetrics ?? null;
  const plans = dashboard?.planUtilisation ?? [];
  const providers = dashboard?.providerAnalysis ?? [];
  const denials = dashboard?.denialAnalysis ?? null;
  const members = dashboard?.memberMetrics ?? null;

  const maxClaimCount = Math.max(...plans.map((p) => p.claimCount), 1);

  function handleDateChange(from: string, to: string) {
    setDateFrom(from);
    setDateTo(to);
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Bupa Global"
        title="Claims Analytics"
        description="STP metrics and operational intelligence"
        actions={<DateRangeFilter dateFrom={dateFrom} dateTo={dateTo} onChange={handleDateChange} />}
      />

      {/* ── Metric cards ──────────────────────── */}
      {stp ? (
        <div className="stats-grid">
          <MetricCard
            label="Total Claims"
            value={formatNumber(stp.totalClaims)}
            icon={<BarChart3 size={18} />}
          />
          <MetricCard
            label="STP Rate"
            value={formatPercent(stp.stpRate, 1)}
            accent={stpAccentColor(stp.stpRate)}
            icon={<Activity size={18} />}
          />
          <MetricCard
            label="Auto-Approved"
            value={formatNumber(stp.autoApproved)}
            accent="green"
          />
          <MetricCard
            label="Auto-Denied"
            value={formatNumber(stp.autoDenied)}
            accent="red"
          />
          <MetricCard
            label="Human Reviewed"
            value={formatNumber(stp.humanReviewed)}
            accent="amber"
          />
          <MetricCard
            label="Avg Processing Time"
            value={formatDurationMs(stp.avgProcessingTimeMs)}
            accent="indigo"
          />
        </div>
      ) : dashboardQuery.isLoading ? (
        <p className="muted-copy">Loading metrics...</p>
      ) : null}

      {/* ── Plan Utilisation ───────────────────── */}
      <section className="surface-card">
        <div className="section-header">
          <h2>Plan Utilisation</h2>
        </div>
        {plans.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Plan Tier', 'Members', 'Claims', 'Total Claimed', 'Total Paid', 'Avg Claim', 'Currency', ''].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 13, fontWeight: 600, borderBottom: '2px solid var(--color-border, rgba(148,163,184,0.2))' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plans.map((plan) => (
                  <tr key={plan.planTier}>
                    <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 500, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      {tierLabel(plan.planTier)}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      {formatNumber(plan.memberCount)}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      {formatNumber(plan.claimCount)}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      {formatCurrencyWithCode(plan.totalClaimed, plan.currency)}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      {formatCurrencyWithCode(plan.totalPaid, plan.currency)}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      {formatCurrencyWithCode(plan.avgClaimAmount, plan.currency)}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      {plan.currency}
                    </td>
                    <td style={{ padding: '8px 12px', width: 120, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      <SimpleBar value={plan.claimCount} maxValue={maxClaimCount} color="var(--color-accent-blue, #3b82f6)" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No plan utilisation data" description="Claims data is required to generate plan utilisation metrics." />
        )}
      </section>

      {/* ── Provider Analysis ─────────────────── */}
      <section className="surface-card">
        <div className="section-header">
          <h2>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Building2 size={18} />
              Top Providers
            </span>
          </h2>
        </div>
        {providers.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  {['Provider', 'Country', 'Network', 'Claims', 'Total Amount', 'Avg Amount'].map((h) => (
                    <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 13, fontWeight: 600, borderBottom: '2px solid var(--color-border, rgba(148,163,184,0.2))' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {providers.slice(0, 10).map((prov) => (
                  <tr key={`${prov.providerName}-${prov.country}`}>
                    <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 500, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      {prov.providerName}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      {prov.country}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      <span
                        className="status-badge"
                        style={{
                          backgroundColor: prov.networkStatus === 'IN_NETWORK' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
                          color: prov.networkStatus === 'IN_NETWORK' ? '#16a34a' : '#dc2626',
                          fontSize: 11,
                          padding: '2px 8px',
                          borderRadius: 12,
                        }}
                      >
                        {prov.networkStatus === 'IN_NETWORK' ? 'In-Network' : 'Out-of-Network'}
                      </span>
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      {formatNumber(prov.claimCount)}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      {formatCurrency(prov.totalAmount)}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                      {formatCurrency(prov.avgAmount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState title="No provider data" description="Provider analysis appears after claims have been processed." />
        )}
      </section>

      {/* ── Denial Analysis ───────────────────── */}
      <section className="surface-card">
        <div className="section-header">
          <h2>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <XCircle size={18} />
              Denial Analysis
            </span>
          </h2>
        </div>
        {denials ? (
          <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
              <MetricCard
                label="Total Denied"
                value={formatNumber(denials.totalDenied)}
                accent="red"
              />
              <MetricCard
                label="Denial Rate"
                value={formatPercent(denials.denialRate, 1)}
                accent={denials.denialRate > 30 ? 'red' : 'amber'}
              />
            </div>

            {denials.denialsByReason.length > 0 ? (
              <>
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>Denial Reasons</h3>
                <div style={{ overflowX: 'auto', marginBottom: 20 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['Reason', 'Count', 'Percentage'].map((h) => (
                          <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 13, fontWeight: 600, borderBottom: '2px solid var(--color-border, rgba(148,163,184,0.2))' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {denials.denialsByReason.map((reason) => (
                        <tr key={reason.reason}>
                          <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                            {reason.reason}
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                            {formatNumber(reason.count)}
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                            {formatPercent(reason.percentage, 1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}

            {denials.denialsByPlan.length > 0 ? (
              <>
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>Denials by Plan Tier</h3>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr>
                        {['Plan Tier', 'Denied Claims', 'Denial Rate'].map((h) => (
                          <th key={h} style={{ textAlign: 'left', padding: '10px 12px', fontSize: 13, fontWeight: 600, borderBottom: '2px solid var(--color-border, rgba(148,163,184,0.2))' }}>
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {denials.denialsByPlan.map((entry) => (
                        <tr key={entry.planTier}>
                          <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 500, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                            {tierLabel(entry.planTier)}
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                            {formatNumber(entry.count)}
                          </td>
                          <td style={{ padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                            {formatPercent(entry.rate, 1)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : null}
          </>
        ) : dashboardQuery.isLoading ? (
          <p className="muted-copy">Loading denial data...</p>
        ) : (
          <EmptyState title="No denial data" description="Denial analysis appears after claims have been processed." />
        )}
      </section>

      {/* ── Member Metrics ────────────────────── */}
      <section className="surface-card">
        <div className="section-header">
          <h2>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Users size={18} />
              Member Metrics
            </span>
          </h2>
        </div>
        {members ? (
          <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
              <MetricCard
                label="Total Members"
                value={formatNumber(members.totalMembers)}
                icon={<Users size={18} />}
              />
              <MetricCard
                label="Active Members"
                value={formatNumber(members.activeMembers)}
                accent="green"
              />
              <MetricCard
                label="Claims per Member"
                value={members.claimsPerMember.toFixed(2)}
                accent="indigo"
              />
            </div>

            {members.membersByPlan.length > 0 ? (
              <>
                <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 12px' }}>Members by Plan Tier</h3>
                <div className="list-stack">
                  {members.membersByPlan.map((entry) => {
                    const maxCount = Math.max(...members.membersByPlan.map((e) => e.count), 1);
                    return (
                      <div key={entry.planTier} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 0' }}>
                        <span style={{ fontSize: 13, fontWeight: 500, minWidth: 120 }}>{tierLabel(entry.planTier)}</span>
                        <div style={{ flex: 1 }}>
                          <SimpleBar value={entry.count} maxValue={maxCount} color="var(--color-accent-indigo, #8b5cf6)" />
                        </div>
                        <span className="muted-copy" style={{ fontSize: 13, minWidth: 40, textAlign: 'right' }}>
                          {formatNumber(entry.count)}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </>
            ) : null}
          </>
        ) : dashboardQuery.isLoading ? (
          <p className="muted-copy">Loading member data...</p>
        ) : (
          <EmptyState title="No member data" description="Member metrics appear after members have been enrolled." />
        )}
      </section>
    </div>
  );
}
