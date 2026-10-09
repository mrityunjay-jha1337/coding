// Validation Service — validates structured claim data and ICD-10 codes
// Pure functions, no DB dependency

import type { StructuredClaimData } from './structuredDataExtractor';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ValidationCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn' | 'skip';
  message: string;
}

export interface ValidationResult {
  isValid: boolean;
  score: number; // 0-100
  checks: ValidationCheck[];
  criticalFailures: ValidationCheck[];
  warnings: ValidationCheck[];
}

export interface CodeInput {
  code: string;
  confidence: number;
  isValidated: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONFIDENCE_THRESHOLD = 60;
const MAX_REASONABLE_AMOUNT = 1_000_000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseDate(raw: string): Date | null {
  // Try DD/MM/YYYY or DD-MM-YYYY
  const ddmmyyyy = raw.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/);
  if (ddmmyyyy) {
    const [, day, month, year] = ddmmyyyy;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Try YYYY-MM-DD
  const yyyymmdd = raw.match(/^(\d{4})[/\-](\d{1,2})[/\-](\d{1,2})$/);
  if (yyyymmdd) {
    const [, year, month, day] = yyyymmdd;
    const d = new Date(Number(year), Number(month) - 1, Number(day));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Try Month DD, YYYY
  const monthDdYyyy = raw.match(
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),?\s+(\d{4})$/i
  );
  if (monthDdYyyy) {
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  return null;
}

function createCheck(
  name: string,
  status: 'pass' | 'fail' | 'warn' | 'skip',
  message: string
): ValidationCheck {
  return { name, status, message };
}

// ─── Class ───────────────────────────────────────────────────────────────────

export class ValidationService {
  /**
   * Validate a structured claim against business rules.
   * Pure function -- no side effects.
   */
  validateClaim(
    data: StructuredClaimData,
    codes: ReadonlyArray<CodeInput>
  ): ValidationResult {
    const checks: ValidationCheck[] = [
      this.checkMandatoryFields(data),
      this.checkDatesLogical(data),
      this.checkIcd10CodesValid(codes),
      this.checkCodesAboveThreshold(codes),
      this.checkFinancialAmountsValid(data),
      this.checkHasDiagnosis(data),
      this.checkDocumentHasContent(data),
    ];

    const criticalFailures = checks.filter((c) => c.status === 'fail');
    const warnings = checks.filter((c) => c.status === 'warn');
    const score = this.computeScore(checks);
    const isValid = criticalFailures.length === 0;

    return { isValid, score, checks, criticalFailures, warnings };
  }

  // ─── Individual checks ──────────────────────────────────────────────

  private checkMandatoryFields(data: StructuredClaimData): ValidationCheck {
    const hasName = data.claimant.name !== null && data.claimant.name.trim().length > 0;
    const hasDob =
      data.claimant.dateOfBirth !== null && data.claimant.dateOfBirth.trim().length > 0;

    if (hasName && hasDob) {
      return createCheck('mandatory_fields', 'pass', 'Name and DOB are present.');
    }

    const missing: string[] = [];
    if (!hasName) missing.push('name');
    if (!hasDob) missing.push('dateOfBirth');
    return createCheck(
      'mandatory_fields',
      'fail',
      `Missing mandatory fields: ${missing.join(', ')}.`
    );
  }

  private checkDatesLogical(data: StructuredClaimData): ValidationCheck {
    const admissionRaw = data.incident.date;
    const dischargeRaw = data.incident.dischargeDate;

    if (!admissionRaw || !dischargeRaw) {
      return createCheck(
        'dates_logical',
        'skip',
        'One or both dates not present; skipping date logic check.'
      );
    }

    const admission = parseDate(admissionRaw);
    const discharge = parseDate(dischargeRaw);

    if (!admission || !discharge) {
      return createCheck(
        'dates_logical',
        'warn',
        'Could not parse one or both dates for comparison.'
      );
    }

    if (admission.getTime() <= discharge.getTime()) {
      return createCheck(
        'dates_logical',
        'pass',
        'Admission date is on or before discharge date.'
      );
    }

    return createCheck(
      'dates_logical',
      'fail',
      'Admission date is after discharge date.'
    );
  }

  private checkIcd10CodesValid(codes: ReadonlyArray<CodeInput>): ValidationCheck {
    if (codes.length === 0) {
      return createCheck('icd10_codes_valid', 'skip', 'No ICD-10 codes to validate.');
    }

    const invalidCodes = codes.filter((c) => !c.isValidated);
    if (invalidCodes.length === 0) {
      return createCheck('icd10_codes_valid', 'pass', 'All ICD-10 codes are validated.');
    }

    return createCheck(
      'icd10_codes_valid',
      'warn',
      `${invalidCodes.length} code(s) are not validated: ${invalidCodes.map((c) => c.code).join(', ')}.`
    );
  }

  private checkCodesAboveThreshold(codes: ReadonlyArray<CodeInput>): ValidationCheck {
    if (codes.length === 0) {
      return createCheck(
        'codes_above_threshold',
        'skip',
        'No ICD-10 codes to check confidence.'
      );
    }

    const lowConfidence = codes.filter((c) => c.confidence < CONFIDENCE_THRESHOLD);
    if (lowConfidence.length === 0) {
      return createCheck(
        'codes_above_threshold',
        'pass',
        `All codes meet the ${CONFIDENCE_THRESHOLD}% confidence threshold.`
      );
    }

    return createCheck(
      'codes_above_threshold',
      'warn',
      `${lowConfidence.length} code(s) below ${CONFIDENCE_THRESHOLD}% confidence: ${lowConfidence.map((c) => `${c.code} (${c.confidence}%)`).join(', ')}.`
    );
  }

  private checkFinancialAmountsValid(data: StructuredClaimData): ValidationCheck {
    const total = data.financials.totalClaimed;

    if (total === null) {
      return createCheck(
        'financial_amounts_valid',
        'skip',
        'No total claimed amount present.'
      );
    }

    if (total <= 0) {
      return createCheck(
        'financial_amounts_valid',
        'warn',
        `Total claimed amount (${total}) is zero or negative.`
      );
    }

    if (total >= MAX_REASONABLE_AMOUNT) {
      return createCheck(
        'financial_amounts_valid',
        'warn',
        `Total claimed amount (${total}) exceeds reasonable threshold of ${MAX_REASONABLE_AMOUNT.toLocaleString()}.`
      );
    }

    return createCheck(
      'financial_amounts_valid',
      'pass',
      `Total claimed amount (${total}) is within reasonable range.`
    );
  }

  private checkHasDiagnosis(data: StructuredClaimData): ValidationCheck {
    const hasPrimary =
      data.treatment.primaryDiagnosis !== null &&
      data.treatment.primaryDiagnosis.trim().length > 0;

    if (hasPrimary) {
      return createCheck('has_diagnosis', 'pass', 'Primary diagnosis is present.');
    }

    return createCheck('has_diagnosis', 'fail', 'Primary diagnosis is missing.');
  }

  private checkDocumentHasContent(data: StructuredClaimData): ValidationCheck {
    // A document "has content" if at least some fields were extracted
    const hasAnyField =
      data.claimant.name !== null ||
      data.claimant.dateOfBirth !== null ||
      data.claimant.policyNumber !== null ||
      data.incident.date !== null ||
      data.treatment.primaryDiagnosis !== null ||
      data.treatment.procedures.length > 0 ||
      data.treatment.medications.length > 0 ||
      data.financials.totalClaimed !== null;

    if (hasAnyField) {
      return createCheck(
        'document_has_content',
        'pass',
        'Document contains extractable content.'
      );
    }

    return createCheck(
      'document_has_content',
      'fail',
      'Document contains no extractable structured content.'
    );
  }

  // ─── Score computation ──────────────────────────────────────────────

  private computeScore(checks: ValidationCheck[]): number {
    const scorable = checks.filter((c) => c.status !== 'skip');
    if (scorable.length === 0) return 0;

    const STATUS_SCORES: Readonly<Record<string, number>> = {
      pass: 100,
      warn: 50,
      fail: 0,
    };

    const total = scorable.reduce(
      (sum, check) => sum + (STATUS_SCORES[check.status] ?? 0),
      0
    );

    return Math.round(total / scorable.length);
  }
}
