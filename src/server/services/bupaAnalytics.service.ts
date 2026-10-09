import { PrismaClient, Prisma } from '@prisma/client';
import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export interface BupaAnalyticsDashboard {
  readonly stpMetrics: StpMetrics;
  readonly planUtilisation: ReadonlyArray<PlanUtilisation>;
  readonly providerAnalysis: ReadonlyArray<ProviderMetric>;
  readonly denialAnalysis: DenialAnalysis;
  readonly memberMetrics: MemberMetrics;
  readonly pipelinePerformance: PipelinePerformance;
  readonly correspondenceMetrics: CorrespondenceMetrics;
}

export interface StpMetrics {
  readonly totalClaims: number;
  readonly autoApproved: number;
  readonly autoDenied: number;
  readonly humanReviewed: number;
  readonly stpRate: number;
  readonly avgProcessingTimeMs: number;
  readonly medianProcessingTimeMs: number;
}

export interface PlanUtilisation {
  readonly planTier: string;
  readonly planName: string;
  readonly memberCount: number;
  readonly claimCount: number;
  readonly totalClaimed: number;
  readonly totalPaid: number;
  readonly avgClaimAmount: number;
  readonly currency: string;
}

export interface ProviderMetric {
  readonly providerName: string;
  readonly country: string;
  readonly networkStatus: string;
  readonly claimCount: number;
  readonly totalAmount: number;
  readonly avgAmount: number;
  readonly inNetworkRate: number;
}

export interface DenialAnalysis {
  readonly totalDenied: number;
  readonly denialRate: number;
  readonly denialsByReason: ReadonlyArray<{
    reason: string;
    count: number;
    percentage: number;
  }>;
  readonly denialsByPlan: ReadonlyArray<{
    planTier: string;
    count: number;
    rate: number;
  }>;
}

export interface MemberMetrics {
  readonly totalMembers: number;
  readonly activeMembers: number;
  readonly claimsPerMember: number;
  readonly membersByPlan: ReadonlyArray<{ planTier: string; count: number }>;
  readonly membersByStatus: ReadonlyArray<{ status: string; count: number }>;
}

export interface PipelinePerformance {
  readonly avgExtractionTimeMs: number;
  readonly avgCodingTimeMs: number;
  readonly avgValidationTimeMs: number;
  readonly codingAccuracy: number;
  readonly missingInfoRate: number;
  readonly escalationRate: number;
}

export interface CorrespondenceMetrics {
  readonly totalSent: number;
  readonly totalReceived: number;
  readonly avgResponseTimeDays: number;
  readonly pendingQueries: number;
  readonly overdueQueries: number;
}

export interface DateFilter {
  readonly from?: string;
  readonly to?: string;
}

// ─── Constants ─────────────────────────────────────

const PERCENTAGE_MULTIPLIER = 100;
const MS_PER_DAY = 86_400_000;

// ─── Service ───────────────────────────────────────

export class BupaAnalyticsService {
  constructor(private readonly prisma: PrismaClient) {}

  // ─── Dashboard ─────────────────────────────────

  async getDashboard(
    orgId: string,
    dateFilter?: DateFilter,
  ): Promise<BupaAnalyticsDashboard> {
    logger.debug({ orgId, dateFilter }, 'Building Bupa analytics dashboard');

    const [
      stpMetrics,
      planUtilisation,
      providerAnalysis,
      denialAnalysis,
      memberMetrics,
      pipelinePerformance,
      correspondenceMetrics,
    ] = await Promise.all([
      this.getStpMetrics(orgId, dateFilter),
      this.getPlanUtilisation(orgId, dateFilter),
      this.getProviderAnalysis(orgId, dateFilter),
      this.getDenialAnalysis(orgId, dateFilter),
      this.getMemberMetrics(),
      this.getPipelinePerformance(orgId, dateFilter),
      this.getCorrespondenceMetrics(orgId, dateFilter),
    ]);

    return {
      stpMetrics,
      planUtilisation,
      providerAnalysis,
      denialAnalysis,
      memberMetrics,
      pipelinePerformance,
      correspondenceMetrics,
    };
  }

  // ─── STP Metrics ───────────────────────────────

