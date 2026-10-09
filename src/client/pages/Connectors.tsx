import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { connectorsApi, type ConnectorRecord } from '../api/connectors.api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { formatDateTime } from '../utils/format';
import { Settings, X, Plus, Trash2, Edit3, Filter } from 'lucide-react';

export default function Connectors() {
  const queryClient = useQueryClient();
  const [rulesTarget, setRulesTarget] = useState<ConnectorRecord | null>(null);
  const [newRuleType, setNewRuleType] = useState('subject_keyword');
  const [newRuleValue, setNewRuleValue] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editType, setEditType] = useState('subject_keyword');
  const [editValue, setEditValue] = useState('');

  const query = useQuery({ queryKey: ['connectors'], queryFn: () => connectorsApi.list() });

  const connectMutation = useMutation({
    mutationFn: () => connectorsApi.connect(),
    onSuccess: (data) => {
      window.open(data.authUrl, '_blank', 'noopener,noreferrer');
      toast.success('OAuth window opened');
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Could not start OAuth'),
  });

  const disconnectMutation = useMutation({
    mutationFn: (id: string) => connectorsApi.disconnect(id),
    onSuccess: () => {
      toast.success('Connector disconnected');
      void queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Disconnect failed'),
  });

  const updateRulesMutation = useMutation({
    mutationFn: ({ id, rules }: { id: string; rules: Array<Record<string, unknown>> }) =>
      connectorsApi.updateRules(id, rules),
    onSuccess: (updated) => {
      toast.success('Filter rules updated');
      setRulesTarget(updated);
      void queryClient.invalidateQueries({ queryKey: ['connectors'] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Failed to update rules'),
  });

  const currentRules = (rulesTarget?.filterRules ?? []) as Array<Record<string, unknown>>;

  const addRule = () => {
    if (!newRuleValue.trim() || !rulesTarget) return;
    const updated = [...currentRules, { type: newRuleType, value: newRuleValue.trim() }];
    updateRulesMutation.mutate({ id: rulesTarget.id, rules: updated });
    setNewRuleValue('');
  };

  const removeRule = (index: number) => {
    if (!rulesTarget) return;
    const updated = currentRules.filter((_, i) => i !== index);
    updateRulesMutation.mutate({ id: rulesTarget.id, rules: updated });
  };

  const startEditing = (index: number, rule: Record<string, unknown>) => {
    setEditingIndex(index);
    setEditType(String(rule.type ?? 'subject_keyword'));
    setEditValue(String(rule.value ?? ''));
  };

  const saveEdit = () => {
    if (editingIndex === null || !rulesTarget) return;
    const updated = [...currentRules];
    updated[editingIndex] = { type: editType, value: editValue.trim() };
    updateRulesMutation.mutate({ id: rulesTarget.id, rules: updated });
    setEditingIndex(null);
  };

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Admin"
        title="Gmail connectors"
        description="Manage ingestion mailboxes, OAuth connection state, and filter-rule readiness for inbound correspondence. If OAuth is not configured locally, the connect action will explain what is missing instead of opening Google."
        actions={<button className="btn btn-primary" onClick={() => connectMutation.mutate()}>Connect Gmail</button>}
      />
      <section className="surface-card">
        {query.data && query.data.length > 0 ? (
          <div className="list-stack">
            {query.data.map((connector) => (
              <div key={connector.id} className="list-item">
                <div>
                  <strong>{connector.email}</strong>
                  <p className="muted-copy">Last sync: {formatDateTime(connector.lastSyncAt)}</p>
                </div>
                  <div className="button-row">
                    {(connector.filterRules as any[])?.length > 0 && (
                      <span className="status-badge status-info" style={{ padding: '0.25rem 0.6rem', fontSize: '0.7rem' }}>
                        <Filter size={10} /> {(connector.filterRules as any[]).length} rules
                      </span>
                    )}
                    <StatusBadge status={connector.status} />
                    <button className="btn btn-secondary btn-sm" onClick={() => setRulesTarget(connector)} title="Filter rules">
                      <Settings size={14} /> Rules
                    </button>
                  <button className="btn btn-ghost" onClick={() => disconnectMutation.mutate(connector.id)}>
                    Disconnect
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No Gmail connectors" description="Start the OAuth flow to attach the first mailbox." />
        )}
      </section>

      {rulesTarget && (
        <div className="modal-backdrop" onClick={() => setRulesTarget(null)}>
          <div className="modal-container surface-card" style={{ maxWidth: '520px' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Filter rules for {rulesTarget.email}</h2>
              <button className="btn-icon" onClick={() => setRulesTarget(null)}><X size={20} /></button>
            </div>
            <div className="page-stack p-4">
              <p className="muted-copy">
                Define patterns to filter incoming emails. Only matching emails will be ingested as claim documents.
              </p>

              {currentRules.length > 0 ? (
                <div className="list-stack compact mt-2">
                  {currentRules.map((rule, i) => (
                    <div key={i} className="list-item compact" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: '3.5rem' }}>
                      {editingIndex === i ? (
                        <div className="toolbar compact" style={{ width: '100%', gap: '8px', display: 'flex' }}>
                          <select className="input" style={{ width: '120px', minHeight: '2.4rem', padding: '0 0.5rem' }} value={editType} onChange={(e) => setEditType(e.target.value)}>
                            <option value="subject_keyword">Subject</option>
                            <option value="sender_domain">Domain</option>
                            <option value="label">Label</option>
                            <option value="exclusion">Exclude</option>
                            <option value="priority">Priority</option>
                          </select>
                          <input
                            className="input"
                            style={{ flex: 1, minHeight: '2.4rem', padding: '0 0.5rem' }}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && saveEdit()}
                            autoFocus
                          />
                          <button className="btn btn-primary compact" style={{ minHeight: '2.4rem' }} onClick={saveEdit}>Save</button>
                          <button className="btn btn-ghost compact" style={{ minHeight: '2.4rem' }} onClick={() => setEditingIndex(null)}><X size={14} /></button>
                        </div>
                      ) : (
                        <>
                          <div style={{ flex: 1 }}>
                            <strong style={{ textTransform: 'capitalize' }}>{String(rule.type ?? 'type').replace('_', ' ')}</strong>
                            <span className="muted-copy"> is </span>
                            <strong style={{ color: 'var(--color-accent-blue)' }}>"{String(rule.value ?? '')}"</strong>
                          </div>
                          <div className="button-row" style={{ gap: '4px' }}>
                            <button className="btn btn-ghost btn-sm" style={{ border: 'none', background: 'transparent' }} onClick={() => startEditing(i, rule)} title="Edit rule">
                              <Edit3 size={14} />
                            </button>
                            <button className="btn btn-ghost btn-sm" style={{ border: 'none', background: 'transparent' }} onClick={() => removeRule(i)} disabled={updateRulesMutation.isPending}>
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted-copy italic mt-2">No filter rules configured. All emails will be ingested.</p>
              )}
              <div className="toolbar compact mt-4" style={{ display: 'flex', gap: '8px' }}>
                <select className="input" style={{ width: '140px' }} value={newRuleType} onChange={(e) => setNewRuleType(e.target.value)}>
                  <option value="subject_keyword">Subject</option>
                  <option value="sender_domain">Domain</option>
                  <option value="label">Label</option>
                  <option value="exclusion">Exclude</option>
                  <option value="priority">Priority</option>
                </select>
                <input
                  className="input"
                  style={{ flex: 1 }}
                  placeholder="Pattern to match..."
                  value={newRuleValue}
                  onChange={(e) => setNewRuleValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && addRule()}
                />
                <button className="btn btn-primary btn-sm" onClick={addRule} disabled={!newRuleValue.trim() || updateRulesMutation.isPending}>
                  <Plus size={16} /> Add
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
