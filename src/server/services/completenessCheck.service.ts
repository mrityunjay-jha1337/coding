// Completeness Check Service — validates Bupa Global claim form (STH) field presence
// Pure functions, no DB dependency

import {
  CATEGORY_WEIGHTS,
  FIELD_DEFINITIONS,
  INPATIENT_TREATMENT_TYPES,
  OPTICAL_PHARMACY_TREATMENT_TYPES,
  OPTIONAL_FIELD_DEFINITIONS,
} from './data/bupaClaimFieldDefinitions';
import type { FieldDefinition } from './data/bupaClaimFieldDefinitions';
import { BankValidationService } from './bankValidation.service';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BupaClaimFormData {
  /** Section 1: Patient Details */
  readonly patientDetails: {
    readonly membershipNumber: string | null;
    readonly groupName: string | null;
    readonly title: string | null;
    readonly firstName: string | null;
    readonly lastName: string | null;
    readonly dateOfBirth: string | null;
    readonly address: {
      readonly building: string | null;
      readonly street: string | null;
      readonly town: string | null;
      readonly areaCode: string | null;
      readonly region: string | null;
      readonly country: string | null;
    } | null;
    readonly email: string | null;
    readonly telephone: string | null;
  };
  /** Section 2: Claim / Medical Details */
  readonly medicalDetails: {
    readonly treatmentCountry: string | null;
    readonly invoiceCurrency: string | null;
    readonly totalClaimedAmount: number | null;
    readonly itemisedCharges: ReadonlyArray<{ description: string; amount: number }> | null;
    readonly reasonForTreatment: string | null;
    readonly treatmentType: string | null;
    readonly symptomStartDate: string | null;
    readonly treatmentDate: string | null;
    readonly treatmentDescription: string | null;
    readonly practitionerName: string | null;
    readonly practitionerSpecialty: string | null;
    readonly facilityName: string | null;
    readonly facilityAddress: string | null;
    readonly admissionDate: string | null;
    readonly dischargeDate: string | null;
    readonly surgeryDate: string | null;
    readonly hospitalName: string | null;
  };
  /** Section 3: Cash Benefit */
  readonly cashBenefit: {
    readonly applicable: boolean | null;
    readonly hospitalStayFrom: string | null;
    readonly hospitalStayTo: string | null;
    readonly hospitalStampVerified: boolean | null;
  };
  /** Section 4: Payment Details */
  readonly paymentDetails: {
    readonly payeeType: string | null;
    readonly bankName: string | null;
    readonly swiftCode: string | null;
    readonly accountNumber: string | null;
    readonly sortCode: string | null;
    readonly iban: string | null;
    readonly accountHolderName: string | null;
    readonly accountCurrency: string | null;
    readonly chequeCurrencyPreference: string | null;
  };
  /** Section 5: Third Party */
  readonly thirdParty: {
    readonly applicable: boolean | null;
    readonly name: string | null;
    readonly contact: string | null;
  };
  /** Section 6: Medical Report Consent */
  readonly consent: {
    readonly consentGiven: boolean | null;
    readonly reportViewPreference: string | null;
  };
  /** Section 8: Declaration */
  readonly declaration: {
    readonly signaturePresent: boolean | null;
    readonly signatureDate: string | null;
    readonly printName: string | null;
  };
}

export interface MissingField {
  readonly fieldPath: string;
  readonly fieldLabel: string;
  readonly section: string;
  readonly severity: 'critical' | 'important' | 'optional';
  readonly queryTarget: 'member' | 'provider' | 'either';
}

export interface ChecklistItem {
  readonly item: string;
  readonly satisfied: boolean;
  readonly details: string;
}