  async getStpMetrics(
    orgId: string,
    dateFilter?: DateFilter,
  ): Promise<StpMetrics> {
    const dateWhere = this.buildDateWhere(dateFilter);
    const baseWhere = { orgId, ...dateWhere };

    const [totalClaims, completedClaimIds, closedClaimIds, avgResult] =
      await Promise.all([
        this.prisma.claim.count({ where: baseWhere as any }),
        this.prisma.claim.findMany({
          where: { ...baseWhere, status: 'COMPLETE' } as any,
          select: { id: true },
        }),
        this.prisma.claim.findMany({
          where: { ...baseWhere, status: 'CLOSED' } as any,
          select: { id: true },
        }),
        this.prisma.claim.aggregate({
          where: {
            ...baseWhere,
            status: { in: ['COMPLETE', 'CLOSED'] },
            processingTimeMs: { not: null },
          } as any,
          _avg: { processingTimeMs: true },
        }),
      ]);

    const completedIds = completedClaimIds.map((c) => c.id);
    const closedIds = closedClaimIds.map((c) => c.id);

    // Determine which completed/closed claims have escalation records
    const [completedEscalations, closedEscalations] = await Promise.all([
      completedIds.length > 0
        ? this.prisma.escalation.groupBy({
            by: ['claimId'],
            where: { claimId: { in: completedIds } },
          })
        : Promise.resolve([]),
      closedIds.length > 0
        ? this.prisma.escalation.groupBy({
            by: ['claimId'],
            where: { claimId: { in: closedIds } },
          })
        : Promise.resolve([]),
    ]);

    const completedWithEscalation = new Set(
      completedEscalations.map((e) => e.claimId),
    );
    const closedWithEscalation = new Set(
      closedEscalations.map((e) => e.claimId),
    );

    const autoApproved = completedIds.filter(
      (id) => !completedWithEscalation.has(id),
    ).length;
    const humanReviewed = completedIds.filter((id) =>
      completedWithEscalation.has(id),
    ).length;
    const autoDenied = closedIds.filter(
      (id) => !closedWithEscalation.has(id),
    ).length;

    const autoProcessed = autoApproved + autoDenied;
    const stpRate =
      totalClaims > 0
        ? this.roundToTwoDecimals(
            (autoProcessed / totalClaims) * PERCENTAGE_MULTIPLIER,
          )
        : 0;

    // Median processing time via raw query
    const medianResult: Array<{ median: number | null }> =
      await this.prisma.$queryRaw`
        SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY processing_time_ms) AS median
        FROM claims
        WHERE org_id = ${orgId}
          AND status IN ('COMPLETE', 'CLOSED')
          AND processing_time_ms IS NOT NULL
          ${dateFilter?.from ? Prisma.sql`AND created_at >= ${new Date(dateFilter.from)}` : Prisma.empty}
          ${dateFilter?.to ? Prisma.sql`AND created_at <= ${new Date(dateFilter.to)}` : Prisma.empty}
      `;

    return {
      totalClaims,
      autoApproved,
      autoDenied,
      humanReviewed,
      stpRate,
      avgProcessingTimeMs: Math.round(avgResult._avg.processingTimeMs ?? 0),
      medianProcessingTimeMs: Math.round(medianResult[0]?.median ?? 0),
    };
  }

  // ─── Plan Utilisation ──────────────────────────

  async getPlanUtilisation(
    orgId: string,
    dateFilter?: DateFilter,
  ): Promise<PlanUtilisation[]> {
    const dateConditions = this.buildRawDateConditions(dateFilter, 'c.created_at');

    const rows: Array<{
      plan_tier: string;
      plan_name: string;
      member_count: bigint;
      claim_count: bigint;
      total_claimed: number | null;
      total_paid: number | null;
    }> = await this.prisma.$queryRaw`
      SELECT
        m.plan_tier AS plan_tier,
        hp.name AS plan_name,
        COUNT(DISTINCT m.id)::bigint AS member_count,
        COUNT(DISTINCT c.id)::bigint AS claim_count,
        COALESCE(SUM((c.financials->>'totalClaimed')::numeric), 0) AS total_claimed,
        COALESCE(SUM((c.financials->>'totalPayable')::numeric), 0) AS total_paid
      FROM members m
      JOIN health_plans hp ON hp.id = m.plan_id
      JOIN member_claims mc ON mc.member_id = m.id
      JOIN claims c ON c.id = mc.claim_id AND c.org_id = ${orgId}
      ${dateConditions}
      GROUP BY m.plan_tier, hp.name
      ORDER BY claim_count DESC
    `;

    return rows.map((row) => {
      const claimCount = Number(row.claim_count);
      const totalClaimed = Number(row.total_claimed ?? 0);

      return {
        planTier: row.plan_tier,
        planName: row.plan_name,
        memberCount: Number(row.member_count),
        claimCount,
        totalClaimed,
        totalPaid: Number(row.total_paid ?? 0),
        avgClaimAmount:
          claimCount > 0
            ? this.roundToTwoDecimals(totalClaimed / claimCount)
            : 0,
        currency: 'USD',
      };
    });
  }

