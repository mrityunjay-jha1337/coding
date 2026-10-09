import { api } from './client';

export interface ConnectorRecord {
  id: string;
  email: string;
  status: string;
  lastSyncAt?: string | null;
  pubsubExpiry?: string | null;
  filterRules?: Array<Record<string, unknown>>;
  createdAt: string;
  updatedAt: string;
}

export const connectorsApi = {
  list: () => api.get<ConnectorRecord[]>('/connectors/gmail'),
  connect: () => api.post<{ authUrl: string }>('/connectors/gmail/connect'),
  status: (id: string) => api.get<ConnectorRecord>(`/connectors/gmail/${id}/status`),
  disconnect: (id: string) => api.delete<{ message: string }>(`/connectors/gmail/${id}`),
  updateRules: (id: string, rules: Array<Record<string, unknown>>) =>
    api.put<ConnectorRecord>(`/connectors/gmail/${id}/rules`, { rules }),
};
