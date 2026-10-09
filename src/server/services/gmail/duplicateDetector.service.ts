import { createHash } from 'crypto';
import type { PrismaClient } from '@prisma/client';
import type { IngestedEmail } from '../../../shared/emailTypes';
import { redis } from '../../config/redis';

// ─── CONSTANTS ──────────────────────────────────────────

const REDIS_HASH_SET_KEY = 'email:hashes';
const CONTENT_HASH_BODY_LIMIT = 500;

// ─── RESULT TYPE ────────────────────────────────────────

export interface DuplicateCheckResult {
  readonly duplicate: boolean;
  readonly existingClaimId?: string;
  readonly reason?: string;
}

const NOT_DUPLICATE: DuplicateCheckResult = Object.freeze({
  duplicate: false,
});

// ─── HELPERS ────────────────────────────────────────────

/**
 * Compute a SHA-256 content hash from subject + sender email + first 500 chars of body + attachment metadata.
 */
export function computeContentHash(email: IngestedEmail): string {
  const attachmentSignature = (email.attachments || [])
    .map((a) => `${a.filename}:${a.size}`)
    .sort()
    .join(',');

  const payload = [
    email.subject,
    email.from.email,
    email.bodyText.substring(0, CONTENT_HASH_BODY_LIMIT),
    attachmentSignature,
  ].join('|');

  return createHash('sha256').update(payload).digest('hex');
}


// ─── DUPLICATE DETECTOR SERVICE ─────────────────────────

export class DuplicateDetectorService {
  /**
   * Check whether an email is a duplicate using two strategies:
   * 1. Exact messageId match in claim_correspondence
   * 2. Content hash match in Redis (subject + from + body + attachments)
   *
   * Note: Fuzzy subject matching is handled by the claimMerge service
   * to potentially merge emails rather than skipping them entirely.
   */
  async isDuplicate(
    prisma: PrismaClient,
    email: IngestedEmail,
  ): Promise<DuplicateCheckResult> {
    // ── Check 1: exact messageId ──
    const messageIdResult = await this.checkByMessageId(prisma, email.messageId);
    if (messageIdResult.duplicate) return messageIdResult;

    // ── Check 2: content hash ──
    const contentHash = computeContentHash(email);
    const hashResult = await this.checkByContentHash(contentHash);
    if (hashResult.duplicate) return hashResult;

    // Not a duplicate — store the content hash for future checks
    await this._storeContentHash(contentHash);

    return NOT_DUPLICATE;
  }

  /**
   * Check if a gmail message ID already exists in claim_correspondence.
   */
  private async checkByMessageId(
    prisma: PrismaClient,
    messageId: string,
  ): Promise<DuplicateCheckResult> {
    const existing = await prisma.claimCorrespondence.findFirst({
      where: { gmailMessageId: messageId },
      select: { id: true, claimId: true },
    });

    if (existing) {
      return Object.freeze({
        duplicate: true,
        existingClaimId: existing.claimId,
        reason: `Duplicate messageId: ${messageId} already linked to claim ${existing.claimId}`,
      });
    }

    return NOT_DUPLICATE;
  }

  /**
   * Check if the content hash exists in the Redis set.
   */
  private async checkByContentHash(
    contentHash: string,
  ): Promise<DuplicateCheckResult> {
    const isMember = await redis.sismember(REDIS_HASH_SET_KEY, contentHash);

    if (isMember) {
      return Object.freeze({
        duplicate: true,
        reason: `Duplicate content hash detected: ${contentHash.substring(0, 12)}...`,
      });
    }

    return NOT_DUPLICATE;
  }

  /**
   * Store the content hash in the Redis set for future deduplication.
   */
  async storeContentHash(emailOrHash: IngestedEmail | string): Promise<void> {
    const contentHash = typeof emailOrHash === 'string' ? emailOrHash : computeContentHash(emailOrHash);
    return this._storeContentHash(contentHash);
  }

  private async _storeContentHash(contentHash: string): Promise<void> {
    await redis.sadd(REDIS_HASH_SET_KEY, contentHash);
  }

}
