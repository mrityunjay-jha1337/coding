import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export interface ClinicalValidationInput {
  readonly primaryDiagnosis: { readonly code: string; readonly description: string } | null;
  readonly secondaryDiagnoses: ReadonlyArray<{ readonly code: string; readonly description: string }>;
  readonly procedures: ReadonlyArray<{ readonly code: string; readonly description: string }>;
  readonly medications: ReadonlyArray<string>;
  readonly treatmentType: string | null;
  readonly admissionDate: string | null;
  readonly dischargeDate: string | null;
  readonly surgeryDate: string | null;
  readonly claimAmount: number | null;
  readonly treatmentDescription: string | null;
  readonly preExistingConditions: ReadonlyArray<string>;
}

export interface ClinicalCheck {
  readonly name: string;
  readonly status: 'pass' | 'fail' | 'warn' | 'skip';
  readonly message: string;
  readonly category: 'consistency' | 'necessity' | 'duration' | 'medication' | 'exclusion' | 'pre_existing';
}

export interface ClinicalValidationResult {
  readonly isValid: boolean;
  readonly score: number;
  readonly checks: ReadonlyArray<ClinicalCheck>;
  readonly criticalIssues: ReadonlyArray<ClinicalCheck>;
  readonly warnings: ReadonlyArray<ClinicalCheck>;
  readonly recommendation: 'PROCEED' | 'REVIEW_RECOMMENDED' | 'CLINICAL_REVIEW_REQUIRED';
}

// ─── Constants ─────────────────────────────────────

/**
 * Maps ICD-10 code prefix ranges to expected procedure code prefixes.
 * Used by diagnosis-procedure consistency checks.
 */
const DIAGNOSIS_PROCEDURE_MAP: ReadonlyArray<{
  readonly diagnosisPrefix: string;
  readonly diagnosisLabel: string;
  readonly expectedProcedurePrefixes: ReadonlyArray<string>;
  readonly procedureLabel: string;
}> = [
  {
    diagnosisPrefix: 'K8',
    diagnosisLabel: 'gallbladder/biliary',
    expectedProcedurePrefixes: ['47'],
    procedureLabel: 'surgical (47xxx)',
  },
  {
    diagnosisPrefix: 'I2',
    diagnosisLabel: 'ischemic heart disease',
    expectedProcedurePrefixes: ['33', '92'],
    procedureLabel: 'cardiology (33xxx, 92xxx)',
  },
  {
    diagnosisPrefix: 'M1',
    diagnosisLabel: 'osteoarthritis',
    expectedProcedurePrefixes: ['27', '29'],
    procedureLabel: 'orthopedic (27xxx, 29xxx)',
  },
  {
    diagnosisPrefix: 'S',
    diagnosisLabel: 'injuries',
    expectedProcedurePrefixes: ['20', '21', '22', '23', '24', '25', '26', '27', '28', '29'],
    procedureLabel: 'trauma procedures',
  },
  {
    diagnosisPrefix: 'C',
    diagnosisLabel: 'neoplasms/cancer',
    expectedProcedurePrefixes: ['38', '19', '96'],
    procedureLabel: 'oncology/surgery',
  },
  {
    diagnosisPrefix: 'J',
    diagnosisLabel: 'respiratory',
    expectedProcedurePrefixes: ['31', '32', '94'],
    procedureLabel: 'pulmonary procedures',
  },
] as const;

/** Keywords that suggest non-medically-necessary treatment. */
const COSMETIC_KEYWORDS: ReadonlyArray<string> = [
  'cosmetic', 'aesthetic', 'beauty', 'botox', 'filler', 'liposuction',
] as const;

const WELLNESS_KEYWORDS: ReadonlyArray<string> = [
  'spa', 'sauna',
] as const;

const EXPERIMENTAL_KEYWORDS: ReadonlyArray<string> = [
  'experimental', 'investigational', 'off-label', 'clinical trial',
] as const;

/** Treatment descriptions that trigger Bupa exclusion checks. */
const EXCLUSION_KEYWORDS: ReadonlyArray<string> = [
  'stem cell', 'gene therapy', 'experimental', 'investigational',
  'not fda approved', 'not ema approved',
] as const;

/**
 * Maps medication name keywords to expected ICD-10 diagnosis prefixes.
 */
