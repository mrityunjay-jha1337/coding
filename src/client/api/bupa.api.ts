import { api } from './client';

// ─── Types ────────────────────────────────────────────

export interface MemberRecord {
  id: string;
  membershipNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  email: string | null;
  phone: string | null;
  planTier: string;
  status: string;
  plan?: { name: string; tier: string };
}

export interface ProviderRecord {
  id: string;
  providerName: string;
  facilityName: string | null;
  providerType: string;
  country: string;
  networkStatus: string;
  accreditationStatus: string;
}

export interface HealthPlanRecord {
  id: string;
  name: string;
  tier: string;
  annualMaximumUsd: number | null;
  annualMaximumHkd: number | null;
  benefits: Record<string, unknown>;
  exclusions: string[];
}

export interface EligibilityResult {
  isEligible: boolean;
  reason: string;
  checks: Array<{ name: string; status: string; message: string }>;
  preAuthRequired: boolean;
  deductibleRemaining: number;
}

export interface BupaPipelineResult {
  claimId?: string;
  stage: string;
  adjudication: {
    decision: string;
    reason: string;
    payableAmount: number;
  } | null;
  memberValidation: unknown;
  eligibility: unknown;
  providerValidation: unknown;
  coverageAnalysis: unknown;
  edi: unknown;
  claimJson: unknown;
  errors: string[];
  warnings: string[];
  processingTimeMs: number;
  requiresHumanReview: boolean;
  humanReviewReason: string | null;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

// ─── API Client ───────────────────────────────────────

export const bupaApi = {
  // Members
  listMembers: (params?: { page?: number; limit?: number; status?: string; planTier?: string; search?: string }) =>
    api.get<PaginatedResponse<MemberRecord>>('/bupa/members', { params }),

  getMember: (id: string) =>
    api.get<MemberRecord>(`/bupa/members/${id}`),

  createMember: (data: Partial<MemberRecord> & Record<string, unknown>) =>
    api.post<MemberRecord>('/bupa/members', data),

  lookupMember: (params: { membershipNumber?: string; firstName?: string; lastName?: string; dateOfBirth?: string }) =>
    api.get<{ isValid: boolean; member: MemberRecord | null; checks: unknown[] }>('/bupa/members/lookup', { params }),

  checkEligibility: (memberId: string, data: { treatmentDate: string; treatmentCountry: string; treatmentType?: string; claimAmount?: number }) =>
    api.post<EligibilityResult>(`/bupa/members/${memberId}/eligibility`, data),

  // Providers
  listProviders: (params?: { page?: number; limit?: number; networkStatus?: string; country?: string; providerType?: string; search?: string }) =>
    api.get<PaginatedResponse<ProviderRecord>>('/bupa/providers', { params }),

  getProvider: (id: string) =>
    api.get<ProviderRecord>(`/bupa/providers/${id}`),

  lookupProvider: (params: { facilityName?: string; practitionerName?: string; country?: string; planTier?: string }) =>
    api.get<{ isValid: boolean; provider: ProviderRecord | null; checks: unknown[] }>('/bupa/providers/lookup', { params }),

  // Plans
  listPlans: () =>
    api.get<HealthPlanRecord[]>('/bupa/plans'),

  getPlan: (id: string) =>
    api.get<HealthPlanRecord>(`/bupa/plans/${id}`),

  // Pipeline
  processClaim: (data: {
    filePath: string;
    membershipNumber?: string;
    claimantName?: string;
    claimantDob?: string;
    facilityName?: string;
    practitionerName?: string;
    treatmentCountry?: string;
    treatmentDate?: string;
    treatmentType?: string;
    claimAmount?: number;
    currency?: string;
  }) =>
    api.post<BupaPipelineResult>('/bupa/process', data),

  // EDI & JSON Export
  getClaimEdi: (claimId: string) =>
    api.get<string>(`/bupa/claims/${claimId}/edi`, { responseType: 'text' as any }),

  getClaimExportJson: (claimId: string) =>
    api.get<Record<string, unknown>>(`/bupa/claims/${claimId}/export-json`),
};
