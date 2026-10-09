import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { bupaApi } from '../api/bupa.api';
import type { ProviderRecord } from '../api/bupa.api';
import type { TableColumn } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime } from '../utils/format';
import { Building2, ShieldCheck, Network, Stethoscope } from 'lucide-react';

interface ProviderDetail extends ProviderRecord {
  email?: string | null;
  phone?: string | null;
  address?: Record<string, string>;
  specialty?: string[];
  bupaProviderId?: string | null;
  lastVerifiedAt?: string | null;
  licenseNumber?: string | null;
  networkMappings?: Array<{
    id: string;
    planTier: string;
    isInNetwork: boolean;
    negotiatedRates?: Record<string, unknown> | null;
  }>;
}

const NETWORK_STATUSES = [
  { value: '', label: 'All network statuses' },
  { value: 'IN_NETWORK', label: 'In Network' },
  { value: 'OUT_OF_NETWORK', label: 'Out of Network' },
  { value: 'PENDING_VERIFICATION', label: 'Pending Verification' },
];

const PROVIDER_TYPES = [
  { value: '', label: 'All provider types' },
  { value: 'HOSPITAL', label: 'Hospital' },
  { value: 'CLINIC', label: 'Clinic' },
  { value: 'PRACTITIONER', label: 'Practitioner' },
  { value: 'LABORATORY', label: 'Laboratory' },
  { value: 'PHARMACY', label: 'Pharmacy' },
];

const PAGE_SIZE = 10;

function InfoRow({ label, value }: { label: string; value?: string | number | null }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid var(--color-border-subtle)' }}>
      <span className="muted-copy" style={{ fontWeight: 500, color: 'var(--color-text-secondary)' }}>{label}</span>
      <span style={{ color: 'var(--color-text-primary)' }}>{value ?? 'N/A'}</span>
    </div>
  );
}

