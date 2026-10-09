import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditApi } from '../api/audit.api';
import type { AuditEventRecord } from '../api/types';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { AuditTrailList } from '../components/AuditTrail';

// ─── Page ─────────────────────────────────────────────

export default function AuditLog() {
  const [targetType, setTargetType] = useState('');

  const query = useQuery({
    queryKey: ['audit', targetType],
    queryFn: () => auditApi.list({ targetType: targetType || undefined, limit: 100 }),
  });

  const events: AuditEventRecord[] = (query.data?.events ?? (query.data as any)?.data ?? []) as AuditEventRecord[];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Governance"
        title="Audit log"
        description="Every system and user action is captured here. Click View details on any entry for a full breakdown of what changed, who triggered it, and why."
      />

      <section className="surface-card">
        <div className="toolbar" style={{ marginBottom: '1rem' }}>
          <input
            className="input"
            placeholder="Filter by target type (e.g. CLAIM, USER, TEAM)"
            value={targetType}
            onChange={(event) => setTargetType(event.target.value.toUpperCase())}
          />
        </div>

        {events.length > 0 ? (
          <AuditTrailList events={events} />
        ) : (
          <EmptyState
            title="No audit events returned"
            description="Adjust the filter above or generate events by modifying claims, users, or teams."
          />
        )}
      </section>
    </div>
  );
}