export interface CompletenessResult {
  readonly score: number;
  readonly isComplete: boolean;
  readonly canProcess: boolean;
  readonly missingFields: readonly MissingField[];
  readonly criticalMissing: readonly MissingField[];
  readonly warningFields: readonly MissingField[];
  readonly checklistStatus: readonly ChecklistItem[];
  readonly recommendation: 'PROCEED' | 'PROCEED_WITH_WARNINGS' | 'QUERY_REQUIRED' | 'HUMAN_REVIEW';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const COMPLETE_THRESHOLD = 80;
const PROCESSABLE_THRESHOLD = 60;
const HUMAN_REVIEW_THRESHOLD = 45;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isFieldPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return true;
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

function getNestedValue(
  data: BupaClaimFormData,
  path: string,
): unknown {
  const parts = path.split('.');
  let current: unknown = data;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return null;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function buildMissingField(def: FieldDefinition): MissingField {
  return {
    fieldPath: def.path,
    fieldLabel: def.label,
    section: def.section,
    severity: def.severity,
    queryTarget: def.queryTarget,
  };
}

function hasBankIdentifier(data: BupaClaimFormData): boolean {
  const { swiftCode, iban } = data.paymentDetails;
  return isFieldPopulated(swiftCode) || isFieldPopulated(iban);
}

function isInpatientOrSurgical(data: BupaClaimFormData): boolean {
  const treatmentType = data.medicalDetails.treatmentType;
  if (!treatmentType) return false;
  const normalised = treatmentType.toLowerCase().trim();
  return INPATIENT_TREATMENT_TYPES.some((t) => normalised.includes(t));
}

function isOpticalOrPharmacy(data: BupaClaimFormData): boolean {
  const treatmentType = data.medicalDetails.treatmentType;
  if (!treatmentType) return false;
  const normalised = treatmentType.toLowerCase().trim();
  return OPTICAL_PHARMACY_TREATMENT_TYPES.some((t) => normalised.includes(t));
}

function isPolicyholderOrGroupPaid(data: BupaClaimFormData): boolean {
  const payee = data.paymentDetails.payeeType;
  if (!payee) return false;
  const normalised = payee.toUpperCase().trim();
  return normalised === 'PATIENT' || normalised === 'GROUP';
}

function computeCategoryScores(
  data: BupaClaimFormData,
): Readonly<Record<string, { populated: number; total: number }>> {
  const scores: Record<string, { populated: number; total: number }> = {};

  for (const def of FIELD_DEFINITIONS) {
    if (!scores[def.category]) {
      scores[def.category] = { populated: 0, total: 0 };
    }
    scores[def.category].total += 1;
    if (isFieldPopulated(getNestedValue(data, def.path))) {
      scores[def.category].populated += 1;
    }
  }

  return scores;
}

function determineRecommendation(
  score: number,
  criticalCount: number,
): 'PROCEED' | 'PROCEED_WITH_WARNINGS' | 'QUERY_REQUIRED' | 'HUMAN_REVIEW' {
  if (criticalCount > 0) {
    return 'QUERY_REQUIRED';
  }
  if (score >= COMPLETE_THRESHOLD) {
    return 'PROCEED';
  }
  if (score >= PROCESSABLE_THRESHOLD) {
    return 'PROCEED_WITH_WARNINGS';
  }
  if (score >= HUMAN_REVIEW_THRESHOLD) {
    return 'QUERY_REQUIRED';
  }
  return 'HUMAN_REVIEW';
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class CompletenessCheckService {
  /**
   * Evaluate overall completeness of a Bupa Global claim form.
   *
   * The score is computed by weighting six field categories, each contributing
   * a fixed percentage of the total score.  Missing fields are classified by
   * severity so downstream logic can decide whether to auto-query or escalate.
   */
  private readonly bankValidator = new BankValidationService();

  checkCompleteness(data: BupaClaimFormData): CompletenessResult {
    const missingFields = [...this.identifyMissingFields(data)];
    const checklistStatus = this.verifyChecklist(data);

    // Bank format validation — if bank details are present, validate format
    if (data.paymentDetails.iban || data.paymentDetails.swiftCode || data.paymentDetails.sortCode) {
      const bankResult = this.bankValidator.validate({
        iban: data.paymentDetails.iban,
        swiftCode: data.paymentDetails.swiftCode,
        sortCode: data.paymentDetails.sortCode,
        accountNumber: data.paymentDetails.accountNumber,
      });

      for (const error of bankResult.errors) {
        missingFields.push({
          fieldPath: 'paymentDetails.bankValidation',
          fieldLabel: error,
          section: 'paymentDetails',
          severity: 'critical',
          queryTarget: 'member',
        });
      }

      for (const warning of bankResult.warnings) {
        missingFields.push({
          fieldPath: 'paymentDetails.bankValidation',
          fieldLabel: warning,
          section: 'paymentDetails',
          severity: 'important',
          queryTarget: 'member',
        });
      }
    }

    const categoryScores = computeCategoryScores(data);
    const score = this.computeWeightedScore(categoryScores);

    const criticalMissing = missingFields.filter((f) => f.severity === 'critical');
    const warningFields = missingFields.filter((f) => f.severity === 'important');

    const recommendation = determineRecommendation(score, criticalMissing.length);

    return {
      score,
      isComplete: score >= COMPLETE_THRESHOLD,
      canProcess: score >= PROCESSABLE_THRESHOLD,
      missingFields,
      criticalMissing,
      warningFields,
      checklistStatus,
      recommendation,
    };
  }

  /**
   * Verify the 8-item Bupa claim checklist.
   *
   * Each item maps to a requirement from the Bupa Global Claim Form (STH).
   * Returns a readonly array -- callers must not mutate the result.
   */
  verifyChecklist(data: BupaClaimFormData): readonly ChecklistItem[] {
    return [
      this.checkLegibility(),
      this.checkSymptomsAndDiagnosis(data),
      this.checkPrescription(data),
      this.checkItemisedInvoice(data),
      this.checkDischargeReport(data),
      this.checkPaymentInstructions(data),
      this.checkProofOfPayment(data),
      this.checkSignature(data),
    ];
  }

  /**
   * Separate missing fields by query target so downstream logic can generate
   * the appropriate correspondence to the member or provider.
   */
  generateMissingInfoQuery(
    missingFields: readonly MissingField[],
  ): {
    readonly memberQuery: readonly MissingField[];
    readonly providerQuery: readonly MissingField[];
  } {
    const memberQuery: MissingField[] = [];
    const providerQuery: MissingField[] = [];

    for (const field of missingFields) {
      switch (field.queryTarget) {
        case 'member':
          if (field.severity !== 'optional') {
            memberQuery.push(field);
          }
          break;
        case 'provider':
          // Provider only gets important or critical fields to avoid cluttering requests
          if (field.severity === 'important' || field.severity === 'critical') {
            providerQuery.push(field);
          }
          break;
        case 'either':
          // For 'either', we push to member by default, but still only if not optional.
          // Provider only gets it if it's important or critical.
          if (field.severity !== 'optional') {
            memberQuery.push(field);
          }
          if (field.severity === 'important' || field.severity === 'critical') {
            providerQuery.push(field);
          }
          break;
      }
    }

    return { memberQuery, providerQuery };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private computeWeightedScore(
    categoryScores: Readonly<Record<string, { populated: number; total: number }>>,
  ): number {
    let totalScore = 0;

    for (const [category, weight] of Object.entries(CATEGORY_WEIGHTS)) {
      const entry = categoryScores[category];
      if (!entry || entry.total === 0) {
        // Category has no fields -- award full weight so score is not penalised
        // for categories that genuinely have no applicable fields.
        totalScore += weight;
        continue;
      }
      const ratio = entry.populated / entry.total;
      totalScore += ratio * weight;
    }

    return Math.round(totalScore);
  }

  private identifyMissingFields(data: BupaClaimFormData): readonly MissingField[] {
    const missing: MissingField[] = [];

    // Scored fields
    for (const def of FIELD_DEFINITIONS) {
      if (!isFieldPopulated(getNestedValue(data, def.path))) {
        missing.push(buildMissingField(def));
      }
    }

    // Bank identifier -- SWIFT or IBAN must be present
    if (!hasBankIdentifier(data)) {
      missing.push({
        fieldPath: 'paymentDetails.swiftCode / paymentDetails.iban',
        fieldLabel: 'SWIFT Code or IBAN',
        section: 'Payment Details',
        severity: 'important',
        queryTarget: 'member',
      });
    }

    // Optional fields -- reported but do not affect score
    for (const def of OPTIONAL_FIELD_DEFINITIONS) {
      if (!isFieldPopulated(getNestedValue(data, def.path))) {
        missing.push(buildMissingField(def));
      }
    }

    return missing;
  }

  // ─── Checklist items ──────────────────────────────────────────────────────

  /**
   * Item 1: Clear, readable documents.
   * At this stage legibility has already been verified by the ingestion
   * pipeline, so we always mark this satisfied.
   */
  private checkLegibility(): ChecklistItem {
    return {
      item: 'Clear, readable documents',
      satisfied: true,
      details: 'Legibility verified during document ingestion.',
    };
  }

  /**
   * Item 2: Symptoms/diagnosis with start date.
   */
  private checkSymptomsAndDiagnosis(data: BupaClaimFormData): ChecklistItem {
    const hasReason = isFieldPopulated(data.medicalDetails.reasonForTreatment);
    const hasStartDate = isFieldPopulated(data.medicalDetails.symptomStartDate);
    const satisfied = hasReason && hasStartDate;

    const detailParts: string[] = [];
    if (!hasReason) detailParts.push('reason for treatment missing');
    if (!hasStartDate) detailParts.push('symptom start date missing');

    return {
      item: 'Symptoms/diagnosis with start date',
      satisfied,
      details: satisfied
        ? 'Reason for treatment and symptom start date present.'
        : `Incomplete: ${detailParts.join('; ')}.`,
    };
  }

  /**
   * Item 3: Prescription for pharmacy/optical claims.
   * Only relevant when treatment type indicates pharmacy or optical.
   */
  private checkPrescription(data: BupaClaimFormData): ChecklistItem {
    if (!isOpticalOrPharmacy(data)) {
      return {
        item: 'Prescription for pharmacy/optical claims',
        satisfied: true,
        details: 'Not applicable for this treatment type.',
      };
    }

    // A treatment description is used as a proxy for a prescription reference,
    // since the claim form itself does not have a dedicated prescription field.
    const hasDescription = isFieldPopulated(data.medicalDetails.treatmentDescription);
    return {
      item: 'Prescription for pharmacy/optical claims',
      satisfied: hasDescription,
      details: hasDescription
        ? 'Treatment description present (proxy for prescription reference).'
        : 'Treatment description missing; prescription reference may be needed.',
    };
  }

  /**
   * Item 4: Final itemised invoice.
   * We treat totalClaimedAmount + invoiceCurrency as a proxy for an itemised
   * invoice being present, since the actual attachment is verified elsewhere.
   */
  private checkItemisedInvoice(data: BupaClaimFormData): ChecklistItem {
    const hasAmount = isFieldPopulated(data.medicalDetails.totalClaimedAmount);
    const hasCurrency = isFieldPopulated(data.medicalDetails.invoiceCurrency);
    const satisfied = hasAmount && hasCurrency;

    const detailParts: string[] = [];
    if (!hasAmount) detailParts.push('total claimed amount missing');
    if (!hasCurrency) detailParts.push('invoice currency missing');

    return {
      item: 'Final itemised invoice',
      satisfied,
      details: satisfied
        ? 'Total claimed amount and invoice currency present.'
        : `Incomplete: ${detailParts.join('; ')}.`,
    };
  }

  /**
   * Item 5: Medical discharge report (inpatient/surgical only).
   */
  private checkDischargeReport(data: BupaClaimFormData): ChecklistItem {
    if (!isInpatientOrSurgical(data)) {
      return {
        item: 'Medical discharge report (inpatient/surgical)',
        satisfied: true,
        details: 'Not applicable for this treatment type.',
      };
    }

    const hasDischargeDate = isFieldPopulated(data.medicalDetails.dischargeDate);
    const hasAdmissionDate = isFieldPopulated(data.medicalDetails.admissionDate);
    const satisfied = hasDischargeDate && hasAdmissionDate;

    const detailParts: string[] = [];
    if (!hasAdmissionDate) detailParts.push('admission date missing');
    if (!hasDischargeDate) detailParts.push('discharge date missing');

    return {
      item: 'Medical discharge report (inpatient/surgical)',
      satisfied,
      details: satisfied
        ? 'Admission and discharge dates present.'
        : `Incomplete: ${detailParts.join('; ')}.`,
    };
  }

  /**
   * Item 6: Complete payment instructions.
   */
  private checkPaymentInstructions(data: BupaClaimFormData): ChecklistItem {
    const hasPayee = isFieldPopulated(data.paymentDetails.payeeType);
    const hasBankId = hasBankIdentifier(data);
    const hasAccountHolder = isFieldPopulated(data.paymentDetails.accountHolderName);
    const satisfied = hasPayee && hasBankId && hasAccountHolder;

    const detailParts: string[] = [];
    if (!hasPayee) detailParts.push('payee type missing');
    if (!hasBankId) detailParts.push('SWIFT code or IBAN missing');
    if (!hasAccountHolder) detailParts.push('account holder name missing');

    return {
      item: 'Complete payment instructions',
      satisfied,
      details: satisfied
        ? 'Payee type, bank identifier, and account holder name present.'
        : `Incomplete: ${detailParts.join('; ')}.`,
    };
  }

  /**
   * Item 7: Proof of payment (for policyholder/group-paid claims).
   * Only relevant when the payee type is PATIENT or GROUP.  At this stage we
   * only verify the payee type is present -- the actual receipt attachment is
   * validated elsewhere in the pipeline.
   */
  private checkProofOfPayment(data: BupaClaimFormData): ChecklistItem {
    if (!isPolicyholderOrGroupPaid(data)) {
      return {
        item: 'Proof of payment (policyholder/group paid)',
        satisfied: true,
        details: 'Not applicable; payment is not to policyholder or group.',
      };
    }

    // We accept the presence of financial data as a proxy -- the actual
    // receipt/proof attachment is checked by the document pipeline.
    const hasAmount = isFieldPopulated(data.medicalDetails.totalClaimedAmount);
    return {
      item: 'Proof of payment (policyholder/group paid)',
      satisfied: hasAmount,
      details: hasAmount
        ? 'Total claimed amount present; proof-of-payment attachment validated separately.'
        : 'Total claimed amount missing; proof of payment may not be verifiable.',
    };
  }

  /**
   * Item 8: Signature with name and date.
   */
  private checkSignature(data: BupaClaimFormData): ChecklistItem {
    const hasSig = data.declaration.signaturePresent === true;
    const hasDate = isFieldPopulated(data.declaration.signatureDate);
    const hasName = isFieldPopulated(data.declaration.printName);
    const satisfied = hasSig && hasDate && hasName;

    const detailParts: string[] = [];
    if (!hasSig) detailParts.push('signature not detected');
    if (!hasDate) detailParts.push('signature date missing');
    if (!hasName) detailParts.push('print name missing');

    return {
      item: 'Signature with name and date',
      satisfied,
      details: satisfied
        ? 'Signature, date, and print name present.'
        : `Incomplete: ${detailParts.join('; ')}.`,
    };
  }
}
