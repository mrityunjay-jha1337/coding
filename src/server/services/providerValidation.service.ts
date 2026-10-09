import { PrismaClient } from '@prisma/client';
import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export interface ProviderLookupInput {
  readonly facilityName?: string;
  readonly practitionerName?: string;
  readonly address?: { readonly country?: string; readonly city?: string };
  readonly bupaProviderId?: string;
}

export interface ProviderValidationResult {
  readonly isValid: boolean;
  readonly provider: ProviderRecord | null;
  readonly isNewProvider: boolean;
  readonly checks: readonly ValidationCheck[];
  readonly networkAnalysis: NetworkAnalysis | null;
}

export interface ProviderRecord {
  readonly id: string;
  readonly providerName: string;
  readonly facilityName: string | null;
  readonly providerType: string;
  readonly specialty: string[];
  readonly country: string;
  readonly networkStatus: string;
  readonly accreditationStatus: string;
  readonly bupaProviderId: string | null;
}

export interface ValidationCheck {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'warn' | 'skip';
  readonly message: string;
}

export interface NetworkAnalysis {
  readonly isInNetwork: boolean;
  readonly coInsurancePenalty: number;
  readonly penaltyReason: string | null;
  readonly negotiatedRates: Record<string, number> | null;
}

// ─── Constants ─────────────────────────────────────

const ULTIMATE_PLAN_TIER = 'ULTIMATE';
const OUT_OF_NETWORK_STATUS = 'OUT_OF_NETWORK';
const COMPREHENSIVE_NETWORK = 'COMPREHENSIVE';
const STANDARD_NETWORK = 'STANDARD';
const OUT_OF_NETWORK_PENALTY = 0.5;
const NO_PENALTY = 0;
const MAX_FUZZY_DISTANCE = 5;

// ─── Helpers ───────────────────────────────────────

/**
 * Compute the Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
  const aLen = a.length;
  const bLen = b.length;

  if (aLen === 0) return bLen;
  if (bLen === 0) return aLen;

  // Use two-row approach for space efficiency
  let previousRow: number[] = Array.from({ length: bLen + 1 }, (_, i) => i);
  let currentRow: number[] = new Array(bLen + 1);

  for (let i = 1; i <= aLen; i++) {
    currentRow[0] = i;
    for (let j = 1; j <= bLen; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      currentRow[j] = Math.min(
        previousRow[j] + 1,       // deletion
        currentRow[j - 1] + 1,    // insertion
        previousRow[j - 1] + cost // substitution
      );
    }
    // Swap rows (immutable swap via reassignment)
    const temp = previousRow;
    previousRow = currentRow;
    currentRow = temp;
  }

  return previousRow[bLen];
}

/**
 * Fuzzy-match a name against a list of providers.
 * Returns the best match if the Levenshtein distance is within the threshold.
 */
export function fuzzyMatchProvider(
  name: string,
  providers: ReadonlyArray<{ readonly providerName: string; readonly facilityName: string | null }>
): { readonly index: number; readonly score: number } | null {
  if (providers.length === 0) {
    return null;
  }

  const normalizedName = name.toLowerCase().trim();
  let bestIndex = -1;
  let bestScore = Infinity;

  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const providerNameDistance = levenshteinDistance(
      normalizedName,
      provider.providerName.toLowerCase().trim()
    );

    const facilityDistance = provider.facilityName
      ? levenshteinDistance(normalizedName, provider.facilityName.toLowerCase().trim())
      : Infinity;

    const minDistance = Math.min(providerNameDistance, facilityDistance);

    if (minDistance < bestScore) {
      bestScore = minDistance;
      bestIndex = i;
    }
  }

  if (bestIndex >= 0 && bestScore <= MAX_FUZZY_DISTANCE) {
    return { index: bestIndex, score: bestScore };
  }

  return null;
}

// ─── Service ───────────────────────────────────────

