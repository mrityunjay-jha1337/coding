// ─── Types ─────────────────────────────────────────

export interface ClaimJsonInput {
  readonly claimReference: string;
  readonly member: unknown;
  readonly provider: unknown;
  readonly treatment: {
    readonly country: string;
    readonly admissionDate?: string;
    readonly dischargeDate?: string;
    readonly treatmentType: string;
    readonly primaryDiagnosis: unknown;
    readonly procedures: readonly unknown[];
    readonly medications: readonly unknown[];
  };
  readonly financials: {
    readonly currency: string;
    readonly totalClaimed: number;
    readonly deductibleApplied: number;
    readonly coInsuranceApplied: number;
    readonly networkPenalty: number;
    readonly totalPayable: number;
    readonly lineItems: readonly unknown[];
  };
  readonly payment: unknown;
  readonly decision: {
    readonly status: string;
    readonly reason: string;
    readonly adjudicatedBy: string;
    readonly adjudicatedAt: string;
    readonly humanReviewRequired: boolean;
  };
  readonly coding: {
    readonly icd10: readonly unknown[];
    readonly cpt: readonly unknown[];
  };
  readonly coverageAnalysis: unknown;
  readonly documents: readonly unknown[];
  readonly auditTrail: readonly unknown[];
}

// ─── Constants ─────────────────────────────────────

const OUTPUT_VERSION = '1.0';

// ─── Helpers ───────────────────────────────────────

/**
 * Build the full claim JSON structure as specified in the featureliste.md spec.
 */
function buildFullClaimJson(input: ClaimJsonInput): Record<string, unknown> {
  return {
    claimReference: input.claimReference,
    version: OUTPUT_VERSION,
    processedAt: new Date().toISOString(),

    member: input.member,

    provider: input.provider,

    treatment: {
      country: input.treatment.country,
      admissionDate: input.treatment.admissionDate ?? null,
      dischargeDate: input.treatment.dischargeDate ?? null,
      treatmentType: input.treatment.treatmentType,
      primaryDiagnosis: input.treatment.primaryDiagnosis,
      procedures: [...input.treatment.procedures],
      medications: [...input.treatment.medications],
    },

    financials: {
      currency: input.financials.currency,
      totalClaimed: input.financials.totalClaimed,
      deductibleApplied: input.financials.deductibleApplied,
      coInsuranceApplied: input.financials.coInsuranceApplied,
      outOfNetworkPenalty: input.financials.networkPenalty,
      totalPayable: input.financials.totalPayable,
      lineItems: [...input.financials.lineItems],
    },

    payment: input.payment,

    decision: {
      status: input.decision.status,
      reason: input.decision.reason,
      adjudicatedBy: input.decision.adjudicatedBy,
      adjudicatedAt: input.decision.adjudicatedAt,
      humanReviewRequired: input.decision.humanReviewRequired,
    },

    coding: {
      icd10: [...input.coding.icd10],
      cpt: [...input.coding.cpt],
    },

    coverageAnalysis: input.coverageAnalysis,

    documents: [...input.documents],

    auditTrail: [...input.auditTrail],
  };
}

/**
 * Build a compact summary suitable for list views.
 */
function buildClaimSummary(input: ClaimJsonInput): Record<string, unknown> {
  return {
    claimReference: input.claimReference,
    version: OUTPUT_VERSION,
    processedAt: new Date().toISOString(),

    decision: {
      status: input.decision.status,
      reason: input.decision.reason,
      adjudicatedBy: input.decision.adjudicatedBy,
      humanReviewRequired: input.decision.humanReviewRequired,
    },

    financials: {
      currency: input.financials.currency,
      totalClaimed: input.financials.totalClaimed,
      totalPayable: input.financials.totalPayable,
    },

    treatment: {
      country: input.treatment.country,
      treatmentType: input.treatment.treatmentType,
      primaryDiagnosis: input.treatment.primaryDiagnosis,
    },

    member: input.member,

    documentCount: input.documents.length,
    auditEventCount: input.auditTrail.length,
  };
}

// ─── Service ───────────────────────────────────────

export class ClaimJsonFormatterService {
  /**
   * Format a complete claim JSON output following the featureliste.md spec.
   * Includes all sections: claimReference, version, processedAt, member,
   * provider, treatment, financials, payment, decision, coding,
   * coverageAnalysis, documents, and auditTrail.
   *
   * Pure function — no database calls or side effects.
   */
  formatClaimJson(input: ClaimJsonInput): Record<string, unknown> {
    return buildFullClaimJson(input);
  }

  /**
   * Format a shorter summary version suitable for list views.
   * Contains key decision, financial, and treatment info without
   * full line items, audit trail, or document details.
   *
   * Pure function — no database calls or side effects.
   */
  formatClaimSummary(input: ClaimJsonInput): Record<string, unknown> {
    return buildClaimSummary(input);
  }
}
