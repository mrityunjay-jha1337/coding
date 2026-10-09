import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { teamsApi } from '../api/teams.api';
import { X } from 'lucide-react';

interface InviteUserModalProps {
  onClose: () => void;
  onInvite: (data: { email: string; name: string; roleName: string; teamId?: string; specialisation?: string }) => void;
  loading: boolean;
}

const ROLES = [
  'SUPER_ADMIN',
  'BPO_ADMIN',
  'TEAM_LEAD',
  'BPO_USER',
  'CLIENT',
];

export function InviteUserModal({ onClose, onInvite, loading }: InviteUserModalProps) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [roleName, setRoleName] = useState('BPO_USER');
  const [teamId, setTeamId] = useState('');
  const [specialisation, setSpecialisation] = useState('');

  const teamsQuery = useQuery({
    queryKey: ['teams'],
    queryFn: () => teamsApi.list(),
  });

  const teams = teamsQuery.data ?? [];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onInvite({
      email,
      name,
      roleName,
      teamId: teamId || undefined,
      specialisation: specialisation || undefined,
    });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-container surface-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Invite new user</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close modal">
            <X size={20} />
          </button>
        </div>
        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="name">Full name</label>
            <input
              id="name"
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. John Doe"
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              type="email"
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="e.g. john@example.com"
              required
            />
          </div>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="role">Role</label>
              <select
                id="role"
                className="input"
                value={roleName}
                onChange={(e) => setRoleName(e.target.value)}
                required
              >
                {ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role.replace('_', ' ')}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="team">Team (optional)</label>
              <select
                id="team"
                className="input"
                value={teamId}
                onChange={(e) => setTeamId(e.target.value)}
              >
                <option value="">No team</option>
                {teams.map((team) => (
                  <option key={team.id} value={team.id}>
                    {team.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="form-group">
            <label htmlFor="specialisation">Specialisation (optional)</label>
            <input
              id="specialisation"
              type="text"
              className="input"
              value={specialisation}
              onChange={(e) => setSpecialisation(e.target.value)}
              placeholder="e.g. Medical Coding, Policy Analysis"
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Sending invite...' : 'Send invitation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
