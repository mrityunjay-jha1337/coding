import { PrismaClient, ClaimStatus } from '@prisma/client';
import { logger } from '../config/logger';

// ─── Constants ─────────────────────────────────────

const SLA_WARNING_HOURS = 4;

// ─── Types ─────────────────────────────────────────

export interface SlaCheckResult {
  readonly totalChecked: number;
  readonly warnings: number;
  readonly breaches: number;
  readonly escalationsCreated: number;
  readonly notificationsSent: number;
}

// ─── Service ───────────────────────────────────────

export class SlaMonitorService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Check all active claims for SLA warnings and breaches.
   * Designed to run as a repeatable BullMQ job every 15 minutes.
   */
  async checkAllSlas(): Promise<SlaCheckResult> {
    const now = new Date();
    const warningThreshold = new Date(now.getTime() + SLA_WARNING_HOURS * 60 * 60 * 1000);
    let warnings = 0;
    let breaches = 0;
    let escalationsCreated = 0;
    let notificationsSent = 0;

    // Find claims with SLA deadlines that are approaching or breached
    const atRiskClaims = await this.prisma.claim.findMany({
      where: {
        slaDeadline: { lte: warningThreshold },
        status: {
          notIn: [ClaimStatus.COMPLETE, ClaimStatus.CLOSED],
        },
      },
      select: {
        id: true,
        claimReference: true,
        status: true,
        slaDeadline: true,
        assignedTo: true,
        teamId: true,
        orgId: true,
      },
    });

    for (const claim of atRiskClaims) {
      const deadline = new Date(claim.slaDeadline!);
      const isBreached = deadline <= now;

      if (isBreached) {
        breaches++;

        // Escalate to team lead
        if (claim.teamId) {
          await this.prisma.auditEvent.create({
            data: {
              eventType: 'SLA_BREACH',
              actorType: 'SYSTEM',
              targetType: 'CLAIM',
              targetId: claim.id,
              action: 'SLA breach detected',
              details: {
                slaDeadline: deadline.toISOString(),
                hoursOverdue: Math.round((now.getTime() - deadline.getTime()) / (1000 * 60 * 60) * 10) / 10,
                currentStatus: claim.status,
              },
            },
          });
          escalationsCreated++;
        }

        // Create notification for assigned handler
        if (claim.assignedTo) {
          await this.prisma.notification.create({
            data: {
              userId: claim.assignedTo,
              type: 'SLA_BREACH',
              title: 'SLA Breach',
              body: `Claim ${claim.claimReference} has breached its SLA deadline.`,
              data: { claimId: claim.id, claimReference: claim.claimReference },
            },
          });
          notificationsSent++;
        }
      } else {
        warnings++;

        // Warn assigned handler of approaching deadline
        if (claim.assignedTo) {
          const hoursRemaining = Math.round((deadline.getTime() - now.getTime()) / (1000 * 60 * 60) * 10) / 10;
          await this.prisma.notification.create({
            data: {
              userId: claim.assignedTo,
              type: 'SLA_WARNING',
              title: 'SLA Warning',
              body: `Claim ${claim.claimReference} SLA deadline in ${hoursRemaining} hours.`,
              data: { claimId: claim.id, hoursRemaining },
            },
          });
          notificationsSent++;
        }
      }
    }

    logger.info(
      { totalChecked: atRiskClaims.length, warnings, breaches, escalationsCreated },
      'SLA monitoring check complete',
    );

    return { totalChecked: atRiskClaims.length, warnings, breaches, escalationsCreated, notificationsSent };
  }
}
