import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export type BenefitCategory =
  | 'HOSPITAL_ROOM'
  | 'OPERATING_ROOM'
  | 'SURGERY'
  | 'INTENSIVE_CARE'
  | 'SPECIALIST_CONSULTATION'
  | 'PATHOLOGY_DIAGNOSTIC'
  | 'PRESCRIBED_DRUGS'
  | 'OUTPATIENT_DAY_CARE'
  | 'OUTPATIENT_SURGICAL'
  | 'MENTAL_HEALTH'
  | 'PHYSIOTHERAPY'
  | 'REHABILITATION'
  | 'CANCER_TREATMENT'
  | 'MATERNITY'
  | 'DENTAL'
  | 'OPTICAL'
  | 'PREVENTIVE_SCREENING'
  | 'EVACUATION_REPATRIATION'
  | 'HOME_NURSING'
  | 'PROSTHETIC'
  | 'OTHER';

export interface ClaimLineItem {
  readonly index: number;
  readonly description: string;
  readonly amount: number;
  readonly category: BenefitCategory;
  readonly icdCode?: string;
  readonly cptCode?: string;
}

export interface BenefitRule {
  readonly covered: boolean;
  readonly limit: number | null;
  readonly limitType: 'ANNUAL' | 'PER_ITEM' | 'LIFETIME' | 'PER_VISIT';
  readonly limitCurrency: string;
  readonly waitingPeriodMonths: number;
  readonly visitLimit?: number | null;
  readonly notes?: string;
}

export interface PlanBenefitsConfig {
  readonly planTier: string;
  readonly annualMaximum: number | null;
  readonly benefits: Readonly<Record<BenefitCategory, BenefitRule>>;
  readonly exclusions: readonly string[];
}

export interface LineItemDecision {
  readonly index: number;
  readonly description: string;
  readonly amountClaimed: number;
  readonly isCovered: boolean;
  readonly benefitCategory: string;
  readonly benefitLimit: number | null;
  readonly amountPayable: number;
  readonly deductibleApplied: number;
  readonly coInsuranceApplied: number;
  readonly networkPenalty: number;
  readonly denialReason: string | null;
}

export interface CoverageAnalysisResult {
  readonly planTier: string;
  readonly annualMaximum: {
    readonly limit: number | null;
    readonly currency: string;
    readonly used: number;
    readonly remaining: number | null;
  };
  readonly lineItemDecisions: readonly LineItemDecision[];
  readonly totalClaimed: number;
  readonly totalPayable: number;
  readonly totalDeductible: number;
  readonly totalCoInsurance: number;
  readonly totalNetworkPenalty: number;
  readonly totalDenied: number;
  readonly exclusionsTriggered: readonly string[];
  readonly overallDecision: 'FULLY_COVERED' | 'PARTIALLY_COVERED' | 'NOT_COVERED';
}

export interface CoverageAnalysisParams {
  readonly lineItems: readonly ClaimLineItem[];
  readonly planTier: string;
  readonly deductibleRemaining: number;
  readonly coInsuranceRate: number | null;
  readonly isOutOfNetwork: boolean;
  readonly networkPenaltyRate: number;
  readonly currency: string;
  readonly annualUsed: number;
}

// ─── Constants ─────────────────────────────────────

const ALL_BENEFIT_CATEGORIES: readonly BenefitCategory[] = [
  'HOSPITAL_ROOM', 'OPERATING_ROOM', 'SURGERY', 'INTENSIVE_CARE',
  'SPECIALIST_CONSULTATION', 'PATHOLOGY_DIAGNOSTIC', 'PRESCRIBED_DRUGS',
  'OUTPATIENT_DAY_CARE', 'OUTPATIENT_SURGICAL', 'MENTAL_HEALTH',
  'PHYSIOTHERAPY', 'REHABILITATION', 'CANCER_TREATMENT', 'MATERNITY',
  'DENTAL', 'OPTICAL', 'PREVENTIVE_SCREENING', 'EVACUATION_REPATRIATION',
  'HOME_NURSING', 'PROSTHETIC', 'OTHER',
] as const;

const VALID_PLAN_TIERS = [
  'MAJOR_MEDICAL', 'SELECT', 'PREMIER', 'ELITE', 'ULTIMATE',
] as const;

