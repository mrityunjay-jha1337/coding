import { api } from './client';

export interface ClientRecord {
  id: string;
  name: string;
  contactEmail: string;
  policyLines?: string[];
  slaConfig?: Record<string, unknown>;
  settings?: Record<string, unknown>;
  status: string;
  createdAt: string;
  updatedAt: string;
  teamMappings?: Array<{
    team: { id: string; name: string };
  }>;
}

export const clientsApi = {
  list: () => api.get<ClientRecord[]>('/clients'),
  create: (data: { name: string; contactEmail: string; policyLines?: string[]; slaConfig?: Record<string, unknown> }) =>
    api.post<ClientRecord>('/clients', data),
  detail: (id: string) => api.get<ClientRecord>(`/clients/${id}`),
  update: (id: string, data: Record<string, unknown>) => api.put<ClientRecord>(`/clients/${id}`, data),
  updateSla: (id: string, config: Record<string, unknown>) => api.put<ClientRecord>(`/clients/${id}/sla`, { config }),
  mapTeam: (clientId: string, teamId: string) => api.post(`/clients/${clientId}/teams`, { teamId }),
};
