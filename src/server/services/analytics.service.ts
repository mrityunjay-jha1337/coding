import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export interface OperationsOverview {
  readonly totalClaims: number;
  readonly autoProcessed: number;
  readonly stpRate: number;
  readonly inReview: number;
  readonly escalations: number;
  readonly avgProcessingTimeMs: number;
}

export interface TeamPerformance {
  readonly teamId: string;
  readonly teamName: string;
  readonly queueDepth: number;
  readonly activeClaims: number;
  readonly completedClaims: number;
  readonly avgConfidence: number;
}

export interface CodingAnalytics {
  readonly totalCodes: number;
  readonly validatedCodes: number;
  readonly avgConfidence: number;
  readonly codesByType: Record<string, number>;
  readonly topCodes: ReadonlyArray<{ code: string; description: string; count: number }>;
  readonly correctionRate: number;
}

export interface ClientSlaStatus {
  readonly clientId: string;
  readonly clientName: string;
  readonly totalClaims: number;
  readonly completedClaims: number;
  readonly avgCompletionTimeMs: number;
  readonly breachCount: number;
}

export interface VolumeDataPoint {
  readonly period: string;
  readonly count: number;
}

export interface HandlerMetric {
  readonly userId: string;
  readonly userName: string;
  readonly activeClaims: number;
  readonly completedClaims: number;
  readonly avgReviewTimeMs: number;
  readonly correctionsMade: number;
}

// ─── Constants ─────────────────────────────────────

const ACTIVE_STATUSES = [
  'NEW', 'INGESTING', 'EXTRACTING', 'TRANSLATING',
  'CODING', 'VALIDATING', 'QUERYING', 'REVIEWING', 'BUILDING',
] as const;

const PERCENTAGE_MULTIPLIER = 100;

// ─── Service ───────────────────────────────────────