const GLOBAL_EXCLUSIONS: readonly string[] = [
  'cosmetic treatment',
  'experimental treatment',
  'genetic testing (non-medical)',
  'gender issues',
  'hazardous substance abuse',
  'health hydros/nature cure',
  'illegal activity',
  'obesity (unless eligible)',
  'professional sports',
  'sleep disorders',
  'surrogacy',
  'TMJ disorders',
] as const;

/**
 * Keyword map used by `categorizeTreatment` to infer a BenefitCategory
 * from free-text descriptions, ICD codes, and CPT codes.
 */
const CATEGORY_KEYWORDS: ReadonlyArray<{
  readonly category: BenefitCategory;
  readonly keywords: readonly string[];
}> = [
  { category: 'HOSPITAL_ROOM', keywords: ['hospital room', 'room and board', 'ward', 'bed charge', 'accommodation'] },
  { category: 'OPERATING_ROOM', keywords: ['operating room', 'operating theatre', 'surgical theatre', 'theatre fee'] },
  { category: 'SURGERY', keywords: ['surgery', 'surgical', 'operation', 'procedure', 'laparoscop', 'arthroscop', 'appendectomy', 'cholecystectomy'] },
  { category: 'INTENSIVE_CARE', keywords: ['intensive care', 'icu', 'critical care', 'high dependency'] },
  { category: 'SPECIALIST_CONSULTATION', keywords: ['consultation', 'specialist visit', 'office visit', 'follow-up visit', 'physician visit'] },
  { category: 'PATHOLOGY_DIAGNOSTIC', keywords: ['pathology', 'diagnostic', 'mri', 'ct scan', 'x-ray', 'xray', 'ultrasound', 'blood test', 'lab test', 'laboratory', 'biopsy', 'imaging', 'radiology'] },
  { category: 'PRESCRIBED_DRUGS', keywords: ['prescribed drug', 'prescription', 'medication', 'pharmaceutical', 'medicine', 'drug'] },
  { category: 'OUTPATIENT_DAY_CARE', keywords: ['outpatient', 'day care', 'day case', 'ambulatory'] },
  { category: 'OUTPATIENT_SURGICAL', keywords: ['outpatient surgery', 'outpatient surgical', 'day surgery'] },
  { category: 'MENTAL_HEALTH', keywords: ['mental health', 'psychiatric', 'psychology', 'counseling', 'counselling', 'therapy session', 'psychotherapy'] },
  { category: 'PHYSIOTHERAPY', keywords: ['physiotherapy', 'physical therapy', 'physio'] },
  { category: 'REHABILITATION', keywords: ['rehabilitation', 'rehab', 'occupational therapy'] },
  { category: 'CANCER_TREATMENT', keywords: ['cancer', 'oncology', 'chemotherapy', 'radiation therapy', 'radiotherapy', 'tumour', 'tumor', 'neoplasm'] },
  { category: 'MATERNITY', keywords: ['maternity', 'pregnancy', 'prenatal', 'postnatal', 'delivery', 'childbirth', 'obstetric', 'antenatal'] },
  { category: 'DENTAL', keywords: ['dental', 'dentist', 'tooth', 'teeth', 'orthodontic', 'periodontal', 'oral surgery'] },
  { category: 'OPTICAL', keywords: ['optical', 'optometry', 'eye exam', 'vision', 'glasses', 'contact lens', 'ophthalmology'] },
  { category: 'PREVENTIVE_SCREENING', keywords: ['preventive', 'screening', 'wellness check', 'health check', 'annual physical', 'vaccination', 'immunization'] },
  { category: 'EVACUATION_REPATRIATION', keywords: ['evacuation', 'repatriation', 'medical transport', 'air ambulance', 'medevac'] },
  { category: 'HOME_NURSING', keywords: ['home nursing', 'home care', 'home health', 'private nursing'] },
  { category: 'PROSTHETIC', keywords: ['prosthetic', 'prosthesis', 'orthotic', 'artificial limb', 'implant'] },
] as const;

/**
 * ICD-10 code prefixes that map to exclusion categories.
 */
