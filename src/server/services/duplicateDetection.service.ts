import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

// ─── Constants ────────────────────────────────────

const AMOUNT_TOLERANCE_PERCENT = 10;
const EXACT_CONFIDENCE = 100;
const THREAD_CONFIDENCE = 90;
const PROBABLE_HIGH_CONFIDENCE = 95;
const PROBABLE_LOW_CONFIDENCE = 80;
const OVERLAP_HIGH_CONFIDENCE = 80;
const OVERLAP_LOW_CONFIDENCE = 60;

// ─── Types ────────────────────────────────────────

export interface DuplicateCheckInput {
  readonly membershipNumber?: string;
  readonly memberId?: string;
  readonly treatmentDate?: string;
  readonly claimAmount?: number;
  readonly currency?: string;
  readonly facilityName?: string;
  readonly primaryDiagnosis?: string;
  readonly sourceEmailId?: string;
  readonly sourceThreadId?: string;
  readonly excludeClaimId?: string;
}

export interface DuplicateCheckResult {
  readonly isDuplicate: boolean;
  readonly duplicateType: 'EXACT' | 'PROBABLE' | 'OVERLAPPING' | 'THREAD' | 'NONE';
  readonly confidence: number;
  readonly matchedClaims: ReadonlyArray<DuplicateMatch>;
  readonly recommendation: 'AUTO_DENY' | 'HUMAN_REVIEW' | 'PROCEED';
}

export interface DuplicateMatch {
  readonly claimId: string;
  readonly claimReference: string;
  readonly matchType: 'EXACT' | 'PROBABLE' | 'OVERLAPPING' | 'THREAD';
  readonly matchScore: number;
  readonly matchDetails: string;
  readonly claimStatus: string;
  readonly claimAmount: number | null;
  readonly treatmentDate: string | null;
}

interface MemberClaimRecord {
  readonly id: string;
  readonly claimReference: string;
  readonly status: string;
  readonly claimant: unknown;
  readonly incident: unknown;
  readonly financials: unknown;
  readonly treatment: unknown;
  readonly sourceThreadId: string | null;
}

// ─── Helper Functions ─────────────────────────────

/**
 * Parse a date string safely, returning null for invalid or missing input.
 * Supports ISO-8601 strings and YYYY-MM-DD format.
 */
export function parseDateSafe(dateStr: string | null | undefined): Date | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  const trimmed = dateStr.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    return null;
  }

  return parsed;
}

/**
 * Calculate similarity score (0-100) between two monetary amounts.
 * Returns 100 for exact matches, lower scores for larger differences.
 */
export function calculateAmountSimilarity(a: number, b: number): number {
  if (a === b) {
    return 100;
  }

  if (a === 0 && b === 0) {
    return 100;
  }

  const maxVal = Math.max(Math.abs(a), Math.abs(b));
  if (maxVal === 0) {
    return 100;
  }

  const diff = Math.abs(a - b);
  const percentDiff = (diff / maxVal) * 100;

  return Math.max(0, Math.round(100 - percentDiff));
}

/**
 * Check whether two date ranges overlap.
 * Returns true if [start1, end1] overlaps with [start2, end2].
 */
export function datesOverlap(
  start1: string,
  end1: string,
  start2: string,
  end2: string,
): boolean {
  const s1 = parseDateSafe(start1);
  const e1 = parseDateSafe(end1);
  const s2 = parseDateSafe(start2);
  const e2 = parseDateSafe(end2);

  if (!s1 || !e1 || !s2 || !e2) {
    return false;
  }

  return s1 <= e2 && s2 <= e1;
}

/**
 * Safely extract a nested property from a JSON field.
 */
function extractJsonField<T>(json: unknown, ...keys: string[]): T | null {
  let current: unknown = json;

  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }

  return (current as T) ?? null;
}

/**
 * Extract totalClaimed from a claim's financials JSON field.
 */
function extractClaimAmount(financials: unknown): number | null {
  const amount = extractJsonField<number>(financials, 'totalClaimed');
  if (typeof amount === 'number' && !isNaN(amount)) {
    return amount;
  }
  return null;
}

/**
 * Extract the treatment/incident date from a claim's incident JSON field.
 */
function extractTreatmentDate(incident: unknown): string | null {
  const date = extractJsonField<string>(incident, 'date');
  if (typeof date === 'string' && date.trim().length > 0) {
    return date.trim();
  }
  return null;
}

