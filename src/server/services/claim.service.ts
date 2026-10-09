import { PrismaClient, ClaimStatus } from '@prisma/client'; 
import fs from 'fs';
import path from 'path';

import { NotificationService } from './notification.service';

// ─── Types ─────────────────────────────────────────

export interface ClaimListFilters {
  status?: string[];
  clientId?: string;
  teamId?: string;
  assignedTo?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  page?: number;
  limit?: number;
}

export interface ClaimListResult {
  claims: unknown[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Icd10Entry {
  short: string;
  long: string;
}

// ─── Constants ─────────────────────────────────────

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

const VALID_SORT_FIELDS = ['createdAt', 'priority', 'overallConfidence'] as const;

/**
 * Defines allowed status transitions.
 * Each status maps to the set of statuses it can transition to.
 */
const STATUS_TRANSITIONS: Record<string, readonly string[]> = {
  NEW: ['INGESTING', 'REVIEWING', 'ON_HOLD', 'DUPLICATE', 'CLOSED'],
  INGESTING: ['EXTRACTING', 'ON_HOLD', 'DUPLICATE', 'CLOSED'],
  EXTRACTING: ['TRANSLATING', 'CODING', 'ON_HOLD', 'DUPLICATE', 'ESCALATED_HANDLER', 'CLOSED'],
  TRANSLATING: ['CODING', 'ON_HOLD', 'DUPLICATE', 'CLOSED'],
  CODING: ['VALIDATING', 'REVIEWING', 'ESCALATED_CLINICAL', 'ON_HOLD', 'DUPLICATE', 'CLOSED'],
  VALIDATING: ['QUERYING', 'QUERYING_MEMBER', 'QUERYING_PROVIDER', 'REVIEWING', 'ON_HOLD', 'DUPLICATE', 'DENIED', 'ESCALATED_CLINICAL', 'CLOSED'],
  QUERYING: ['VALIDATING', 'REVIEWING', 'ON_HOLD', 'DUPLICATE', 'CLOSED'],
  QUERYING_MEMBER: ['VALIDATING', 'REVIEWING', 'ON_HOLD', 'DUPLICATE', 'CLOSED'],
  QUERYING_PROVIDER: ['VALIDATING', 'REVIEWING', 'ON_HOLD', 'DUPLICATE', 'CLOSED'],
  REVIEWING: ['BUILDING', 'COMPLETE', 'DENIED', 'ON_HOLD', 'DUPLICATE', 'CLOSED'],
  BUILDING: ['COMPLETE', 'ON_HOLD', 'CLOSED'],
  COMPLETE: ['REOPENED', 'CLOSED'],
  ON_HOLD: ['NEW', 'VALIDATING', 'REVIEWING', 'DUPLICATE', 'CLOSED'],
  REOPENED: ['VALIDATING', 'REVIEWING', 'CLOSED'],
  ESCALATED_HANDLER: ['REVIEWING', 'ON_HOLD', 'CLOSED'],
  ESCALATED_CLINICAL: ['REVIEWING', 'DENIED', 'ON_HOLD', 'CLOSED'],
  DENIED: ['REOPENED', 'CLOSED'],
  DUPLICATE: ['REOPENED', 'CLOSED', 'REVIEWING'],
  CLOSED: [],
} as const;

// ─── Errors ────────────────────────────────────────

export class ClaimNotFoundError extends Error {
  constructor(claimId: string) {
    super(`Claim not found: ${claimId}`);
    this.name = 'ClaimNotFoundError';
  }
}

export class InvalidStatusTransitionError extends Error {
  constructor(current: string, target: string) {
    super(`Invalid status transition from ${current} to ${target}`);
    this.name = 'InvalidStatusTransitionError';
  }
}

export class CodingNotFoundError extends Error {
  constructor(codingId: string) {
    super(`Coding entry not found: ${codingId}`);
    this.name = 'CodingNotFoundError';
  }
}

export class InvalidReviewerActionError extends Error {
  constructor(action: string) {
    super(`Invalid reviewer action: ${action}. Must be accepted, corrected, or rejected.`);
    this.name = 'InvalidReviewerActionError';
  }
}

// ─── Service ───────────────────────────────────────

export class ClaimService {
  private icd10Cache: Record<string, Icd10Entry> | null = null;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly notificationService?: NotificationService,
  ) {}

  /**
   * List claims for an organisation with filtering, searching, sorting, and pagination.
   */
  async listClaims(orgId: string, filters: ClaimListFilters): Promise<ClaimListResult> {
    const page = Math.max(DEFAULT_PAGE, filters.page ?? DEFAULT_PAGE);
    const limit = Math.min(MAX_LIMIT, Math.max(1, filters.limit ?? DEFAULT_LIMIT));
    const skip = (page - 1) * limit;

    const sortBy = VALID_SORT_FIELDS.includes(filters.sortBy as any)
      ? (filters.sortBy as string)
      : 'createdAt';
    const sortOrder = filters.sortOrder === 'asc' ? 'asc' : 'desc';

    const where: Record<string, unknown> = { orgId };

    if (filters.status && filters.status.length > 0) {
      where.status = { in: filters.status };
    }
    if (filters.clientId) {
      where.clientId = filters.clientId;
    }
    if (filters.teamId) {
      where.teamId = filters.teamId;
    }
    if (filters.assignedTo) {
      where.assignedTo = filters.assignedTo;
    }
    if (filters.dateFrom || filters.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (filters.dateFrom) {
        createdAt.gte = new Date(filters.dateFrom);
      }
      if (filters.dateTo) {
        createdAt.lte = new Date(filters.dateTo);
      }
      where.createdAt = createdAt;
    }
    if (filters.search) {
      const searchTerm = filters.search.trim();
      where.OR = [
        { claimReference: { contains: searchTerm, mode: 'insensitive' } },
        { claimant: { path: ['name'], string_contains: searchTerm } },
      ];
    }

    const [claims, total] = await Promise.all([
      this.prisma.claim.findMany({
        where: where as any,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
        select: {
          id: true,
          claimReference: true,
          status: true,
          priority: true,
          overallConfidence: true,
          claimant: true,
          assignedTo: true,
          teamId: true,
          clientId: true,
          slaDeadline: true,
          createdAt: true,
          updatedAt: true,
          completedAt: true,
          _count: { select: { documents: true, coding: true } },
        },
      }),
      this.prisma.claim.count({ where: where as any }),
    ]);

    return {
      claims,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Get full claim detail including all relations.
   */
  async getClaimDetail(claimId: string): Promise<unknown | null> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      include: {
        documents: true,
        coding: {
          orderBy: [{ isPrimary: 'desc' }, { confidence: 'desc' }],
        },
        correspondence: {
          orderBy: { createdAt: 'desc' },
        },
        escalations: {
          orderBy: { createdAt: 'desc' },
        },
        assignedHandler: {
          select: { id: true, name: true, email: true },
        },
        team: {
          select: { id: true, name: true },
        },
        client: {
          select: { id: true, name: true },
        },
      },
    });

    return claim;
  }