const EXCLUSION_ICD_PREFIXES: ReadonlyArray<{
  readonly prefix: string;
  readonly exclusion: string;
}> = [
  { prefix: 'Z41', exclusion: 'cosmetic treatment' },
  { prefix: 'Z31.7', exclusion: 'surrogacy' },
  { prefix: 'F10', exclusion: 'hazardous substance abuse' },
  { prefix: 'F11', exclusion: 'hazardous substance abuse' },
  { prefix: 'F12', exclusion: 'hazardous substance abuse' },
  { prefix: 'F13', exclusion: 'hazardous substance abuse' },
  { prefix: 'F14', exclusion: 'hazardous substance abuse' },
  { prefix: 'F15', exclusion: 'hazardous substance abuse' },
  { prefix: 'F16', exclusion: 'hazardous substance abuse' },
  { prefix: 'F17', exclusion: 'hazardous substance abuse' },
  { prefix: 'F18', exclusion: 'hazardous substance abuse' },
  { prefix: 'F19', exclusion: 'hazardous substance abuse' },
  { prefix: 'E66', exclusion: 'obesity (unless eligible)' },
  { prefix: 'G47', exclusion: 'sleep disorders' },
  { prefix: 'K07.6', exclusion: 'TMJ disorders' },
] as const;

// ─── Helpers ──────────────────────────────────────

function buildDefaultBenefit(overrides: Partial<BenefitRule> = {}): BenefitRule {
  return {
    covered: true,
    limit: null,
    limitType: 'ANNUAL',
    limitCurrency: 'USD',
    waitingPeriodMonths: 0,
    visitLimit: null,
    ...overrides,
  };
}

function buildNotCovered(notes?: string): BenefitRule {
  return {
    covered: false,
    limit: null,
    limitType: 'ANNUAL',
    limitCurrency: 'USD',
    waitingPeriodMonths: 0,
    visitLimit: null,
    notes: notes ?? 'Not covered under this plan',
  };
}

function buildFullBenefitsMap(
  overrides: Partial<Record<BenefitCategory, BenefitRule>>,
): Record<BenefitCategory, BenefitRule> {
  const base: Record<string, BenefitRule> = {};
  for (const category of ALL_BENEFIT_CATEGORIES) {
    base[category] = overrides[category] ?? buildDefaultBenefit();
  }
  return base as Record<BenefitCategory, BenefitRule>;
}

// ─── Plan Definitions ─────────────────────────────

function buildMajorMedicalPlan(): PlanBenefitsConfig {
  return {
    planTier: 'MAJOR_MEDICAL',
    annualMaximum: 4_500_000,
    benefits: buildFullBenefitsMap({
      OUTPATIENT_DAY_CARE: buildNotCovered('Day care not covered under Major Medical'),
      PRESCRIBED_DRUGS: buildDefaultBenefit({ limit: 1_000, limitType: 'ANNUAL' }),
      SPECIALIST_CONSULTATION: buildNotCovered('Specialist consultations not covered under Major Medical'),
      DENTAL: buildNotCovered('Dental not covered under Major Medical'),
      OPTICAL: buildNotCovered('Optical not covered under Major Medical'),
      MATERNITY: buildNotCovered('Maternity not covered under Major Medical'),
    }),
    exclusions: GLOBAL_EXCLUSIONS,
  };
}

function buildSelectPlan(): PlanBenefitsConfig {
  return {
    planTier: 'SELECT',
    annualMaximum: 4_500_000,
    benefits: buildFullBenefitsMap({
      OUTPATIENT_DAY_CARE: buildDefaultBenefit({ limit: 28_800, limitType: 'ANNUAL' }),
      PRESCRIBED_DRUGS: buildDefaultBenefit({ limit: 5_800, limitType: 'ANNUAL' }),
      SPECIALIST_CONSULTATION: buildDefaultBenefit({ visitLimit: 15, limitType: 'ANNUAL', notes: '15 visits per year' }),
      DENTAL: buildNotCovered('Dental not covered under Select'),
      OPTICAL: buildNotCovered('Optical not covered under Select'),
      MATERNITY: buildNotCovered('Maternity not covered under Select'),
    }),
    exclusions: GLOBAL_EXCLUSIONS,
  };
}

function buildPremierPlan(): PlanBenefitsConfig {
  return {
    planTier: 'PREMIER',
    annualMaximum: 5_000_000,
    benefits: buildFullBenefitsMap({
      OUTPATIENT_DAY_CARE: buildDefaultBenefit({ limit: 38_500, limitType: 'ANNUAL' }),
      PRESCRIBED_DRUGS: buildDefaultBenefit({ limit: null }),
      SPECIALIST_CONSULTATION: buildDefaultBenefit({ visitLimit: 30, limitType: 'ANNUAL', notes: '30 visits per year' }),
      DENTAL: buildDefaultBenefit({ limit: 2_550, limitType: 'ANNUAL' }),
      OPTICAL: buildDefaultBenefit({ limit: 500, limitType: 'ANNUAL', notes: 'Limited optical benefit' }),
      MATERNITY: buildNotCovered('Maternity not covered under Premier'),
    }),
    exclusions: GLOBAL_EXCLUSIONS,
  };
}