export class ProviderValidationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Validate a provider and check their network status for a given plan tier.
   */
  async validateProvider(
    input: ProviderLookupInput,
    planTier: string
  ): Promise<ProviderValidationResult> {
    try {
      const provider = await this.lookupProvider(input);

      if (!provider) {
        logger.warn({ input }, 'Provider not found — flagging as new provider');

        const checks: readonly ValidationCheck[] = [
          { name: 'provider_exists', status: 'warn', message: 'Provider not found in registry; new provider workflow required' },
          { name: 'accreditation_valid', status: 'skip', message: 'Skipped — provider not yet registered' },
          { name: 'network_status', status: 'skip', message: 'Skipped — provider not yet registered' },
        ];

        return {
          isValid: true,
          provider: null,
          isNewProvider: true,
          checks,
          networkAnalysis: null,
        };
      }

      const providerRecord = toProviderRecord(provider);
      const checks = buildValidationChecks(provider);
      const hasFailedCheck = checks.some((c) => c.status === 'fail');

      const networkAnalysis = await this.getNetworkAnalysis(
        provider.id,
        planTier,
        provider.networkType
      );

      logger.info(
        { providerId: provider.id, planTier, isValid: !hasFailedCheck },
        'Provider validation complete'
      );

      return {
        isValid: !hasFailedCheck,
        provider: providerRecord,
        isNewProvider: false,
        checks,
        networkAnalysis,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message, input }, 'Provider validation failed');
      throw new Error(`Provider validation failed: ${message}`);
    }
  }

  /**
   * Create a provisional provider record for a previously unknown provider.
   */
  async createProvisionalProvider(input: ProviderLookupInput): Promise<ProviderRecord> {
    try {
      const providerName = input.practitionerName ?? input.facilityName ?? 'Unknown Provider';
      const country = input.address?.country ?? 'UNKNOWN';

      const created = await this.prisma.provider.create({
        data: {
          providerName,
          facilityName: input.facilityName ?? null,
          providerType: input.practitionerName ? 'PRACTITIONER' : 'HOSPITAL',
          specialty: [],
          address: input.address ?? {},
          networkStatus: 'PENDING_VERIFICATION',
          networkType: 'STANDARD',
          bupaProviderId: input.bupaProviderId ?? null,
          accreditationStatus: 'PENDING_ACCREDITATION',
          country,
        },
      });

      logger.info(
        { providerId: created.id, providerName, country },
        'Provisional provider created'
      );

      return toProviderRecord(created);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message, input }, 'Failed to create provisional provider');
      throw new Error(`Failed to create provisional provider: ${message}`);
    }
  }

  /**
   * Analyse the network status of a provider for a given plan tier and member network option.
   */
  async getNetworkAnalysis(
    providerId: string,
    planTier: string,
    memberNetworkOption: string
  ): Promise<NetworkAnalysis> {
    try {
      // ULTIMATE tier always gets comprehensive network with no penalties
      if (planTier === ULTIMATE_PLAN_TIER) {
        logger.info({ providerId, planTier }, 'ULTIMATE plan — no network penalties');
        return {
          isInNetwork: true,
          coInsurancePenalty: NO_PENALTY,
          penaltyReason: null,
          negotiatedRates: null,
        };
      }

      const mapping = await this.prisma.providerNetworkMapping.findUnique({
        where: {
          providerId_planTier: {
            providerId,
            planTier: planTier as any,
          },
        },
      });

      const isInNetwork = mapping?.isInNetwork ?? false;

      // COMPREHENSIVE network or in-network: no penalty
      if (isInNetwork || memberNetworkOption === COMPREHENSIVE_NETWORK) {
        return {
          isInNetwork,
          coInsurancePenalty: NO_PENALTY,
          penaltyReason: isInNetwork
            ? null
            : 'Out-of-network provider; no penalty applied due to Comprehensive network option',
          negotiatedRates: parseNegotiatedRates(mapping?.negotiatedRates),
        };
      }

      // STANDARD network and out-of-network: 50% co-insurance penalty
      if (memberNetworkOption === STANDARD_NETWORK && !isInNetwork) {
        return {
          isInNetwork: false,
          coInsurancePenalty: OUT_OF_NETWORK_PENALTY,
          penaltyReason: 'Out-of-network provider with Standard network option — 50% co-insurance penalty applies',
          negotiatedRates: null,
        };
      }

      // Default: no penalty
      return {
        isInNetwork,
        coInsurancePenalty: NO_PENALTY,
        penaltyReason: null,
        negotiatedRates: parseNegotiatedRates(mapping?.negotiatedRates),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.error({ error: message, providerId, planTier }, 'Network analysis failed');
      throw new Error(`Network analysis failed: ${message}`);
    }
  }

  // ─── Private ───────────────────────────────────────

  /**
   * Look up a provider by bupaProviderId first, then by fuzzy name + country match.
   */
  private async lookupProvider(input: ProviderLookupInput) {
    // Priority 1: Exact match on bupaProviderId
    if (input.bupaProviderId) {
      const provider = await this.prisma.provider.findFirst({
        where: { bupaProviderId: input.bupaProviderId },
      });

      if (provider) {
        logger.info({ bupaProviderId: input.bupaProviderId }, 'Provider found by Bupa ID');
        return provider;
      }
    }

    // Priority 2: Fuzzy match on name + country
    const searchName = input.facilityName ?? input.practitionerName;
    if (!searchName) {
      return null;
    }

    const whereClause: Record<string, unknown> = {};
    if (input.address?.country) {
      whereClause.country = input.address.country;
    }

    const candidates = await this.prisma.provider.findMany({
      where: whereClause,
    });

    if (candidates.length === 0) {
      return null;
    }

    const match = fuzzyMatchProvider(searchName, candidates);
    if (!match) {
      return null;
    }

    const matched = candidates[match.index];
    logger.info(
      { providerId: matched.id, score: match.score, searchName },
      'Provider found by fuzzy match'
    );

    return matched;
  }
}

