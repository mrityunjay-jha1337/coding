import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore } from '../stores/authStore';
import { useUiStore } from '../stores/uiStore';
import { PageHeader } from '../components/PageHeader';
import { usersApi } from '../api/users.api';
import { authApi } from '../api/auth.api';
import { formatDateTime } from '../utils/format';
import { User, Shield, Key, Save, Moon, Sun } from 'lucide-react';

export default function Settings() {
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const { theme, toggleTheme } = useUiStore();
  
  const [name, setName] = useState(user?.name || '');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const updateProfileMutation = useMutation({
    mutationFn: () => usersApi.update(user!.id, { name }),
    onSuccess: () => {
      toast.success('Profile updated');
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Failed to update profile'),
  });

  const changePasswordMutation = useMutation({
    mutationFn: () => authApi.changePassword({ current: currentPassword, next: newPassword }),
    onSuccess: () => {
      toast.success('Password changed successfully');
      setCurrentPassword('');
      setNewPassword('');
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'Failed to change password'),
  });

  const toggleMfaMutation = useMutation({
    mutationFn: (enabled: boolean) => authApi.toggleMfa(enabled),
    onSuccess: () => {
      toast.success('Security settings updated');
      void queryClient.invalidateQueries({ queryKey: ['auth', 'me'] });
    },
    onError: (error: { error?: string }) => toast.error(error.error || 'MFA update failed'),
  });

  return (
    <div className="page-stack">
      <PageHeader eyebrow="Preferences" title="Settings and profile" description="Adjust your personal profile and security configurations." />
      
      <div className="icd-grid-layout">
        <section className="surface-card">
          <div className="section-header">
            <h2>Personal Profile</h2>
            <p className="muted-copy">Update your public identity and contact details.</p>
          </div>
          <div className="form-grid">
            <label className="field-group">
              <span className="label-with-icon"><User size={16} /> Display Name</span>
              <div className="horizontal-form-row">
                <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
                <button 
                  className="btn btn-primary btn-sm"
                  disabled={!name || name === user?.name || updateProfileMutation.isPending}
                  onClick={() => updateProfileMutation.mutate()}
                >
                  <Save size={16} /> Update
                </button>
              </div>
            </label>
            <div className="detail-grid mt-4">
              <div><span>Email</span><strong>{user?.email}</strong></div>
              <div><span>Role</span><strong>{user?.role}</strong></div>
              <div><span>Organisation</span><strong>{user?.orgName}</strong></div>
              <div><span>Last login</span><strong>{formatDateTime(user?.lastLoginAt)}</strong></div>
            </div>
          </div>
        </section>

        <section className="surface-card">
          <div className="section-header">
            <h2>Security</h2>
            <p className="muted-copy">Manage your authentication and account access.</p>
          </div>
          <div className="form-grid">
            <div className="list-item flush">
              <div className="list-item-content">
                <strong className="flex-center gap-sm"><Shield size={16} /> Multi-factor Authentication (MFA)</strong>
                <p className="muted-copy">Add an extra layer of security to your account.</p>
              </div>
              <button 
                className={`btn btn-sm ${user?.mfaEnabled ? 'btn-danger-outline' : 'btn-primary-outline'}`}
                onClick={() => toggleMfaMutation.mutate(!user?.mfaEnabled)}
                disabled={toggleMfaMutation.isPending}
              >
                {user?.mfaEnabled ? 'Disable MFA' : 'Enable MFA'}
              </button>
            </div>

            <hr className="divider" />

            <div className="field-group">
              <span className="label-with-icon"><Key size={16} /> Change Password</span>
              <input 
                className="input mb-2" 
                type="password" 
                placeholder="Current password" 
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
              <input 
                className="input mb-2" 
                type="password" 
                placeholder="New password" 
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <button 
                className="btn btn-secondary btn-block"
                disabled={!currentPassword || !newPassword || changePasswordMutation.isPending}
                onClick={() => changePasswordMutation.mutate()}
              >
                Change Password
              </button>
            </div>
          </div>
        </section>

        <aside className="surface-card">
          <div className="section-header"><h2>Interface</h2></div>
          <div className="list-stack">
            <div className="list-item compact">
              <div className="list-item-content">
                <strong className="flex-center gap-sm">
                  {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
                  Theme mode
                </strong>
                <p className="muted-copy">Switch between dark and light appearance.</p>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={toggleTheme}>
                Toggle
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
