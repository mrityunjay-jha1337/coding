import type { AuthResult, LoginRequest, SignupRequest } from '@shared/authTypes';
import { api } from './client';
import type { CurrentUser } from './types';

export const authApi = {
  signup: (data: SignupRequest) => api.post<AuthResult>('/auth/signup', data),
  login: (data: LoginRequest) => api.post<AuthResult | { requiresMfa: true; userId: string }>('/auth/login', data),
  refresh: (refreshToken: string) =>
    api.post<{ accessToken: string; refreshToken: string }>('/auth/refresh', { refreshToken }),
  logout: (refreshToken: string) => api.post<{ message: string }>('/auth/logout', { refreshToken }),
  me: () => api.get<CurrentUser>('/auth/me'),
  changePassword: (data: { current: string; next: string }) => api.put<{ message: string }>('/auth/password', data),
  toggleMfa: (enabled: boolean) => api.put<{ message: string }>('/auth/mfa', { enabled }),
};