function buildElitePlan(): PlanBenefitsConfig {
  return {
    planTier: 'ELITE',
    annualMaximum: 10_000_000,
    benefits: buildFullBenefitsMap({
      OUTPATIENT_DAY_CARE: buildDefaultBenefit({ limit: 75_000, limitType: 'ANNUAL' }),
      PRESCRIBED_DRUGS: buildDefaultBenefit({ limit: null }),
      SPECIALIST_CONSULTATION: buildDefaultBenefit({ visitLimit: 60, limitType: 'ANNUAL', notes: '60 visits per year' }),
      DENTAL: buildDefaultBenefit({ limit: 4_000, limitType: 'ANNUAL' }),
      OPTICAL: buildDefaultBenefit({ limit: 1_000, limitType: 'ANNUAL', notes: 'Limited optical benefit' }),
      MATERNITY: buildDefaultBenefit({
        covered: false,
        notes: 'Optional — covered only if purchased as add-on',
      }),
    }),
    exclusions: GLOBAL_EXCLUSIONS,
  };
}

function buildUltimatePlan(): PlanBenefitsConfig {
  return {
    planTier: 'ULTIMATE',
    annualMaximum: null,
    benefits: buildFullBenefitsMap({
      OUTPATIENT_DAY_CARE: buildDefaultBenefit({ limit: null }),
      PRESCRIBED_DRUGS: buildDefaultBenefit({ limit: null }),
      SPECIALIST_CONSULTATION: buildDefaultBenefit({ visitLimit: null, notes: 'Paid in full' }),
      DENTAL: buildDefaultBenefit({ limit: 15_000, limitType: 'ANNUAL' }),
      OPTICAL: buildDefaultBenefit({ limit: 15_000, limitType: 'ANNUAL' }),
      MATERNITY: buildDefaultBenefit({
        covered: false,
        notes: 'Optional — covered only if purchased as add-on',
      }),
    }),
    exclusions: GLOBAL_EXCLUSIONS,
  };
}

// ─── Errors ───────────────────────────────────────

export class UnknownPlanTierError extends Error {
  constructor(tier: string) {
    super(`Unknown plan tier: ${tier}. Valid tiers: ${VALID_PLAN_TIERS.join(', ')}`);
    this.name = 'UnknownPlanTierError';
  }
}

// ─── Service ──────────────────────────────────────

export class CoverageAnalysisService {
  /**
   * Return the hardcoded benefits configuration for a given Bupa plan tier.
   */
  static getPlanBenefits(tier: string): PlanBenefitsConfig {
    const normalized = tier.toUpperCase().replace(/[\s-]+/g, '_');

    switch (normalized) {
      case 'MAJOR_MEDICAL':
        return buildMajorMedicalPlan();
      case 'SELECT':
        return buildSelectPlan();
      case 'PREMIER':
        return buildPremierPlan();
      case 'ELITE':
        return buildElitePlan();
      case 'ULTIMATE':
        return buildUltimatePlan();
      default:
        throw new UnknownPlanTierError(tier);
    }
  }

  /**
   * Check whether a treatment description or ICD code triggers any global
   * or plan-specific exclusions. Returns the list of triggered exclusion names.
   */
  checkExclusions(description: string, icdCode?: string): string[] {
    const triggered: string[] = [];
    const descLower = description.toLowerCase();

    for (const exclusion of GLOBAL_EXCLUSIONS) {
      if (descLower.includes(exclusion)) {
        triggered.push(exclusion);
      }
    }

    // Keyword-based checks for terms that may appear differently in descriptions
    if (/\bcosmet/i.test(description)) {
      addUniqueExclusion(triggered, 'cosmetic treatment');
    }
    if (/\bexperimental\b/i.test(description)) {
      addUniqueExclusion(triggered, 'experimental treatment');
    }
    if (/\bsurrogacy\b|\bsurrogate\b/i.test(description)) {
      addUniqueExclusion(triggered, 'surrogacy');
    }

    if (icdCode) {
      const normalizedIcd = icdCode.toUpperCase().replace(/[.\s]/g, '');
      for (const entry of EXCLUSION_ICD_PREFIXES) {
        const normalizedPrefix = entry.prefix.replace(/[.\s]/g, '');
        if (normalizedIcd.startsWith(normalizedPrefix)) {
          addUniqueExclusion(triggered, entry.exclusion);
        }
      }
    }

    return triggered;
  }

