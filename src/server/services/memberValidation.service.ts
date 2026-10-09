import { PrismaClient, Member } from '@prisma/client';
import { logger } from '../config/logger';

// ─── Constants ────────────────────────────────────

const LEVENSHTEIN_THRESHOLD = 2;

const US_TERRITORY_CODES: ReadonlySet<string> = new Set([
  'US', 'USA', 'PR', 'GU', 'VI', 'AS', 'MP',
]);

const PRE_AUTH_REQUIRED_TYPES: ReadonlySet<string> = new Set([
  'INPATIENT',
  'DAY_PATIENT',
]);

// ─── Types ────────────────────────────────────────

export interface MemberLookupInput {
  readonly membershipNumber?: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly dateOfBirth?: string; // ISO or DD/MM/YYYY
}

export interface EligibilityInput {
  readonly treatmentDate: string;
  readonly treatmentCountry: string;
  readonly treatmentType?: string; // 'INPATIENT' | 'OUTPATIENT' | 'DAY_PATIENT' etc.
  readonly claimAmount?: number;
}

export interface MemberValidationResult {
  readonly isValid: boolean;
  readonly member: MemberRecord | null;
  readonly checks: readonly ValidationCheck[];
  readonly eligibility: EligibilityResult | null;
}

export interface MemberRecord {
  readonly id: string;
  readonly membershipNumber: string;
  readonly fullName: string;
  readonly dateOfBirth: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly planTier: string;
  readonly planName: string;
  readonly policyStatus: string;
  readonly policyStartDate: string;
  readonly policyEndDate: string;
  readonly deductible: {
    readonly amount: number | null;
    readonly currency: string | null;
    readonly used: number;
    readonly remaining: number;
  };
  readonly coInsuranceRate: number | null;
  readonly networkOption: string;
  readonly geographicCover: string;
  readonly preferredLanguage: string;
}

export interface ValidationCheck {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'warn' | 'skip';
  readonly message: string;
}

export interface EligibilityResult {
  readonly isEligible: boolean;
  readonly reason: string;
  readonly checks: readonly ValidationCheck[];
  readonly preAuthRequired: boolean;
  readonly deductibleRemaining: number;
  readonly coInsuranceRate: number | null;
  readonly networkPenaltyApplicable: boolean;
}

// ─── Errors ───────────────────────────────────────

export class MemberNotFoundError extends Error {
  constructor(identifier: string) {
    super(`Member not found: ${identifier}`);
    this.name = 'MemberNotFoundError';
  }
}

export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidInputError';
  }
}

// ─── Helper Functions ─────────────────────────────

/**
 * Parse a date string in DD/MM/YYYY, YYYY-MM-DD, or full ISO-8601 format.
 * Returns null if the input is invalid or unparseable.
 */
export function parseFlexibleDate(dateStr: string): Date | null {
  if (!dateStr || typeof dateStr !== 'string') {
    return null;
  }

  const trimmed = dateStr.trim();

  // DD/MM/YYYY
  const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const ddMatch = ddmmyyyy.exec(trimmed);
  if (ddMatch) {
    const day = parseInt(ddMatch[1], 10);
    const month = parseInt(ddMatch[2], 10) - 1;
    const year = parseInt(ddMatch[3], 10);
    const date = new Date(Date.UTC(year, month, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month &&
      date.getUTCDate() === day
    ) {
      return date;
    }
    return null;
  }

  // YYYY-MM-DD
  const yyyymmdd = /^(\d{4})-(\d{2})-(\d{2})$/;
  const isoMatch = yyyymmdd.exec(trimmed);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10) - 1;
    const day = parseInt(isoMatch[3], 10);
    const date = new Date(Date.UTC(year, month, day));
    if (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month &&
      date.getUTCDate() === day
    ) {
      return date;
    }
    return null;
  }

  // Full ISO-8601 (e.g. 2024-01-15T00:00:00.000Z)
  const parsed = new Date(trimmed);
  if (!isNaN(parsed.getTime())) {
    return parsed;
  }

  return null;
}