/**
 * Extract facility name from a claim's treatment JSON field.
 */
function extractFacilityName(treatment: unknown): string | null {
  const facility = extractJsonField<string>(treatment, 'facilityName');
  if (typeof facility === 'string' && facility.trim().length > 0) {
    return facility.trim();
  }
  return null;
}

/**
 * Extract primary diagnosis from a claim's treatment JSON field.
 */
function extractPrimaryDiagnosis(treatment: unknown): string | null {
  const diagnosis = extractJsonField<string>(treatment, 'primaryDiagnosis');
  if (typeof diagnosis === 'string' && diagnosis.trim().length > 0) {
    return diagnosis.trim();
  }
  return null;
}

/**
 * Extract admission and discharge dates from a claim's incident JSON field.
 */
function extractDateRange(incident: unknown): { start: string; end: string } | null {
  const admissionDate = extractJsonField<string>(incident, 'admissionDate')
    ?? extractJsonField<string>(incident, 'date');
  const dischargeDate = extractJsonField<string>(incident, 'dischargeDate')
    ?? admissionDate;

  if (!admissionDate || !dischargeDate) {
    return null;
  }

  return { start: admissionDate, end: dischargeDate };
}

/**
 * Build a no-duplicate result.
 */
function buildNoDuplicateResult(): DuplicateCheckResult {
  return {
    isDuplicate: false,
    duplicateType: 'NONE',
    confidence: 0,
    matchedClaims: [],
    recommendation: 'PROCEED',
  };
}

// ─── Service ──────────────────────────────────────

