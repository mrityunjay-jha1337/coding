import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { bupaApi } from '../api/bupa.api';
import { useAuthStore } from '../stores/authStore';
import type { MemberRecord, EligibilityResult } from '../api/bupa.api';
import type { TableColumn } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime, formatCurrency } from '../utils/format';
import { ShieldCheck, X, User, CreditCard, Plus } from 'lucide-react';

interface MemberDetail extends MemberRecord {
  title?: string | null;
  dateOfBirth: string;
  address?: Record<string, string>;
  policyStartDate?: string;
  policyEndDate?: string;
  deductibleAmount?: number | null;
  deductibleCurrency?: string | null;
  deductibleUsed?: number;
  coInsuranceRate?: number | null;
  networkOption?: string;
  geographicCover?: string;
  plan?: { name: string; tier: string };
}

interface EligibilityForm {
  treatmentDate: string;
  treatmentCountry: string;
  treatmentType: string;
}

const PLAN_TIERS = [
  { value: '', label: 'All plan tiers' },
  { value: 'MAJOR_MEDICAL', label: 'Major Medical' },
  { value: 'SELECT', label: 'Select' },
  { value: 'PREMIER', label: 'Premier' },
  { value: 'ELITE', label: 'Elite' },
  { value: 'ULTIMATE', label: 'Ultimate' },
];

