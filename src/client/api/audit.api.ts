import { api } from './client';
import type { AuditEventRecord } from './types';

export const auditApi = {
  list: (params?: {
    targetType?: string;
    targetId?: string;
    eventType?: string;
    actorId?: string;
    dateFrom?: string;
    dateTo?: string;
    page?: number;
    limit?: number;
  }) =>
    api.get<{ events?: AuditEventRecord[]; data?: AuditEventRecord[]; total?: number; page?: number; limit?: number }>(
      '/audit/events',
      { params: params as Record<string, string | number | boolean | undefined> },
    ),
  detail: (id: string) => api.get<AuditEventRecord>(`/audit/events/${id}`),
};
