import { PrismaClient, EscalationTier } from '@prisma/client';
import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export interface EscalateParams {
  readonly claimId: string;
  readonly tier: 'QUERY_SENDER' | 'HANDLER' | 'TEAM_LEAD' | 'ADMIN';
  readonly reason: string;
  readonly details?: Record<string, unknown>;
  readonly escalatedBy: string;
}

interface ClaimForPriority {
  readonly type?: string;
  readonly slaDeadline?: Date | string | null;
  readonly financials?: { totalClaimed?: number } | null;
}

interface HandlerScore {
  readonly userId: string;
  readonly score: number;
}

// ─── Constants ─────────────────────────────────────

const PRIORITY_SOLICITOR = 100;
const PRIORITY_COMPLAINT = 90;
const PRIORITY_HIGH_VALUE = 80;
const PRIORITY_STANDARD = 50;
const PRIORITY_STATUS_ENQUIRY = 20;

const HIGH_VALUE_THRESHOLD = 10_000;

const URGENCY_CRITICAL_HOURS = 4;
const URGENCY_HIGH_HOURS = 24;
const URGENCY_CRITICAL_MULTIPLIER = 2.0;
const URGENCY_HIGH_MULTIPLIER = 1.5;
const URGENCY_NORMAL_MULTIPLIER = 1.0;

const SCORE_SPECIALISATION_MATCH = 30;
const SCORE_LOWEST_WORKLOAD = 25;
const SCORE_LANGUAGE_MATCH = 20;
const SCORE_HISTORICAL_ACCURACY = 10;
const SCORE_ACTIVE_STATUS = 10;

// ─── Errors ────────────────────────────────────────

export class EscalationNotFoundError extends Error {
  constructor(escalationId: string) {
    super(`Escalation not found: ${escalationId}`);
    this.name = 'EscalationNotFoundError';
  }
}

export class ClaimNotFoundError extends Error {
  constructor(claimId: string) {
    super(`Claim not found: ${claimId}`);
    this.name = 'ClaimNotFoundError';
  }
}

// ─── Service ───────────────────────────────────────

