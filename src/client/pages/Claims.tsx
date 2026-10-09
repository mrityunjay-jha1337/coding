import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Link } from 'react-router-dom';
import { claimsApi } from '../api/claims.api';
import { clientsApi } from '../api/clients.api';
import { teamsApi } from '../api/teams.api';
import { processingApi } from '../api/processing.api';
import type { ClaimSummary } from '../api/types';
import { DataTable, type TableColumn } from '../components/DataTable';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { formatConfidence, formatDateTime } from '../utils/format';

export default function Claims() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [clientId, setClientId] = useState('');
  const [teamId, setTeamId] = useState('');
  const [page, setPage] = useState(1);
  const [file, setFile] = useState<File | null>(null);

  const claimsQuery = useQuery({
    queryKey: ['claims', status, search, clientId, teamId, page],
    queryFn: () =>
      claimsApi.list({
        status: status || undefined,
        search: search || undefined,
        clientId: clientId || undefined,
        teamId: teamId || undefined,
        limit: 6,
        page,
      }),
  });

  const clientsQuery = useQuery({ queryKey: ['clients-lite'], queryFn: () => clientsApi.list() });
  const teamsQuery = useQuery({ queryKey: ['teams-lite'], queryFn: () => teamsApi.list() });

  const uploadMutation = useMutation({
    mutationFn: (uploadFile: File) => processingApi.upload(uploadFile),
    onSuccess: (data) => {
      toast.success(`Claim ${data.claimReference} queued for processing`);
      setFile(null);
      void queryClient.invalidateQueries({ queryKey: ['claims'] });
    },
    onError: (error: { error?: string }) => {
      toast.error(error.error || 'Upload failed');
    },
  });

  const rows = claimsQuery.data?.claims ?? claimsQuery.data?.data ?? [];

  const clientMap = useMemo(() => {
    const map = new Map<string, string>();
    (clientsQuery.data ?? []).forEach((client) => map.set(client.id, client.name));
    return map;
  }, [clientsQuery.data]);

  const columns: Array<TableColumn<ClaimSummary>> = [
    {
      key: 'reference',
      header: 'Claim',
      render: (claim) => (
        <div>
          <Link className="table-link" to={`/app/claims/${claim.id}`}>
            {claim.claimReference}
          </Link>
          <div className="subtle-row">{claim.claimant?.name || 'Unnamed claimant'}</div>
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      render: (claim) => <StatusBadge status={claim.status} />,
    },
    {
      key: 'confidence',
      header: 'Confidence',
      // formatConfidence normalises the backend value to a real percentage
      // (legacy records stored 0–1 fractions; newer records store 0–100).
      render: (claim) => formatConfidence(claim.overallConfidence, 1),
    },
    {
      key: 'client',
      header: 'Client',
      render: (claim) => (claim.clientId ? clientMap.get(claim.clientId) ?? 'Mapped client' : 'Unassigned'),
    },
    {
      key: 'updated',
      header: 'Updated',
      render: (claim) => formatDateTime(claim.updatedAt),
    },
  ];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Primary work queue"
        title="Claims work queue"
        description="Filter by lifecycle stage, search by claim reference or claimant name, and open the detailed review workspace."
        actions={
          <Link className="btn btn-secondary" to="/app/icd">
            Open ICD workbench
          </Link>
        }
      />

      <div className="split-dashboard">
        <section className="surface-card card-stack">
          <div className="toolbar">
            <input
              className="input"
              placeholder="Search claim or claimant"
              value={search}
              onChange={(event) => { setSearch(event.target.value); setPage(1); }}
            />
            <select className="input" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}>
              <option value="">All statuses</option>
              <option value="NEW"               style={{ color: '#6b7280', background: '#f9fafb' }}>New</option>
              <option value="EXTRACTING"        style={{ color: '#6366f1', background: '#f0f0ff' }}>Extracting</option>
              <option value="TRANSLATING"       style={{ color: '#6366f1', background: '#f0f0ff' }}>Translating</option>
              <option value="CODING"            style={{ color: '#6366f1', background: '#f0f0ff' }}>Coding</option>
              <option value="VALIDATING"        style={{ color: '#6366f1', background: '#f0f0ff' }}>Validating</option>
              <option value="REVIEWING"         style={{ color: '#b45309', background: '#fffbeb' }}>Reviewing</option>
              <option value="QUERYING_MEMBER"   style={{ color: '#b45309', background: '#fffbeb' }}>Querying Member</option>
              <option value="QUERYING_PROVIDER" style={{ color: '#b45309', background: '#fffbeb' }}>Querying Provider</option>
              <option value="COMPLETE"          style={{ color: '#15803d', background: '#f0fdf4', fontWeight: 600 }}>Complete</option>
              <option value="DENIED"            style={{ color: '#b91c1c', background: '#fef2f2', fontWeight: 600 }}>Denied</option>
              <option value="ON_HOLD"           style={{ color: '#c2410c', background: '#fff7ed', fontWeight: 600 }}>On hold</option>
              <option value="DUPLICATE"         style={{ color: '#b91c1c', background: '#fef2f2', fontWeight: 600 }}>Duplicate</option>
            </select>

            <select className="input" value={clientId} onChange={(e) => { setClientId(e.target.value); setPage(1); }}>
              <option value="">All Clients</option>
              {clientsQuery.data?.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select className="input" value={teamId} onChange={(e) => { setTeamId(e.target.value); setPage(1); }}>
              <option value="">All Teams</option>
              {teamsQuery.data?.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <DataTable
            columns={columns}
            rows={rows}
            emptyState={
              <EmptyState
                title="No claims match the current filters"
                description="Adjust the queue filters or upload a new claim file to start the pipeline."
              />
            }
          />
          <div className="pagination-bar">
            <div className="muted-copy">
              Page {claimsQuery.data?.page || 1} of {Math.max(1, Math.ceil((claimsQuery.data?.total || 0) / 6))}
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
                disabled={page >= Math.ceil((claimsQuery.data?.total || 0) / 6)}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </section>

        <aside className="surface-card">
          <div className="section-header">
            <h2>Claim upload</h2>
          </div>
          <p className="muted-copy">
            Manual uploads create a claim record and enqueue the backend processing pipeline.
          </p>
          <label className="upload-box">
            <span>{file ? file.name : 'Choose a PDF document'}</span>
            <input
              type="file"
              accept=".pdf,application/pdf"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          </label>
          <button
            className="btn btn-primary btn-block"
            disabled={!file || uploadMutation.isPending}
            onClick={() => {
              if (file) {
                uploadMutation.mutate(file);
              }
            }}
          >
            {uploadMutation.isPending ? 'Uploading...' : 'Queue claim for processing'}
          </button>
        </aside>
      </div>
    </div>
  );
}