const MEDICATION_DIAGNOSIS_MAP: ReadonlyArray<{
  readonly medicationKeywords: ReadonlyArray<string>;
  readonly expectedDiagnosisPrefixes: ReadonlyArray<string>;
  readonly medicationLabel: string;
  readonly diagnosisLabel: string;
  readonly isOpioid?: boolean;
}> = [
  {
    medicationKeywords: ['insulin', 'metformin', 'glipizide', 'glyburide', 'sitagliptin'],
    expectedDiagnosisPrefixes: ['E10', 'E11', 'E12', 'E13', 'E14'],
    medicationLabel: 'diabetes medication',
    diagnosisLabel: 'diabetes (E10-E14)',
  },
  {
    medicationKeywords: ['statin', 'atorvastatin', 'rosuvastatin', 'simvastatin', 'pravastatin', 'lovastatin'],
    expectedDiagnosisPrefixes: ['I'],
    medicationLabel: 'cardiovascular medication',
    diagnosisLabel: 'cardiovascular disease (I00-I99)',
  },
  {
    medicationKeywords: ['amoxicillin', 'azithromycin', 'ciprofloxacin', 'doxycycline', 'cephalexin', 'penicillin', 'antibiotic'],
    expectedDiagnosisPrefixes: ['A', 'B', 'J0', 'J1', 'J2'],
    medicationLabel: 'antibiotic',
    diagnosisLabel: 'infection (A00-B99, J00-J22)',
  },
  {
    medicationKeywords: ['cisplatin', 'carboplatin', 'doxorubicin', 'paclitaxel', 'cyclophosphamide', 'methotrexate', 'chemotherapy'],
    expectedDiagnosisPrefixes: ['C', 'D0', 'D1', 'D2', 'D3', 'D4'],
    medicationLabel: 'chemotherapy drug',
    diagnosisLabel: 'cancer (C00-D49)',
  },
  {
    medicationKeywords: ['morphine', 'fentanyl', 'oxycodone', 'hydrocodone', 'codeine', 'tramadol'],
    expectedDiagnosisPrefixes: [],
    medicationLabel: 'opioid',
    diagnosisLabel: 'pain/post-surgical',
    isOpioid: true,
  },
] as const;

/** Category weights for score calculation (must sum to 100). */
const CATEGORY_WEIGHTS: Readonly<Record<string, number>> = {
  consistency: 25,
  necessity: 20,
  duration: 15,
  medication: 15,
  exclusion: 15,
  pre_existing: 10,
} as const;

const SCORE_PROCEED_THRESHOLD = 80;
const SCORE_REVIEW_THRESHOLD = 60;

const CLAIM_AMOUNT_OUTPATIENT_WARN = 100_000;
const CLAIM_AMOUNT_INPATIENT_WARN = 500_000;
const CLAIM_AMOUNT_ABSOLUTE_FAIL = 1_000_000;

const LOS_WARN_DAYS = 30;
const LOS_FAIL_DAYS = 90;

// ─── Helpers ─────────────────────────────────────────

function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[.\s-]/g, '');
}

function lowered(text: string | null | undefined): string {
  return (text ?? '').toLowerCase();
}

function containsAny(text: string, keywords: ReadonlyArray<string>): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

function daysBetween(startIso: string, endIso: string): number | null {
  const start = new Date(startIso);
  const end = new Date(endIso);

  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return null;
  }

  const diffMs = end.getTime() - start.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function buildCheck(
  name: string,
  status: ClinicalCheck['status'],
  message: string,
  category: ClinicalCheck['category'],
): ClinicalCheck {
  return { name, status, message, category };
}

function codeMatchesAnyPrefix(
  code: string,
  prefixes: ReadonlyArray<string>,
): boolean {
  const normalized = normalizeCode(code);
  return prefixes.some((prefix) => normalized.startsWith(prefix.toUpperCase()));
}

function treatmentTypeIs(input: ClinicalValidationInput, type: string): boolean {
  return lowered(input.treatmentType).includes(type.toLowerCase());
}

// ─── Check Functions ─────────────────────────────────

