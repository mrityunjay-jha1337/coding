import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { claimsApi } from '../api/claims.api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';

export default function Denials() {
  const query = useQuery({
    queryKey: ['denials'],
    queryFn: () => claimsApi.list({ status: 'ON_HOLD', limit: 50 }),
  });

  const claims = query.data?.claims ?? query.data?.data ?? [];

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Exception handling" title="Denial management" description="A filtered view of claims requiring intervention, follow-up, or appeal handling." />
      <section className="surface-card">
        {claims.length > 0 ? (
          <div className="list-stack">
            {claims.map((claim) => (
              <Link key={claim.id} className="list-item interactive" to={`/app/claims/${claim.id}`}>
                <div>
                  <strong>{claim.claimReference}</strong>
                  <p className="muted-copy">{claim.claimant?.name || 'Unnamed claimant'}</p>
                </div>
                <StatusBadge status={claim.status} />
              </Link>
            ))}
          </div>
        ) : (
          <EmptyState title="No denial cases in this filter" description="Claims on hold or reopened will appear here when the backend state reflects intervention work." />
        )}
      </section>
    </div>
  );
}
