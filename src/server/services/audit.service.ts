import { PrismaClient, Prisma, AuditEvent } from '@prisma/client';
import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export interface AuditLogParams {
  readonly eventType: string;
  readonly actorType: string;
  readonly actorId?: string;
  readonly targetType: string;
  readonly targetId?: string;
  readonly action: string;
  readonly details?: Record<string, unknown>;
  readonly previousValue?: unknown;
  readonly newValue?: unknown;
  readonly ipAddress?: string;
  readonly sessionId?: string;
}

export interface AuditQueryFilters {
  readonly orgId?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly eventType?: string;
  readonly actorId?: string;
  readonly dateFrom?: Date;
  readonly dateTo?: Date;
  readonly page?: number;
  readonly limit?: number;
}

export interface AuditQueryResult {
  readonly events: ReadonlyArray<AuditEvent>;
  readonly total: number;
}

// ─── Constants ─────────────────────────────────────

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 50;

// ─── Service ───────────────────────────────────────

export class AuditService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Fire-and-forget audit event logging.
   * Never blocks calling code; errors are logged but not thrown.
   */
  async logEvent(params: AuditLogParams): Promise<void> {
    try {
      await this.prisma.auditEvent.create({
        data: {
          eventType: params.eventType,
          actorType: params.actorType,
          actorId: params.actorId ?? null,
          targetType: params.targetType,
          targetId: params.targetId ?? null,
          action: params.action,
          details: (params.details ?? {}) as Prisma.InputJsonValue,
          previousValue: params.previousValue != null
            ? (params.previousValue as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          newValue: params.newValue != null
            ? (params.newValue as Prisma.InputJsonValue)
            : Prisma.JsonNull,
          ipAddress: params.ipAddress ?? null,
          sessionId: params.sessionId ?? null,
        },
      });
    } catch (error) {
      logger.error({ error, params }, 'Failed to log audit event');
    }
  }

  /**
   * Paginated query of audit events with flexible filters.
   */
  async queryEvents(filters: AuditQueryFilters): Promise<AuditQueryResult> {
    const page = filters.page ?? DEFAULT_PAGE;
    const limit = filters.limit ?? DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const where = this.buildWhereClause(filters);

    const [events, total] = await Promise.all([
      this.prisma.auditEvent.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          actor: { select: { id: true, name: true, email: true } },
          claim: { select: { id: true, claimReference: true } },
        },
      }),
      this.prisma.auditEvent.count({ where: where as any }),
    ]);

    return { events, total };
  }

  /**
   * Full audit trail for a specific claim, ordered chronologically.
   */
  async getClaimAuditTrail(claimId: string): Promise<AuditEvent[]> {
    return this.prisma.auditEvent.findMany({
      where: { targetId: claimId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── Private Helpers ──────────────────────────────

  private buildWhereClause(
    filters: AuditQueryFilters,
  ): Record<string, unknown> {
    const where: Record<string, unknown> = {};

    if (filters.targetType) {
      where.targetType = filters.targetType;
    }

    if (filters.targetId) {
      where.targetId = filters.targetId;
    }

    if (filters.eventType) {
      where.eventType = filters.eventType;
    }

    if (filters.actorId) {
      where.actorId = filters.actorId;
    }

    if (filters.dateFrom || filters.dateTo) {
      const createdAt: Record<string, Date> = {};
      if (filters.dateFrom) {
        createdAt.gte = filters.dateFrom;
      }
      if (filters.dateTo) {
        createdAt.lte = filters.dateTo;
      }
      where.createdAt = createdAt;
    }

    return where;
  }
}
