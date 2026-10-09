import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Shield, AlertTriangle } from 'lucide-react';
import { bupaApi, type HealthPlanRecord } from '../api/bupa.api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { formatCurrency, formatNumber } from '../utils/format';

// ─── Constants ────────────────────────────────────────

const TIER_ORDER = ['MAJOR_MEDICAL', 'SELECT', 'PREMIER', 'ELITE', 'ULTIMATE'] as const;

const TIER_LABELS: Record<string, string> = {
  MAJOR_MEDICAL: 'Major Medical',
  SELECT: 'Select',
  PREMIER: 'Premier',
  ELITE: 'Elite',
  ULTIMATE: 'Ultimate',
};

const TIER_COLORS: Record<string, string> = {
  MAJOR_MEDICAL: '#64748b',
  SELECT: '#3b82f6',
  PREMIER: '#8b5cf6',
  ELITE: '#f59e0b',
  ULTIMATE: '#10b981',
};

/** Human-readable labels for benefit keys returned by the API. */
const BENEFIT_LABELS: Record<string, string> = {
  hospitalAccommodation: 'Hospital Accommodation',
  operatingRoom: 'Operating Room',
  surgery: 'Surgery',
  intensiveCare: 'Intensive Care',
  specialistConsultations: 'Specialist Consultations',
  pathologyScans: 'Pathology & Scans',
  prescribedDrugs: 'Prescribed Drugs',
  outPatientDayCare: 'Outpatient Day Care',
  outPatientSurgical: 'Outpatient Surgical',
  rehabilitation: 'Rehabilitation',
  cancerTreatment: 'Cancer Treatment',
  transplant: 'Transplant',
  kidneyDialysis: 'Kidney Dialysis',
  maternity: 'Maternity',
  dental: 'Dental',
  optical: 'Optical',
  evacuation: 'Evacuation',
  repatriation: 'Repatriation',
};

/** Ordered keys used for the comparison table rows. */
const BENEFIT_KEYS = Object.keys(BENEFIT_LABELS);

// ─── Types ────────────────────────────────────────────

/**
 * The API returns HealthPlanRecord plus extra DB fields that are not on the
 * typed interface (geographicOptions, deductibleOptions, coInsuranceOption,
 * memberCount). We model them explicitly so we avoid unsafe casts.
 */
interface PlanWithExtras extends HealthPlanRecord {
  memberCount?: number;
  geographicOptions?: Array<{ name: string; code: string }>;
  deductibleOptions?: Array<{ amount: number; currency: string }>;
  coInsuranceOption?: { rate: number; description: string } | null;
}

// ─── Helpers ──────────────────────────────────────────

interface BenefitEntry {
  covered: boolean;
  limit: string;
  subLimit: number | null;
}

function getBenefitEntry(benefits: Record<string, unknown>, key: string): BenefitEntry {
  const raw = benefits[key];
  if (raw && typeof raw === 'object' && raw !== null) {
    const entry = raw as unknown as Record<string, unknown>;
    return {
      covered: Boolean(entry.covered),
      limit: typeof entry.limit === 'string' ? entry.limit : 'N/A',
      subLimit: typeof entry.subLimit === 'number' ? entry.subLimit : null,
    };
  }
  return { covered: false, limit: 'N/A', subLimit: null };
}

function getCellStyle(entry: BenefitEntry): React.CSSProperties {
  if (!entry.covered) {
    return { backgroundColor: 'rgba(239,68,68,0.08)', color: 'var(--color-text-muted)' };
  }
  const lowerLimit = entry.limit.toLowerCase();
  if (lowerLimit.includes('full cover') || lowerLimit === 'unlimited') {
    return { backgroundColor: 'rgba(34,197,94,0.08)' };
  }
  if (entry.subLimit !== null || lowerLimit.includes('usd') || lowerLimit.includes('days') || lowerLimit.includes('visits')) {
    return { backgroundColor: 'rgba(234,179,8,0.06)' };
  }
  return {};
}

function formatMaximum(usd: number | null, hkd: number | null): string {
  if (usd === null) return 'Unlimited';
  const parts = [formatCurrency(usd)];
  if (hkd !== null) {
    parts.push(`HKD ${formatNumber(hkd)}`);
  }
  return parts.join(' / ');
}

function formatGeoOptions(geo: PlanWithExtras['geographicOptions']): string {
  if (Array.isArray(geo) && geo.length > 0) {
    return geo.map((g) => g.name).filter(Boolean).join(', ');
  }
  return 'Worldwide';
}

// ─── Sub-Components ───────────────────────────────────