  /**
   * Use keyword matching to map a treatment description (plus optional ICD/CPT
   * codes) to a BenefitCategory. Falls back to OTHER if no match is found.
   */
  categorizeTreatment(
    description: string,
    icdCode?: string,
    cptCode?: string,
  ): BenefitCategory {
    const combined = [description, icdCode ?? '', cptCode ?? '']
      .join(' ')
      .toLowerCase();

    // Check more-specific multi-word categories first (outpatient surgical
    // must be tested before generic outpatient / surgical keywords).
    for (const entry of CATEGORY_KEYWORDS) {
      for (const keyword of entry.keywords) {
        if (combined.includes(keyword)) {
          return entry.category;
        }
      }
    }

    return 'OTHER';
  }

  /**
   * Analyze coverage for a set of claim line items against a member's Bupa
   * plan tier. Calculates deductible, co-insurance, network penalties, and
   * per-item payability. Pure computation — no database access.
   */
  analyzeCoverage(params: CoverageAnalysisParams): CoverageAnalysisResult {
    const {
      lineItems,
      planTier,
      deductibleRemaining,
      coInsuranceRate,
      isOutOfNetwork,
      networkPenaltyRate,
      currency,
      annualUsed,
    } = params;

    const planConfig = CoverageAnalysisService.getPlanBenefits(planTier);

    logger.debug(
      { planTier, lineItemCount: lineItems.length, annualUsed },
      'Starting coverage analysis',
    );

    let remainingDeductible = deductibleRemaining;
    const allExclusionsTriggered: string[] = [];
    const decisions: LineItemDecision[] = [];

    for (const item of lineItems) {
      const decision = this.evaluateLineItem(
        item,
        planConfig,
        remainingDeductible,
        coInsuranceRate,
        isOutOfNetwork,
        networkPenaltyRate,
      );

      decisions.push(decision);

      // Track running deductible (reduce as it is applied)
      remainingDeductible = Math.max(0, remainingDeductible - decision.deductibleApplied);

      // Collect triggered exclusions
      if (decision.denialReason) {
        const exclusions = this.checkExclusions(item.description, item.icdCode);
        for (const ex of exclusions) {
          addUniqueExclusion(allExclusionsTriggered, ex);
        }
      }
    }

    // Compute totals
    const totalClaimed = sumField(decisions, 'amountClaimed');
    let totalPayable = sumField(decisions, 'amountPayable');
    const totalDeductible = sumField(decisions, 'deductibleApplied');
    const totalCoInsurance = sumField(decisions, 'coInsuranceApplied');
    const totalNetworkPenalty = sumField(decisions, 'networkPenalty');

    // Enforce annual maximum
    const annualRemaining = planConfig.annualMaximum !== null
      ? Math.max(0, planConfig.annualMaximum - annualUsed)
      : null;

    if (annualRemaining !== null && totalPayable > annualRemaining) {
      logger.info(
        { totalPayable, annualRemaining, planTier },
        'Total payable exceeds annual remaining; capping',
      );
      totalPayable = annualRemaining;
    }

    const totalDenied = totalClaimed - totalPayable - totalDeductible - totalCoInsurance - totalNetworkPenalty;

    const overallDecision = determineOverallDecision(decisions, totalPayable, totalClaimed);

    const result: CoverageAnalysisResult = {
      planTier: planConfig.planTier,
      annualMaximum: {
        limit: planConfig.annualMaximum,
        currency,
        used: annualUsed,
        remaining: annualRemaining,
      },
      lineItemDecisions: decisions,
      totalClaimed,
      totalPayable,
      totalDeductible,
      totalCoInsurance,
      totalNetworkPenalty,
      totalDenied: Math.max(0, totalDenied),
      exclusionsTriggered: allExclusionsTriggered,
      overallDecision,
    };

    logger.info(
      { planTier, overallDecision, totalClaimed, totalPayable },
      'Coverage analysis complete',
    );

    return result;
  }

