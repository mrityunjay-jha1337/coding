import { api } from './client';
import type { PaginatedResponse } from './types';

export interface UserRecord {
  id: string;
  name: string;
  email: string;
  specialisation?: string | null;
  status: string;
  role?: { id?: string; name: string; permissions?: string[] } | null;
  organisation?: { id: string; name: string; type: string } | null;
  createdAt?: string;
}

export const usersApi = {
  list: (params?: { search?: string; roleId?: string; roleName?: string; status?: string; page?: number; limit?: number }) =>
    api.get<PaginatedResponse<UserRecord>>('/users', { params: params as Record<string, string | number | boolean | undefined> }),
  detail: (id: string) => api.get<UserRecord>(`/users/${id}`),
  update: (id: string, data: { name?: string; specialisation?: string; status?: string }) =>
    api.put<UserRecord>(`/users/${id}`, data),
  deactivate: (id: string) => api.delete<{ success?: boolean }>(`/users/${id}`),
  invite: (data: { email: string; name: string; roleName: string; teamId?: string; specialisation?: string }) =>
    api.post<{ error?: string }>('/users/invite', data),
};