function ProviderDetailPanel({ providerId }: { providerId: string }) {
  const detailQuery = useQuery({
    queryKey: ['bupa-provider', providerId],
    queryFn: () => bupaApi.getProvider(providerId),
  });

  const provider = detailQuery.data as ProviderDetail | undefined;

  if (detailQuery.isLoading) {
    return (
      <tr>
        <td colSpan={6}>
          <div style={{ padding: '24px', textAlign: 'center' }} className="muted-copy">
            Loading provider details...
          </div>
        </td>
      </tr>
    );
  }

  if (detailQuery.isError || !provider) {
    return (
      <tr>
        <td colSpan={6}>
          <div style={{ padding: '24px', textAlign: 'center' }} className="muted-copy">
            Failed to load provider details.
          </div>
        </td>
      </tr>
    );
  }

  const address = provider.address;
  const addressStr = address
    ? [address.line1, address.line2, address.city, address.state, address.postalCode, address.country]
        .filter(Boolean)
        .join(', ')
    : 'N/A';

  const specialties: string[] = Array.isArray(provider.specialty) ? provider.specialty : [];
  const networkMappings = provider.networkMappings ?? [];

  return (
    <tr>
      <td colSpan={6} style={{ padding: 0 }}>
        <div style={{ padding: '16px 24px', background: 'var(--color-bg-primary)', borderBottom: '1px solid var(--color-border-default)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {/* Contact & Address */}
            <div>
              <div className="section-header" style={{ marginBottom: '8px' }}>
                <Building2 size={16} />
                <h3 style={{ margin: 0, fontSize: '14px' }}>Contact & Address</h3>
              </div>
              <InfoRow label="Provider name" value={provider.providerName} />
              <InfoRow label="Facility" value={provider.facilityName} />
              <InfoRow label="Email" value={provider.email} />
              <InfoRow label="Phone" value={provider.phone} />
              <InfoRow label="Address" value={addressStr} />
              <InfoRow label="License #" value={provider.licenseNumber} />

              {specialties.length > 0 ? (
                <div style={{ marginTop: '12px' }}>
                  <div className="section-header" style={{ marginBottom: '8px' }}>
                    <Stethoscope size={16} />
                    <h3 style={{ margin: 0, fontSize: '14px' }}>Specialties</h3>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                    {specialties.map((spec, idx) => (
                      <StatusBadge key={idx} status={spec} />
                    ))}
                  </div>
                </div>
              ) : null}
            </div>

            {/* Network & Verification */}
            <div>
              <div className="section-header" style={{ marginBottom: '8px' }}>
                <ShieldCheck size={16} />
                <h3 style={{ margin: 0, fontSize: '14px' }}>Verification Details</h3>
              </div>
              <InfoRow label="Bupa Provider ID" value={provider.bupaProviderId} />
              <InfoRow label="Network status" value={provider.networkStatus} />
              <InfoRow label="Accreditation" value={provider.accreditationStatus} />
              <InfoRow label="Last verified" value={provider.lastVerifiedAt ? formatDateTime(provider.lastVerifiedAt) : null} />
              <InfoRow label="Country" value={provider.country} />

              {networkMappings.length > 0 ? (
                <div style={{ marginTop: '16px' }}>
                  <div className="section-header" style={{ marginBottom: '8px' }}>
                    <Network size={16} />
                    <h3 style={{ margin: 0, fontSize: '14px' }}>Network Mappings by Plan Tier</h3>
                  </div>
                  <div className="table-shell">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th>Plan Tier</th>
                          <th>In Network</th>
                        </tr>
                      </thead>
                      <tbody>
                        {networkMappings.map((mapping) => (
                          <tr key={mapping.id}>
                            <td><StatusBadge status={mapping.planTier} /></td>
                            <td>
                              <StatusBadge status={mapping.isInNetwork ? 'ACTIVE' : 'INACTIVE'} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </td>
    </tr>
  );
}

export default function Providers() {
  const [search, setSearch] = useState('');
  const [networkStatus, setNetworkStatus] = useState('');
  const [country, setCountry] = useState('');
  const [providerType, setProviderType] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const providersQuery = useQuery({
    queryKey: ['bupa-providers', search, networkStatus, country, providerType, page],
    queryFn: () =>
      bupaApi.listProviders({
        search: search || undefined,
        networkStatus: networkStatus || undefined,
        country: country || undefined,
        providerType: providerType || undefined,
        limit: PAGE_SIZE,
        page,
      }),
  });

  const responseData = providersQuery.data;
  const rows: ProviderRecord[] = responseData?.data ?? [];
  const pagination = (responseData as any)?.pagination;
  const total: number = pagination?.total ?? responseData?.total ?? 0;
  const totalPages: number = pagination?.totalPages ?? Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage: number = pagination?.page ?? responseData?.page ?? page;

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const columns: Array<TableColumn<ProviderRecord>> = [
    {
      key: 'providerName',
      header: 'Provider Name',
      render: (provider) => (
        <button
          className="btn btn-ghost btn-sm"
          style={{ fontWeight: 600, padding: 0, textDecoration: 'underline', cursor: 'pointer' }}
          onClick={() => toggleExpand(provider.id)}
        >
          {provider.providerName}
        </button>
      ),
    },
    {
      key: 'facilityName',
      header: 'Facility',
      render: (provider) => provider.facilityName ?? <span className="muted-copy">N/A</span>,
    },
    {
      key: 'providerType',
      header: 'Type',
      render: (provider) => <StatusBadge status={provider.providerType} />,
    },
    {
      key: 'country',
      header: 'Country',
      render: (provider) => provider.country,
    },
    {
      key: 'networkStatus',
      header: 'Network Status',
      render: (provider) => <StatusBadge status={provider.networkStatus} />,
    },
    {
      key: 'accreditationStatus',
      header: 'Accreditation',
      render: (provider) => <StatusBadge status={provider.accreditationStatus} />,
    },
  ];

  // Build rows with inline expansion
  const tableContent = rows.length === 0 ? (
    <EmptyState
      title="No providers match the current filters"
      description="Adjust the search or filter criteria to find provider records."
    />
  ) : (
    <div className="table-shell">
      <table className="data-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((provider) => (
            <>
              <tr key={provider.id} style={{ cursor: 'pointer' }} onClick={() => toggleExpand(provider.id)}>
                {columns.map((col) => (
                  <td key={col.key}>{col.render(provider)}</td>
                ))}
              </tr>
              {expandedId === provider.id ? (
                <ProviderDetailPanel key={`detail-${provider.id}`} providerId={provider.id} />
              ) : null}
            </>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Bupa Global"
        title="Providers"
        description="Healthcare provider registry"
      />

      <section className="surface-card card-stack">
        <div className="toolbar">
          <input
            className="input"
            placeholder="Search by facility or practitioner name"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <select className="input" value={networkStatus} onChange={(e) => { setNetworkStatus(e.target.value); setPage(1); }}>
            {NETWORK_STATUSES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <input
            className="input"
            placeholder="Country"
            value={country}
            onChange={(e) => { setCountry(e.target.value); setPage(1); }}
          />
          <select className="input" value={providerType} onChange={(e) => { setProviderType(e.target.value); setPage(1); }}>
            {PROVIDER_TYPES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {tableContent}

        <div className="pagination-bar">
          <div className="muted-copy">
            Page {currentPage} of {totalPages}
            {total > 0 ? ` (${total} providers)` : ''}
          </div>
          <div className="pagination-actions">
            <button
              className="btn btn-secondary btn-sm"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </button>
            <button
              className="btn btn-secondary btn-sm"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
