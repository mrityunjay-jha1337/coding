import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import toast from 'react-hot-toast';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../stores/authStore';
import type { ApiError } from '../api/client';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
  mfaCode: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuthStore((state) => state.login);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
  });

  const from = (location.state as { from?: string } | null)?.from ?? '/app/dashboard';

  const onSubmit = async (values: FormValues) => {
    try {
      const result = await login(values);
      if (result.requiresMfa) {
        toast.error('MFA is enabled on this account. Enter the MFA code and retry.');
        return;
      }
      toast.success('Signed in');
      navigate(from, { replace: true });
    } catch (error) {
      const apiError = error as ApiError;
      toast.error(apiError.error || 'Login failed');
    }
  };

  return (
    <div className="centered-screen">
      <div className="surface-card auth-card">
        <div className="eyebrow">Secure Access</div>
        <h1>Sign in to the operator workspace</h1>
        <p className="muted-copy">
          Use the organisation credentials provisioned through the admin onboarding flow.
        </p>

        <form className="form-grid" onSubmit={handleSubmit(onSubmit)}>
          <label className="field-group">
            <span>Email</span>
            <input className="input" placeholder="ops@payer.com" {...register('email')} />
            {errors.email ? <small className="field-error">{errors.email.message}</small> : null}
          </label>

          <label className="field-group">
            <span>Password</span>
            <input className="input" type="password" placeholder="Enter your password" {...register('password')} />
            {errors.password ? <small className="field-error">{errors.password.message}</small> : null}
          </label>

          <label className="field-group">
            <span>MFA code</span>
            <input className="input" placeholder="Optional" {...register('mfaCode')} />
          </label>

          <button className="btn btn-primary btn-block" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="auth-footer">
          <span>Need a workspace?</span>
          <Link to="/signup">Create one</Link>
        </div>
      </div>
    </div>
  );
}