  // ─── Provider Analysis ─────────────────────────

  async getProviderAnalysis(
    orgId: string,
    dateFilter?: DateFilter,
  ): Promise<ProviderMetric[]> {
    const dateConditions = this.buildRawDateConditions(dateFilter, 'c.created_at');

    const rows: Array<{
      provider_name: string;
      country: string;
      network_status: string;
      claim_count: bigint;
      total_amount: number | null;
      in_network_count: bigint;
    }> = await this.prisma.$queryRaw`
      SELECT
        p.provider_name,
        p.country,
        p.network_status,
        COUNT(DISTINCT c.id)::bigint AS claim_count,
        COALESCE(SUM((c.financials->>'totalClaimed')::numeric), 0) AS total_amount,
        COUNT(DISTINCT CASE WHEN p.network_status = 'IN_NETWORK' THEN c.id END)::bigint AS in_network_count
      FROM providers p
      JOIN provider_claims pc ON pc.provider_id = p.id
      JOIN claims c ON c.id = pc.claim_id AND c.org_id = ${orgId}
      ${dateConditions}
      GROUP BY p.id, p.provider_name, p.country, p.network_status
      ORDER BY claim_count DESC
    `;

    return rows.map((row) => {
      const claimCount = Number(row.claim_count);
      const totalAmount = Number(row.total_amount ?? 0);
      const inNetworkCount = Number(row.in_network_count);

      return {
        providerName: row.provider_name,
        country: row.country,
        networkStatus: row.network_status,
        claimCount,
        totalAmount,
        avgAmount:
          claimCount > 0
            ? this.roundToTwoDecimals(totalAmount / claimCount)
            : 0,
        inNetworkRate:
          claimCount > 0
            ? this.roundToTwoDecimals(
                (inNetworkCount / claimCount) * PERCENTAGE_MULTIPLIER,
              )
            : 0,
      };
    });
  }

  // ─── Denial Analysis ───────────────────────────

  async getDenialAnalysis(
    orgId: string,
    dateFilter?: DateFilter,
  ): Promise<DenialAnalysis> {
    const dateWhere = this.buildDateWhere(dateFilter);
    const baseWhere = { orgId, ...dateWhere };

    const [totalClaims, totalDenied] = await Promise.all([
      this.prisma.claim.count({ where: baseWhere as any }),
      this.prisma.claim.count({
        where: { ...baseWhere, status: 'CLOSED' } as any,
      }),
    ]);

    const denialRate =
      totalClaims > 0
        ? this.roundToTwoDecimals(
            (totalDenied / totalClaims) * PERCENTAGE_MULTIPLIER,
          )
        : 0;

    // Denial reasons from coverage decisions
    const dateConditions = this.buildRawDateConditions(dateFilter, 'c.created_at');

    const reasonRows: Array<{
      reason: string;
      count: bigint;
    }> = await this.prisma.$queryRaw`
      SELECT
        COALESCE(cd.denial_reason, 'Unspecified') AS reason,
        COUNT(*)::bigint AS count
      FROM coverage_decisions cd
      JOIN claims c ON c.id = cd.claim_id AND c.org_id = ${orgId} AND c.status = 'CLOSED'
      ${dateConditions}
      WHERE cd.is_covered = false AND cd.denial_reason IS NOT NULL
      GROUP BY cd.denial_reason
      ORDER BY count DESC
    `;

    const totalReasons = reasonRows.reduce(
      (sum, row) => sum + Number(row.count),
      0,
    );

    const denialsByReason = reasonRows.map((row) => {
      const count = Number(row.count);
      return {
        reason: row.reason,
        count,
        percentage:
          totalReasons > 0
            ? this.roundToTwoDecimals(
                (count / totalReasons) * PERCENTAGE_MULTIPLIER,
              )
            : 0,
      };
    });

    // Denials by plan tier
    const planRows: Array<{
      plan_tier: string;
      denied_count: bigint;
      total_count: bigint;
    }> = await this.prisma.$queryRaw`
      SELECT
        m.plan_tier,
        COUNT(DISTINCT CASE WHEN c.status = 'CLOSED' THEN c.id END)::bigint AS denied_count,
        COUNT(DISTINCT c.id)::bigint AS total_count
      FROM members m
      JOIN member_claims mc ON mc.member_id = m.id
      JOIN claims c ON c.id = mc.claim_id AND c.org_id = ${orgId}
      ${dateConditions}
      GROUP BY m.plan_tier
      ORDER BY denied_count DESC
    `;

    const denialsByPlan = planRows.map((row) => {
      const deniedCount = Number(row.denied_count);
      const planTotal = Number(row.total_count);
      return {
        planTier: row.plan_tier,
        count: deniedCount,
        rate:
          planTotal > 0
            ? this.roundToTwoDecimals(
                (deniedCount / planTotal) * PERCENTAGE_MULTIPLIER,
              )
            : 0,
      };
    });

    return {
      totalDenied,
      denialRate,
      denialsByReason,
      denialsByPlan,
    };
  }

