import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

// ─── Constants ────────────────────────────────────

export const VALID_APPEAL_OUTCOMES = ['UPHELD', 'OVERTURNED'] as const;
export type AppealOutcome = (typeof VALID_APPEAL_OUTCOMES)[number];

// ─── Pure Functions (testable without DB) ─────────

export function isValidAppealOutcome(outcome: string): outcome is AppealOutcome {
  return (VALID_APPEAL_OUTCOMES as readonly string[]).includes(outcome);
}

export function buildAppealAuditDetails(params: {
  type: 'submit' | 'review';
  appealId: string;
  claimId: string;
  reason?: string;
  outcome?: string;
  reviewerId?: string;
  notes?: string;
}): Record<string, unknown> {
  if (params.type === 'submit') {
    return {
      action: 'APPEAL_SUBMITTED',
      appealId: params.appealId,
      claimId: params.claimId,
      reason: params.reason,
    };
  }

  return {
    action: 'APPEAL_REVIEWED',
    appealId: params.appealId,
    claimId: params.claimId,
    outcome: params.outcome,
    reviewerId: params.reviewerId,
    ...(params.notes ? { notes: params.notes } : {}),
  };
}

// ─── Service Class (requires DB) ──────────────────

export class AppealService {
  constructor(private readonly prisma: PrismaClient) {}

  async submitAppeal(params: {
    claimId: string;
    reason: string;
    supportingDocs?: string[];
  }): Promise<string> {
    const appeal = await this.prisma.appeal.create({
      data: {
        claimId: params.claimId,
        reason: params.reason,
        supportingDocs: params.supportingDocs ?? [],
        status: 'SUBMITTED',
      },
    });

    // Reopen the claim for re-review
    await this.prisma.claim.update({
      where: { id: params.claimId },
      data: { status: 'REOPENED' },
    });

    // Create audit event
    await this.prisma.auditEvent.create({
      data: {
        eventType: 'APPEAL_SUBMITTED',
        actorType: 'MEMBER',
        targetType: 'CLAIM',
        targetId: params.claimId,
        action: 'Appeal submitted',
        details: buildAppealAuditDetails({
          type: 'submit',
          appealId: appeal.id,
          claimId: params.claimId,
          reason: params.reason,
        }) as any,
      },
    });

    logger.info({ appealId: appeal.id, claimId: params.claimId }, 'Appeal submitted');
    return appeal.id;
  }

  async reviewAppeal(appealId: string, params: {
    reviewerId: string;
    outcome: AppealOutcome;
    notes?: string;
  }): Promise<void> {
    if (!isValidAppealOutcome(params.outcome)) {
      throw new Error(`Invalid appeal outcome: ${params.outcome}`);
    }

    const appeal = await this.prisma.appeal.update({
      where: { id: appealId },
      data: {
        status: params.outcome,
        reviewedBy: params.reviewerId,
        reviewDate: new Date(),
        outcome: params.outcome,
        notes: params.notes,
      },
    });

    if (params.outcome === 'OVERTURNED') {
      // Set claim back to VALIDATING for re-adjudication
      await this.prisma.claim.update({
        where: { id: appeal.claimId },
        data: { status: 'VALIDATING' },
      });
    }

    await this.prisma.auditEvent.create({
      data: {
        eventType: 'APPEAL_REVIEWED',
        actorType: 'USER',
        targetType: 'CLAIM',
        targetId: appeal.claimId,
        action: `Appeal ${params.outcome.toLowerCase()}`,
        details: buildAppealAuditDetails({
          type: 'review',
          appealId,
          claimId: appeal.claimId,
          outcome: params.outcome,
          reviewerId: params.reviewerId,
          notes: params.notes,
        }) as any,
      },
    });

    logger.info({ appealId, outcome: params.outcome }, 'Appeal reviewed');
  }

  async listAppeals(claimId: string) {
    return this.prisma.appeal.findMany({
      where: { claimId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
