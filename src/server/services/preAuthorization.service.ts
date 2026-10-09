import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export interface PreAuthCheckResult {
  readonly preAuthRequired: boolean;
  readonly existingPreAuth: {
    readonly id: string;
    readonly authorizationNumber: string | null;
    readonly status: string;
    readonly authorizedAmount: number | null;
    readonly validFrom: Date | null;
    readonly validTo: Date | null;
  } | null;
  readonly isValid: boolean;
  readonly reason: string;
}

export interface PreAuthRequestInput {
  readonly memberId: string;
  readonly claimId?: string;
  readonly treatmentType: string;
  readonly treatmentDate: string;
  readonly estimatedAmount?: number;
  readonly procedures?: string[];
  readonly requestedBy: string;
}

// ─── Constants ─────────────────────────────────────

const PRE_AUTH_REQUIRED_TYPES = new Set(['INPATIENT', 'DAY_PATIENT', 'SURGICAL']);

// ─── Service ───────────────────────────────────────

export class PreAuthorizationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Check whether pre-authorization is required and if a valid one exists.
   */
  async checkPreAuth(params: {
    memberId: string;
    treatmentType: string;
    treatmentDate: string;
  }): Promise<PreAuthCheckResult> {
    const required = PRE_AUTH_REQUIRED_TYPES.has(params.treatmentType.toUpperCase());

    if (!required) {
      return {
        preAuthRequired: false,
        existingPreAuth: null,
        isValid: true,
        reason: 'Pre-authorization not required for this treatment type',
      };
    }

    // Look up existing valid pre-auth
    const treatmentDateObj = new Date(params.treatmentDate);
    const existing = await this.prisma.preAuthorization.findFirst({
      where: {
        memberId: params.memberId,
        status: 'APPROVED',
        validFrom: { lte: treatmentDateObj },
        validTo: { gte: treatmentDateObj },
      },
      orderBy: { approvedDate: 'desc' },
    });

    if (existing) {
      return {
        preAuthRequired: true,
        existingPreAuth: {
          id: existing.id,
          authorizationNumber: existing.authorizationNumber,
          status: existing.status,
          authorizedAmount: existing.authorizedAmount,
          validFrom: existing.validFrom,
          validTo: existing.validTo,
        },
        isValid: true,
        reason: `Valid pre-authorization found: ${existing.authorizationNumber}`,
      };
    }

    return {
      preAuthRequired: true,
      existingPreAuth: null,
      isValid: false,
      reason: 'Pre-authorization required but none found — claim will be held pending approval',
    };
  }

  /**
   * Create a new pre-authorization request.
   */
  async requestPreAuth(input: PreAuthRequestInput): Promise<string> {
    const preAuth = await this.prisma.preAuthorization.create({
      data: {
        memberId: input.memberId,
        claimId: input.claimId,
        treatmentType: input.treatmentType,
        authorizedProcedures: input.procedures ?? [],
        requestedBy: input.requestedBy,
        status: 'REQUESTED',
      },
    });

    logger.info({ preAuthId: preAuth.id, memberId: input.memberId }, 'Pre-authorization request created');
    return preAuth.id;
  }

  /**
   * Approve a pre-authorization request.
   */
  async approvePreAuth(preAuthId: string, params: {
    authorizationNumber: string;
    authorizedAmount: number;
    validFrom: Date;
    validTo: Date;
    notes?: string;
  }): Promise<void> {
    await this.prisma.preAuthorization.update({
      where: { id: preAuthId },
      data: {
        status: 'APPROVED',
        approvedDate: new Date(),
        authorizationNumber: params.authorizationNumber,
        authorizedAmount: params.authorizedAmount,
        validFrom: params.validFrom,
        validTo: params.validTo,
        notes: params.notes,
      },
    });

    logger.info({ preAuthId }, 'Pre-authorization approved');
  }

  /**
   * Deny a pre-authorization request.
   */
  async denyPreAuth(preAuthId: string, notes?: string): Promise<void> {
    await this.prisma.preAuthorization.update({
      where: { id: preAuthId },
      data: {
        status: 'DENIED',
        deniedDate: new Date(),
        notes,
      },
    });

    logger.info({ preAuthId }, 'Pre-authorization denied');
  }
}
