import { api } from './client';

// ─── Types ────────────────────────────────────────────

export interface StpMetrics {
  totalClaims: number;
  autoApproved: number;
  autoDenied: number;
  humanReviewed: number;
  stpRate: number;
  avgProcessingTimeMs: number;
  medianProcessingTimeMs: number;
}

export interface PlanUtilisation {
  planTier: string;
  planName: string;
  memberCount: number;
  claimCount: number;
  totalClaimed: number;
  totalPaid: number;
  avgClaimAmount: number;
  currency: string;
}

export interface ProviderMetric {
  providerName: string;
  country: string;
  networkStatus: string;
  claimCount: number;
  totalAmount: number;
  avgAmount: number;
  inNetworkRate: number;
}

export interface DenialAnalysis {
  totalDenied: number;
  denialRate: number;
  denialsByReason: Array<{ reason: string; count: number; percentage: number }>;
  denialsByPlan: Array<{ planTier: string; count: number; rate: number }>;
}

export interface MemberMetrics {
  totalMembers: number;
  activeMembers: number;
  claimsPerMember: number;
  membersByPlan: Array<{ planTier: string; count: number }>;
  membersByStatus: Array<{ status: string; count: number }>;
}

export interface BupaAnalyticsDashboard {
  stpMetrics: StpMetrics;
  planUtilisation: PlanUtilisation[];
  providerAnalysis: ProviderMetric[];
  denialAnalysis: DenialAnalysis;
  memberMetrics: MemberMetrics;
}

// ─── API Client ───────────────────────────────────────

export const bupaAnalyticsApi = {
  getDashboard: (params?: { dateFrom?: string; dateTo?: string }) =>
    api.get<BupaAnalyticsDashboard>('/bupa/analytics/dashboard', { params }),

  getStpMetrics: (params?: { dateFrom?: string; dateTo?: string }) =>
    api.get<StpMetrics>('/bupa/analytics/stp', { params }),

  getPlanUtilisation: (params?: { dateFrom?: string; dateTo?: string }) =>
    api.get<PlanUtilisation[]>('/bupa/analytics/plans', { params }),

  getProviderAnalysis: (params?: { dateFrom?: string; dateTo?: string }) =>
    api.get<ProviderMetric[]>('/bupa/analytics/providers', { params }),

  getDenialAnalysis: (params?: { dateFrom?: string; dateTo?: string }) =>
    api.get<DenialAnalysis>('/bupa/analytics/denials', { params }),

  getMemberMetrics: () =>
    api.get<MemberMetrics>('/bupa/analytics/members'),

  batchExportEdi: (data: {
    dateFrom?: string;
    dateTo?: string;
    status?: string[];
    planTier?: string;
    claimIds?: string[];
    format?: 'INDIVIDUAL' | 'COMBINED';
  }) =>
    api.post<{ content: string; filename: string; totalClaims: number; successCount: number }>('/bupa/batch-export/edi', data),
};