export class AnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * High-level operations overview for the organisation dashboard.
   */
  async getOperationsOverview(
    orgId: string,
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<OperationsOverview> {
    const dateFilter = this.buildDateFilter(dateFrom, dateTo);
    const where: Record<string, unknown> = { orgId, ...dateFilter };

    const [totalClaims, autoProcessed, inReview, escalations, avgResult] =
      await Promise.all([
        this.prisma.claim.count({ where: where as any }),
        this.prisma.claim.count({
          where: {
            ...where,
            status: 'COMPLETE',
            assignedTo: null,
          } as any,
        }),
        this.prisma.claim.count({
          where: { ...where, status: 'REVIEWING' } as any,
        }),
        this.prisma.escalation.count({
          where: {
            claim: { orgId, ...dateFilter },
          } as any,
        }),
        this.prisma.claim.aggregate({
          where: {
            ...where,
            status: 'COMPLETE',
            processingTimeMs: { not: null },
          } as any,
          _avg: { processingTimeMs: true },
        }),
      ]);

    const stpRate =
      totalClaims > 0
        ? Math.round((autoProcessed / totalClaims) * PERCENTAGE_MULTIPLIER * 100) / 100
        : 0;

    return {
      totalClaims,
      autoProcessed,
      stpRate,
      inReview,
      escalations,
      avgProcessingTimeMs: Math.round(avgResult._avg.processingTimeMs ?? 0),
    };
  }

  /**
   * Live snapshot of claims per status for the org.
   */
  async getPipelineStatus(orgId: string): Promise<Record<string, number>> {
    const groups = await this.prisma.claim.groupBy({
      by: ['status'],
      where: { orgId },
      _count: { _all: true },
    });

    const result: Record<string, number> = {};
    for (const group of groups) {
      result[group.status] = group._count._all;
    }
    return result;
  }

  /**
   * Performance metrics for each team in the organisation.
   */
  async getTeamPerformance(orgId: string): Promise<TeamPerformance[]> {
    const teams = await this.prisma.team.findMany({
      where: { orgId },
      select: { id: true, name: true },
    });

    const performances = await Promise.all(
      teams.map(async (team) => {
        const [queueDepth, activeClaims, completedClaims, avgConfidence] =
          await Promise.all([
            this.prisma.claim.count({
              where: { teamId: team.id, status: { in: ['NEW', 'INGESTING', 'EXTRACTING'] } },
            }),
            this.prisma.claim.count({
              where: {
                teamId: team.id,
                status: { in: [...ACTIVE_STATUSES] },
              },
            }),
            this.prisma.claim.count({
              where: { teamId: team.id, status: 'COMPLETE' },
            }),
            this.prisma.claim.aggregate({
              where: {
                teamId: team.id,
                overallConfidence: { not: null },
              },
              _avg: { overallConfidence: true },
            }),
          ]);

        return {
          teamId: team.id,
          teamName: team.name,
          queueDepth,
          activeClaims,
          completedClaims,
          avgConfidence: Math.round((avgConfidence._avg.overallConfidence ?? 0) * 100) / 100,
        };
      }),
    );

    return performances;
  }

  /**
   * Analytics on ICD/OPCS coding across the org.
   */
  async getCodingAnalytics(
    orgId: string,
    dateFrom?: Date,
    dateTo?: Date,
  ): Promise<CodingAnalytics> {
    const dateFilter = this.buildDateFilter(dateFrom, dateTo);
    const claimWhere = { orgId, ...dateFilter };

    const claimIds = await this.prisma.claim.findMany({
      where: claimWhere as any,
      select: { id: true },
    });
    const ids = claimIds.map((c) => c.id);

    if (ids.length === 0) {
      return {
        totalCodes: 0,
        validatedCodes: 0,
        avgConfidence: 0,
        codesByType: {},
        topCodes: [],
        correctionRate: 0,
      };
    }

    const codingWhere = { claimId: { in: ids } };

    const [totalCodes, validatedCodes, avgConfidence, correctedCount, codeTypeGroups] =
      await Promise.all([
        this.prisma.claimCoding.count({ where: codingWhere }),
        this.prisma.claimCoding.count({
          where: { ...codingWhere, isValidated: true },
        }),
        this.prisma.claimCoding.aggregate({
          where: codingWhere,
          _avg: { confidence: true },
        }),
        this.prisma.claimCoding.count({
          where: { ...codingWhere, reviewerAction: 'corrected' },
        }),
        this.prisma.claimCoding.groupBy({
          by: ['codeType'],
          where: codingWhere,
          _count: { _all: true },
        }),
      ]);

    const codesByType: Record<string, number> = {};
    for (const group of codeTypeGroups) {
      codesByType[group.codeType] = group._count._all;
    }

    // Top codes by frequency
    const topCodesRaw = await this.prisma.claimCoding.groupBy({
      by: ['code', 'description'],
      where: codingWhere,
      _count: { _all: true },
      orderBy: { _count: { code: 'desc' } },
      take: 10,
    });

    const topCodes = topCodesRaw.map((row) => ({
      code: row.code,
      description: row.description,
      count: row._count._all,
    }));

    const correctionRate =
      totalCodes > 0
        ? Math.round((correctedCount / totalCodes) * PERCENTAGE_MULTIPLIER * 100) / 100
        : 0;

    return {
      totalCodes,
      validatedCodes,
      avgConfidence: Math.round((avgConfidence._avg.confidence ?? 0) * 100) / 100,
      codesByType,
      topCodes,
      correctionRate,
    };
  }

  /**
   * SLA status for each client in the organisation.
   */
  async getClientSlaStatus(orgId: string): Promise<ClientSlaStatus[]> {
    const clients = await this.prisma.client.findMany({
      where: { orgId },
      select: { id: true, name: true, slaConfig: true },
    });

    const statuses = await Promise.all(
      clients.map(async (client) => {
        const clientWhere = { clientId: client.id };

        const [totalClaims, completedClaims, avgCompletion] = await Promise.all([
          this.prisma.claim.count({ where: clientWhere }),
          this.prisma.claim.count({
            where: { ...clientWhere, status: 'COMPLETE' },
          }),
          this.prisma.claim.findMany({
            where: {
              ...clientWhere,
              status: 'COMPLETE',
              completedAt: { not: null },
            },
            select: { createdAt: true, completedAt: true, slaDeadline: true },
          }),
        ]);

        let totalCompletionMs = 0;
        let breachCount = 0;

        for (const claim of avgCompletion) {
          if (claim.completedAt) {
            const duration =
              claim.completedAt.getTime() - claim.createdAt.getTime();
            totalCompletionMs += duration;

            if (claim.slaDeadline && claim.completedAt > claim.slaDeadline) {
              breachCount += 1;
            }
          }
        }

        const avgCompletionTimeMs =
          avgCompletion.length > 0
            ? Math.round(totalCompletionMs / avgCompletion.length)
            : 0;

        return {
          clientId: client.id,
          clientName: client.name,
          totalClaims,
          completedClaims,
          avgCompletionTimeMs,
          breachCount,
        };
      }),
    );

    return statuses;
  }

  /**
   * Volume analysis grouped by day, week, or month.
   */
  async getVolumeAnalysis(
    orgId: string,
    dateFrom: Date,
    dateTo: Date,
    groupBy: 'day' | 'week' | 'month',
  ): Promise<VolumeDataPoint[]> {
    const truncExpr = this.getDateTruncExpression(groupBy);

    const results: Array<{ period: Date; count: bigint }> =
      await this.prisma.$queryRawUnsafe(
        `SELECT date_trunc($1, created_at) AS period, COUNT(*)::bigint AS count
         FROM claims
         WHERE org_id = $2 AND created_at >= $3 AND created_at <= $4
         GROUP BY period
         ORDER BY period ASC`,
        truncExpr,
        orgId,
        dateFrom,
        dateTo,
      );

    return results.map((row) => ({
      period: this.formatPeriod(row.period, groupBy),
      count: Number(row.count),
    }));
  }

  /**
   * Per-handler metrics within the org (optionally scoped to a team).
   */
  async getHandlerMetrics(
    orgId: string,
    teamId?: string,
  ): Promise<HandlerMetric[]> {
    const userWhere: Record<string, unknown> = { orgId };
    if (teamId) {
      userWhere.teamMemberships = { some: { teamId } };
    }

    const users = await this.prisma.user.findMany({
      where: userWhere as any,
      select: { id: true, name: true },
    });

    const metrics = await Promise.all(
      users.map(async (user) => {
        const [activeClaims, completedClaims, reviewTimes, correctionsMade] =
          await Promise.all([
            this.prisma.claim.count({
              where: {
                assignedTo: user.id,
                status: { in: [...ACTIVE_STATUSES] },
              },
            }),
            this.prisma.claim.count({
              where: { assignedTo: user.id, status: 'COMPLETE' },
            }),
            this.prisma.claim.findMany({
              where: {
                assignedTo: user.id,
                status: 'COMPLETE',
                completedAt: { not: null },
              },
              select: { updatedAt: true, completedAt: true },
            }),
            this.prisma.claimCoding.count({
              where: {
                reviewerId: user.id,
                reviewerAction: 'corrected',
              },
            }),
          ]);

        let totalReviewMs = 0;
        for (const claim of reviewTimes) {
          if (claim.completedAt) {
            totalReviewMs +=
              claim.completedAt.getTime() - claim.updatedAt.getTime();
          }
        }

        const avgReviewTimeMs =
          reviewTimes.length > 0
            ? Math.round(totalReviewMs / reviewTimes.length)
            : 0;

        return {
          userId: user.id,
          userName: user.name,
          activeClaims,
          completedClaims,
          avgReviewTimeMs: Math.max(0, avgReviewTimeMs),
          correctionsMade,
        };
      }),
    );

    return metrics;
  }

  // ─── Private Helpers ──────────────────────────────

  private buildDateFilter(
    dateFrom?: Date,
    dateTo?: Date,
  ): Record<string, unknown> {
    if (!dateFrom && !dateTo) {
      return {};
    }

    const createdAt: Record<string, Date> = {};
    if (dateFrom) {
      createdAt.gte = dateFrom;
    }
    if (dateTo) {
      createdAt.lte = dateTo;
    }
    return { createdAt };
  }

  private getDateTruncExpression(groupBy: 'day' | 'week' | 'month'): string {
    switch (groupBy) {
      case 'day':
        return 'day';
      case 'week':
        return 'week';
      case 'month':
        return 'month';
      default:
        return 'day';
    }
  }

  private formatPeriod(date: Date, groupBy: 'day' | 'week' | 'month'): string {
    const d = new Date(date);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, '0');
    const day = String(d.getUTCDate()).padStart(2, '0');

    switch (groupBy) {
      case 'day':
        return `${year}-${month}-${day}`;
      case 'week': {
        const weekNum = this.getISOWeekNumber(d);
        return `${year}-W${String(weekNum).padStart(2, '0')}`;
      }
      case 'month':
        return `${year}-${month}`;
      default:
        return `${year}-${month}-${day}`;
    }
  }

  private getISOWeekNumber(date: Date): number {
    const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  }
}