  // ─── Member Metrics ────────────────────────────

  async getMemberMetrics(): Promise<MemberMetrics> {
    const [totalMembers, activeMembers, totalClaimLinks, planGroups, statusGroups] =
      await Promise.all([
        this.prisma.member.count(),
        this.prisma.member.count({ where: { status: 'MEMBER_ACTIVE' } }),
        this.prisma.memberClaim.count(),
        this.prisma.member.groupBy({
          by: ['planTier'],
          _count: { _all: true },
        }),
        this.prisma.member.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
      ]);

    const claimsPerMember =
      totalMembers > 0
        ? this.roundToTwoDecimals(totalClaimLinks / totalMembers)
        : 0;

    const membersByPlan = planGroups.map((group) => ({
      planTier: group.planTier,
      count: group._count._all,
    }));

    const membersByStatus = statusGroups.map((group) => ({
      status: group.status,
      count: group._count._all,
    }));

    return {
      totalMembers,
      activeMembers,
      claimsPerMember,
      membersByPlan,
      membersByStatus,
    };
  }

  // ─── Pipeline Performance ──────────────────────

  async getPipelinePerformance(
    orgId: string,
    dateFilter?: DateFilter,
  ): Promise<PipelinePerformance> {
    const dateWhere = this.buildDateWhere(dateFilter);
    const baseWhere = { orgId, ...dateWhere };

    const [totalClaims, queryingClaims, escalatedClaimIds] = await Promise.all([
      this.prisma.claim.count({ where: baseWhere as any }),
      this.prisma.claim.count({
        where: { ...baseWhere, status: 'QUERYING' } as any,
      }),
      this.prisma.escalation.findMany({
        where: {
          claim: { orgId, ...dateWhere } as any,
        },
        select: { claimId: true },
        distinct: ['claimId'],
      }),
    ]);

    // Coding accuracy: 1 - (corrected / total)
    const claimIds = await this.prisma.claim.findMany({
      where: baseWhere as any,
      select: { id: true },
    });
    const ids = claimIds.map((c) => c.id);

    let codingAccuracy = 100;
    if (ids.length > 0) {
      const [totalCodes, correctedCodes] = await Promise.all([
        this.prisma.claimCoding.count({
          where: { claimId: { in: ids } },
        }),
        this.prisma.claimCoding.count({
          where: { claimId: { in: ids }, reviewerAction: 'corrected' },
        }),
      ]);

      codingAccuracy =
        totalCodes > 0
          ? this.roundToTwoDecimals(
              ((totalCodes - correctedCodes) / totalCodes) *
                PERCENTAGE_MULTIPLIER,
            )
          : 100;
    }

    const missingInfoRate =
      totalClaims > 0
        ? this.roundToTwoDecimals(
            (queryingClaims / totalClaims) * PERCENTAGE_MULTIPLIER,
          )
        : 0;

    const escalationRate =
      totalClaims > 0
        ? this.roundToTwoDecimals(
            (escalatedClaimIds.length / totalClaims) * PERCENTAGE_MULTIPLIER,
          )
        : 0;

    // Stage-level timing via audit events
    const dateConditions = this.buildRawDateConditions(dateFilter, 'c.created_at');

    const stageTimings: Array<{
      stage: string;
      avg_ms: number | null;
    }> = await this.prisma.$queryRaw`
      SELECT
        ae.action AS stage,
        AVG(EXTRACT(EPOCH FROM (ae.created_at - c.created_at)) * 1000)::float AS avg_ms
      FROM audit_events ae
      JOIN claims c ON c.id = ae.target_id AND c.org_id = ${orgId}
      ${dateConditions}
      WHERE ae.action IN ('EXTRACTING', 'CODING', 'VALIDATING')
      GROUP BY ae.action
    `;

    const timingMap = new Map(
      stageTimings.map((row) => [row.stage, Math.round(row.avg_ms ?? 0)]),
    );

    return {
      avgExtractionTimeMs: timingMap.get('EXTRACTING') ?? 0,
      avgCodingTimeMs: timingMap.get('CODING') ?? 0,
      avgValidationTimeMs: timingMap.get('VALIDATING') ?? 0,
      codingAccuracy,
      missingInfoRate,
      escalationRate,
    };
  }