  /**
   * Update claim status with transition validation.
   */
  async updateClaimStatus(
    claimId: string,
    targetStatus: string,
    userId?: string,
  ): Promise<unknown> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      select: { id: true, status: true },
    });

    if (!claim) {
      throw new ClaimNotFoundError(claimId);
    }

    const currentStatus = claim.status;
    const allowedTransitions = STATUS_TRANSITIONS[currentStatus] ?? [];

    if (!allowedTransitions.includes(targetStatus)) {
      throw new InvalidStatusTransitionError(currentStatus, targetStatus);
    }

    const updateData: Record<string, unknown> = {
      status: targetStatus as ClaimStatus,
    };

    if (targetStatus === 'COMPLETE') {
      updateData.completedAt = new Date();
    }

    const updated = await this.prisma.claim.update({
      where: { id: claimId },
      data: updateData as any,
    });

    // Log audit event
    await this.prisma.auditEvent.create({
      data: {
        eventType: 'CLAIM_STATUS_CHANGE',
        actorType: userId ? 'USER' : 'SYSTEM',
        actorId: userId ?? null,
        targetType: 'CLAIM',
        targetId: claimId,
        action: 'status_change',
        previousValue: { status: currentStatus } as any,
        newValue: { status: targetStatus } as any,
      },
    });

    return updated;
  }

  /**
   * Assign a claim to a handler.
   * Moves status to REVIEWING if not already in REVIEWING or later.
   */
  async assignClaim(claimId: string, handlerId: string): Promise<unknown> {
    const claim = await this.prisma.claim.findUnique({
      where: { id: claimId },
      select: { id: true, status: true, assignedTo: true },
    });

    if (!claim) {
      throw new ClaimNotFoundError(claimId);
    }

    const updateData: Record<string, unknown> = {
      assignedTo: handlerId,
    };

    // Move to REVIEWING if the claim is in an early stage
    const earlyStatuses: string[] = [
      'NEW', 'INGESTING', 'EXTRACTING', 'TRANSLATING',
      'CODING', 'VALIDATING', 'QUERYING',
    ];
    if (earlyStatuses.includes(claim.status)) {
      updateData.status = 'REVIEWING' as ClaimStatus;
    }

    const updated = await this.prisma.claim.update({
      where: { id: claimId },
      data: updateData as any,
    });

    // Log audit event
    await this.prisma.auditEvent.create({
      data: {
        eventType: 'CLAIM_ASSIGNED',
        actorType: 'SYSTEM',
        actorId: null,
        targetType: 'CLAIM',
        targetId: claimId,
        action: 'assign',
        previousValue: { assignedTo: claim.assignedTo } as any,
        newValue: { assignedTo: handlerId } as any,
      },
    });

    // Send notification to assignee
    if (this.notificationService) {
      await this.notificationService.notify({
        userId: handlerId,
        type: 'CLAIM_ASSIGNED',
        title: 'New Claim Assigned',
        body: `Claim ${updated.claimReference} has been assigned to you.`,
        data: {
          claimId: updated.id,
          claimReference: updated.claimReference,
        },
      });
    }

    return updated;
  }

  /**
   * Update a coding entry with reviewer action.
   */
  async updateCoding(
    claimId: string,
    codingId: string,
    data: { reviewerAction: string; correctedCode?: string; note?: string },
    reviewerId: string,
  ): Promise<unknown> {
    const coding = await this.prisma.claimCoding.findFirst({
      where: { id: codingId, claimId },
    });

    if (!coding) {
      throw new CodingNotFoundError(codingId);
    }

    const validActions = ['accepted', 'corrected', 'rejected'];
    if (!validActions.includes(data.reviewerAction)) {
      throw new InvalidReviewerActionError(data.reviewerAction);
    }

    const updateData: Record<string, unknown> = {
      reviewerAction: data.reviewerAction,
      reviewerId,
      reviewedAt: new Date(),
      reviewerNote: data.note ?? null,
    };

    if (data.reviewerAction === 'corrected') {
      if (!data.correctedCode) {
        throw new Error('correctedCode is required when reviewerAction is corrected');
      }
      updateData.originalCode = coding.code;
      updateData.code = data.correctedCode;
    }

    const updated = await this.prisma.claimCoding.update({
      where: { id: codingId },
      data: updateData as any,
    });

    return updated;
  }

  /**
   * Get all coding entries for a claim.
   */
  async getClaimCoding(claimId: string): Promise<unknown[]> {
    const codes = await this.prisma.claimCoding.findMany({
      where: { claimId },
      orderBy: [{ isPrimary: 'desc' }, { confidence: 'desc' }],
    });
    return codes;
  }

  /**
   * Search ICD-10 codes by code prefix or description text.
   * Loads from the bundled icd10-codes.json file.
   */
  searchIcd10Codes(
    query: string,
    limit: number = 20,
  ): Array<{ code: string; short: string; long: string }> {
    const db = this.loadIcd10Database();
    if (!db) {
      return [];
    }

    const normalizedQuery = query.trim().toUpperCase();
    if (!normalizedQuery) {
      return [];
    }

    const results: Array<{ code: string; short: string; long: string }> = [];
    const queryLower = query.trim().toLowerCase();

    for (const [code, entry] of Object.entries(db)) {
      if (results.length >= limit) {
        break;
      }

      const codeMatch = code.toUpperCase().startsWith(normalizedQuery);
      const descMatch =
        entry.short.toLowerCase().includes(queryLower) ||
        entry.long.toLowerCase().includes(queryLower);

      if (codeMatch || descMatch) {
        results.push({ code, short: entry.short, long: entry.long });
      }
    }

    return results;
  }

  /**
   * Get audit events for a claim.
   */
  async getClaimAudit(claimId: string): Promise<unknown[]> {
    const events = await this.prisma.auditEvent.findMany({
      where: { targetId: claimId, targetType: 'CLAIM' },
      orderBy: { createdAt: 'desc' },
      include: {
        actor: {
          select: { id: true, name: true, email: true },
        },
      },
    });
    return events;
  }

  /**
   * Load the ICD-10 database from disk. Returns null if the file does not exist.
   */
  private loadIcd10Database(): Record<string, Icd10Entry> | null {
    if (this.icd10Cache) {
      return this.icd10Cache;
    }

    const jsonPath = path.resolve(__dirname, '../data/icd10-codes.json');

    if (!fs.existsSync(jsonPath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(jsonPath, 'utf-8');
      this.icd10Cache = JSON.parse(raw) as Record<string, Icd10Entry>;
      return this.icd10Cache;
    } catch (err) {
      console.error('[ClaimService] Failed to load ICD-10 database:', err);
      return null;
    }
  }
}