const MEMBER_STATUSES = [
  { value: '', label: 'All statuses' },
  { value: 'ACTIVE', label: 'Active' },
  { value: 'SUSPENDED', label: 'Suspended' },
  { value: 'LAPSED', label: 'Lapsed' },
  { value: 'CANCELLED', label: 'Cancelled' },
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

interface CreateMemberModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

function CreateMemberModal({ onClose, onSuccess }: CreateMemberModalProps) {
  const [formData, setFormData] = useState({
    membershipNumber: '',
    firstName: '',
    lastName: '',
    dateOfBirth: '',
    email: '',
    phone: '',
    planId: '',
    planTier: 'SELECT',
    policyStartDate: new Date().toISOString().split('T')[0],
    policyEndDate: new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString().split('T')[0],
    deductibleAmount: 0,
    deductibleCurrency: 'USD',
    coInsuranceRate: 0.1,
    networkOption: 'STANDARD',
    geographicCover: 'WORLDWIDE',
  });

  const plansQuery = useQuery({
    queryKey: ['bupa-plans'],
    queryFn: () => bupaApi.listPlans(),
  });

  const createMutation = useMutation({
    mutationFn: (data: any) => bupaApi.createMember(data),
    onSuccess: () => {
      toast.success('Member created successfully');
      onSuccess();
      onClose();
    },
    onError: (error: any) => {
      toast.error(error.error || 'Failed to create member');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate({
      ...formData,
      deductibleAmount: Number(formData.deductibleAmount),
      coInsuranceRate: Number(formData.coInsuranceRate),
    });
  };

  const updateField = (field: keyof typeof formData, value: string | number) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-container surface-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '600px' }}>
        <div className="modal-header">
          <h2>Add New Member</h2>
          <button className="btn-icon" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <form className="modal-form" onSubmit={handleSubmit} style={{ maxHeight: '80vh', overflowY: 'auto', padding: '16px' }}>
          <div className="form-row">
            <div className="form-group">
              <label>Membership Number</label>
              <input
                className="input"
                required
                value={formData.membershipNumber}
                onChange={(e) => updateField('membershipNumber', e.target.value)}
                placeholder="e.g. TWC-23-XXXX"
              />
            </div>
            <div className="form-group">
              <label>Plan Tier</label>
              <select
                className="input"
                value={formData.planTier}
                onChange={(e) => updateField('planTier', e.target.value)}
              >
                {PLAN_TIERS.filter(p => p.value).map((tier) => (
                  <option key={tier.value} value={tier.value}>{tier.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>First Name</label>
              <input
                className="input"
                required
                value={formData.firstName}
                onChange={(e) => updateField('firstName', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Last Name</label>
              <input
                className="input"
                required
                value={formData.lastName}
                onChange={(e) => updateField('lastName', e.target.value)}
              />
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Date of Birth</label>
              <input
                className="input"
                type="date"
                required
                value={formData.dateOfBirth}
                onChange={(e) => updateField('dateOfBirth', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Email</label>
              <input
                className="input"
                type="email"
                value={formData.email}
                onChange={(e) => updateField('email', e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label>Health Plan</label>
            <select
              className="input"
              required
              value={formData.planId}
              onChange={(e) => updateField('planId', e.target.value)}
            >
              <option value="">Select a plan</option>
              {plansQuery.data?.map((plan) => (
                <option key={plan.id} value={plan.id}>{plan.name} ({plan.tier})</option>
              ))}
            </select>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Policy Start Date</label>
              <input
                className="input"
                type="date"
                required
                value={formData.policyStartDate}
                onChange={(e) => updateField('policyStartDate', e.target.value)}
              />
            </div>
            <div className="form-group">
              <label>Policy End Date</label>
              <input
                className="input"
                type="date"
                required
                value={formData.policyEndDate}
                onChange={(e) => updateField('policyEndDate', e.target.value)}
              />
            </div>
          </div>

          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={createMutation.isPending}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function EligibilityCheckPanel({
  memberId,
  onClose,
}: {
  memberId: string;
  onClose: () => void;
}) {
  const [form, setForm] = useState<EligibilityForm>({
    treatmentDate: new Date().toISOString().split('T')[0],
    treatmentCountry: '',
    treatmentType: '',
  });

  const [result, setResult] = useState<EligibilityResult | null>(null);

  const eligibilityMutation = useMutation({
    mutationFn: () =>
      bupaApi.checkEligibility(memberId, {
        treatmentDate: form.treatmentDate,
        treatmentCountry: form.treatmentCountry,
        treatmentType: form.treatmentType || undefined,
      }),
    onSuccess: (data) => {
      setResult(data);
    },
    onError: (error: { error?: string }) => {
      toast.error(error.error || 'Eligibility check failed');
    },
  });

  const updateField = (field: keyof EligibilityForm, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setResult(null);
  };

  return (
    <div className="surface-card" style={{ marginTop: '12px', padding: '16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
        <div className="section-header" style={{ margin: 0 }}>
          <ShieldCheck size={16} />
          <h3 style={{ margin: 0, fontSize: '14px' }}>Quick Eligibility Check</h3>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>
          <X size={14} />
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', marginBottom: '12px' }}>
        <input
          className="input"
          type="date"
          value={form.treatmentDate}
          onChange={(e) => updateField('treatmentDate', e.target.value)}
          placeholder="Treatment date"
        />
        <input
          className="input"
          value={form.treatmentCountry}
          onChange={(e) => updateField('treatmentCountry', e.target.value)}
          placeholder="Country (e.g. GB)"
        />
        <select
          className="input"
          value={form.treatmentType}
          onChange={(e) => updateField('treatmentType', e.target.value)}
        >
          <option value="">Treatment type</option>
          <option value="INPATIENT">Inpatient</option>
          <option value="OUTPATIENT">Outpatient</option>
          <option value="DENTAL">Dental</option>
          <option value="OPTICAL">Optical</option>
          <option value="MATERNITY">Maternity</option>
          <option value="MENTAL_HEALTH">Mental Health</option>
        </select>
      </div>

      <button
        className="btn btn-primary btn-sm"
        disabled={!form.treatmentDate || !form.treatmentCountry || eligibilityMutation.isPending}
        onClick={() => eligibilityMutation.mutate()}
      >
        {eligibilityMutation.isPending ? 'Checking...' : 'Check Eligibility'}
      </button>

      {result ? (
        <div style={{ marginTop: '12px', padding: '12px', borderRadius: '6px', background: result.isEligible ? 'var(--color-accent-green-light)' : 'var(--color-accent-red-light)', border: result.isEligible ? '1px solid var(--color-accent-green)' : '1px solid var(--color-accent-red)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
            <StatusBadge status={result.isEligible ? 'ACTIVE' : 'REJECTED'} />
            <strong>{result.isEligible ? 'Eligible' : 'Not Eligible'}</strong>
          </div>
          <p className="muted-copy" style={{ margin: '0 0 8px' }}>{result.reason}</p>
          {result.preAuthRequired ? (
            <p style={{ margin: '0 0 8px', fontWeight: 600, color: 'var(--color-status-warning-text)' }}>
              Pre-authorization required
            </p>
          ) : null}
          <InfoRow label="Deductible remaining" value={formatCurrency(result.deductibleRemaining)} />
          {result.checks.length > 0 ? (
            <div className="list-stack" style={{ marginTop: '8px' }}>
              {result.checks.map((check, idx) => (
                <div key={idx} className="list-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span>{check.name}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <StatusBadge status={check.status} />
                    <span className="muted-copy">{check.message}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function MemberDetailPanel({ memberId }: { memberId: string }) {
  const [showEligibility, setShowEligibility] = useState(false);

  const detailQuery = useQuery({
    queryKey: ['bupa-member', memberId],
    queryFn: () => bupaApi.getMember(memberId),
  });

  const member = detailQuery.data as MemberDetail | undefined;

  if (detailQuery.isLoading) {
    return (
      <tr>
        <td colSpan={6}>
          <div style={{ padding: '24px', textAlign: 'center' }} className="muted-copy">
            Loading member details...
          </div>
        </td>
      </tr>
    );
  }

  if (detailQuery.isError || !member) {
    return (
      <tr>
        <td colSpan={6}>
          <div style={{ padding: '24px', textAlign: 'center' }} className="muted-copy">
            Failed to load member details.
          </div>
        </td>
      </tr>
    );
  }

  const address = member.address;
  const addressStr = address
    ? [address.line1, address.line2, address.city, address.state, address.postalCode, address.country]
        .filter(Boolean)
        .join(', ')
    : 'N/A';

  const deductibleRemaining =
    member.deductibleAmount != null
      ? Math.max(0, member.deductibleAmount - (member.deductibleUsed ?? 0))
      : null;

  return (
    <tr>
      <td colSpan={6} style={{ padding: 0 }}>
        <div style={{ padding: '16px 24px', background: 'var(--color-bg-primary)', borderBottom: '1px solid var(--color-border-default)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
            {/* Personal Info */}
            <div>
              <div className="section-header" style={{ marginBottom: '8px' }}>
                <User size={16} />
                <h3 style={{ margin: 0, fontSize: '14px' }}>Personal Information</h3>
              </div>
              <InfoRow label="Full name" value={`${member.title ?? ''} ${member.firstName} ${member.lastName}`.trim()} />
              <InfoRow label="Date of birth" value={formatDateTime(member.dateOfBirth)?.split(' ')[0] ?? member.dateOfBirth} />
              <InfoRow label="Email" value={member.email} />
              <InfoRow label="Phone" value={member.phone} />
              <InfoRow label="Address" value={addressStr} />
            </div>

            {/* Plan Info */}
            <div>
              <div className="section-header" style={{ marginBottom: '8px' }}>
                <CreditCard size={16} />
                <h3 style={{ margin: 0, fontSize: '14px' }}>Plan Information</h3>
              </div>
              <InfoRow label="Plan" value={member.plan?.name} />
              <InfoRow label="Tier" value={member.planTier} />
              <InfoRow label="Policy start" value={member.policyStartDate ? formatDateTime(member.policyStartDate) : null} />
              <InfoRow label="Policy end" value={member.policyEndDate ? formatDateTime(member.policyEndDate) : null} />
              <InfoRow
                label="Deductible"
                value={
                  member.deductibleAmount != null
                    ? `${formatCurrency(member.deductibleAmount)} ${member.deductibleCurrency ?? 'USD'}`
                    : null
                }
              />
              <InfoRow
                label="Deductible used"
                value={member.deductibleUsed != null ? formatCurrency(member.deductibleUsed) : null}
              />
              <InfoRow
                label="Deductible remaining"
                value={deductibleRemaining != null ? formatCurrency(deductibleRemaining) : null}
              />
              <InfoRow
                label="Co-insurance"
                value={member.coInsuranceRate != null ? `${(member.coInsuranceRate * 100).toFixed(0)}%` : null}
              />
              <InfoRow label="Network option" value={member.networkOption} />
              <InfoRow label="Geographic cover" value={member.geographicCover} />
            </div>
          </div>

          {!showEligibility ? (
            <button
              className="btn btn-secondary btn-sm"
              style={{ marginTop: '12px' }}
              onClick={() => setShowEligibility(true)}
            >
              <ShieldCheck size={14} />
              Quick Eligibility Check
            </button>
          ) : (
            <EligibilityCheckPanel memberId={memberId} onClose={() => setShowEligibility(false)} />
          )}
        </div>
      </td>
    </tr>
  );
}

export default function Members() {
  const [search, setSearch] = useState('');
  const [planTier, setPlanTier] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isAddingMember, setIsAddingMember] = useState(false);

  const { user } = useAuthStore();
  const canAddMember = user?.permissions.includes('*') || user?.permissions.includes('claims:create');

  const membersQuery = useQuery({
    queryKey: ['bupa-members', search, planTier, status, page],
    queryFn: () =>
      bupaApi.listMembers({
        search: search || undefined,
        planTier: planTier || undefined,
        status: status || undefined,
        limit: PAGE_SIZE,
        page,
      }),
  });

  const responseData = membersQuery.data;
  const rows: MemberRecord[] = responseData?.data ?? [];
  const pagination = (responseData as any)?.pagination;
  const total: number = pagination?.total ?? responseData?.total ?? 0;
  const totalPages: number = pagination?.totalPages ?? Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage: number = pagination?.page ?? responseData?.page ?? page;

  const toggleExpand = (id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  };

  const columns: Array<TableColumn<MemberRecord>> = [
    {
      key: 'membershipNumber',
      header: 'Membership #',
      render: (member) => (
        <div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontWeight: 600, padding: 0, textDecoration: 'underline', cursor: 'pointer' }}
            onClick={() => toggleExpand(member.id)}
          >
            {member.membershipNumber}
          </button>
        </div>
      ),
    },
    {
      key: 'name',
      header: 'Name',
      render: (member) => `${member.firstName} ${member.lastName}`,
    },
    {
      key: 'planTier',
      header: 'Plan Tier',
      render: (member) => <StatusBadge status={member.planTier} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (member) => <StatusBadge status={member.status} />,
    },
    {
      key: 'email',
      header: 'Email',
      render: (member) => member.email ?? <span className="muted-copy">N/A</span>,
    },
    {
      key: 'phone',
      header: 'Phone',
      render: (member) => member.phone ?? <span className="muted-copy">N/A</span>,
    },
  ];

  // Build rows with inline expansion
  const tableContent = rows.length === 0 ? (
    <EmptyState
      title="No members match the current filters"
      description="Adjust the search or filter criteria to find member records."
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
          {rows.map((member) => (
            <>
              <tr key={member.id} style={{ cursor: 'pointer' }} onClick={() => toggleExpand(member.id)}>
                {columns.map((col) => (
                  <td key={col.key}>{col.render(member)}</td>
                ))}
              </tr>
              {expandedId === member.id ? (
                <MemberDetailPanel key={`detail-${member.id}`} memberId={member.id} />
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
        title="Members"
        description="View and manage member records"
        actions={
          canAddMember && (
            <button className="btn btn-primary" onClick={() => setIsAddingMember(true)}>
              <Plus size={16} />
              Add Member
            </button>
          )
        }
      />

      {isAddingMember && (
        <CreateMemberModal
          onClose={() => setIsAddingMember(false)}
          onSuccess={() => membersQuery.refetch()}
        />
      )}

      <section className="surface-card card-stack">
        <div className="toolbar">
          <input
            className="input"
            placeholder="Search by name or membership number"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
          <select className="input" value={planTier} onChange={(e) => { setPlanTier(e.target.value); setPage(1); }}>
            {PLAN_TIERS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <select className="input" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
            {MEMBER_STATUSES.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {tableContent}

        <div className="pagination-bar">
          <div className="muted-copy">
            Page {currentPage} of {totalPages}
            {total > 0 ? ` (${total} members)` : ''}
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