export class EscalationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Escalate a claim to the appropriate tier.
   * Depending on the tier, assigns a handler, finds a team lead,
   * marks high-priority, or queries the sender.
   */
  async escalate(params: EscalateParams) {
    const { claimId, tier, reason, details, escalatedBy } = params;

    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      select: {
        id: true,
        teamId: true,
        status: true,
        financials: true,
        policy: true,
      },
    });

    if (!claim) {
      throw new ClaimNotFoundError(claimId);
    }

    const escalationData: Record<string, unknown> = {
      claimId,
      tier: tier as EscalationTier,
      reason,
      details: details ?? {},
      escalatedBy,
    };

    if (tier === 'HANDLER' && claim.teamId) {
      const handlerId = await this.findBestHandler(claim.teamId, {
        lineOfBusiness: this.extractLineOfBusiness(claim),
        language: this.extractLanguage(claim),
      });

      if (handlerId) {
        escalationData.assignedTo = handlerId;

        await this.prisma.claim.update({
          where: { id: claimId },
          data: {
            assignedTo: handlerId,
            status: 'REVIEWING',
          } as Record<string, unknown>,
        });
      }
    } else if (tier === 'TEAM_LEAD' && claim.teamId) {
      const team = await this.prisma.team.findUnique({
        where: { id: claim.teamId },
        select: { leadId: true },
      });

      if (team?.leadId) {
        escalationData.assignedTo = team.leadId;

        await this.prisma.claim.update({
          where: { id: claimId },
          data: { assignedTo: team.leadId } as Record<string, unknown>,
        });
      }
    } else if (tier === 'ADMIN') {
      await this.prisma.claim.update({
        where: { id: claimId },
        data: { priority: 100 } as Record<string, unknown>,
      });
    } else if (tier === 'QUERY_SENDER') {
      await this.prisma.claim.update({
        where: { id: claimId },
        data: { status: 'QUERYING' } as Record<string, unknown>,
      });
    }

    const escalation = await this.prisma.escalation.create({
      data: escalationData as any,
    });

    logger.info(
      { escalationId: escalation.id, claimId, tier, escalatedBy },
      'Escalation created',
    );

    return escalation;
  }

  /**
   * Find the best handler for a claim based on scoring criteria.
   * Returns the user ID of the highest-scoring handler, or null.
   */
  async findBestHandler(
    teamId: string,
    claim: { lineOfBusiness?: string; language?: string },
  ): Promise<string | null> {
    const members = await this.prisma.teamMember.findMany({
      where: { teamId },
      select: {
        user: {
          select: {
            id: true,
            specialisation: true,
            status: true,
          },
        },
      },
    });

    if (members.length === 0) {
      return null;
    }

    const userIds = members.map((m) => m.user.id);

    const workloadCounts = await this.prisma.claim.groupBy({
      by: ['assignedTo'],
      where: {
        assignedTo: { in: userIds },
        status: 'REVIEWING',
      },
      _count: { id: true },
    });

    const workloadMap = new Map<string, number>();
    for (const entry of workloadCounts) {
      if (entry.assignedTo) {
        workloadMap.set(entry.assignedTo, entry._count.id);
      }
    }

    const maxWorkload = Math.max(1, ...workloadMap.values());

    const scores: HandlerScore[] = members.map((m) => {
      const user = m.user;
      let score = 0;

      // +30 if specialisation matches lineOfBusiness
      if (
        claim.lineOfBusiness &&
        user.specialisation &&
        user.specialisation.toLowerCase().includes(claim.lineOfBusiness.toLowerCase())
      ) {
        score += SCORE_SPECIALISATION_MATCH;
      }

      // +25 for lowest workload (inversely proportional)
      const userWorkload = workloadMap.get(user.id) ?? 0;
      const workloadScore =
        maxWorkload > 0
          ? SCORE_LOWEST_WORKLOAD * (1 - userWorkload / maxWorkload)
          : SCORE_LOWEST_WORKLOAD;
      score += Math.round(workloadScore);

      // +20 if handler speaks the claim language
      if (
        claim.language &&
        user.specialisation &&
        user.specialisation.toLowerCase().includes(claim.language.toLowerCase())
      ) {
        score += SCORE_LANGUAGE_MATCH;
      }

      // +10 historical accuracy placeholder
      score += SCORE_HISTORICAL_ACCURACY;

      // +10 if handler has ACTIVE status
      if (user.status === 'ACTIVE') {
        score += SCORE_ACTIVE_STATUS;
      }

      return { userId: user.id, score };
    });

    const sorted = [...scores].sort((a, b) => b.score - a.score);
    return sorted[0]?.userId ?? null;
  }

  /**
   * Resolve an escalation with a resolution note.
   */
  async resolveEscalation(
    escalationId: string,
    resolvedBy: string,
    resolution: string,
  ) {
    const existing = await this.prisma.escalation.findUnique({
      where: { id: escalationId },
    });

    if (!existing) {
      throw new EscalationNotFoundError(escalationId);
    }

    const resolved = await this.prisma.escalation.update({
      where: { id: escalationId },
      data: {
        resolvedBy,
        resolvedAt: new Date(),
        resolution,
      },
    });

    logger.info(
      { escalationId, resolvedBy },
      'Escalation resolved',
    );

    return resolved;
  }

  /**
   * List all escalations for a claim, newest first.
   */
  async listEscalations(claimId: string) {
    const escalations = await this.prisma.escalation.findMany({
      where: { claimId },
      orderBy: { createdAt: 'desc' },
    });

    return escalations;
  }

  /**
   * Compute a priority score for a claim.
   * Pure function based on claim type and SLA urgency.
   */
  computePriority(claim: ClaimForPriority): number {
    const claimType = (claim.type ?? '').toLowerCase();

    let basePriority: number;
    if (claimType.includes('solicitor') || claimType.includes('legal')) {
      basePriority = PRIORITY_SOLICITOR;
    } else if (claimType.includes('complaint')) {
      basePriority = PRIORITY_COMPLAINT;
    } else if (
      claim.financials &&
      typeof claim.financials === 'object' &&
      'totalClaimed' in claim.financials &&
      (claim.financials as { totalClaimed?: number }).totalClaimed !== undefined &&
      (claim.financials as { totalClaimed: number }).totalClaimed > HIGH_VALUE_THRESHOLD
    ) {
      basePriority = PRIORITY_HIGH_VALUE;
    } else if (claimType.includes('status_enquiry') || claimType.includes('enquiry')) {
      basePriority = PRIORITY_STATUS_ENQUIRY;
    } else {
      basePriority = PRIORITY_STANDARD;
    }

    let urgencyMultiplier = URGENCY_NORMAL_MULTIPLIER;

    if (claim.slaDeadline) {
      const deadline = new Date(claim.slaDeadline);
      const now = new Date();
      const hoursRemaining = (deadline.getTime() - now.getTime()) / (1000 * 60 * 60);

      if (hoursRemaining < URGENCY_CRITICAL_HOURS) {
        urgencyMultiplier = URGENCY_CRITICAL_MULTIPLIER;
      } else if (hoursRemaining < URGENCY_HIGH_HOURS) {
        urgencyMultiplier = URGENCY_HIGH_MULTIPLIER;
      }
    }

    return Math.round(basePriority * urgencyMultiplier);
  }

  // ─── Private Helpers ─────────────────────────────

  private extractLineOfBusiness(claim: Record<string, unknown>): string | undefined {
    const policy = claim.policy as Record<string, unknown> | null;
    if (policy && typeof policy === 'object' && 'lineOfBusiness' in policy) {
      return String(policy.lineOfBusiness);
    }
    return undefined;
  }

  private extractLanguage(claim: Record<string, unknown>): string | undefined {
    const claimData = claim as Record<string, unknown>;
    if ('language' in claimData && claimData.language) {
      return String(claimData.language);
    }
    return undefined;
  }
}
