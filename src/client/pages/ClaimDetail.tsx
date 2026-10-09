import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useParams } from 'react-router-dom';
import { claimsApi } from '../api/claims.api';
import { bupaApi } from '../api/bupa.api';
import { processingApi } from '../api/processing.api';
import { UserRecord, usersApi } from '../api/users.api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { AuditTrailList } from '../components/AuditTrail';
import { formatConfidence, formatDateTime, formatDurationMs } from '../utils/format';
import { Search, Edit3, X, Download, Eye, Check, AlertCircle, FileText, DollarSign, User, Building2, Shield, Activity, Mail, ChevronDown, ChevronRight, AlertTriangle, Info, CheckCircle, XCircle } from 'lucide-react';
import type { AuditEventRecord } from '../api/types';

// ─── Processing Decision Summary ─────────────────────────────

interface DecisionPoint {
  severity: 'error' | 'warning' | 'info' | 'success';
  title: string;
  details: string[];
}

function buildDecisionPoints(events: AuditEventRecord[], status: string): DecisionPoint[] {
  const points: DecisionPoint[] = [];

  // Find the key events
  const adjEvent = events.find(e => e.action === 'DECISION_MADE');
  const completenessEvent = events.find(e => e.action === 'COMPLETENESS_CHECKED');
  const memberEvent = events.find(e => e.action === 'MEMBER_VALIDATED' || e.action === 'MEMBER_VALIDATION_FAILED');
  const validationError = events.find(e => e.action === 'VALIDATION_ERROR');
  const manualIntervention = events.find(e => e.action === 'MANUAL_INTERVENTION_REQUIRED');
  const onHoldEvent = events.find(e => e.action === 'CLAIM_ON_HOLD');
  const coverageEvent = events.find(e => e.action === 'COVERAGE_CALCULATED');

  // 1. Adjudication decision — always the primary reason
  if (adjEvent) {
    const d = adjEvent.details as Record<string, unknown>;
    const decision = d.decision as string | undefined;
    const reason = (d.humanReviewReason ?? d.reason) as string | undefined;
    const requiresReview = d.requiresReview as boolean | undefined;
    const severity: DecisionPoint['severity'] =
      decision === 'APPROVED' ? 'success'
      : decision === 'DENIED' ? 'error'
      : decision === 'HUMAN_REVIEW' || requiresReview ? 'warning'
      : 'info';
    const details: string[] = [];
    if (reason) details.push(reason);
    const denialReasons = d.denialReasons as string[] | undefined;
    if (Array.isArray(denialReasons) && denialReasons.length > 0) {
      denialReasons.forEach(r => details.push(`• ${r}`));
    }
    points.push({ severity, title: `Adjudication: ${decision ?? 'Pending'}`, details: details.length ? details : ['No additional detail provided.'] });
  }

  // 2. Eligibility
  if (memberEvent) {
    const d = memberEvent.details as Record<string, unknown>;
    const isValid = d.isValid as boolean | undefined;
    const isEligible = d.isEligible as boolean | undefined;
    const eligReason = d.eligibilityReason as string | undefined;
    const memberName = d.claimantName as string | undefined;
    const details: string[] = [];
    if (memberName) details.push(`Member: ${memberName}`);
    if (isValid === false) details.push('Member could not be matched in the policy database.');
    if (isEligible === false && eligReason) details.push(`Ineligible — ${eligReason}`);
    else if (isEligible === false) details.push('Member is not eligible for this claim.');
    if (isValid && isEligible !== false) details.push('Member validated and eligible.');
    points.push({
      severity: isValid === false || isEligible === false ? 'error' : 'success',
      title: 'Member & Eligibility',
      details: details.length ? details : ['Eligibility check not completed.']
    });
  } else if (validationError) {
    const d = validationError.details as Record<string, unknown>;
    const errMsg = d.error as string | undefined;
    points.push({
      severity: 'warning',
      title: 'Member Validation Error',
      details: [errMsg ? `Validation service error: ${errMsg}` : 'Member validation could not be completed — member may not exist in the database.', 'Claim was processed on coding and coverage signals only.']
    });
  }

  // 3. Completeness
  if (completenessEvent) {
    const d = completenessEvent.details as Record<string, unknown>;
    const score = d.score as number | undefined;
    const canProcess = d.canProcess as boolean | undefined;
    const criticalMissing = d.criticalMissing as string[] | undefined;
    const recommendation = d.recommendation as string | undefined;
    const details: string[] = [];
    if (score != null) details.push(`Completeness score: ${score}%`);
    if (recommendation) details.push(recommendation);
    if (Array.isArray(criticalMissing) && criticalMissing.length > 0) {
      details.push(`Critical fields missing: ${criticalMissing.join(', ')}`);
    }
    if (canProcess === false && (!criticalMissing || criticalMissing.length === 0)) {
      details.push('Claim form is incomplete for straight-through processing.');
    }
    points.push({
      severity: canProcess === false || (Array.isArray(criticalMissing) && criticalMissing.length > 0) ? 'warning' : 'info',
      title: 'Form Completeness',
      details: details.length ? details : ['Completeness check passed.']
    });
  }

  // 4. Manual intervention / missing data
  if (manualIntervention) {
    const d = manualIntervention.details as Record<string, unknown>;
    const desc = d.description as string | undefined;
    const missing = d.missingCategories as string[] | undefined;
    const recommendation = d.recommendation as string | undefined;
    const details: string[] = [];
    if (desc) details.push(desc);
    if (Array.isArray(missing) && missing.length > 0) details.push(`Missing: ${missing.join(', ')}`);
    if (recommendation) details.push(recommendation);
    points.push({ severity: 'error', title: 'Manual Intervention Required', details: details.length ? details : ['Human review needed.'] });
  }

  // 5. Coverage
  if (coverageEvent) {
    const d = coverageEvent.details as Record<string, unknown>;
    const decision = d.decision as string | undefined;
    const totalPayable = d.totalPayable as number | undefined;
    const totalClaimed = d.totalClaimed as number | undefined;
    const currency = d.currency as string | undefined;
    const exclusions = d.exclusions as number | undefined;
    const usedDefaults = d.usedDefaults as boolean | undefined;
    const details: string[] = [];
    if (decision) details.push(`Coverage decision: ${decision}`);
    if (totalClaimed != null && totalPayable != null) {
      details.push(`Claimed: ${currency ?? ''} ${totalClaimed} → Payable: ${currency ?? ''} ${totalPayable}`);
    }
    if (exclusions && exclusions > 0) details.push(`${exclusions} exclusion(s) triggered.`);
    if (usedDefaults) details.push('Coverage calculated using default plan rules (member not matched).');
    points.push({
      severity: decision === 'FULLY_COVERED' ? 'success' : decision === 'NOT_COVERED' ? 'error' : 'warning',
      title: 'Coverage Analysis',
      details: details.length ? details : ['No coverage detail available.']
    });
  }

  // 6. On-hold reason
  if (onHoldEvent) {
    const d = onHoldEvent.details as Record<string, unknown>;
    const holdReason = d.reason as string | undefined;
    const missingLabels = d.missingFieldLabels as string[] | undefined;
    const details: string[] = [];
    if (holdReason) details.push(holdReason);
    if (Array.isArray(missingLabels) && missingLabels.length > 0) {
      details.push(`Missing: ${missingLabels.join(', ')}`);
    }
    points.push({ severity: 'warning', title: 'Claim On Hold', details: details.length ? details : ['Claim is pending additional information.'] });
  }

  return points;
}

