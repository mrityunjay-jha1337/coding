import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, User, Bot, Clock, ArrowRight, Eye, FileText } from 'lucide-react';
import type { AuditEventRecord } from '../api/types';
import { formatDateTime, formatRelative } from '../utils/format';

// ─── Helpers ──────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  CLAIM_CREATE: 'Claim created',
  CLAIM_UPDATE: 'Claim updated',
  CLAIM_PROCESS: 'Claim processed',
  CLAIM_STATUS_CHANGE: 'Claim status changed',
  CLAIM_ASSIGN: 'Claim assigned',
  CLAIM_UPLOAD: 'Document uploaded',
  CLAIM_EXTRACT: 'Data extraction',
  CLAIM_VALIDATE: 'Validation check',
  CLAIM_COVERAGE: 'Coverage analysis',
  CLAIM_ADJUDICATE: 'Adjudication',
  CLAIM_EDI: 'EDI generation',
  CLAIM_FINANCIALS: 'Financial update',
  USER_CREATE: 'User created',
  USER_UPDATE: 'User updated',
  USER_LOGIN: 'User signed in',
  USER_LOGOUT: 'User signed out',
  TEAM_CREATE: 'Team created',
  CLIENT_CREATE: 'Client created',
  AUTH_LOGIN: 'Authentication',
  CODE_OVERRIDE: 'Code override',
  QUERY_SENT: 'Query sent to provider',
  APPEAL_FILED: 'Appeal filed',
  DENIAL_RECORDED: 'Denial recorded',
};

