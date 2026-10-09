import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { teamsApi } from '../api/teams.api';
import { usersApi } from '../api/users.api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { Users, Trash2, Plus } from 'lucide-react';
import { StatusBadge } from '../components/StatusBadge';

export default function Teams() {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');

  const teamsQuery = useQuery({ queryKey: ['teams'], queryFn: () => teamsApi.list() });
  const teamDetailQuery = useQuery({
    queryKey: ['team-detail', selectedTeamId],
    queryFn: () => teamsApi.detail(selectedTeamId!),
    enabled: Boolean(selectedTeamId),
  });
  const usersQuery = useQuery({
    queryKey: ['users-lite'],
    queryFn: () => usersApi.list({ limit: 100 })
  });

  const selectedTeam = teamDetailQuery.data ?? teamsQuery.data?.find(t => t.id === selectedTeamId);

  const createMutation = useMutation({
    mutationFn: () => teamsApi.create({ name }),
    onSuccess: () => {
      toast.success('Team created');
      setName('');
      void queryClient.invalidateQueries({ queryKey: ['teams'] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Team creation failed'),
  });

  const addMemberMutation = useMutation({
    mutationFn: (userId: string) => teamsApi.addMember(selectedTeamId!, userId),
    onSuccess: () => {
      toast.success('Member added to team');
      setInviteEmail('');
      void queryClient.invalidateQueries({ queryKey: ['teams'] });
      void queryClient.invalidateQueries({ queryKey: ['team-detail', selectedTeamId] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Failed to add member'),
  });

  const removeMemberMutation = useMutation({
    mutationFn: (userId: string) => teamsApi.removeMember(selectedTeamId!, userId),
    onSuccess: () => {
      toast.success('Member removed from team');
      void queryClient.invalidateQueries({ queryKey: ['teams'] });
      void queryClient.invalidateQueries({ queryKey: ['team-detail', selectedTeamId] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Failed to remove member'),
  });

  const updateLeadMutation = useMutation({
    mutationFn: (userId: string | null) => teamsApi.update(selectedTeamId!, { leadId: userId }),
    onSuccess: () => {
      toast.success('Team lead updated');
      void queryClient.invalidateQueries({ queryKey: ['teams'] });
      void queryClient.invalidateQueries({ queryKey: ['team-detail', selectedTeamId] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Failed to update lead'),
  });

  return (
    <div className="page-stack">
      <PageHeader 
        eyebrow="Admin" 
        title="Groups and teams" 
        description="Segment the workforce into functional units to manage queue permissions and throughput analysis." 
      />
      
      <div className="split-dashboard">
        <section className="surface-card">
          <div className="section-header">
            <h2>Current teams</h2>
          </div>
          
          <div className="list-stack">
            {(teamsQuery.data ?? []).map((team) => (
              <div 
                key={team.id} 
                className={`list-item clickable ${selectedTeamId === team.id ? 'active' : ''}`}
                onClick={() => setSelectedTeamId(team.id)}
              >
                <div>
                  <strong>{team.name}</strong>
                  <p className="muted-copy">{(team as any).lead?.name || 'No lead assigned'}</p>
                </div>
                <div className="list-meta">
                  {team.members?.length || 0} members
                </div>
              </div>
            ))}
            {(teamsQuery.data ?? []).length === 0 && (
              <EmptyState title="No teams yet" description="Create the first team to start client routing and claim assignment." />
            )}
          </div>
        </section>

        <section className="surface-card">
          {selectedTeam ? (
            <div className="page-stack">
              <div className="section-header">
                <h2>{selectedTeam.name} Roster</h2>
                <div className="list-actions no-shrink">
                  <select 
                    className="input compact" 
                    value={selectedTeam.leadId || ''} 
                    onChange={(e) => updateLeadMutation.mutate(e.target.value || null)}
                    disabled={updateLeadMutation.isPending}
                  >
                    <option value="">Assign lead...</option>
                    {selectedTeam.members?.map(m => (
                      <option key={m.user.id} value={m.user.id}>{m.user.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="toolbar compact">
                <input 
                  className="input" 
                  placeholder="Add user to team (email)" 
                  value={inviteEmail} 
                  onChange={(e) => setInviteEmail(e.target.value)} 
                />
                <button 
                  className="btn btn-primary compact"
                  onClick={() => {
                    const rows = (usersQuery.data as any)?.users ?? (usersQuery.data as any)?.data ?? [];
                    const user = rows.find((u: any) => u.email.toLowerCase() === inviteEmail.toLowerCase());
                    if (user) {
                      addMemberMutation.mutate(user.id);
                    } else {
                      toast.error('User not found in system or check email spelling');
                    }
                  }}
                  disabled={!inviteEmail || addMemberMutation.isPending}
                >
                  <Plus size={16} />
                </button>
              </div>

              <div className="list-stack compact mt-4">
                {selectedTeam.members?.map((member) => (
                  <div key={member.user.id} className="list-item">
                    <div style={{ flex: 1 }}>
                      <strong>{member.user.name} {selectedTeam.leadId === member.user.id && <span className="badge badge-primary compact ml-2">Lead</span>}</strong>
                      <p className="muted-copy">{member.user.email} · {member.user.specialisation || 'Generalist'}</p>
                    </div>
                    <button 
                      className="btn btn-ghost compact no-shrink"
                      onClick={() => removeMemberMutation.mutate(member.user.id)}
                      disabled={removeMemberMutation.isPending}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
                {selectedTeam.members?.length === 0 && (
                  <p className="muted-copy text-center py-4 italic">No members in this team yet.</p>
                )}
              </div>
            </div>
          ) : (
            <div className="empty-selection">
              <Users size={48} className="muted-icon mb-4" />
              <p className="muted-copy">Select a team from the roster to view members, assign a lead, or manage unit membership.</p>
            </div>
          )}
        </section>

        <aside className="surface-card">
          <div className="section-header">
            <h2>Create team</h2>
          </div>
          <div className="form-grid">
            <label className="field-group">
              <span>Team name</span>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Orthopedics Team" />
            </label>
            <button className="btn btn-primary btn-block" disabled={!name || createMutation.isPending} onClick={() => createMutation.mutate()}>
              {createMutation.isPending ? 'Creating...' : 'Create team'}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}
