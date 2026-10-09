import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import type { ApiError } from '../api/client';

const schema = z.object({
  organisationName: z.string().min(2),
  organisationType: z.enum(['BPO', 'TPA', 'INSURER', 'BROKER']),
  fcaNumber: z.string().optional(),
  adminName: z.string().min(2),
  adminEmail: z.string().email(),
  adminPassword: z.string().min(12, 'Password must be at least 12 characters'),
});

type FormValues = z.infer<typeof schema>;

export default function Signup() {
  const navigate = useNavigate();
  const signup = useAuthStore((state) => state.signup);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      organisationType: 'BPO',
    },
  });

  const onSubmit = async (values: FormValues) => {
    try {
      await signup(values);
      toast.success('Workspace created');
      navigate('/app/dashboard', { replace: true });
    } catch (error) {
      const apiError = error as ApiError;
      toast.error(apiError.error || 'Signup failed');
    }
  };

  return (
    <div className="centered-screen">
      <div className="surface-card auth-card wide">
        <div className="eyebrow">Organisation Onboarding</div>
        <h1>Create a ClaimsIntell workspace</h1>
        <p className="muted-copy">
          This provisions the organisation, seeds the first admin account, and issues a live JWT session.
        </p>

        <form className="form-grid two-column" onSubmit={handleSubmit(onSubmit)}>
          <label className="field-group">
            <span>Organisation name</span>
            <input className="input" {...register('organisationName')} />
            {errors.organisationName ? <small className="field-error">{errors.organisationName.message}</small> : null}
          </label>

          <label className="field-group">
            <span>Organisation type</span>
            <select className="input" {...register('organisationType')}>
              <option value="BPO">BPO</option>
              <option value="TPA">TPA</option>
              <option value="INSURER">Insurer</option>
              <option value="BROKER">Broker</option>
            </select>
          </label>

          <label className="field-group">
            <span>Admin name</span>
            <input className="input" {...register('adminName')} />
            {errors.adminName ? <small className="field-error">{errors.adminName.message}</small> : null}
          </label>

          <label className="field-group">
            <span>Admin email</span>
            <input className="input" {...register('adminEmail')} />
            {errors.adminEmail ? <small className="field-error">{errors.adminEmail.message}</small> : null}
          </label>

          <label className="field-group">
            <span>FCA number</span>
            <input className="input" {...register('fcaNumber')} />
          </label>

          <label className="field-group">
            <span>Admin password</span>
            <input className="input" type="password" {...register('adminPassword')} />
            {errors.adminPassword ? <small className="field-error">{errors.adminPassword.message}</small> : null}
          </label>

          <div className="form-actions span-2">
            <button className="btn btn-primary" type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Creating workspace...' : 'Create workspace'}
            </button>
            <Link className="btn btn-secondary" to="/login">
              Back to sign in
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
