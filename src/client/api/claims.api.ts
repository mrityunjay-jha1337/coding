import { api } from './client';
import type {
  AuditEventRecord,
  ClaimCodingEntry,
  ClaimDetailRecord,
  ClaimDocument,
  ClaimSummary,
  PaginatedResponse,
} from './types';

export interface ClaimListParams {
  page?: number;
  limit?: number;
  status?: string;
  clientId?: string;
  teamId?: string;
  assignedTo?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export const claimsApi = {
  list: (params: ClaimListParams) =>
    api.get<PaginatedResponse<ClaimSummary>>('/claims', { params: params as Record<string, string | number | boolean | undefined> }),
  detail: (id: string) => api.get<ClaimDetailRecord>(`/claims/${id}`),
  updateStatus: (id: string, status: string) => api.put<ClaimDetailRecord>(`/claims/${id}/status`, { status }),
  assign: (id: string, handlerId: string) => api.put<ClaimDetailRecord>(`/claims/${id}/assign`, { handlerId }),
  getCoding: (id: string) => api.get<ClaimCodingEntry[]>(`/claims/${id}/coding`),
  reviewCoding: (
    claimId: string,
    codingId: string,
    data: { reviewerAction: 'accepted' | 'corrected' | 'rejected'; correctedCode?: string; note?: string }
  ) => api.put<ClaimCodingEntry>(`/claims/${claimId}/coding/${codingId}`, data),
  searchCodes: (query: string, limit = 20) =>
    api.get<Array<{ code: string; short: string; long: string }>>('/claims/coding/search', {
      params: { q: query, limit },
    }),
  getDocuments: (id: string) => api.get<ClaimDocument[]>(`/claims/${id}/documents`),
  getFile: (id: string) => api.get<Record<string, unknown>>(`/claims/${id}/file`),
  getAudit: (id: string) => api.get<AuditEventRecord[]>(`/claims/${id}/audit`),
  downloadPdf: (id: string) => api.get<Blob>(`/claims/${id}/pdf`, { responseType: 'blob' }),
};