function checkDiagnosisProcedureConsistency(
  input: ClinicalValidationInput,
): ClinicalCheck {
  const name = 'Diagnosis-Procedure Consistency';
  const category: ClinicalCheck['category'] = 'consistency';

  if (input.procedures.length > 0 && input.primaryDiagnosis === null) {
    return buildCheck(name, 'fail', 'Procedures without diagnosis', category);
  }

  if (input.primaryDiagnosis === null) {
    return buildCheck(name, 'skip', 'No diagnosis provided', category);
  }

  if (input.procedures.length === 0) {
    return buildCheck(name, 'warn', 'No procedures documented for the given diagnosis', category);
  }

  const diagCode = normalizeCode(input.primaryDiagnosis.code);

  for (const mapping of DIAGNOSIS_PROCEDURE_MAP) {
    const diagPrefix = mapping.diagnosisPrefix.toUpperCase();
    if (!diagCode.startsWith(diagPrefix)) {
      continue;
    }

    const hasExpected = input.procedures.some((proc) =>
      mapping.expectedProcedurePrefixes.some((pp) =>
        normalizeCode(proc.code).startsWith(pp),
      ),
    );

    if (!hasExpected) {
      return buildCheck(
        name,
        'warn',
        `Diagnosis ${input.primaryDiagnosis.code} (${mapping.diagnosisLabel}) present but no expected ${mapping.procedureLabel} procedures found`,
        category,
      );
    }

    return buildCheck(
      name,
      'pass',
      `Diagnosis ${input.primaryDiagnosis.code} (${mapping.diagnosisLabel}) is consistent with documented procedures`,
      category,
    );
  }

  return buildCheck(
    name,
    'pass',
    'Diagnosis and procedures present; no specific mismatch detected',
    category,
  );
}

function checkTreatmentNecessity(
  input: ClinicalValidationInput,
): ClinicalCheck {
  const name = 'Treatment Medical Necessity';
  const category: ClinicalCheck['category'] = 'necessity';

  const desc = lowered(input.treatmentDescription);

  if (desc.length === 0) {
    return buildCheck(name, 'skip', 'No treatment description provided', category);
  }

  if (containsAny(desc, COSMETIC_KEYWORDS)) {
    return buildCheck(
      name,
      'fail',
      'Treatment description suggests cosmetic/aesthetic procedure which may not be medically necessary',
      category,
    );
  }

  if (containsAny(desc, EXPERIMENTAL_KEYWORDS)) {
    return buildCheck(
      name,
      'warn',
      'Treatment description references experimental or investigational treatment',
      category,
    );
  }

  // "massage" without "physiotherapy" context is flagged
  if (containsAny(desc, WELLNESS_KEYWORDS)) {
    const hasPhysioContext = desc.includes('physiotherapy') || desc.includes('physical therapy');
    if (!hasPhysioContext) {
      return buildCheck(
        name,
        'warn',
        'Treatment description includes wellness-related keywords that may not be covered',
        category,
      );
    }
  }

  if (desc.includes('massage') && !desc.includes('physiotherapy') && !desc.includes('physical therapy')) {
    return buildCheck(
      name,
      'warn',
      'Massage therapy without physiotherapy context may not be covered',
      category,
    );
  }

  return buildCheck(
    name,
    'pass',
    'No concerns regarding medical necessity detected',
    category,
  );
}

function checkLengthOfStay(
  input: ClinicalValidationInput,
): ClinicalCheck {
  const name = 'Length of Stay';
  const category: ClinicalCheck['category'] = 'duration';

  if (input.admissionDate === null || input.dischargeDate === null) {
    return buildCheck(name, 'skip', 'Admission or discharge date not available', category);
  }

  const days = daysBetween(input.admissionDate, input.dischargeDate);

  if (days === null) {
    return buildCheck(name, 'skip', 'Unable to parse admission/discharge dates', category);
  }

  if (days < 0) {
    return buildCheck(
      name,
      'fail',
      'Discharge date is before admission date',
      category,
    );
  }

  if (days > LOS_FAIL_DAYS) {
    return buildCheck(
      name,
      'fail',
      `Unusually long hospital stay (${days} days) requires review`,
      category,
    );
  }

  if (days > LOS_WARN_DAYS) {
    return buildCheck(
      name,
      'warn',
      `Extended hospital stay of ${days} days`,
      category,
    );
  }

  if (days === 0 && treatmentTypeIs(input, 'inpatient')) {
    return buildCheck(
      name,
      'warn',
      'Same-day discharge for inpatient claim',
      category,
    );
  }

  return buildCheck(
    name,
    'pass',
    `Length of stay (${days} days) is within normal range`,
    category,
  );
}

