import { api } from './client';

export interface TeamRecord {
  id: string;
  name: string;
  leadId?: string | null;
  settings?: Record<string, unknown>;
  createdAt?: string;
  members?: Array<{
    joinedAt: string;
    user: {
      id: string;
      name: string;
      email: string;
      specialisation?: string | null;
    };
  }>;
}

export const teamsApi = {
  list: () => api.get<TeamRecord[]>('/teams'),
  create: (data: { name: string; leadId?: string }) => api.post<TeamRecord>('/teams', data),
  detail: (id: string) => api.get<TeamRecord>(`/teams/${id}`),
  update: (id: string, data: { name?: string; leadId?: string | null; settings?: Record<string, unknown> }) =>
    api.put<TeamRecord>(`/teams/${id}`, data),
  remove: (id: string) => api.delete<{ success?: boolean }>(`/teams/${id}`),
  addMember: (teamId: string, userId: string) => api.post(`/teams/${teamId}/members`, { userId }),
  removeMember: (teamId: string, userId: string) => api.delete(`/teams/${teamId}/members/${userId}`),
};