function PlanCard({ plan }: { readonly plan: PlanWithExtras }) {
  const label = TIER_LABELS[plan.tier] ?? plan.tier;
  const tierColor = TIER_COLORS[plan.tier] ?? '#64748b';
  const geo = formatGeoOptions(plan.geographicOptions);

  return (
    <div className="surface-card" style={{ flex: '1 1 180px', minWidth: 180 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Shield size={18} color={tierColor} />
        <span
          className="status-badge"
          style={{ backgroundColor: tierColor, color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 12 }}
        >
          {label}
        </span>
      </div>
      <h3 style={{ margin: '0 0 4px' }}>{plan.name}</h3>
      <p className="muted-copy" style={{ fontSize: 13, margin: '0 0 6px' }}>
        Annual max: {formatMaximum(plan.annualMaximumUsd, plan.annualMaximumHkd)}
      </p>
      <p className="muted-copy" style={{ fontSize: 12, margin: 0 }}>
        {geo}
      </p>
      {typeof plan.memberCount === 'number' ? (
        <p className="muted-copy" style={{ fontSize: 12, margin: '4px 0 0' }}>
          {formatNumber(plan.memberCount)} members
        </p>
      ) : null}
    </div>
  );
}

function BenefitCell({ entry }: { readonly entry: BenefitEntry }) {
  const style = getCellStyle(entry);
  return (
    <td style={{ ...style, padding: '8px 12px', fontSize: 13, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
      {entry.covered ? entry.limit : 'Not covered'}
    </td>
  );
}

// ─── Main Component ───────────────────────────────────

export default function Plans() {
  const plansQuery = useQuery({
    queryKey: ['bupa-plans'],
    queryFn: () => bupaApi.listPlans(),
  });

  const sortedPlans: PlanWithExtras[] = useMemo(() => {
    const raw = (plansQuery.data ?? []) as PlanWithExtras[];
    const plans = [...raw];
    plans.sort((a, b) => {
      const ai = TIER_ORDER.indexOf(a.tier as typeof TIER_ORDER[number]);
      const bi = TIER_ORDER.indexOf(b.tier as typeof TIER_ORDER[number]);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
    });
    return plans;
  }, [plansQuery.data]);

  if (plansQuery.isLoading) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Bupa Global" title="Health Plans" description="Compare plan tiers and benefits" />
        <p className="muted-copy">Loading plans...</p>
      </div>
    );
  }

  if (plansQuery.isError) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Bupa Global" title="Health Plans" description="Compare plan tiers and benefits" />
        <EmptyState title="Failed to load plans" description="An error occurred while fetching health plan data. Please try again." />
      </div>
    );
  }

  if (sortedPlans.length === 0) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Bupa Global" title="Health Plans" description="Compare plan tiers and benefits" />
        <EmptyState title="No plans available" description="Health plan data has not been seeded yet." />
      </div>
    );
  }

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Bupa Global"
        title="Health Plans"
        description="Compare plan tiers and benefits"
      />

      {/* ── Plan cards ────────────────────────── */}
      <div className="plan-card-grid">
        {sortedPlans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </div>

      {/* ── Benefits comparison table ─────────── */}
      <section className="surface-card">
        <div className="section-header">
          <h2>Benefits Comparison</h2>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '10px 12px', fontSize: 13, fontWeight: 600, borderBottom: '2px solid var(--color-border, rgba(148,163,184,0.2))' }}>
                  Benefit
                </th>
                {sortedPlans.map((plan) => (
                  <th
                    key={plan.id}
                    style={{
                      textAlign: 'left',
                      padding: '10px 12px',
                      fontSize: 13,
                      fontWeight: 600,
                      borderBottom: `2px solid ${TIER_COLORS[plan.tier] ?? '#64748b'}`,
                      color: TIER_COLORS[plan.tier] ?? 'inherit',
                      minWidth: 140,
                    }}
                  >
                    {TIER_LABELS[plan.tier] ?? plan.tier}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {BENEFIT_KEYS.map((key) => (
                <tr key={key}>
                  <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 500, borderBottom: '1px solid var(--color-border, rgba(148,163,184,0.15))' }}>
                    {BENEFIT_LABELS[key]}
                  </td>
                  {sortedPlans.map((plan) => {
                    const entry = getBenefitEntry(plan.benefits as unknown as Record<string, unknown>, key);
                    return <BenefitCell key={plan.id} entry={entry} />;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Deductible options ────────────────── */}
      <section className="surface-card">
        <div className="section-header">
          <h2>Deductible Options</h2>
        </div>
        <div className="detail-grid" style={{ gap: 24 }}>
          {sortedPlans.map((plan) => {
            const deductibles = plan.deductibleOptions ?? [];
            return (
              <div key={plan.id}>
                <h4 style={{ margin: '0 0 8px', color: TIER_COLORS[plan.tier] }}>{TIER_LABELS[plan.tier] ?? plan.tier}</h4>
                {deductibles.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                    {deductibles.map((d) => (
                      <li key={`${d.amount}-${d.currency}`}>
                        {d.currency} {formatNumber(d.amount)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-copy" style={{ fontSize: 13, margin: 0 }}>No deductible (zero deductible plan)</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Co-insurance ──────────────────────── */}
      <section className="surface-card">
        <div className="section-header">
          <h2>Co-Insurance</h2>
        </div>
        <div className="detail-grid" style={{ gap: 24 }}>
          {sortedPlans.map((plan) => {
            const coIns = plan.coInsuranceOption ?? null;
            return (
              <div key={plan.id}>
                <h4 style={{ margin: '0 0 8px', color: TIER_COLORS[plan.tier] }}>{TIER_LABELS[plan.tier] ?? plan.tier}</h4>
                {coIns ? (
                  <p style={{ fontSize: 13, margin: 0 }}>
                    {(coIns.rate * 100).toFixed(0)}% &mdash; {coIns.description}
                  </p>
                ) : (
                  <p className="muted-copy" style={{ fontSize: 13, margin: 0 }}>Not applicable</p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Exclusions ────────────────────────── */}
      <section className="surface-card">
        <div className="section-header">
          <h2>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <AlertTriangle size={18} />
              Plan Exclusions
            </span>
          </h2>
        </div>
        <div className="detail-grid" style={{ gap: 24 }}>
          {sortedPlans.map((plan) => {
            const exclusions = Array.isArray(plan.exclusions) ? plan.exclusions : [];
            return (
              <div key={plan.id}>
                <h4 style={{ margin: '0 0 8px', color: TIER_COLORS[plan.tier] }}>{TIER_LABELS[plan.tier] ?? plan.tier}</h4>
                {exclusions.length > 0 ? (
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                    {exclusions.map((ex) => (
                      <li key={typeof ex === 'string' ? ex : String(ex)} style={{ marginBottom: 4 }}>
                        {String(ex)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted-copy" style={{ fontSize: 13, margin: 0 }}>No specific exclusions listed</p>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