const SEVERITY_STYLES: Record<DecisionPoint['severity'], {
  accent: string;        // top-border / icon colour
  iconBg: string;        // soft circle behind icon
  pillBg: string;        // pill badge background
  pillText: string;      // pill badge text
  label: string;
  icon: React.ReactNode;
}> = {
  error:   {
    accent:   'hsl(0 72% 51%)',
    iconBg:   'hsl(0 86% 97%)',
    pillBg:   'hsl(0 86% 95%)',
    pillText: 'hsl(0 72% 38%)',
    label: 'Blocking issue',
    icon: <XCircle size={15} />,
  },
  warning: {
    accent:   'hsl(38 92% 50%)',
    iconBg:   'hsl(45 96% 95%)',
    pillBg:   'hsl(45 96% 92%)',
    pillText: 'hsl(38 80% 32%)',
    label: 'Needs attention',
    icon: <AlertTriangle size={15} />,
  },
  info:    {
    accent:   'hsl(217 91% 60%)',
    iconBg:   'hsl(214 100% 97%)',
    pillBg:   'hsl(214 100% 93%)',
    pillText: 'hsl(217 72% 38%)',
    label: 'Information',
    icon: <Info size={15} />,
  },
  success: {
    accent:   'hsl(142 71% 45%)',
    iconBg:   'hsl(138 76% 96%)',
    pillBg:   'hsl(138 76% 92%)',
    pillText: 'hsl(142 56% 28%)',
    label: 'Passed',
    icon: <CheckCircle size={15} />,
  },
};

