import { PrismaClient, ClaimStatus } from '@prisma/client';
import { logger } from '../config/logger';

// ─── Constants ────────────────────────────────────

export const MERGE_WINDOW_DAYS = 30;
const SIMILARITY_THRESHOLD = 0.5;

// ─── Pure Functions (testable without DB) ─────────

/**
 * Strip RE:/FW:/FWD: prefixes from email subject and lowercase.
 */
export function cleanSubject(subject: string): string {
  let cleaned = subject;
  // Strip all RE:/FW:/FWD: prefixes iteratively
  let prev = '';
  while (prev !== cleaned) {
    prev = cleaned;
    cleaned = cleaned.replace(/^(re|fw|fwd):\s*/i, '');
  }
  return cleaned.trim().toLowerCase();
}

/**
 * Compute keyword overlap ratio between two email subjects.
 * Ignores words with 3 or fewer characters (articles, prepositions).
 * Returns 0-1 where 1 = identical keyword sets.
 */
export function computeSubjectSimilarity(subject1: string, subject2: string): number {
  const clean1 = cleanSubject(subject1);
  const clean2 = cleanSubject(subject2);

  const keywords1 = clean1.split(/\s+/).filter(w => w.length > 3);
  const keywords2Set = new Set(clean2.split(/\s+/).filter(w => w.length > 3));

  if (keywords1.length === 0 || keywords2Set.size === 0) return 0;

  const matchCount = keywords1.filter(k => keywords2Set.has(k)).length;
  return matchCount / keywords1.length;
}

/**
 * Determine if an existing correspondence should be merged with an incoming email.
 */
export function isMergeCandidate(params: {
  incomingSubject: string;
  existingSubject: string;
  existingDate: Date;
}): boolean {
  // Check if within merge window
  const cutoff = new Date(Date.now() - MERGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (params.existingDate < cutoff) return false;

  // Check subject similarity
  const similarity = computeSubjectSimilarity(params.incomingSubject, params.existingSubject);
  return similarity >= SIMILARITY_THRESHOLD;
}

// ─── DB-dependent function ────────────────────────

/**
 * Check if an incoming email should be merged with an existing open claim
 * from the same sender, rather than creating a new claim.
 */
export async function findMergeCandidate(
  prisma: PrismaClient,
  params: {
    senderEmail: string;
    subject: string;
    orgId: string;
  },
): Promise<string | null> {
  const cutoff = new Date(Date.now() - MERGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  // Find recent open claims from this sender
  const recentCorrespondence = await prisma.claimCorrespondence.findMany({
    where: {
      fromEmail: params.senderEmail,
      direction: 'INBOUND',
      createdAt: { gte: cutoff },
      claim: {
        orgId: params.orgId,
        status: {
          notIn: [ClaimStatus.COMPLETE, ClaimStatus.CLOSED],
        },
      },
    },
    include: {
      claim: { select: { id: true, claimReference: true, status: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  if (recentCorrespondence.length === 0) return null;

  for (const corr of recentCorrespondence) {
    if (isMergeCandidate({
      incomingSubject: params.subject,
      existingSubject: corr.subject,
      existingDate: corr.createdAt,
    })) {
      logger.info(
        { existingClaimId: corr.claim.id, claimRef: corr.claim.claimReference },
        'Merge candidate found — linking documents to existing claim',
      );
      return corr.claim.id;
    }
  }

  return null;
}