function describeEvent(event: AuditEventRecord): string {
  const label = EVENT_LABELS[event.eventType] ?? event.eventType.replace(/_/g, ' ').toLowerCase();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function describeTrigger(event: AuditEventRecord): string {
  const d = (event.details ?? {}) as Record<string, unknown>;

  // Priority order: most-specific fields first
  const humanReviewReason = d.humanReviewReason ?? d.reviewReason;
  if (typeof humanReviewReason === 'string' && humanReviewReason.trim()) return humanReviewReason;

  const description = d.description;
  if (typeof description === 'string' && description.trim()) return description;

  const reason = d.reason ?? d.trigger ?? d.source;
  if (typeof reason === 'string' && reason.trim()) return reason;

  // Eligibility failure detail
  const eligibilityReason = d.eligibilityReason;
  if (typeof eligibilityReason === 'string' && eligibilityReason.trim()) {
    const eligible = d.isEligible;
    if (eligible === false) return `Eligibility check failed — ${eligibilityReason}`;
    return eligibilityReason;
  }

  // Error messages
  const error = d.error;
  if (typeof error === 'string' && error.trim()) return `Error: ${error}`;

  // Critical missing fields list (from completeness check)
  const criticalMissing = d.criticalMissing;
  if (Array.isArray(criticalMissing) && criticalMissing.length > 0) {
    const fields = (criticalMissing as string[]).join(', ');
    return `Missing required fields: ${fields}`;
  }

  // Missing categories from manual intervention check
  const missingCategories = d.missingCategories;
  if (Array.isArray(missingCategories) && missingCategories.length > 0) {
    return `Cannot auto-process — missing: ${(missingCategories as string[]).join(', ')}`;
  }

  // Completeness score
  const score = d.score;
  const recommendation = d.recommendation;
  if (typeof score === 'number' && typeof recommendation === 'string') {
    return `Completeness score: ${score}% — ${recommendation}`;
  }

  // Adjudication decision
  const decision = d.decision;
  if (typeof decision === 'string' && decision.trim()) {
    const payable = d.payableAmount;
    if (typeof payable === 'number') return `Decision: ${decision} — payable: ${payable}`;
    return `Decision: ${decision}`;
  }

  // Generic fallback by actor + event type
  if (event.actorType === 'SYSTEM') {
    if (event.eventType.startsWith('CLAIM_PROCESS')) return 'Automated pipeline processing';
    if (event.eventType.includes('STATUS')) return 'System-driven status transition';
    if (event.action.includes('EXTRACT')) return 'Automated document extraction';
    return 'Automated background action';
  }
  if (event.actorType === 'USER') return 'Manual action by an authenticated user';
  return 'Triggered by system workflow';
}


function actorName(event: AuditEventRecord): string {
  if (event.actor?.name) return event.actor.name;
  if (event.actorType === 'SYSTEM') return 'System';
  return event.actorType || 'Unknown';
}

function actorIcon(event: AuditEventRecord) {
  return event.actorType === 'SYSTEM' ? <Bot size={14} /> : <User size={14} />;
}

function isStatusChange(event: AuditEventRecord): boolean {
  return Boolean(event.previousValue?.status && event.newValue?.status);
}

// ─── Detail Modal ─────────────────────────────────────

export function AuditDetailModal({ event, onClose }: { event: AuditEventRecord; onClose: () => void }) {
  const detailsString = useMemo(() => {
    try {
      return JSON.stringify(event.details ?? {}, null, 2);
    } catch {
      return '{}';
    }
  }, [event.details]);

  const previousString = event.previousValue ? JSON.stringify(event.previousValue, null, 2) : null;
  const newString = event.newValue ? JSON.stringify(event.newValue, null, 2) : null;

  return (
    <div className="modal-backdrop" onClick={onClose} style={{ zIndex: 100 }}>
      <div
        className="modal-container surface-card"
        style={{ width: 'min(720px, 100%)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 style={{ marginBottom: '0.25rem' }}>{describeEvent(event)}</h2>
            <p className="muted-copy" style={{ margin: 0, fontSize: '0.85rem' }}>
              Event ID: <code>{event.id}</code>
            </p>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Close audit detail">
            <X size={20} />
          </button>
        </div>

        <div className="audit-detail-grid">
          <div className="audit-detail-field">
            <span className="audit-detail-label">What</span>
            <span className="audit-detail-value">{describeEvent(event)} ({event.action})</span>
          </div>
          <div className="audit-detail-field">
            <span className="audit-detail-label">Who</span>
            <span className="audit-detail-value">
              {actorIcon(event)} {actorName(event)}
              {event.actor?.email ? <span className="muted-copy"> · {event.actor.email}</span> : null}
            </span>
          </div>
          <div className="audit-detail-field">
            <span className="audit-detail-label">When</span>
            <span className="audit-detail-value">
              {formatDateTime(event.createdAt)}
              <span className="muted-copy"> ({formatRelative(event.createdAt)})</span>
            </span>
          </div>
          <div className="audit-detail-field">
            <span className="audit-detail-label">Why</span>
            <span className="audit-detail-value">{describeTrigger(event)}</span>
          </div>
          <div className="audit-detail-field">
            <span className="audit-detail-label">Target</span>
            <span className="audit-detail-value">
              {event.targetType}
              {event.claim?.claimReference && event.claim.id ? (
                <>
                  {' · '}
                  <Link to={`/app/claims/${event.claim.id}`} style={{ color: 'var(--primary)', fontWeight: 500 }}>
                    {event.claim.claimReference}
                  </Link>
                </>
              ) : (
                <>
                   {event.claim?.claimReference ? ` · ${event.claim.claimReference}` : ''}
                   {!event.claim?.claimReference && event.targetId ? ` · ${event.targetId}` : ''}
                </>
              )}
            </span>
          </div>
        </div>

        {(previousString || newString) && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Change details</h3>
            <div className="audit-diff-grid">
              <div>
                <div className="audit-detail-label" style={{ marginBottom: '0.25rem' }}>Before</div>
                <pre className="audit-code-block">{previousString ?? '—'}</pre>
              </div>
              <div>
                <div className="audit-detail-label" style={{ marginBottom: '0.25rem' }}>After</div>
                <pre className="audit-code-block">{newString ?? '—'}</pre>
              </div>
            </div>
          </div>
        )}

        <div style={{ marginTop: '1.5rem' }}>
          <h3 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: '0.5rem' }}>Raw details payload</h3>
          <pre className="audit-code-block">{detailsString}</pre>
        </div>

        <div className="modal-actions">
          <button className="btn btn-primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

// ─── Entry Row ────────────────────────────────────────

export function AuditEntry({ 
  event, 
  onViewDetails, 
  showClaimRef = true 
}: { 
  event: AuditEventRecord; 
  onViewDetails: (event: AuditEventRecord) => void;
  showClaimRef?: boolean;
}) {
  const when = formatDateTime(event.createdAt);
  const relative = formatRelative(event.createdAt);
  const statusChange = isStatusChange(event);

  return (
    <li key={event.id} className="audit-entry surface-card shadow-sm" style={{ marginBottom: '1rem' }}>
      <div className="audit-entry__head">
        <div className="audit-entry__title">
          <span className="audit-entry__badge">
            {event.actorType === 'SYSTEM' ? <Bot size={14} /> : <User size={14} />}
            {event.actorType}
          </span>
          <strong>{describeEvent(event)}</strong>
          {showClaimRef && event.claim?.claimReference && event.claim.id && (
            <Link to={`/app/claims/${event.claim.id}`} className="audit-entry__claim-link" style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none', color: 'inherit' }}>
              <span className="audit-entry__claim-ref">
                <FileText size={13} /> {event.claim.claimReference}
              </span>
            </Link>
          )}
        </div>
        <div className="audit-entry__meta">
          <Clock size={13} />
          <span>{when}</span>
          <span className="muted-copy">· {relative}</span>
        </div>
      </div>

      <div className="audit-entry__body">
        <div className="audit-entry__row">
          <span className="audit-entry__label">Who</span>
          <span>{actorName(event)}</span>
        </div>
        <div className="audit-entry__row">
          <span className="audit-entry__label">Action</span>
          <span>{event.action.replace(/_/g, ' ').toLowerCase()} on {event.targetType}</span>
        </div>
        <div className="audit-entry__row">
          <span className="audit-entry__label">Why</span>
          <span>{describeTrigger(event)}</span>
        </div>
        {statusChange && (
          <div className="audit-entry__row">
            <span className="audit-entry__label">Change</span>
            <span className="flex-center gap-sm" style={{ display: 'inline-flex' }}>
              <span className="badge outline">{String(event.previousValue.status)}</span>
              <ArrowRight size={13} />
              <span className="badge blue">{String(event.newValue.status)}</span>
            </span>
          </div>
        )}
      </div>

      <div className="audit-entry__footer">
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => onViewDetails(event)}
        >
          <Eye size={14} /> View details
        </button>
      </div>
    </li>
  );
}

export function AuditTrailList({ 
  events, 
  showClaimRefs = true 
}: { 
  events: AuditEventRecord[];
  showClaimRefs?: boolean;
}) {
  const [selected, setSelected] = useState<AuditEventRecord | null>(null);

  return (
    <>
      <ul className="audit-list">
        {events.map((event) => (
          <AuditEntry 
            key={event.id} 
            event={event} 
            onViewDetails={setSelected} 
            showClaimRef={showClaimRefs}
          />
        ))}
      </ul>
      {selected && <AuditDetailModal event={selected} onClose={() => setSelected(null)} />}
    </>
  );
}