/**
 * Compute the Levenshtein distance between two strings.
 * Uses a standard dynamic-programming approach.
 */
export function levenshteinDistance(a: string, b: string): number {
  const aLower = a.toLowerCase();
  const bLower = b.toLowerCase();

  if (aLower === bLower) return 0;
  if (aLower.length === 0) return bLower.length;
  if (bLower.length === 0) return aLower.length;

  // Use two rows to save memory
  let previousRow: number[] = Array.from(
    { length: bLower.length + 1 },
    (_, i) => i,
  );
  let currentRow: number[] = new Array(bLower.length + 1);

  for (let i = 1; i <= aLower.length; i++) {
    currentRow[0] = i;
    for (let j = 1; j <= bLower.length; j++) {
      const cost = aLower[i - 1] === bLower[j - 1] ? 0 : 1;
      currentRow[j] = Math.min(
        previousRow[j] + 1,       // deletion
        currentRow[j - 1] + 1,    // insertion
        previousRow[j - 1] + cost, // substitution
      );
    }
    // Swap rows (immutable pattern: create fresh reference)
    const temp = previousRow;
    previousRow = currentRow;
    currentRow = temp;
  }

  return previousRow[bLower.length];
}

/**
 * Returns true if the country code represents a US territory.
 */
export function isUSTerritory(countryCode: string): boolean {
  if (!countryCode || typeof countryCode !== 'string') {
    return false;
  }
  return US_TERRITORY_CODES.has(countryCode.trim().toUpperCase());
}

/**
 * Format a Date as an ISO date string (YYYY-MM-DD).
 */
function formatDateISO(date: Date): string {
  return date.toISOString().split('T')[0];
}

/**
 * Build a MemberRecord from a Prisma Member with its related plan.
 */
function buildMemberRecord(
  member: Member & { plan: { name: string } },
): MemberRecord {
  const deductibleAmount = member.deductibleAmount ?? 0;
  const deductibleUsed = member.deductibleUsed ?? 0;
  const remaining = Math.max(0, deductibleAmount - deductibleUsed);

  return {
    id: member.id,
    membershipNumber: member.membershipNumber,
    fullName: `${member.firstName} ${member.lastName}`,
    dateOfBirth: formatDateISO(member.dateOfBirth),
    email: member.email ?? null,
    phone: member.phone ?? null,
    planTier: member.planTier,
    planName: member.plan.name,
    policyStatus: member.status,
    policyStartDate: formatDateISO(member.policyStartDate),
    policyEndDate: formatDateISO(member.policyEndDate),
    deductible: {
      amount: member.deductibleAmount ?? null,
      currency: member.deductibleCurrency ?? null,
      used: deductibleUsed,
      remaining,
    },
    coInsuranceRate: member.coInsuranceRate ?? null,
    networkOption: member.networkOption,
    geographicCover: member.geographicCover,
    preferredLanguage: (member as Record<string, unknown>).preferredLanguage as string ?? 'en',
  };
}

/**
 * Create a validation check entry.
 */
function createCheck(
  name: string,
  status: ValidationCheck['status'],
  message: string,
): ValidationCheck {
  return { name, status, message };
}

export interface CreateMemberInput {
  membershipNumber: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string | Date;
  email?: string;
  phone?: string;
  planId: string;
  planTier: string;
  policyStartDate: string | Date;
  policyEndDate: string | Date;
  deductibleAmount?: number;
  deductibleCurrency?: string;
  coInsuranceRate?: number;
  networkOption?: string;
  geographicCover?: string;
}

// ─── Service ──────────────────────────────────────