  // ─── Private ──────────────────────────────────────

  /**
   * Evaluate a single line item against plan rules and return a decision.
   */
  private evaluateLineItem(
    item: ClaimLineItem,
    planConfig: PlanBenefitsConfig,
    deductibleRemaining: number,
    coInsuranceRate: number | null,
    isOutOfNetwork: boolean,
    networkPenaltyRate: number,
  ): LineItemDecision {
    const benefitRule = planConfig.benefits[item.category];

    // 1. Check if the benefit category is covered
    if (!benefitRule || !benefitRule.covered) {
      return buildDeniedDecision(
        item,
        benefitRule?.notes ?? `${item.category} is not covered under ${planConfig.planTier}`,
      );
    }

    // 2. Check against global exclusions
    const exclusions = this.checkExclusions(item.description, item.icdCode);
    if (exclusions.length > 0) {
      return buildDeniedDecision(
        item,
        `Excluded: ${exclusions.join(', ')}`,
      );
    }

    // 3. Check against benefit limit
    let eligibleAmount = item.amount;
    if (benefitRule.limit !== null && eligibleAmount > benefitRule.limit) {
      logger.debug(
        { index: item.index, limit: benefitRule.limit, amount: item.amount },
        'Amount exceeds benefit limit; capping',
      );
      eligibleAmount = benefitRule.limit;
    }

    // 4. Apply deductible
    const deductibleApplied = Math.min(deductibleRemaining, eligibleAmount);
    let afterDeductible = eligibleAmount - deductibleApplied;

    // 5. Apply co-insurance
    let coInsuranceApplied = 0;
    if (coInsuranceRate !== null && coInsuranceRate > 0) {
      coInsuranceApplied = roundCurrency(afterDeductible * coInsuranceRate);
      afterDeductible = afterDeductible - coInsuranceApplied;
    }

    // 6. Apply network penalty
    let networkPenalty = 0;
    if (isOutOfNetwork && networkPenaltyRate > 0) {
      networkPenalty = roundCurrency(afterDeductible * networkPenaltyRate);
      afterDeductible = afterDeductible - networkPenalty;
    }

    // 7. Ensure non-negative
    const amountPayable = Math.max(0, roundCurrency(afterDeductible));

    return {
      index: item.index,
      description: item.description,
      amountClaimed: item.amount,
      isCovered: true,
      benefitCategory: item.category,
      benefitLimit: benefitRule.limit,
      amountPayable,
      deductibleApplied: roundCurrency(deductibleApplied),
      coInsuranceApplied: roundCurrency(coInsuranceApplied),
      networkPenalty: roundCurrency(networkPenalty),
      denialReason: null,
    };
  }
}

// ─── Pure Utility Functions ───────────────────────

function buildDeniedDecision(item: ClaimLineItem, reason: string): LineItemDecision {
  return {
    index: item.index,
    description: item.description,
    amountClaimed: item.amount,
    isCovered: false,
    benefitCategory: item.category,
    benefitLimit: null,
    amountPayable: 0,
    deductibleApplied: 0,
    coInsuranceApplied: 0,
    networkPenalty: 0,
    denialReason: reason,
  };
}

function determineOverallDecision(
  decisions: readonly LineItemDecision[],
  totalPayable: number,
  totalClaimed: number,
): 'FULLY_COVERED' | 'PARTIALLY_COVERED' | 'NOT_COVERED' {
  if (decisions.length === 0 || totalClaimed === 0) {
    return 'NOT_COVERED';
  }

  const allDenied = decisions.every((d) => !d.isCovered);
  if (allDenied || totalPayable === 0) {
    return 'NOT_COVERED';
  }

  const allFullyCovered = decisions.every(
    (d) => d.isCovered && d.amountPayable === d.amountClaimed,
  );
  if (allFullyCovered && totalPayable >= totalClaimed) {
    return 'FULLY_COVERED';
  }

  return 'PARTIALLY_COVERED';
}

function addUniqueExclusion(list: string[], value: string): void {
  if (!list.includes(value)) {
    list.push(value);
  }
}

function sumField(
  decisions: readonly LineItemDecision[],
  field: 'amountClaimed' | 'amountPayable' | 'deductibleApplied' | 'coInsuranceApplied' | 'networkPenalty',
): number {
  return roundCurrency(decisions.reduce((acc, d) => acc + d[field], 0));
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}