function ProcessingDecisionSummary({ auditEvents, status }: { auditEvents: AuditEventRecord[]; status: string }) {
  const points = buildDecisionPoints(auditEvents, status);
  if (points.length === 0) return null;

  return (
    <section style={{ marginBottom: '2rem' }}>
      {/* Section header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
        <div style={{
          width: 28, height: 28, borderRadius: '50%',
          background: 'hsl(245 58% 95%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <AlertCircle size={14} color="hsl(245 58% 52%)" />
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: '0.9rem', fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--color-text-primary, #111827)' }}>
            Processing Decision — why this claim is&nbsp;
            <span style={{
              display: 'inline-block',
              padding: '1px 8px',
              borderRadius: '4px',
              background: 'hsl(245 58% 95%)',
              color: 'hsl(245 58% 42%)',
              fontSize: '0.78rem',
              fontWeight: 700,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              verticalAlign: 'middle',
            }}>{status}</span>
          </h3>
          <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--color-text-secondary, #6b7280)', marginTop: '1px' }}>
            Key signals extracted from the automated pipeline run
          </p>
        </div>
      </div>

      {/* Cards grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: '0.75rem',
      }}>
        {points.map((pt, i) => {
          const s = SEVERITY_STYLES[pt.severity];
          return (
            <div key={i} style={{
              background: 'var(--color-surface, #0f1b2e)',
              border: '1px solid hsl(220 13% 91%)',
              borderTop: `3px solid ${s.accent}`,
              borderRadius: '8px',
              padding: '1rem 1rem 0.85rem',
              boxShadow: '0 1px 4px hsla(220,13%,18%,0.06)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.55rem',
            }}>
              {/* Card header */}
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.6rem' }}>
                {/* Icon circle */}
                <div style={{
                  flexShrink: 0,
                  width: 28, height: 28,
                  borderRadius: '50%',
                  background: s.iconBg,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: s.accent,
                  marginTop: '1px',
                }}>
                  {s.icon}
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600, fontSize: '0.83rem', color: 'var(--color-text-primary, #111827)', lineHeight: 1.3 }}>
                    {pt.title}
                  </div>
                  {/* Severity pill */}
                  <span style={{
                    display: 'inline-block',
                    marginTop: '3px',
                    padding: '1px 7px',
                    borderRadius: '99px',
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    letterSpacing: '0.03em',
                    background: s.pillBg,
                    color: s.pillText,
                  }}>
                    {s.label}
                  </span>
                </div>
              </div>

              {/* Detail lines */}
              {pt.details.length > 0 && (
                <div style={{
                  borderTop: '1px solid hsl(220 13% 94%)',
                  paddingTop: '0.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.3rem',
                }}>
                  {pt.details.map((line, j) => (
                    <p key={j} style={{
                      margin: 0,
                      fontSize: '0.78rem',
                      color: 'var(--color-text-secondary, #4b5563)',
                      lineHeight: 1.55,
                      paddingLeft: '0.25rem',
                    }}>
                      {line.startsWith('•') ? line : `${line}`}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}



const nextStatuses = ['NEW', 'EXTRACTING', 'TRANSLATING', 'CODING', 'VALIDATING', 'REVIEWING', 'COMPLETE', 'ON_HOLD', 'DENIED', 'DUPLICATE'];

function getStatusOptionStyle(status: string) {
  if (status === 'COMPLETE') return { color: '#15803d', background: '#f0fdf4', fontWeight: 600 };
  if (status === 'DENIED') return { color: '#b91c1c', background: '#fef2f2', fontWeight: 600 };
  if (status === 'DUPLICATE') return { color: '#b91c1c', background: '#fef2f2', fontWeight: 600 };
  if (status === 'ON_HOLD') return { color: '#c2410c', background: '#fff7ed', fontWeight: 600 };
  if (['REVIEWING', 'QUERYING_MEMBER', 'QUERYING_PROVIDER'].includes(status)) return { color: '#b45309', background: '#fffbeb' };
  if (['EXTRACTING', 'TRANSLATING', 'CODING', 'VALIDATING'].includes(status)) return { color: '#6366f1', background: '#f0f0ff' };
  return { color: '#6b7280', background: '#f9fafb' };
}

// ─── Helper Components ────────────────────────────────

function ConfidenceBar({ value, label }: { value: number; label?: string }) {
  // Handle both decimal (0.65) and percentage (65) values gracefully
  const pct = value > 1 ? Math.round(value) : Math.round(value * 100);
  const color = pct >= 85 ? '#22c55e' : pct >= 60 ? '#eab308' : '#ef4444';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', minWidth: '120px' }}>
      {label && <span className="muted-copy" style={{ fontSize: '0.75rem', minWidth: '60px' }}>{label}</span>}
      <div style={{ flex: 1, height: '6px', background: 'var(--color-border-subtle, #e2e8f0)', borderRadius: '3px', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, pct)}%`, height: '100%', background: color, borderRadius: '3px', transition: 'width 0.3s' }} />
      </div>
      <span style={{ fontSize: '0.75rem', fontWeight: 600, color, minWidth: '35px' }}>{pct}%</span>
    </div>
  );
}

function InfoRow({ label, value, badge }: { label: string; value: string | number | null | undefined; badge?: boolean }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '0.35rem 0', borderBottom: '1px solid var(--color-border, #e2e8f0)' }}>
      <span className="muted-copy" style={{ fontSize: '0.8rem' }}>{label}</span>
      {badge ? <StatusBadge status={String(value)} /> : <strong style={{ fontSize: '0.8rem' }}>{value}</strong>}
    </div>
  );
}

function SectionCard({ title, icon, children, collapsible, defaultOpen = true }: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
  collapsible?: boolean;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="surface-card">
      <div
        className="section-header"
        style={{ cursor: collapsible ? 'pointer' : 'default', display: 'flex', alignItems: 'center', gap: '0.5rem' }}
        onClick={() => collapsible && setOpen(!open)}
      >
        {icon}
        <h2 style={{ flex: 1 }}>{title}</h2>
        {collapsible && (open ? <ChevronDown size={16} /> : <ChevronRight size={16} />)}
      </div>
      {(!collapsible || open) && children}
    </section>
  );
}

function formatCurrency(amount: number | null | undefined, currency?: string): string {
  if (amount === null || amount === undefined) return '—';
  const cur = currency || 'USD';
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: cur, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(amount);
}

// ─── Main Component ───────────────────────────────────

export default function ClaimDetail() {
  const { id = '' } = useParams();
  const queryClient = useQueryClient();
  const [selectedStatus, setSelectedStatus] = useState('REVIEWING');
  const [selectedHandler, setSelectedHandler] = useState('');
  const [correctionTarget, setCorrectionTarget] = useState<{ id: string; code: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState<'overview' | 'coding' | 'financials' | 'documents' | 'correspondence' | 'audit'>('overview');

  const detailQuery = useQuery({ queryKey: ['claim', id], queryFn: () => claimsApi.detail(id), enabled: Boolean(id) });
  const isProcessing = ['NEW', 'EXTRACTING', 'TRANSLATING', 'CODING', 'VALIDATING'].includes(detailQuery.data?.status ?? '');
  const pipelineQuery = useQuery({
    queryKey: ['pipeline', id],
    queryFn: () => processingApi.pipelineStatus(id),
    enabled: Boolean(id) && isProcessing,
    refetchInterval: isProcessing ? 5000 : false,
  });
  const pipelineStatus = (pipelineQuery.data as Record<string, unknown>)?.status as string | undefined;
  useEffect(() => {
    if (pipelineStatus && !['NEW', 'EXTRACTING', 'TRANSLATING', 'CODING', 'VALIDATING'].includes(pipelineStatus)) {
      void queryClient.invalidateQueries({ queryKey: ['claim', id] });
      void queryClient.invalidateQueries({ queryKey: ['claim-audit', id] });
    }
  }, [pipelineStatus, id, queryClient]);

  const auditQuery = useQuery({ queryKey: ['claim-audit', id], queryFn: () => claimsApi.getAudit(id), enabled: Boolean(id) });
  const usersQuery = useQuery({ queryKey: ['users-assign'], queryFn: () => usersApi.list({ limit: 100 }), enabled: Boolean(id) });

  // Sync state with detail data when it loads or changes
  useEffect(() => {
    if (detailQuery.data) {
      setSelectedStatus(detailQuery.data.status || 'REVIEWING');
      setSelectedHandler(detailQuery.data.assignedTo || '');
    }
  }, [detailQuery.data]);

  const searchQueryHook = useQuery({
    queryKey: ['icd-search', searchQuery],
    queryFn: () => claimsApi.searchCodes(searchQuery),
    enabled: searchQuery.length > 2,
  });

  const statusMutation = useMutation({
    mutationFn: (status: string) => claimsApi.updateStatus(id, status),
    onSuccess: () => {
      toast.success('Claim status updated');
      void queryClient.invalidateQueries({ queryKey: ['claim', id] });
      void queryClient.invalidateQueries({ queryKey: ['claim-audit', id] });
      void queryClient.invalidateQueries({ queryKey: ['claims'] });
    },
    onError: (error: { error?: string }) => {
      toast.error(error.error || 'Status update failed');
    },
  });

  const assignMutation = useMutation({
    mutationFn: (handlerId: string) => claimsApi.assign(id, handlerId),
    onSuccess: () => {
      toast.success('Claim assigned');
      void queryClient.invalidateQueries({ queryKey: ['claim', id] });
      void queryClient.invalidateQueries({ queryKey: ['claim-audit', id] });
      void queryClient.invalidateQueries({ queryKey: ['claims'] });
    },
    onError: (error: { error?: string }) => {
      toast.error(error.error || 'Assignment failed');
    },
  });

  const codingMutation = useMutation({
    mutationFn: ({ codingId, reviewerAction, correctedCode, note }: {
      codingId: string;
      reviewerAction: 'accepted' | 'rejected' | 'corrected';
      correctedCode?: string;
      note?: string;
    }) =>
      claimsApi.reviewCoding(id, codingId, { reviewerAction, correctedCode, note }),
    onSuccess: () => {
      toast.success('Coding review saved');
      setCorrectionTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['claim', id] });
      void queryClient.invalidateQueries({ queryKey: ['claim-audit', id] });
    },
    onError: (error: { error?: string }) => {
      toast.error(error.error || 'Coding review failed');
    },
  });

  const handleDownload = async (claimId: string, format: 'pdf' | 'json' | 'edi' = 'pdf') => {
    try {
      if (format === 'pdf') {
        const response = await claimsApi.downloadPdf(claimId);
        const url = window.URL.createObjectURL(new Blob([response]));
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `claim-${claimId}.pdf`);
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else if (format === 'json') {
        const file = await bupaApi.getClaimExportJson(claimId);
        const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `claim-${claimId}.json`);
        document.body.appendChild(link);
        link.click();
        link.remove();
      } else if (format === 'edi') {
        const ediContent = await bupaApi.getClaimEdi(claimId);
        const blob = new Blob([ediContent], { type: 'text/plain' });
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.setAttribute('download', `claim-${claimId}.edi`);
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch {
      toast.error(`Failed to download ${format.toUpperCase()}`);
    }
  };

  const detail = detailQuery.data;
  const users = useMemo(() => {
    const rawData = usersQuery.data;
    return rawData?.data ?? (rawData as any)?.users ?? [];
  }, [usersQuery.data]);
  if (!detail) {
    return (
      <div className="page-stack">
        <PageHeader eyebrow="Claims" title="Claim detail" description="Loading claim detail workspace." />
      </div>
    );
  }

  const claimant = detail.claimant as Record<string, any> | null;
  const policy = detail.policy as Record<string, any> | null;
  const incident = detail.incident as Record<string, any> | null;
  const treatment = detail.treatment as Record<string, any> | null;
  const financials = detail.financials as Record<string, any> | null;
  const coverage = detail.coverageAnalysis as Record<string, any> | null;

  const decisionColor = detail.status === 'COMPLETE'
    ? '#22c55e'
    : ['ON_HOLD', 'QUERYING', 'QUERYING_MEMBER', 'QUERYING_PROVIDER', 'ESCALATED_HANDLER', 'ESCALATED_CLINICAL'].includes(detail.status)
      ? '#eab308'
      : ['CLOSED', 'DENIED'].includes(detail.status)
        ? '#ef4444'
        : '#3b82f6';

  return (
    <div className="page-stack">
      {/* ─── Header ─────────────────────────────────── */}
      <PageHeader
        eyebrow="Bupa Global Claim"
        title={detail.claimReference}
        description="Agentic claims processing — review member, provider, coding, coverage, and financials."
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <StatusBadge status={detail.status} />
            <button className="btn btn-ghost btn-sm" onClick={() => handleDownload(detail.id, 'pdf')} title="Download PDF">
              <Download size={14} /> PDF
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => handleDownload(detail.id, 'json')} title="Download JSON">
              <FileText size={14} /> JSON
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => handleDownload(detail.id, 'edi')} title="Download EDI 837">
              <Download size={14} /> EDI
            </button>
          </div>
        }
      />

      {/* ─── Processing Banner ──────────────────────── */}
      {isProcessing && (
        <div className="surface-card" style={{ background: 'var(--color-surface-accent, var(--color-surface-alt))', borderLeft: '4px solid var(--color-accent-blue)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <AlertCircle size={18} />
            <div>
              <strong>Claim is being processed by the agent</strong>
              <p className="muted-copy">
                Current stage: <strong>{pipelineStatus ?? detail.status ?? 'Processing'}</strong>.
                Auto-refreshes every 5 seconds.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ─── Tab Navigation ─────────────────────────── */}
      <div style={{ display: 'flex', gap: '0.25rem', borderBottom: '2px solid var(--color-border, #e2e8f0)', marginBottom: '0.5rem' }}>
        {(['overview', 'coding', 'financials', 'documents', 'correspondence', 'audit'] as const).map((tab) => (
          <button
            key={tab}
            className={`btn btn-ghost btn-sm ${activeTab === tab ? 'btn-active' : ''}`}
            style={{
              borderBottom: activeTab === tab ? '2px solid var(--color-accent-blue, #3b82f6)' : '2px solid transparent',
              borderRadius: 0,
              fontWeight: activeTab === tab ? 600 : 400,
              textTransform: 'capitalize',
            }}
            onClick={() => setActiveTab(tab)}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* ─── OVERVIEW TAB ──────────────────────────── */}
      {activeTab === 'overview' && (
        <>
          {/* Decision Banner */}
          {detail.status === 'COMPLETE' && coverage && (
            <div className="surface-card" style={{ borderLeft: `4px solid ${decisionColor}` }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <h3 style={{ color: decisionColor, margin: 0 }}>
                    <Shield size={18} style={{ verticalAlign: 'middle', marginRight: '0.5rem' }} />
                    {coverage.decision ?? 'PROCESSED'}
                  </h3>
                  <p className="muted-copy">{coverage.reason ?? 'Claim processed through agentic pipeline.'}</p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '1.5rem', fontWeight: 700, color: decisionColor }}>
                    {formatCurrency(financials?.totalPayable ?? financials?.totalClaimed, financials?.currency)}
                  </div>
                  <span className="muted-copy">Payable amount</span>
                </div>
              </div>
            </div>
          )}

          <div className="claim-detail-grid">
            {/* ─── Member Panel ──────────────────────── */}
            <SectionCard title="Member" icon={<User size={18} />}>
              <div className="detail-grid">
                <InfoRow label="Membership #" value={claimant?.membershipNumber ?? claimant?.policyNumber} />
                <InfoRow label="Name" value={claimant?.name ?? `${claimant?.firstName ?? ''} ${claimant?.lastName ?? ''}`.trim()} />
                <InfoRow label="Date of Birth" value={claimant?.dateOfBirth} />
                <InfoRow label="Email" value={claimant?.email ?? claimant?.contactEmail} />
                <InfoRow label="Phone" value={claimant?.phone ?? claimant?.contactPhone} />
                <InfoRow label="Plan Tier" value={policy?.planTier ?? policy?.planName} badge />
                <InfoRow label="Policy Status" value={policy?.policyStatus ?? 'Unknown'} badge />
                <InfoRow label="Network" value={policy?.networkOption} />
                <InfoRow label="Geographic Cover" value={policy?.geographicCover} />
                <InfoRow label="Deductible" value={policy?.deductible
                  ? `${formatCurrency(policy.deductible.remaining, policy.deductible.currency)} remaining of ${formatCurrency(policy.deductible.amount, policy.deductible.currency)}`
                  : null
                } />
                <InfoRow label="Co-Insurance" value={policy?.coInsuranceRate ? `${(policy.coInsuranceRate * 100)}%` : 'None'} />
              </div>
            </SectionCard>

            {/* ─── Provider Panel ─────────────────────── */}
            <SectionCard title="Provider" icon={<Building2 size={18} />}>
              <div className="detail-grid">
                <InfoRow label="Facility" value={incident?.facility ?? incident?.hospitalName ?? treatment?.facility} />
                <InfoRow label="Practitioner" value={incident?.physician ?? treatment?.practitioner} />
                <InfoRow label="Specialty" value={incident?.specialty} />
                <InfoRow label="Country" value={incident?.location ?? incident?.treatmentCountry} />
                <InfoRow label="Network Status" value={coverage?.providerNetwork ?? 'Unknown'} badge />
                <InfoRow label="Accreditation" value={coverage?.providerAccreditation ?? 'Unknown'} badge />
                {coverage?.networkPenalty !== undefined && coverage?.networkPenalty > 0 && (
                  <div style={{ padding: '0.5rem', background: '#fef3c7', borderRadius: '4px', marginTop: '0.5rem' }}>
                    <strong style={{ color: '#92400e', fontSize: '0.8rem' }}>
                      Out-of-Network Penalty: 50% co-insurance applied
                    </strong>
                  </div>
                )}
              </div>
            </SectionCard>
          </div>

          <div className="claim-detail-grid">
            {/* ─── Treatment Timeline ────────────────── */}
            <SectionCard title="Treatment" icon={<Activity size={18} />}>
              <div className="detail-grid">
                <InfoRow label="Treatment Type" value={incident?.treatmentType ?? treatment?.type} badge />
                <InfoRow label="Treatment Country" value={incident?.treatmentCountry ?? incident?.location} />
                <InfoRow label="Reason" value={incident?.reason ?? treatment?.primaryDiagnosis} />
                <InfoRow label="Symptom Start" value={incident?.symptomStartDate} />
                <InfoRow label="Admission" value={incident?.date ?? incident?.admissionDate} />
                <InfoRow label="Discharge" value={incident?.dischargeDate} />
                <InfoRow label="Surgery Date" value={incident?.surgeryDate} />
                <InfoRow label="Treatment Details" value={treatment?.description ?? treatment?.details} />
                {treatment?.procedures && (treatment.procedures as string[]).length > 0 && (
                  <div style={{ padding: '0.35rem 0' }}>
                    <span className="muted-copy" style={{ fontSize: '0.8rem' }}>Procedures</span>
                    <ul style={{ margin: '0.25rem 0', paddingLeft: '1.2rem' }}>
                      {(treatment.procedures as string[]).map((p: string, i: number) => (
                        <li key={i} style={{ fontSize: '0.8rem' }}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {treatment?.medications && (treatment.medications as string[]).length > 0 && (
                  <div style={{ padding: '0.35rem 0' }}>
                    <span className="muted-copy" style={{ fontSize: '0.8rem' }}>Medications</span>
                    <ul style={{ margin: '0.25rem 0', paddingLeft: '1.2rem' }}>
                      {(treatment.medications as string[]).map((m: string, i: number) => (
                        <li key={i} style={{ fontSize: '0.8rem' }}>{m}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </SectionCard>

            {/* ─── Workflow Controls ──────────────────── */}
            <SectionCard title="Workflow Controls" icon={<Shield size={18} />}>
              <div className="detail-grid">
                <InfoRow label="Client" value={detail.client?.name ?? 'Unassigned'} />
                <InfoRow label="Team" value={detail.team?.name ?? 'Unassigned'} />
                <InfoRow label="Handler" value={detail.assignedHandler?.name ?? 'Unassigned'} />
                <InfoRow label="Processing Time" value={formatDurationMs(detail.processingTimeMs)} />
                <InfoRow label="Overall Confidence" value={detail.overallConfidence != null ? formatConfidence(detail.overallConfidence, 0, 'Pending') : null} />
                <InfoRow label="Created" value={formatDateTime(detail.createdAt)} />
              </div>
              <div className="toolbar stacked" style={{ marginTop: '1rem' }}>
                <select className="input" value={selectedStatus} onChange={(e) => setSelectedStatus(e.target.value)}>
                  {nextStatuses.map((s) => <option key={s} value={s} style={getStatusOptionStyle(s)}>{s}</option>)}
                </select>
                <button className="btn btn-primary" onClick={() => statusMutation.mutate(selectedStatus)} disabled={statusMutation.isPending}>
                  {statusMutation.isPending ? 'Updating...' : 'Update status'}
                </button>
                <select className="input" value={selectedHandler} onChange={(e) => setSelectedHandler(e.target.value)}>
                  <option value="">Select handler</option>
                  {users.map((user: UserRecord) => (
                    <option key={user.id} value={user.id}>{user.name} ({user.email})</option>
                  ))}
                </select>
                <button className="btn btn-secondary" onClick={() => selectedHandler && assignMutation.mutate(selectedHandler)} disabled={!selectedHandler || assignMutation.isPending}>
                  {assignMutation.isPending ? 'Assigning...' : 'Assign'}
                </button>
              </div>
            </SectionCard>
          </div>

          {/* ─── Coverage Analysis ────────────────────── */}
          {coverage && (
            <SectionCard title="Coverage Analysis" icon={<Shield size={18} />} collapsible defaultOpen>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem', marginBottom: '1rem' }}>
                <div className="surface-card" style={{ textAlign: 'center', padding: '1rem' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{coverage.planTier}</div>
                  <span className="muted-copy">Plan Tier</span>
                </div>
                <div className="surface-card" style={{ textAlign: 'center', padding: '1rem' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                    {coverage.annualMaximum?.limit ? formatCurrency(coverage.annualMaximum.limit, coverage.annualMaximum.currency) : 'Unlimited'}
                  </div>
                  <span className="muted-copy">Annual Maximum</span>
                </div>
                <div className="surface-card" style={{ textAlign: 'center', padding: '1rem' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: decisionColor }}>
                    {coverage.overallDecision ?? '—'}
                  </div>
                  <span className="muted-copy">Coverage Decision</span>
                </div>
              </div>

              {coverage.benefitsApplied && (coverage.benefitsApplied as any[]).length > 0 && (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                  <thead>
                    <tr style={{ background: '#e2e8f0', textAlign: 'left' }}>
                      <th style={{ padding: '0.5rem' }}>Benefit</th>
                      <th style={{ padding: '0.5rem' }}>Covered</th>
                      <th style={{ padding: '0.5rem' }}>Limit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(coverage.benefitsApplied as any[]).map((b: any, i: number) => (
                      <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                        <td style={{ padding: '0.5rem' }}>{b.benefit}</td>
                        <td style={{ padding: '0.5rem' }}>
                          <StatusBadge status={b.covered ? 'COVERED' : 'NOT_COVERED'} />
                        </td>
                        <td style={{ padding: '0.5rem' }}>{b.limit ?? 'Paid in full'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {coverage.exclusionsChecked && (coverage.exclusionsChecked as string[]).length > 0 && (
                <div style={{ marginTop: '0.75rem', padding: '0.5rem', background: '#fef2f2', borderRadius: '4px' }}>
                  <strong style={{ color: '#991b1b', fontSize: '0.8rem' }}>Exclusions Triggered:</strong>
                  <ul style={{ margin: '0.25rem 0', paddingLeft: '1.2rem' }}>
                    {(coverage.exclusionsChecked as string[]).map((e: string, i: number) => (
                      <li key={i} style={{ fontSize: '0.8rem', color: '#991b1b' }}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </SectionCard>
          )}
        </>
      )}

      {/* ─── CODING TAB ────────────────────────────── */}
      {activeTab === 'coding' && (
        <div className="claim-detail-grid secondary">
          <SectionCard title="ICD-10 & CPT Coding" icon={<FileText size={18} />}>
            {detail.coding.length === 0 ? (
              <EmptyState title="No coding records" description="Coding results will populate after the coding stage completes." />
            ) : (
              <div className="list-stack">
                {detail.coding.map((entry) => (
                  <div key={entry.id} className="coding-card">
                    <div className="coding-head">
                      <div>
                        <strong>{entry.code}</strong>
                        <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', padding: '2px 6px', background: entry.codeType === 'ICD10' ? '#dbeafe' : '#fef3c7', borderRadius: '4px' }}>
                          {entry.codeType}
                        </span>
                        {entry.isPrimary && (
                          <span style={{ marginLeft: '0.5rem', fontSize: '0.7rem', padding: '2px 6px', background: '#dcfce7', borderRadius: '4px', color: '#166534' }}>
                            PRIMARY
                          </span>
                        )}
                        <span className="muted-copy" style={{ marginLeft: '0.5rem' }}>{entry.description}</span>
                      </div>
                      <StatusBadge status={entry.reviewerAction || (entry.isValidated ? 'accepted' : 'reviewing')} />
                    </div>
                    <ConfidenceBar value={entry.confidence} label="Confidence" />
                    <p className="muted-copy" style={{ fontSize: '0.75rem', marginTop: '0.25rem' }}>
                      {entry.reasoning || entry.llmDescription || 'No reasoning summary available.'}
                    </p>
                    {entry.evidenceSource && (
                      <div className="evidence-box" style={{ marginTop: '0.25rem', fontSize: '0.75rem' }}>
                        <strong style={{ display: 'block', marginBottom: '0.25rem', color: 'var(--color-text-primary)' }}>Evidence: </strong>
                        <span style={{ color: 'var(--color-text-secondary)', display: 'block', lineHeight: 1.4 }}>
                          {entry.evidenceSource.substring(0, 200)}{entry.evidenceSource.length > 200 ? '...' : ''}
                        </span>
                      </div>
                    )}
                    <div className="coding-meta">
                      <span>Page: {entry.pageNumber ?? 'n/a'}</span>
                      <span>Section: {entry.section ?? 'n/a'}</span>
                      <span>Path: {entry.pathUsed ?? 'n/a'}</span>
                    </div>
                    <div className="button-row">
                      <button className="btn btn-primary btn-sm" onClick={() => codingMutation.mutate({ codingId: entry.id, reviewerAction: 'accepted' })}>
                        <Check size={14} /> Accept
                      </button>
                      <button className="btn btn-secondary btn-sm" onClick={() => setCorrectionTarget({ id: entry.id, code: entry.code })}>
                        <Edit3 size={14} /> Correct
                      </button>
                      <button className="btn btn-ghost btn-sm" onClick={() => codingMutation.mutate({ codingId: entry.id, reviewerAction: 'rejected' })}>
                        <X size={14} /> Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {/* Code Correction Modal */}
          {correctionTarget && (
            <div className="modal-backdrop">
              <div className="modal-container surface-card" style={{ maxWidth: '500px' }}>
                <div className="modal-header">
                  <h2>Correct code {correctionTarget.code}</h2>
                  <button className="btn-icon" onClick={() => setCorrectionTarget(null)}><X size={20} /></button>
                </div>
                <div className="page-stack p-4">
                  <div className="field-group">
                    <span className="label-with-icon"><Search size={16} /> Search for better ICD-10 code</span>
                    <input
                      className="input"
                      placeholder="Type to search (e.g. diabetes, fracture)..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                    />
                  </div>
                  <div className="search-results-list mt-2" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                    {searchQueryHook.data?.map(res => (
                      <div
                        key={res.code}
                        className="list-item clickable compact"
                        onClick={() => {
                          codingMutation.mutate({
                            codingId: correctionTarget.id,
                            reviewerAction: 'corrected',
                            correctedCode: res.code,
                            note: `Corrected from ${correctionTarget.code} to ${res.code} by user`,
                          });
                        }}
                      >
                        <strong>{res.code}</strong>
                        <p className="muted-copy">{res.short}</p>
                      </div>
                    ))}
                    {searchQuery.length > 2 && !searchQueryHook.isLoading && searchQueryHook.data?.length === 0 && (
                      <p className="muted-copy p-2 text-center">No codes found for "{searchQuery}"</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ─── FINANCIALS TAB ─────────────────────────── */}
      {activeTab === 'financials' && (
        <div className="claim-detail-grid secondary">
          <SectionCard title="Financial Breakdown" icon={<DollarSign size={18} />}>
            {financials ? (
              <>
                {/* Summary Cards */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '0.75rem', marginBottom: '1rem' }}>
                  <div style={{ textAlign: 'center', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700 }}>{formatCurrency(financials.totalClaimed, financials.currency)}</div>
                    <span className="muted-copy" style={{ fontSize: '0.75rem' }}>Total Claimed</span>
                  </div>
                  <div style={{ textAlign: 'center', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#dc2626' }}>{formatCurrency(financials.deductibleApplied ?? 0, financials.currency)}</div>
                    <span className="muted-copy" style={{ fontSize: '0.75rem' }}>Deductible</span>
                  </div>
                  <div style={{ textAlign: 'center', padding: '0.75rem', border: '1px solid #e2e8f0', borderRadius: '8px' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#dc2626' }}>{formatCurrency(financials.coInsuranceApplied ?? 0, financials.currency)}</div>
                    <span className="muted-copy" style={{ fontSize: '0.75rem' }}>Co-Insurance</span>
                  </div>
                  <div style={{ textAlign: 'center', padding: '0.75rem', border: '1px solid #22c55e', borderRadius: '8px', background: '#f0fdf4' }}>
                    <div style={{ fontSize: '1.25rem', fontWeight: 700, color: '#22c55e' }}>{formatCurrency(financials.totalPayable, financials.currency)}</div>
                    <span className="muted-copy" style={{ fontSize: '0.75rem' }}>Total Payable</span>
                  </div>
                </div>

                {/* Line Items Table */}
                {financials.itemisedCharges && (financials.itemisedCharges as any[]).length > 0 && (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr style={{ background: '#e2e8f0', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem' }}>Description</th>
                        <th style={{ padding: '0.5rem', textAlign: 'right' }}>Amount</th>
                        <th style={{ padding: '0.5rem' }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(financials.itemisedCharges as any[]).map((item: any, i: number) => (
                        <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                          <td style={{ padding: '0.5rem' }}>{item.description}</td>
                          <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatCurrency(item.amount, financials.currency)}</td>
                          <td style={{ padding: '0.5rem' }}>
                            <StatusBadge status={item.covered !== false ? 'COVERED' : 'DENIED'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: '#f8fafc', fontWeight: 600 }}>
                        <td style={{ padding: '0.5rem' }}>Total</td>
                        <td style={{ padding: '0.5rem', textAlign: 'right' }}>{formatCurrency(financials.totalClaimed, financials.currency)}</td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                )}

                {/* Payment Details */}
                <div style={{ marginTop: '1rem' }}>
                  <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Payment Details</h3>
                  <InfoRow label="Payee" value={financials.payeeType} />
                  <InfoRow label="Payment Method" value={financials.paymentMethod} />
                  <InfoRow label="Currency" value={financials.currency ?? financials.paymentCurrency} />
                </div>
              </>
            ) : (
              <EmptyState title="No financial data" description="Financial breakdown will appear after claim processing." />
            )}
          </SectionCard>
        </div>
      )}

      {/* ─── DOCUMENTS TAB ──────────────────────────── */}
      {activeTab === 'documents' && (
        <SectionCard title="Documents" icon={<FileText size={18} />}>
          {detail.documents.length === 0 ? (
            <EmptyState title="No documents" description="Source claim files will be attached here." />
          ) : (
            <div className="list-stack">
              {detail.documents.map((doc) => {
                const isGenerated = doc.processingStatus === 'generated';
                const filename = (doc.originalFilename || '').toLowerCase();
                const downloadFormat: 'pdf' | 'json' | 'edi' =
                  filename.endsWith('.json') ? 'json'
                  : filename.endsWith('.edi') || filename.endsWith('.edi.txt') ? 'edi'
                  : 'pdf';
                return (
                  <div key={doc.id} className="list-item">
                    <div style={{ flex: 1 }}>
                      <strong>{doc.originalFilename}</strong>
                      <p className="muted-copy">
                        {doc.docType} &middot; {doc.mimeType}
                        {doc.pageCount ? ` · ${doc.pageCount} pages` : ''}
                        {doc.language && ` · Language: ${doc.language}`}
                        {` · ${isGenerated ? 'Generated output' : 'Source upload'}`}
                      </p>
                      {doc.extractionConfidence !== null && doc.extractionConfidence !== undefined && (
                        <ConfidenceBar value={doc.extractionConfidence} label="Extraction" />
                      )}
                    </div>
                    <div className="list-actions no-shrink">
                      <StatusBadge status={isGenerated ? 'generated' : (doc.processingStatus || 'new')} />
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => handleDownload(detail.id, downloadFormat)}
                        title={`Download ${downloadFormat.toUpperCase()}`}
                      >
                        <Download size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>
      )}

      {/* ─── CORRESPONDENCE TAB ─────────────────────── */}
      {activeTab === 'correspondence' && (
        <SectionCard title="Correspondence" icon={<Mail size={18} />}>
          {detail.correspondence.length === 0 ? (
            <EmptyState title="No correspondence" description="Emails and queries will appear here as the claim progresses." />
          ) : (
            <div className="timeline">
              {detail.correspondence.map((corr) => (
                <div key={corr.id} className="timeline-item" style={{ borderLeft: corr.direction === 'INBOUND' ? '3px solid #3b82f6' : '3px solid #22c55e', paddingLeft: '1rem' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <strong style={{ fontSize: '0.85rem' }}>
                      {corr.direction === 'INBOUND' ? '← Received' : '→ Sent'}: {corr.type}
                    </strong>
                    <span className="muted-copy" style={{ fontSize: '0.75rem' }}>{formatDateTime(corr.sentAt || corr.createdAt)}</span>
                  </div>
                  <p style={{ fontSize: '0.8rem', fontWeight: 500, margin: '0.25rem 0' }}>{corr.subject}</p>
                  <p className="muted-copy" style={{ fontSize: '0.75rem' }}>
                    {corr.fromEmail} → {corr.toEmail}
                  </p>
                  <div style={{ 
                    background: 'var(--surface-sunken)', 
                    color: 'var(--text-main)', 
                    padding: '0.75rem', 
                    borderRadius: '6px', 
                    marginTop: '0.5rem', 
                    fontSize: '0.85rem', 
                    maxHeight: '200px', 
                    overflow: 'auto',
                    border: '1px solid var(--border-light)',
                    lineHeight: '1.5'
                  }}>
                    {corr.body}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Escalations */}
          {detail.escalations.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <h3 style={{ fontSize: '0.9rem', marginBottom: '0.5rem' }}>Escalation History</h3>
              <div className="list-stack">
                {detail.escalations.map((esc) => (
                  <div key={esc.id} className="list-item">
                    <div>
                      <StatusBadge status={esc.tier} />
                      <strong style={{ marginLeft: '0.5rem' }}>{esc.reason}</strong>
                    </div>
                    <div className="list-actions">
                      {esc.resolvedAt ? (
                        <span className="muted-copy">{esc.resolution} · {formatDateTime(esc.resolvedAt)}</span>
                      ) : (
                        <StatusBadge status="PENDING" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </SectionCard>
      )}

      {/* ─── AUDIT TAB ──────────────────────────────── */}
      {activeTab === 'audit' && (
        <SectionCard title="Audit Trail" icon={<Eye size={18} />}>
          {auditQuery.data && auditQuery.data.length > 0 ? (
            <>
              <ProcessingDecisionSummary auditEvents={auditQuery.data} status={detail.status} />
              <AuditTrailList events={auditQuery.data} showClaimRefs={false} />
            </>
          ) : (
            <EmptyState title="No audit events yet" description="Events will appear as actions are performed against this claim." />
          )}
        </SectionCard>
      )}
    </div>
  );
}
