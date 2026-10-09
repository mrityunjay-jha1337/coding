import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { clientsApi, type ClientRecord } from '../api/clients.api';
import { teamsApi } from '../api/teams.api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { Building2, Save, Share2, Clock } from 'lucide-react';

export default function Clients() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [policyLines, setPolicyLines] = useState('');
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null);
  const [teamIdToMap, setTeamIdToMap] = useState('');
  const [slaHours, setSlaHours] = useState('24');
  const [editPolicyLines, setEditPolicyLines] = useState('');

  const clientsQuery = useQuery({ queryKey: ['clients'], queryFn: () => clientsApi.list() });
  const teamsQuery = useQuery({ queryKey: ['teams-lite'], queryFn: () => teamsApi.list() });

  const selectedClient = clientsQuery.data?.find(c => c.id === selectedClientId);

  const createMutation = useMutation({
    mutationFn: () => clientsApi.create({ 
      name, 
      contactEmail, 
      policyLines: policyLines.split(',').map(s => s.trim()).filter(Boolean) 
    }),
    onSuccess: () => {
      toast.success('Client created');
      setName('');
      setContactEmail('');
      setPolicyLines('');
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Client creation failed'),
  });

  const updateProfileMutation = useMutation({
    mutationFn: (data: any) => clientsApi.update(selectedClientId!, data),
    onSuccess: () => {
      toast.success('Client updated');
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Update failed'),
  });

  const mapTeamMutation = useMutation({
    mutationFn: () => clientsApi.mapTeam(selectedClientId!, teamIdToMap),
    onSuccess: () => {
      toast.success('Team mapped to client');
      setTeamIdToMap('');
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Team mapping failed'),
  });

  const slaMutation = useMutation({
    mutationFn: () => clientsApi.updateSla(selectedClientId!, { standardSlaHours: parseInt(slaHours, 10) }),
    onSuccess: () => {
      toast.success('SLA configuration saved');
      void queryClient.invalidateQueries({ queryKey: ['clients'] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'SLA update failed'),
  });

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Admin" title="Clients and payers" description="Manage client accounts, contact points, status, and downstream routing readiness." />
      
      <div className="icd-grid-layout">
        <section className="surface-card">
          <div className="section-header">
            <h2>Client roster</h2>
            <p className="muted-copy">Select a client to manage settings</p>
          </div>
          
          {clientsQuery.data && clientsQuery.data.length > 0 ? (
            <div className="list-stack">
              {clientsQuery.data.map((client) => (
                <div 
                  key={client.id} 
                  className={`list-item clickable ${selectedClientId === client.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedClientId(client.id);
                    setSlaHours(String((client.slaConfig as any)?.standardSlaHours ?? '24'));
                    setEditPolicyLines(client.policyLines?.join(', ') || '');
                  }}
                >
                  <div className="list-item-content">
                    <strong>{client.name}</strong>
                    <p className="muted-copy">{client.contactEmail}</p>
                    <div className="tag-cloud mt-1">
                      {client.policyLines?.map(p => <span key={p} className="badge compact">{p}</span>)}
                    </div>
                  </div>
                  <StatusBadge status={client.status} />
                </div>
              ))}
            </div>
          ) : (
            <EmptyState title="No clients yet" description="Onboard a client to connect queue ownership and SLA reporting." />
          )}
        </section>

        <section className="surface-card">
          {selectedClient ? (
            <div className="page-stack">
              <div className="section-header">
                <h2>{selectedClient.name} Settings</h2>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button 
                    className="btn btn-secondary btn-sm"
                    onClick={() => updateProfileMutation.mutate({ status: selectedClient.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' })}
                    disabled={updateProfileMutation.isPending}
                  >
                    Set {selectedClient.status === 'ACTIVE' ? 'Inactive' : 'Active'}
                  </button>
                </div>
              </div>

              <div className="form-grid">
                <div className="field-group">
                  <span className="label-with-icon"><Building2 size={16} /> Business Lines</span>
                  <div className="horizontal-form-row">
                    <input 
                      className="input" 
                      value={editPolicyLines} 
                      onChange={(e) => setEditPolicyLines(e.target.value)} 
                      placeholder="e.g. Life, Health, IPP (comma separated)"
                    />
                    <button 
                      className="btn btn-primary btn-sm"
                      onClick={() => updateProfileMutation.mutate({ policyLines: editPolicyLines.split(',').map(s => s.trim()).filter(Boolean) })}
                      disabled={updateProfileMutation.isPending}
                    >
                      <Save size={16} /> Save
                    </button>
                  </div>
                </div>

                <div className="field-group">
                  <span className="label-with-icon"><Clock size={16} /> SLA Configuration</span>
                  <div className="horizontal-form-row">
                    <input 
                      type="number" 
                      className="input" 
                      value={slaHours} 
                      onChange={(e) => setSlaHours(e.target.value)} 
                      placeholder="Hours"
                    />
                    <button 
                      className="btn btn-primary btn-sm"
                      onClick={() => slaMutation.mutate()}
                      disabled={slaMutation.isPending}
                    >
                      <Save size={16} /> Save SLA
                    </button>
                  </div>
                  <p className="muted-copy small">Standard processing SLA in hours for this client's claims.</p>
                </div>

                <div className="field-group">
                  <span className="label-with-icon"><Share2 size={16} /> Team Assignment</span>
                  <div className="horizontal-form-row">
                    <select 
                      className="input" 
                      value={teamIdToMap} 
                      onChange={(e) => setTeamIdToMap(e.target.value)}
                    >
                      <option value="">Select team to map...</option>
                      {teamsQuery.data?.filter(t => !selectedClient.teamMappings?.some(m => m.team.id === t.id)).map(t => (
                        <option key={t.id} value={t.id}>{t.name}</option>
                      ))}
                    </select>
                    <button 
                      className="btn btn-primary btn-sm"
                      onClick={() => mapTeamMutation.mutate()}
                      disabled={!teamIdToMap || mapTeamMutation.isPending}
                    >
                      Map Team
                    </button>
                  </div>
                  <div className="tag-cloud mt-2">
                    {selectedClient.teamMappings?.map(m => (
                      <span key={m.team.id} className="meta-pill">{m.team.name}</span>
                    )) || <span className="muted-copy italic">No teams mapped</span>}
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="empty-selection">
              <Building2 size={48} className="muted-icon mb-4" />
              <p className="muted-copy">Select a client from the roster to configure its status, SLA, and team mappings.</p>
            </div>
          )}
        </section>

        <aside className="surface-card">
          <div className="section-header"><h2>Onboard client</h2></div>
          <div className="form-grid">
            <label className="field-group">
              <span>Name</span>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Acme Health" />
            </label>
            <label className="field-group">
              <span>Contact email</span>
              <input className="input" value={contactEmail} onChange={(event) => setContactEmail(event.target.value)} placeholder="contact@acme.com" />
            </label>
            <label className="field-group">
              <span>Business lines</span>
              <input className="input" value={policyLines} onChange={(event) => setPolicyLines(event.target.value)} placeholder="Life, Health (comma separated)" />
            </label>
            <button className="btn btn-primary btn-block" disabled={!name || !contactEmail || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? 'Saving...' : 'Create client'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