export class MemberValidationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create a new member in the database.
   */
  async createMember(input: CreateMemberInput): Promise<Member> {
    const dob = typeof input.dateOfBirth === 'string' ? parseFlexibleDate(input.dateOfBirth) : input.dateOfBirth;
    const startDate = typeof input.policyStartDate === 'string' ? parseFlexibleDate(input.policyStartDate) : input.policyStartDate;
    const endDate = typeof input.policyEndDate === 'string' ? parseFlexibleDate(input.policyEndDate) : input.policyEndDate;

    if (!dob || isNaN(dob.getTime())) throw new InvalidInputError('Invalid date of birth');
    if (!startDate || isNaN(startDate.getTime())) throw new InvalidInputError('Invalid policy start date');
    if (!endDate || isNaN(endDate.getTime())) throw new InvalidInputError('Invalid policy end date');

    try {
      return await this.prisma.member.create({
        data: {
          membershipNumber: input.membershipNumber,
          firstName: input.firstName,
          lastName: input.lastName,
          dateOfBirth: dob,
          email: input.email,
          phone: input.phone,
          planId: input.planId,
          planTier: input.planTier as any,
          policyStartDate: startDate,
          policyEndDate: endDate,
          deductibleAmount: input.deductibleAmount,
          deductibleCurrency: input.deductibleCurrency ?? 'USD',
          coInsuranceRate: input.coInsuranceRate,
          networkOption: (input.networkOption as any) ?? 'STANDARD',
          geographicCover: (input.geographicCover as any) ?? 'WORLDWIDE',
          status: 'MEMBER_ACTIVE',
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new InvalidInputError(`Member with number ${input.membershipNumber} already exists`);
      }
      throw err;
    }
  }

  /**
   * Validate a member by looking them up and running identity/status checks.
   */
  async validateMember(input: MemberLookupInput): Promise<MemberValidationResult> {
    logger.info({ input: { ...input, dateOfBirth: input.dateOfBirth ? '***' : undefined } }, 'Starting member validation');

    const checks: ValidationCheck[] = [];

    // Attempt lookup by membership number first
    let memberWithPlan: (Member & { plan: { name: string } }) | null = null;

    if (input.membershipNumber) {
      memberWithPlan = await this.prisma.member.findUnique({
        where: { membershipNumber: input.membershipNumber },
        include: { plan: { select: { name: true } } },
      }) as (Member & { plan: { name: string } }) | null;

      if (memberWithPlan) {
        checks.push(createCheck(
          'membership_number_exists',
          'pass',
          `Member found with number ${input.membershipNumber}`,
        ));
      } else {
        checks.push(createCheck(
          'membership_number_exists',
          'fail',
          `No member found with number ${input.membershipNumber}`,
        ));

        logger.warn({ membershipNumber: input.membershipNumber }, 'Member not found by membership number');

        return {
          isValid: false,
          member: null,
          checks,
          eligibility: null,
        };
      }
    } else if (input.firstName && input.lastName && input.dateOfBirth) {
      // Fuzzy match by name + DOB
      const parsedDob = parseFlexibleDate(input.dateOfBirth);
      if (!parsedDob) {
        checks.push(createCheck(
          'dob_matches',
          'fail',
          `Invalid date of birth format: ${input.dateOfBirth}`,
        ));

        logger.warn({ dateOfBirth: input.dateOfBirth }, 'Invalid date of birth format');

        return {
          isValid: false,
          member: null,
          checks,
          eligibility: null,
        };
      }

      memberWithPlan = await this.findMemberByFuzzyMatchWithPlan(
        input.firstName,
        input.lastName,
        parsedDob,
      );

      if (memberWithPlan) {
        checks.push(createCheck(
          'membership_number_exists',
          'pass',
          `Member found via fuzzy name match: ${memberWithPlan.membershipNumber}`,
        ));
      } else {
        checks.push(createCheck(
          'membership_number_exists',
          'fail',
          'No member found matching the provided name and date of birth',
        ));

        logger.warn({ firstName: input.firstName, lastName: input.lastName }, 'Member not found by fuzzy match');

        return {
          isValid: false,
          member: null,
          checks,
          eligibility: null,
        };
      }
    } else {
      checks.push(createCheck(
        'membership_number_exists',
        'fail',
        'Insufficient lookup criteria: provide membershipNumber or firstName+lastName+dateOfBirth',
      ));

      logger.warn('Insufficient lookup criteria provided');

      return {
        isValid: false,
        member: null,
        checks,
        eligibility: null,
      };
    }

    // Name match check (fuzzy)
    if (input.firstName && input.lastName) {
      const firstNameDistance = levenshteinDistance(input.firstName, memberWithPlan.firstName);
      const lastNameDistance = levenshteinDistance(input.lastName, memberWithPlan.lastName);

      if (firstNameDistance <= LEVENSHTEIN_THRESHOLD && lastNameDistance <= LEVENSHTEIN_THRESHOLD) {
        checks.push(createCheck(
          'name_matches',
          'pass',
          `Name matches: ${memberWithPlan.firstName} ${memberWithPlan.lastName}`,
        ));
      } else {
        const detail = `Input "${input.firstName} ${input.lastName}" vs record "${memberWithPlan.firstName} ${memberWithPlan.lastName}" (distance: first=${firstNameDistance}, last=${lastNameDistance})`;
        checks.push(createCheck(
          'name_matches',
          'fail',
          `Name does not match within tolerance. ${detail}`,
        ));
      }
    } else {
      checks.push(createCheck(
        'name_matches',
        'skip',
        'Name not provided for validation',
      ));
    }

    // DOB match check (exact)
    if (input.dateOfBirth) {
      const parsedDob = parseFlexibleDate(input.dateOfBirth);
      if (parsedDob) {
        const memberDob = formatDateISO(memberWithPlan.dateOfBirth);
        const inputDob = formatDateISO(parsedDob);

        if (memberDob === inputDob) {
          checks.push(createCheck('dob_matches', 'pass', 'Date of birth matches'));
        } else {
          checks.push(createCheck(
            'dob_matches',
            'fail',
            `Date of birth mismatch: expected ${memberDob}, got ${inputDob}`,
          ));
        }
      } else {
        checks.push(createCheck(
          'dob_matches',
          'fail',
          `Invalid date of birth format: ${input.dateOfBirth}`,
        ));
      }
    } else {
      checks.push(createCheck('dob_matches', 'skip', 'Date of birth not provided'));
    }

    // Policy status check
    if (memberWithPlan.status === 'MEMBER_ACTIVE') {
      checks.push(createCheck('policy_status', 'pass', 'Policy is active'));
    } else {
      checks.push(createCheck(
        'policy_status',
        'fail',
        `Policy status is ${memberWithPlan.status} — must be MEMBER_ACTIVE`,
      ));
    }

    const hasFailure = checks.some((c) => c.status === 'fail');
    const memberRecord = buildMemberRecord(memberWithPlan);

    logger.info(
      { memberId: memberWithPlan.id, isValid: !hasFailure, checkCount: checks.length },
      'Member validation complete',
    );

    return {
      isValid: !hasFailure,
      member: memberRecord,
      checks,
      eligibility: null,
    };
  }

  /**
   * Check whether a member is eligible for a specific treatment/claim.
   */
  async checkEligibility(memberId: string, input: EligibilityInput): Promise<EligibilityResult> {
    logger.info({ memberId, treatmentDate: input.treatmentDate, treatmentCountry: input.treatmentCountry }, 'Checking eligibility');

    const member = await this.prisma.member.findUnique({
      where: { id: memberId },
      include: { plan: true },
    });

    if (!member) {
      logger.error({ memberId }, 'Member not found for eligibility check');
      throw new MemberNotFoundError(memberId);
    }

    const treatmentDate = parseFlexibleDate(input.treatmentDate);
    if (!treatmentDate) {
      throw new InvalidInputError(`Invalid treatment date: ${input.treatmentDate}`);
    }

    const checks: ValidationCheck[] = [];
    let isEligible = true;
    let failureReason = '';

    // 0. Member Status check
    if (member.status !== 'MEMBER_ACTIVE') {
      isEligible = false;
      failureReason = `Member status is ${member.status}`;
      checks.push(createCheck(
        'member_status',
        'fail',
        `Membership status must be ACTIVE (currently ${member.status})`,
      ));
    } else {
      checks.push(createCheck('member_status', 'pass', 'Member is active'));
    }

    // 1. Policy active on treatment date
    const policyStart = member.policyStartDate;
    const policyEnd = member.policyEndDate;

    if (treatmentDate >= policyStart && treatmentDate <= policyEnd) {
      checks.push(createCheck(
        'policy_active_on_date',
        'pass',
        `Treatment date ${formatDateISO(treatmentDate)} is within policy period ${formatDateISO(policyStart)} - ${formatDateISO(policyEnd)}`,
      ));
    } else {
      isEligible = false;
      failureReason = `Treatment date ${formatDateISO(treatmentDate)} is outside policy period`;
      checks.push(createCheck(
        'policy_active_on_date',
        'fail',
        `${failureReason} (${formatDateISO(policyStart)} - ${formatDateISO(policyEnd)})`,
      ));
    }

    // 2. Geographic coverage
    const countryCode = input.treatmentCountry.trim().toUpperCase();
    const geoCover = member.geographicCover;

    if (geoCover === 'WORLDWIDE_EXCL_US' && isUSTerritory(countryCode)) {
      isEligible = false;
      const reason = `Treatment in US territory (${countryCode}) is excluded under WORLDWIDE_EXCL_US coverage`;
      if (!failureReason) failureReason = reason;
      checks.push(createCheck('geographic_coverage', 'fail', reason));
    } else {
      checks.push(createCheck(
        'geographic_coverage',
        'pass',
        `Treatment country ${countryCode} is covered under ${geoCover}`,
      ));
    }

    // 3. Waiting period
    if (input.treatmentType) {
      const waitingPeriods = member.plan.waitingPeriods as Record<string, number> | null;

      if (waitingPeriods && typeof waitingPeriods === 'object') {
        const waitingDays = waitingPeriods[input.treatmentType];

        if (typeof waitingDays === 'number' && waitingDays > 0) {
          const waitingEndDate = new Date(policyStart.getTime());
          waitingEndDate.setUTCDate(waitingEndDate.getUTCDate() + waitingDays);

          if (treatmentDate < waitingEndDate) {
            isEligible = false;
            const reason = `Treatment date is within the ${waitingDays}-day waiting period for ${input.treatmentType} (ends ${formatDateISO(waitingEndDate)})`;
            if (!failureReason) failureReason = reason;
            checks.push(createCheck('waiting_period', 'fail', reason));
          } else {
            checks.push(createCheck(
              'waiting_period',
              'pass',
              `Waiting period for ${input.treatmentType} has been satisfied`,
            ));
          }
        } else {
          checks.push(createCheck(
            'waiting_period',
            'pass',
            `No waiting period defined for ${input.treatmentType}`,
          ));
        }
      } else {
        checks.push(createCheck(
          'waiting_period',
          'pass',
          'No waiting periods defined on plan',
        ));
      }
    } else {
      checks.push(createCheck(
        'waiting_period',
        'skip',
        'Treatment type not provided — waiting period not checked',
      ));
    }

    // 4. Pre-auth requirement
    const preAuthRequired = input.treatmentType
      ? PRE_AUTH_REQUIRED_TYPES.has(input.treatmentType.toUpperCase())
      : false;

    if (preAuthRequired) {
      checks.push(createCheck(
        'pre_auth_required',
        'warn',
        `Pre-authorization is mandatory for ${input.treatmentType}`,
      ));
    } else {
      checks.push(createCheck(
        'pre_auth_required',
        'pass',
        'Pre-authorization not required for this treatment type',
      ));
    }

    // 5. Deductible
    const deductibleAmount = member.deductibleAmount ?? 0;
    const deductibleUsed = member.deductibleUsed ?? 0;
    const deductibleRemaining = Math.max(0, deductibleAmount - deductibleUsed);

    if (deductibleRemaining > 0) {
      checks.push(createCheck(
        'deductible',
        'warn',
        `Deductible remaining: ${deductibleRemaining} ${member.deductibleCurrency ?? ''}`.trim(),
      ));
    } else {
      checks.push(createCheck(
        'deductible',
        'pass',
        'Deductible fully met',
      ));
    }

    // 6. Network penalty
    const networkPenaltyApplicable = member.networkOption === 'STANDARD';

    if (networkPenaltyApplicable) {
      checks.push(createCheck(
        'network_option',
        'warn',
        'Standard network — out-of-network penalties may apply',
      ));
    } else {
      checks.push(createCheck(
        'network_option',
        'pass',
        'Comprehensive network — no out-of-network penalty',
      ));
    }

    if (!failureReason) {
      failureReason = isEligible ? 'Member is eligible for this claim' : 'Eligibility check failed';
    }

    const result: EligibilityResult = {
      isEligible,
      reason: isEligible ? 'Member is eligible for this claim' : failureReason,
      checks,
      preAuthRequired,
      deductibleRemaining,
      coInsuranceRate: member.coInsuranceRate ?? null,
      networkPenaltyApplicable,
    };

    logger.info(
      { memberId, isEligible, preAuthRequired, deductibleRemaining },
      'Eligibility check complete',
    );

    return result;
  }

  /**
   * Find a member by fuzzy matching first name, last name, and exact DOB.
   * Returns the first member whose name parts are within Levenshtein distance threshold.
   */
  async findMemberByFuzzyMatch(
    firstName: string,
    lastName: string,
    dateOfBirth: Date,
  ): Promise<Member | null> {
    const result = await this.findMemberByFuzzyMatchWithPlan(firstName, lastName, dateOfBirth);
    return result as Member | null;
  }

  /**
   * Internal fuzzy match that also loads the plan relation.
   */
  private async findMemberByFuzzyMatchWithPlan(
    firstName: string,
    lastName: string,
    dateOfBirth: Date,
  ): Promise<(Member & { plan: { name: string } }) | null> {
    logger.debug(
      { firstName, lastName, dateOfBirth: formatDateISO(dateOfBirth) },
      'Searching for member by fuzzy match',
    );

    // Query candidates by exact DOB to narrow the set before fuzzy name matching
    const startOfDay = new Date(Date.UTC(
      dateOfBirth.getUTCFullYear(),
      dateOfBirth.getUTCMonth(),
      dateOfBirth.getUTCDate(),
      0, 0, 0, 0,
    ));
    const endOfDay = new Date(Date.UTC(
      dateOfBirth.getUTCFullYear(),
      dateOfBirth.getUTCMonth(),
      dateOfBirth.getUTCDate(),
      23, 59, 59, 999,
    ));

    const candidates = await this.prisma.member.findMany({
      where: {
        dateOfBirth: {
          gte: startOfDay,
          lte: endOfDay,
        },
      },
      include: { plan: { select: { name: true } } },
    });

    if (candidates.length === 0) {
      logger.debug('No candidates found with matching date of birth');
      return null;
    }

    // Find best fuzzy match
    let bestMatch: (Member & { plan: { name: string } }) | null = null;
    let bestTotalDistance = Infinity;

    for (const candidate of candidates) {
      const firstDist = levenshteinDistance(firstName, candidate.firstName);
      const lastDist = levenshteinDistance(lastName, candidate.lastName);

      if (firstDist <= LEVENSHTEIN_THRESHOLD && lastDist <= LEVENSHTEIN_THRESHOLD) {
        const totalDist = firstDist + lastDist;
        if (totalDist < bestTotalDistance) {
          bestTotalDistance = totalDist;
          bestMatch = candidate;
        }
      }
    }

    if (bestMatch) {
      logger.debug(
        { matchedMemberId: bestMatch.id, distance: bestTotalDistance },
        'Fuzzy match found',
      );
    } else {
      logger.debug('No fuzzy match found within threshold');
    }

    return bestMatch;
  }
}