  // ─── Correspondence Metrics ────────────────────

  async getCorrespondenceMetrics(
    orgId: string,
    dateFilter?: DateFilter,
  ): Promise<CorrespondenceMetrics> {
    const dateConditions = this.buildRawDateConditions(dateFilter, 'c.created_at');

    const directionRows: Array<{
      direction: string;
      count: bigint;
    }> = await this.prisma.$queryRaw`
      SELECT
        cc.direction,
        COUNT(*)::bigint AS count
      FROM claim_correspondence cc
      JOIN claims c ON c.id = cc.claim_id AND c.org_id = ${orgId}
      ${dateConditions}
      GROUP BY cc.direction
    `;

    const directionMap = new Map(
      directionRows.map((row) => [row.direction, Number(row.count)]),
    );

    // Query metrics
    const [pendingQueries, overdueQueries, avgResponseResult] =
      await Promise.all([
        this.prisma.claimQuery.count({
          where: {
            status: { in: ['SENT', 'AWAITING_RESPONSE'] },
            claim: { orgId },
          } as any,
        }),
        this.prisma.claimQuery.count({
          where: {
            status: { in: ['SENT', 'AWAITING_RESPONSE'] },
            nextFollowUp: { lt: new Date() },
            claim: { orgId },
          } as any,
        }),
        this.prisma.$queryRaw<Array<{ avg_days: number | null }>>`
          SELECT
            AVG(EXTRACT(EPOCH FROM (cq.response_received_at - cq.sent_at)) / ${MS_PER_DAY / 1000})::float AS avg_days
          FROM claim_queries cq
          JOIN claims c ON c.id = cq.claim_id AND c.org_id = ${orgId}
          WHERE cq.response_received_at IS NOT NULL AND cq.sent_at IS NOT NULL
        `,
      ]);

    return {
      totalSent: directionMap.get('OUTBOUND') ?? 0,
      totalReceived: directionMap.get('INBOUND') ?? 0,
      avgResponseTimeDays: this.roundToTwoDecimals(
        avgResponseResult[0]?.avg_days ?? 0,
      ),
      pendingQueries,
      overdueQueries,
    };
  }

  // ─── Private Helpers ───────────────────────────

  private buildDateWhere(
    dateFilter?: DateFilter,
  ): Record<string, unknown> {
    if (!dateFilter?.from && !dateFilter?.to) {
      return {};
    }

    const createdAt: Record<string, Date> = {};
    if (dateFilter.from) {
      createdAt.gte = new Date(dateFilter.from);
    }
    if (dateFilter.to) {
      createdAt.lte = new Date(dateFilter.to);
    }
    return { createdAt };
  }

  private buildRawDateConditions(
    dateFilter: DateFilter | undefined,
    column: string,
  ): Prisma.Sql {
    if (!dateFilter?.from && !dateFilter?.to) {
      return Prisma.empty;
    }

    const parts: Prisma.Sql[] = [];
    if (dateFilter?.from) {
      parts.push(
        Prisma.sql`AND ${Prisma.raw(column)} >= ${new Date(dateFilter.from)}`,
      );
    }
    if (dateFilter?.to) {
      parts.push(
        Prisma.sql`AND ${Prisma.raw(column)} <= ${new Date(dateFilter.to)}`,
      );
    }

    return Prisma.join(parts, ' ');
  }

  private roundToTwoDecimals(value: number): number {
    return Math.round(value * 100) / 100;
  }
}