function checkMedicationDiagnosisMatch(
  input: ClinicalValidationInput,
): ClinicalCheck {
  const name = 'Medication-Diagnosis Match';
  const category: ClinicalCheck['category'] = 'medication';

  if (input.medications.length === 0) {
    return buildCheck(name, 'skip', 'No medications listed', category);
  }

  const allDiagCodes = gatherDiagnosisCodes(input);
  const issues: string[] = [];

  for (const med of input.medications) {
    const medLower = med.toLowerCase();

    for (const mapping of MEDICATION_DIAGNOSIS_MAP) {
      const matchesMed = mapping.medicationKeywords.some((kw) =>
        medLower.includes(kw),
      );

      if (!matchesMed) {
        continue;
      }

      if (mapping.isOpioid) {
        const hasSurgicalProcedure = input.procedures.length > 0 || input.surgeryDate !== null;
        if (!hasSurgicalProcedure) {
          issues.push(
            `Opioid "${med}" prescribed without documented surgical procedure`,
          );
        }
        continue;
      }

      const diagMatches = allDiagCodes.some((dc) =>
        codeMatchesAnyPrefix(dc, mapping.expectedDiagnosisPrefixes),
      );

      if (!diagMatches) {
        issues.push(
          `${mapping.medicationLabel} "${med}" does not match any ${mapping.diagnosisLabel} diagnosis`,
        );
      }
    }
  }

  if (issues.length === 0) {
    return buildCheck(
      name,
      'pass',
      'Medications are consistent with documented diagnoses',
      category,
    );
  }

  return buildCheck(
    name,
    'warn',
    issues.join('; '),
    category,
  );
}

function checkExperimentalTreatment(
  input: ClinicalValidationInput,
): ClinicalCheck {
  const name = 'Experimental/Excluded Treatment';
  const category: ClinicalCheck['category'] = 'exclusion';

  const desc = lowered(input.treatmentDescription);

  if (desc.length === 0) {
    return buildCheck(name, 'skip', 'No treatment description provided', category);
  }

  const matched = EXCLUSION_KEYWORDS.filter((kw) => desc.includes(kw));

  if (matched.length > 0) {
    return buildCheck(
      name,
      'fail',
      `Treatment description contains excluded terms: ${matched.join(', ')}. These are excluded under all Bupa plans`,
      category,
    );
  }

  return buildCheck(
    name,
    'pass',
    'No experimental or excluded treatment indicators detected',
    category,
  );
}

function checkPreExistingConditions(
  input: ClinicalValidationInput,
): ClinicalCheck {
  const name = 'Pre-Existing Condition Review';
  const category: ClinicalCheck['category'] = 'pre_existing';

  if (input.preExistingConditions.length === 0) {
    return buildCheck(name, 'skip', 'No pre-existing conditions listed', category);
  }

  if (input.primaryDiagnosis === null) {
    return buildCheck(name, 'skip', 'No primary diagnosis to compare', category);
  }

  const diagCode = normalizeCode(input.primaryDiagnosis.code);
  const diagDesc = lowered(input.primaryDiagnosis.description);

  for (const condition of input.preExistingConditions) {
    const condLower = condition.toLowerCase();

    // Check if the pre-existing condition text appears in the diagnosis description
    if (diagDesc.includes(condLower)) {
      return buildCheck(
        name,
        'warn',
        `Potential pre-existing condition "${condition}" matches primary diagnosis description -- subject to underwriting review`,
        category,
      );
    }

    // Check if condition text contains an ICD prefix that matches the diagnosis code
    const condNormalized = condLower.replace(/[.\s-]/g, '').toUpperCase();
    if (condNormalized.length >= 3 && diagCode.startsWith(condNormalized.slice(0, 3))) {
      return buildCheck(
        name,
        'warn',
        `Potential pre-existing condition "${condition}" -- diagnosis code prefix matches. Subject to underwriting review`,
        category,
      );
    }
  }

  return buildCheck(
    name,
    'pass',
    'No match between pre-existing conditions and current diagnosis',
    category,
  );
}

