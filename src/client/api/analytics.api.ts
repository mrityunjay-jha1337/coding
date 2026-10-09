import { api } from './client';

export interface AnalyticsParams {
  dateFrom?: string;
  dateTo?: string;
  teamId?: string;
  groupBy?: 'day' | 'week' | 'month';
}

export interface OverviewMetrics {
  totalClaims: number;
  autoProcessed: number;
  stpRate: number;
  inReview: number;
  escalations: number;
  avgProcessingTimeMs: number;
}

export const analyticsApi = {
  overview: (params?: AnalyticsParams) => api.get<OverviewMetrics>('/analytics/overview', { params: params as Record<string, string | number | boolean | undefined> }),
  pipeline: () => api.get<Record<string, number>>('/analytics/pipeline'),
  teams: () => api.get<Array<{ teamId: string; teamName: string; queueDepth: number; activeClaims: number; completedClaims: number; avgConfidence: number }>>('/analytics/teams'),
  coding: (params?: AnalyticsParams) =>
    api.get<{
      totalCodes: number;
      validatedCodes: number;
      avgConfidence: number;
      codesByType: Record<string, number>;
      topCodes: Array<{ code: string; description: string; count: number }>;
      correctionRate: number;
    }>('/analytics/coding', { params: params as Record<string, string | number | boolean | undefined> }),
  sla: () => api.get<Array<{ clientId: string; clientName: string; totalClaims: number; completedClaims: number; avgCompletionTimeMs: number; breachCount: number }>>('/analytics/sla'),
  volume: (params: Required<Pick<AnalyticsParams, 'dateFrom' | 'dateTo'>> & AnalyticsParams) =>
    api.get<Array<{ period: string; count: number }>>('/analytics/volume', { params: params as unknown as Record<string, string | number | boolean | undefined> }),
  handlers: (params?: Pick<AnalyticsParams, 'teamId'>) =>
    api.get<Array<{ userId: string; userName: string; activeClaims: number; completedClaims: number; avgReviewTimeMs: number; correctionsMade: number }>>('/analytics/handlers', { params: params as Record<string, string | number | boolean | undefined> }),
};