export class DuplicateDetectionService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Run all duplicate checks in order of strictness and return the
   * highest-confidence match found.
   */
  async checkDuplicates(input: DuplicateCheckInput): Promise<DuplicateCheckResult> {
    logger.info(
      {
        membershipNumber: input.membershipNumber,
        memberId: input.memberId,
        treatmentDate: input.treatmentDate,
        excludeClaimId: input.excludeClaimId,
      },
      'Starting duplicate detection',
    );

    const memberId = await this.resolveMemberId(input);
    if (!memberId) {
      logger.info('No member ID resolved; skipping member-based duplicate checks');

      // Still check thread duplicate if sourceThreadId is provided
      if (input.sourceThreadId) {
        const threadResult = await this.checkEmailThreadDuplicate(input, []);
        if (threadResult.isDuplicate) {
          logger.info(
            { duplicateType: threadResult.duplicateType, confidence: threadResult.confidence },
            'Duplicate detected via email thread',
          );
          return threadResult;
        }
      }

      return buildNoDuplicateResult();
    }

    const memberClaims = await this.findMemberClaims(memberId);
    const filteredClaims = input.excludeClaimId
      ? memberClaims.filter((c) => c.id !== input.excludeClaimId)
      : memberClaims;

    if (filteredClaims.length === 0) {
      logger.info({ memberId }, 'No existing claims for member; no duplicates possible');
      return buildNoDuplicateResult();
    }

    // Run checks in order of strictness: EXACT -> THREAD -> PROBABLE -> OVERLAPPING
    const exactResult = this.checkExactDuplicate(input, filteredClaims);
    if (exactResult.isDuplicate) {
      logger.info(
        { duplicateType: 'EXACT', confidence: exactResult.confidence, matchCount: exactResult.matchedClaims.length },
        'Exact duplicate detected',
      );
      return exactResult;
    }

    const threadResult = await this.checkEmailThreadDuplicate(input, filteredClaims);
    if (threadResult.isDuplicate) {
      logger.info(
        { duplicateType: 'THREAD', confidence: threadResult.confidence, matchCount: threadResult.matchedClaims.length },
        'Thread duplicate detected',
      );
      return threadResult;
    }

    const probableResult = this.checkProbableDuplicate(input, filteredClaims);
    if (probableResult.isDuplicate) {
      logger.info(
        { duplicateType: 'PROBABLE', confidence: probableResult.confidence, matchCount: probableResult.matchedClaims.length },
        'Probable duplicate detected',
      );
      return probableResult;
    }

    const overlapResult = this.checkOverlappingDates(input, filteredClaims);
    if (overlapResult.isDuplicate) {
      logger.info(
        { duplicateType: 'OVERLAPPING', confidence: overlapResult.confidence, matchCount: overlapResult.matchedClaims.length },
        'Overlapping date duplicate detected',
      );
      return overlapResult;
    }

    logger.info({ memberId }, 'No duplicates detected');
    return buildNoDuplicateResult();
  }

  /**
   * Fetch all claims linked to a member via the MemberClaim join table.
   */
  async findMemberClaims(
    memberId: string,
  ): Promise<Array<{
    id: string;
    claimReference: string;
    status: string;
    claimant: unknown;
    incident: unknown;
    financials: unknown;
    treatment: unknown;
    sourceThreadId: string | null;
  }>> {
    logger.debug({ memberId }, 'Fetching member claims');

    const memberClaims = await this.prisma.memberClaim.findMany({
      where: { memberId },
      select: { claimId: true },
    });

    if (memberClaims.length === 0) {
      return [];
    }

    const claimIds = memberClaims.map((mc) => mc.claimId);

    const claims = await this.prisma.claim.findMany({
      where: { id: { in: claimIds } },
      select: {
        id: true,
        claimReference: true,
        status: true,
        claimant: true,
        incident: true,
        financials: true,
        treatment: true,
        sourceThreadId: true,
      },
    });

    logger.debug({ memberId, claimCount: claims.length }, 'Member claims fetched');

    return claims;
  }

  // ─── Private Check Methods ────────────────────────

  /**
   * Resolve a memberId from the input.
   * If memberId is provided directly, use it.
   * Otherwise, look up by membershipNumber.
   */
  private async resolveMemberId(input: DuplicateCheckInput): Promise<string | null> {
    if (input.memberId) {
      return input.memberId;
    }

    if (!input.membershipNumber) {
      return null;
    }

    const member = await this.prisma.member.findUnique({
      where: { membershipNumber: input.membershipNumber },
      select: { id: true },
    });

    if (!member) {
      logger.warn(
        { membershipNumber: input.membershipNumber },
        'Member not found by membership number during duplicate check',
      );
      return null;
    }

    return member.id;
  }

  /**
   * EXACT duplicate check:
   * Same member + same treatment date + same amount (exact) + same facility.
   * Confidence: 100%, Recommendation: AUTO_DENY
   */
  private checkExactDuplicate(
    input: DuplicateCheckInput,
    claims: ReadonlyArray<MemberClaimRecord>,
  ): DuplicateCheckResult {
    if (!input.treatmentDate || input.claimAmount === undefined || !input.facilityName) {
      return buildNoDuplicateResult();
    }

    const inputDate = parseDateSafe(input.treatmentDate);
    if (!inputDate) {
      return buildNoDuplicateResult();
    }

    const inputDateStr = inputDate.toISOString().split('T')[0];
    const inputFacility = input.facilityName.trim().toLowerCase();

    const matches: DuplicateMatch[] = [];

    for (const claim of claims) {
      const claimDate = extractTreatmentDate(claim.incident);
      const claimAmount = extractClaimAmount(claim.financials);
      const claimFacility = extractFacilityName(claim.treatment);

      if (!claimDate || claimAmount === null || !claimFacility) {
        continue;
      }

      const parsedClaimDate = parseDateSafe(claimDate);
      if (!parsedClaimDate) {
        continue;
      }

      const claimDateStr = parsedClaimDate.toISOString().split('T')[0];
      const normalizedClaimFacility = claimFacility.toLowerCase();

      const dateMatch = inputDateStr === claimDateStr;
      const amountMatch = input.claimAmount === claimAmount;
      const facilityMatch = inputFacility === normalizedClaimFacility;

      if (dateMatch && amountMatch && facilityMatch) {
        matches.push({
          claimId: claim.id,
          claimReference: claim.claimReference,
          matchType: 'EXACT',
          matchScore: EXACT_CONFIDENCE,
          matchDetails: `Exact match: same date (${claimDateStr}), amount (${claimAmount}), facility (${claimFacility})`,
          claimStatus: claim.status,
          claimAmount,
          treatmentDate: claimDateStr,
        });
      }
    }

    if (matches.length === 0) {
      return buildNoDuplicateResult();
    }

    const sortedMatches = [...matches].sort((a, b) => b.matchScore - a.matchScore);

    return {
      isDuplicate: true,
      duplicateType: 'EXACT',
      confidence: EXACT_CONFIDENCE,
      matchedClaims: sortedMatches,
      recommendation: 'AUTO_DENY',
    };
  }

  /**
   * PROBABLE duplicate check:
   * - Same member + same treatment date + amount within +/-10%
   * - OR same member + same treatment date + same primary diagnosis
   * Confidence: 80-95%, Recommendation: HUMAN_REVIEW
   */
  private checkProbableDuplicate(
    input: DuplicateCheckInput,
    claims: ReadonlyArray<MemberClaimRecord>,
  ): DuplicateCheckResult {
    if (!input.treatmentDate) {
      return buildNoDuplicateResult();
    }

    const inputDate = parseDateSafe(input.treatmentDate);
    if (!inputDate) {
      return buildNoDuplicateResult();
    }

    const inputDateStr = inputDate.toISOString().split('T')[0];
    const inputDiagnosis = input.primaryDiagnosis?.trim().toLowerCase() ?? null;

    const matches: DuplicateMatch[] = [];

    for (const claim of claims) {
      const claimDate = extractTreatmentDate(claim.incident);
      if (!claimDate) {
        continue;
      }

      const parsedClaimDate = parseDateSafe(claimDate);
      if (!parsedClaimDate) {
        continue;
      }

      const claimDateStr = parsedClaimDate.toISOString().split('T')[0];
      if (inputDateStr !== claimDateStr) {
        continue;
      }

      const claimAmount = extractClaimAmount(claim.financials);
      const claimDiagnosis = extractPrimaryDiagnosis(claim.treatment);

      // Check amount similarity
      let amountMatch = false;
      let amountSimilarity = 0;
      if (input.claimAmount !== undefined && claimAmount !== null) {
        amountSimilarity = calculateAmountSimilarity(input.claimAmount, claimAmount);
        amountMatch = amountSimilarity >= (100 - AMOUNT_TOLERANCE_PERCENT);
      }

      // Check diagnosis match
      let diagnosisMatch = false;
      if (inputDiagnosis && claimDiagnosis) {
        diagnosisMatch = inputDiagnosis === claimDiagnosis.toLowerCase();
      }

      if (!amountMatch && !diagnosisMatch) {
        continue;
      }

      const details: string[] = [`Same date (${claimDateStr})`];
      let confidence = PROBABLE_LOW_CONFIDENCE;

      if (amountMatch && diagnosisMatch) {
        confidence = PROBABLE_HIGH_CONFIDENCE;
        details.push(`amount similarity ${amountSimilarity}%`);
        details.push(`same diagnosis (${claimDiagnosis})`);
      } else if (amountMatch) {
        confidence = PROBABLE_HIGH_CONFIDENCE - 5;
        details.push(`amount similarity ${amountSimilarity}%`);
      } else if (diagnosisMatch) {
        confidence = PROBABLE_LOW_CONFIDENCE;
        details.push(`same diagnosis (${claimDiagnosis})`);
      }

      matches.push({
        claimId: claim.id,
        claimReference: claim.claimReference,
        matchType: 'PROBABLE',
        matchScore: confidence,
        matchDetails: `Probable match: ${details.join(', ')}`,
        claimStatus: claim.status,
        claimAmount,
        treatmentDate: claimDateStr,
      });
    }

    if (matches.length === 0) {
      return buildNoDuplicateResult();
    }

    const sortedMatches = [...matches].sort((a, b) => b.matchScore - a.matchScore);
    const highestConfidence = sortedMatches[0].matchScore;

    return {
      isDuplicate: true,
      duplicateType: 'PROBABLE',
      confidence: highestConfidence,
      matchedClaims: sortedMatches,
      recommendation: 'HUMAN_REVIEW',
    };
  }

  /**
   * OVERLAPPING date check:
   * Same member + admission-discharge date range overlaps with another claim's dates.
   * Confidence: 60-80%, Recommendation: HUMAN_REVIEW
   */
  private checkOverlappingDates(
    input: DuplicateCheckInput,
    claims: ReadonlyArray<MemberClaimRecord>,
  ): DuplicateCheckResult {
    if (!input.treatmentDate) {
      return buildNoDuplicateResult();
    }

    // Use the input treatmentDate as both start and end if no range is available
    const inputStart = input.treatmentDate;
    const inputEnd = input.treatmentDate;

    const matches: DuplicateMatch[] = [];

    for (const claim of claims) {
      const dateRange = extractDateRange(claim.incident);
      if (!dateRange) {
        continue;
      }

      if (datesOverlap(inputStart, inputEnd, dateRange.start, dateRange.end)) {
        const claimAmount = extractClaimAmount(claim.financials);

        // Higher confidence if amounts are similar
        let confidence = OVERLAP_LOW_CONFIDENCE;
        if (input.claimAmount !== undefined && claimAmount !== null) {
          const similarity = calculateAmountSimilarity(input.claimAmount, claimAmount);
          if (similarity >= 80) {
            confidence = OVERLAP_HIGH_CONFIDENCE;
          } else if (similarity >= 50) {
            confidence = Math.round(
              OVERLAP_LOW_CONFIDENCE + (OVERLAP_HIGH_CONFIDENCE - OVERLAP_LOW_CONFIDENCE) * (similarity / 100),
            );
          }
        }

        const claimDateStr = extractTreatmentDate(claim.incident);

        matches.push({
          claimId: claim.id,
          claimReference: claim.claimReference,
          matchType: 'OVERLAPPING',
          matchScore: confidence,
          matchDetails: `Overlapping dates: input (${inputStart} - ${inputEnd}) overlaps with claim (${dateRange.start} - ${dateRange.end})`,
          claimStatus: claim.status,
          claimAmount,
          treatmentDate: claimDateStr,
        });
      }
    }

    if (matches.length === 0) {
      return buildNoDuplicateResult();
    }

    const sortedMatches = [...matches].sort((a, b) => b.matchScore - a.matchScore);
    const highestConfidence = sortedMatches[0].matchScore;

    return {
      isDuplicate: true,
      duplicateType: 'OVERLAPPING',
      confidence: highestConfidence,
      matchedClaims: sortedMatches,
      recommendation: 'HUMAN_REVIEW',
    };
  }

  /**
   * THREAD duplicate check:
   * Same sourceThreadId as an existing claim.
   * Confidence: 90%, Recommendation: HUMAN_REVIEW (link to existing claim)
   */
  private async checkEmailThreadDuplicate(
    input: DuplicateCheckInput,
    memberClaims: ReadonlyArray<MemberClaimRecord>,
  ): Promise<DuplicateCheckResult> {
    if (!input.sourceThreadId) {
      return buildNoDuplicateResult();
    }

    // First check member claims in-memory
    const memberThreadMatches: DuplicateMatch[] = [];
    for (const claim of memberClaims) {
      if (claim.sourceThreadId === input.sourceThreadId) {
        const claimAmount = extractClaimAmount(claim.financials);
        const claimDateStr = extractTreatmentDate(claim.incident);

        memberThreadMatches.push({
          claimId: claim.id,
          claimReference: claim.claimReference,
          matchType: 'THREAD',
          matchScore: THREAD_CONFIDENCE,
          matchDetails: `Same email thread (${input.sourceThreadId})`,
          claimStatus: claim.status,
          claimAmount,
          treatmentDate: claimDateStr,
        });
      }
    }

    // Also query the database for any claims with the same thread ID
    // that may not belong to this member
    const threadClaims = await this.prisma.claim.findMany({
      where: {
        sourceThreadId: input.sourceThreadId,
        ...(input.excludeClaimId ? { id: { not: input.excludeClaimId } } : {}),
      },
      select: {
        id: true,
        claimReference: true,
        status: true,
        incident: true,
        financials: true,
      },
    });

    const existingMatchIds = new Set(memberThreadMatches.map((m) => m.claimId));
    const additionalMatches: DuplicateMatch[] = [];

    for (const claim of threadClaims) {
      if (existingMatchIds.has(claim.id)) {
        continue;
      }

      const claimAmount = extractClaimAmount(claim.financials);
      const claimDateStr = extractTreatmentDate(claim.incident);

      additionalMatches.push({
        claimId: claim.id,
        claimReference: claim.claimReference,
        matchType: 'THREAD',
        matchScore: THREAD_CONFIDENCE,
        matchDetails: `Same email thread (${input.sourceThreadId})`,
        claimStatus: claim.status,
        claimAmount,
        treatmentDate: claimDateStr,
      });
    }

    const allMatches = [...memberThreadMatches, ...additionalMatches];

    if (allMatches.length === 0) {
      return buildNoDuplicateResult();
    }

    const sortedMatches = [...allMatches].sort((a, b) => b.matchScore - a.matchScore);

    return {
      isDuplicate: true,
      duplicateType: 'THREAD',
      confidence: THREAD_CONFIDENCE,
      matchedClaims: sortedMatches,
      recommendation: 'HUMAN_REVIEW',
    };
  }
}