// ─── Pure Helpers ──────────────────────────────────

/**
 * Map a Prisma provider row to the immutable ProviderRecord interface.
 */
function toProviderRecord(provider: {
  readonly id: string;
  readonly providerName: string;
  readonly facilityName: string | null;
  readonly providerType: string;
  readonly specialty: unknown;
  readonly country: string;
  readonly networkStatus: string;
  readonly accreditationStatus: string;
  readonly bupaProviderId: string | null;
}): ProviderRecord {
  return {
    id: provider.id,
    providerName: provider.providerName,
    facilityName: provider.facilityName,
    providerType: provider.providerType,
    specialty: parseSpecialty(provider.specialty),
    country: provider.country,
    networkStatus: provider.networkStatus,
    accreditationStatus: provider.accreditationStatus,
    bupaProviderId: provider.bupaProviderId,
  };
}

/**
 * Parse the JSON specialty field into a string array.
 */
function parseSpecialty(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.filter((item): item is string => typeof item === 'string');
  }
  return [];
}

/**
 * Parse negotiated rates from JSON to a typed record.
 */
function parseNegotiatedRates(raw: unknown): Record<string, number> | null {
  if (raw === null || raw === undefined) {
    return null;
  }

  if (typeof raw === 'object' && !Array.isArray(raw)) {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof value === 'number') {
        result[key] = value;
      }
    }
    return Object.keys(result).length > 0 ? result : null;
  }

  return null;
}

/**
 * Build the set of validation checks for a found provider.
 */
function buildValidationChecks(provider: {
  readonly accreditationStatus: string;
  readonly networkStatus: string;
}): readonly ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // Check: provider exists
  checks.push({
    name: 'provider_exists',
    status: 'pass',
    message: 'Provider found in registry',
  });

  // Check: accreditation
  checks.push(buildAccreditationCheck(provider.accreditationStatus));

  // Check: network status
  checks.push(buildNetworkStatusCheck(provider.networkStatus));

  return checks;
}

/**
 * Determine the validation check result for accreditation status.
 */
function buildAccreditationCheck(status: string): ValidationCheck {
  switch (status) {
    case 'ACCREDITED':
      return { name: 'accreditation_valid', status: 'pass', message: 'Provider is accredited' };

    case 'PENDING_ACCREDITATION':
      return { name: 'accreditation_valid', status: 'warn', message: 'Provider accreditation is pending verification' };

    case 'ACCREDITATION_SUSPENDED':
      return { name: 'accreditation_valid', status: 'fail', message: 'Provider accreditation has been suspended' };

    case 'REVOKED':
      return { name: 'accreditation_valid', status: 'fail', message: 'Provider accreditation has been revoked' };

    default:
      return { name: 'accreditation_valid', status: 'warn', message: `Unknown accreditation status: ${status}` };
  }
}

/**
 * Determine the validation check result for network status.
 */
function buildNetworkStatusCheck(status: string): ValidationCheck {
  switch (status) {
    case 'IN_NETWORK':
      return { name: 'network_status', status: 'pass', message: 'Provider is in-network' };

    case 'OUT_OF_NETWORK':
      return { name: 'network_status', status: 'warn', message: 'Provider is out-of-network; co-insurance penalties may apply' };

    case 'PENDING_VERIFICATION':
      return { name: 'network_status', status: 'warn', message: 'Provider network status is pending verification' };

    default:
      return { name: 'network_status', status: 'warn', message: `Unknown network status: ${status}` };
  }
}
