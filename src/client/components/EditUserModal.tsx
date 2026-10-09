import { useState } from 'react';
import { X } from 'lucide-react';

interface EditUserModalProps {
  user: { id: string; name: string; email: string; specialisation?: string | null; role?: { name: string } | null };
  onClose: () => void;
  onUpdate: (id: string, data: { name: string; specialisation: string }) => void;
  loading: boolean;
}

export function EditUserModal({ user, onClose, onUpdate, loading }: EditUserModalProps) {
  const [name, setName] = useState(user.name);
  const [specialisation, setSpecialisation] = useState(user.specialisation || '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate(user.id, { name, specialisation });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-container surface-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Edit user profile</h2>
          <button className="btn-icon" onClick={onClose} aria-label="Close modal">
            <X size={20} />
          </button>
        </div>
        <form className="modal-form" onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="email">Email address (read-only)</label>
            <input id="email" type="email" className="input disabled" value={user.email} disabled />
          </div>
          <div className="form-group">
            <label htmlFor="name">Full name</label>
            <input
              id="name"
              type="text"
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="specialisation">Specialisation</label>
            <input
              id="specialisation"
              type="text"
              className="input"
              value={specialisation}
              onChange={(e) => setSpecialisation(e.target.value)}
              placeholder="e.g. Cardiology, Radiology"
            />
          </div>
          <div className="modal-actions">
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Saving...' : 'Save changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
