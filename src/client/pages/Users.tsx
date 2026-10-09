import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { UserRecord, usersApi } from '../api/users.api';
import { EmptyState } from '../components/EmptyState';
import { PageHeader } from '../components/PageHeader';
import { StatusBadge } from '../components/StatusBadge';
import { InviteUserModal } from '../components/InviteUserModal';
import { EditUserModal } from '../components/EditUserModal';
import { Edit2, Settings } from 'lucide-react';

export default function Users() {
  const queryClient = useQueryClient();
  const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRecord | null>(null);
  const [search, setSearch] = useState('');
  const [roleName, setRoleName] = useState('');
  const [status, setStatus] = useState('');

  const query = useQuery({ 
    queryKey: ['users', search, roleName, status], 
    queryFn: () => usersApi.list({ search, roleName, status, limit: 100 }) 
  });
  
  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) => usersApi.update(id, data),
    onSuccess: () => {
      toast.success('User updated');
      setEditingUser(null);
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Update failed'),
  });

  const inviteMutation = useMutation({
    mutationFn: (data: { email: string; name: string; roleName: string; teamId?: string; specialisation?: string }) => 
      usersApi.invite(data),
    onSuccess: (data: any) => {
      if (data.error) {
        toast.error(data.error);
      } else {
        toast.success('Invitation request submitted');
        setIsInviteModalOpen(false);
        void queryClient.invalidateQueries({ queryKey: ['users'] });
      }
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Invite failed'),
  });

  const deactivateMutation = useMutation({
    mutationFn: (userId: string) => usersApi.deactivate(userId),
    onSuccess: () => {
      toast.success('User deactivated');
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Deactivation failed'),
  });

  const activateMutation = useMutation({
    mutationFn: (userId: string) => usersApi.update(userId, { status: 'ACTIVE' }),
    onSuccess: () => {
      toast.success('User activated');
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Activation failed'),
  });

  const rows = (query.data as any)?.users ?? (query.data as any)?.data ?? [];

  return (
    <div className="page-stack">
      <PageHeader
        eyebrow="Admin"
        title="User management"
        description="Review active users, filter the roster, and handle placeholder invitation flow behaviour."
        actions={<button className="btn btn-secondary" onClick={() => setIsInviteModalOpen(true)}>Invite new user</button>}
      />
      <section className="surface-card">
        <div className="toolbar" style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
          <input 
            className="input" 
            style={{ flex: 2, minWidth: '200px' }}
            value={search} 
            onChange={(event) => setSearch(event.target.value)} 
            placeholder="Search user name or email" 
          />
          <select className="input" style={{ flex: 1 }} value={roleName} onChange={(e) => setRoleName(e.target.value)}>
            <option value="">All Roles</option>
            <option value="SUPER_ADMIN">Super Admin</option>
            <option value="BPO_ADMIN">BPO Admin</option>
            <option value="TEAM_LEAD">Team Lead</option>
            <option value="BPO_USER">BPO User</option>
            <option value="CLIENT">Client</option>
          </select>
          <select className="input" style={{ flex: 1 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All Status</option>
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive</option>
            <option value="LOCKED">Locked</option>
          </select>
        </div>
        {rows.length > 0 ? (
          <div className="list-stack">
            {rows.map((user: UserRecord) => (
              <div key={user.id} className="list-item">
                <div style={{ flex: 1 }}>
                  <strong>{user.name}</strong>
                  <p className="muted-copy">{user.email} · {user.role?.name ?? 'Role unavailable'} · {user.specialisation || 'Generalist'}</p>
                </div>
                <div className="list-actions no-shrink">
                  <StatusBadge status={user.status} />
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditingUser(user)}>
                    <Edit2 size={14} />
                  </button>
                  {user.status === 'INACTIVE' ? (
                    <button 
                      className="btn btn-ghost compact" 
                      onClick={() => activateMutation.mutate(user.id)}
                      disabled={activateMutation.isPending}
                    >
                      Activate
                    </button>
                  ) : (
                    <button 
                      className="btn btn-ghost compact" 
                      onClick={() => deactivateMutation.mutate(user.id)}
                      disabled={deactivateMutation.isPending}
                    >
                      Deactivate
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState title="No users found" description="Try another search term or onboard the first admin through signup." />
        )}
      </section>
      {isInviteModalOpen && (
        <InviteUserModal 
          onClose={() => setIsInviteModalOpen(false)} 
          onInvite={(data) => inviteMutation.mutate(data)}
          loading={inviteMutation.isPending}
        />
      )}
      {editingUser && (
        <EditUserModal 
          user={editingUser}
          onClose={() => setEditingUser(null)}
          onUpdate={(id, data) => updateMutation.mutate({ id, data })}
          loading={updateMutation.isPending}
        />
      )}
    </div>
  );
}