function checkClaimAmountReasonableness(
  input: ClinicalValidationInput,
): ClinicalCheck {
  const name = 'Claim Amount Reasonableness';
  const category: ClinicalCheck['category'] = 'necessity';

  if (input.claimAmount === null || input.claimAmount <= 0) {
    return buildCheck(name, 'skip', 'No claim amount provided', category);
  }

  if (input.claimAmount > CLAIM_AMOUNT_ABSOLUTE_FAIL) {
    return buildCheck(
      name,
      'fail',
      `Exceptionally high claim (USD ${input.claimAmount.toLocaleString()}) requires review`,
      category,
    );
  }

  if (treatmentTypeIs(input, 'outpatient') && input.claimAmount > CLAIM_AMOUNT_OUTPATIENT_WARN) {
    return buildCheck(
      name,
      'warn',
      `High value outpatient claim (USD ${input.claimAmount.toLocaleString()})`,
      category,
    );
  }

  if (treatmentTypeIs(input, 'inpatient') && input.claimAmount > CLAIM_AMOUNT_INPATIENT_WARN) {
    return buildCheck(
      name,
      'warn',
      `High value inpatient claim (USD ${input.claimAmount.toLocaleString()})`,
      category,
    );
  }

  return buildCheck(
    name,
    'pass',
    `Claim amount (USD ${input.claimAmount.toLocaleString()}) is within expected range`,
    category,
  );
}

// ─── Score Calculation ───────────────────────────────

function computeScore(checks: ReadonlyArray<ClinicalCheck>): number {
  const categoryChecks: Record<string, ReadonlyArray<ClinicalCheck>> = {};

  for (const check of checks) {
    const existing = categoryChecks[check.category] ?? [];
    categoryChecks[check.category] = [...existing, check];
  }

  let totalScore = 0;
  let totalWeight = 0;

  for (const [category, weight] of Object.entries(CATEGORY_WEIGHTS)) {
    const checksInCategory = categoryChecks[category] ?? [];
    const scoreable = checksInCategory.filter((c) => c.status !== 'skip');

    if (scoreable.length === 0) {
      // Category has no scoreable checks; do not penalise
      continue;
    }

    const categoryScore = scoreable.reduce((sum, c) => {
      switch (c.status) {
        case 'pass': return sum + 100;
        case 'warn': return sum + 50;
        case 'fail': return sum + 0;
        default: return sum;
      }
    }, 0) / scoreable.length;

    totalScore += categoryScore * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) {
    return 100;
  }

  return Math.round(totalScore / totalWeight);
}

function determineRecommendation(
  score: number,
): ClinicalValidationResult['recommendation'] {
  if (score >= SCORE_PROCEED_THRESHOLD) {
    return 'PROCEED';
  }
  if (score >= SCORE_REVIEW_THRESHOLD) {
    return 'REVIEW_RECOMMENDED';
  }
  return 'CLINICAL_REVIEW_REQUIRED';
}

// ─── Utility ─────────────────────────────────────────

function gatherDiagnosisCodes(input: ClinicalValidationInput): ReadonlyArray<string> {
  const codes: string[] = [];

  if (input.primaryDiagnosis !== null) {
    codes.push(input.primaryDiagnosis.code);
  }

  for (const diag of input.secondaryDiagnoses) {
    codes.push(diag.code);
  }

  return codes;
}

// ─── Service ─────────────────────────────────────────

export class ClinicalValidationService {
  /**
   * Run all clinical validation checks against the provided input and
   * return a comprehensive result with score and recommendation.
   *
   * This is a pure computation -- no database or network calls.
   */
  validate(input: ClinicalValidationInput): ClinicalValidationResult {
    logger.debug(
      {
        hasDiagnosis: input.primaryDiagnosis !== null,
        procedureCount: input.procedures.length,
        medicationCount: input.medications.length,
        treatmentType: input.treatmentType,
      },
      'Starting clinical validation',
    );

    const checks: ReadonlyArray<ClinicalCheck> = [
      checkDiagnosisProcedureConsistency(input),
      checkTreatmentNecessity(input),
      checkLengthOfStay(input),
      checkMedicationDiagnosisMatch(input),
      checkExperimentalTreatment(input),
      checkPreExistingConditions(input),
      checkClaimAmountReasonableness(input),
    ];

    const criticalIssues = checks.filter((c) => c.status === 'fail');
    const warnings = checks.filter((c) => c.status === 'warn');
    const score = computeScore(checks);
    const recommendation = determineRecommendation(score);
    const isValid = criticalIssues.length === 0;

    const result: ClinicalValidationResult = {
      isValid,
      score,
      checks,
      criticalIssues,
      warnings,
      recommendation,
    };

    logger.info(
      {
        isValid,
        score,
        recommendation,
        criticalCount: criticalIssues.length,
        warningCount: warnings.length,
      },
      'Clinical validation complete',
    );

    return result;
  }
}
