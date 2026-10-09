// ─── Types ─────────────────────────────────────────

export interface AdjudicationInput {
  readonly claimReference: string;
  readonly memberValidation: { readonly isValid: boolean; readonly member: unknown };
  readonly eligibility: {
    readonly isEligible: boolean;
    readonly isChecked: boolean;
    readonly preAuthRequired: boolean;
    readonly reason: string;
    readonly failedChecks?: readonly string[];
  };
  readonly providerValidation: {
    readonly isValid: boolean;
    readonly provider: unknown;
    readonly networkAnalysis: unknown;
  };
  readonly completeness: {
    readonly score: number;
    readonly isComplete: boolean;
    readonly canProcess: boolean;
    readonly criticalMissing: readonly unknown[];
  };
  readonly codingConfidence: number;
  readonly clinicalValidationScore: number;
  readonly coverageAnalysis: {
    readonly overallDecision: string;
    readonly totalClaimed: number;
    readonly totalPayable: number;
    readonly totalDenied: number;
    readonly exclusionsTriggered: readonly string[];
  };
  readonly isDuplicate: boolean;
  readonly isComplaint: boolean;
  readonly hasLegalCorrespondence: boolean;
  readonly claimAmount: number;
  readonly highValueThreshold: number;
}

export interface AdjudicationResult {
  readonly decision: 'APPROVED' | 'DENIED' | 'PARTIALLY_APPROVED' | 'HUMAN_REVIEW';
  readonly reason: string;
  readonly denialReasons: readonly string[];
  readonly payableAmount: number;
  readonly adjudicatedBy: 'SYSTEM' | 'PENDING_HUMAN';
  readonly requiresHumanReview: boolean;
  readonly humanReviewReason: string | null;
  readonly rulesFired: readonly string[];
}

// ─── Constants ─────────────────────────────────────

const COMPLETENESS_THRESHOLD = 60;
const CODING_CONFIDENCE_THRESHOLD = 70;
const CLINICAL_VALIDATION_THRESHOLD = 80;
const CODING_CONFIDENCE_HUMAN_REVIEW = 50;
const CLINICAL_VALIDATION_HUMAN_REVIEW = 65;
const COVERAGE_FULLY_COVERED = 'FULLY_COVERED';
const COVERAGE_PARTIALLY_COVERED = 'PARTIALLY_COVERED';

// Eligibility check names that, when failed, justify a hard auto-denial.
// Anything else (waiting period, pre-auth, unknown) is NOT grounds to deny —
// those are handled by `evaluateShouldHold()` upstream of adjudication.
const HARD_DENY_ELIGIBILITY_CHECKS: ReadonlySet<string> = new Set([
  'member_status',
  'policy_active_on_date',
  'geographic_coverage',
]);

// ─── Rule Evaluators ──────────────────────────────

interface RuleContext {
  readonly rulesFired: string[];
  readonly denialReasons: string[];
}

/**
 * Rule 1: Auto-Approve
 * Eligibility pass (or not checked) + completeness >= 90 + coding >= 85 + clinical >= 90
 * + coverage FULLY_COVERED + not duplicate + no exclusions triggered.
 *
 * When eligibility was never checked (e.g. member not found in DB), we do not
 * block auto-approval on that basis alone — the same asymmetry as Rule 2, which
 * only auto-denies when eligibility was explicitly checked *and* failed.
 */
function evaluateAutoApprove(input: AdjudicationInput): boolean {
  // Eligibility is a positive signal when checked & passed.
  // When not checked, we treat it as "unknown" (neither pass nor fail).
  const eligibilityOk = !input.eligibility.isChecked || input.eligibility.isEligible;
  return (
    eligibilityOk &&
    input.completeness.score >= COMPLETENESS_THRESHOLD &&
    input.codingConfidence >= CODING_CONFIDENCE_THRESHOLD &&
    input.clinicalValidationScore >= CLINICAL_VALIDATION_THRESHOLD &&
    input.coverageAnalysis.overallDecision === COVERAGE_FULLY_COVERED &&
    !input.isDuplicate &&
    input.coverageAnalysis.exclusionsTriggered.length === 0
  );
}

/**
 * Rule 2: Auto-Deny
 * Hard-deny only when the failure is genuinely terminal — lapsed policy,
 * out-of-period treatment date, or geographic exclusion. Recoverable
 * conditions (waiting period, pre-auth, member-not-found, skipped checks)
 * must NOT fall through this rule.
 */
function evaluateAutoDeny(
  input: AdjudicationInput,
  ctx: RuleContext,
): boolean {
  // Only consider eligibility-based denial if the check actually ran.
  // When eligibility was never checked (e.g. member not found in DB),
  // we route to human review instead of denying — "not checked" ≠ "failed".
  if (input.eligibility.isChecked && !input.eligibility.isEligible) {
    const failedChecks = input.eligibility.failedChecks ?? [];
    const hardDenyTriggers = failedChecks.filter((name) =>
      HARD_DENY_ELIGIBILITY_CHECKS.has(name),
    );

    if (hardDenyTriggers.length > 0) {
      ctx.denialReasons.push(
        `Eligibility check failed (${hardDenyTriggers.join(', ')}): ${input.eligibility.reason}`,
      );
      return true;
    }
    // Eligibility failed for a non-terminal reason (waiting period, pre-auth,
    // or something unclassified). Do not deny here — let the claim fall
    // through to the human-review fallback so the upstream hold path or a
    // reviewer can decide.
  }

  if (input.isDuplicate) {
    ctx.denialReasons.push('Claim is an exact duplicate of an existing claim');
    return true;
  }

  const allExcluded =
    input.coverageAnalysis.totalClaimed > 0 &&
    input.coverageAnalysis.totalDenied >= input.coverageAnalysis.totalClaimed;

  if (allExcluded) {
    const exclusionsList = input.coverageAnalysis.exclusionsTriggered.join(', ');
    ctx.denialReasons.push(
      `All claimed items are excluded from coverage: ${exclusionsList || 'policy exclusions apply'}`,
    );
    return true;
  }

  return false;
}

/**
 * Pre-adjudication gate: decide whether a claim should be held rather than
 * adjudicated. Returns a human-readable hold reason, or null if the claim
 * should proceed to adjudication.
 *
 * Call this from the upstream worker BEFORE invoking `adjudicate()` so
 * holdable claims (waiting period, pre-auth pending) never get routed
 * through the deny path.
 */
export function evaluateShouldHold(
  eligibility: AdjudicationInput['eligibility'],
): string | null {
  const failedChecks = eligibility.failedChecks ?? [];

  if (failedChecks.includes('waiting_period')) {
    return 'Waiting period not yet met for this treatment type';
  }

  // The eligibility engine flags pre-auth as a `warn` (not `fail`), so we
  // inspect the dedicated `preAuthRequired` flag rather than failedChecks.
  if (eligibility.preAuthRequired) {
    return 'Pre-authorization is required for this treatment and has not been obtained';
  }

  // Defensive: if `pre_auth_required` ever starts being emitted as a fail,
  // honour it here too.
  if (failedChecks.includes('pre_auth_required')) {
    return 'Pre-authorization is required for this treatment and has not been obtained';
  }

  return null;
}

/**
 * Rule 3: Partial Approve
 * Coverage PARTIALLY_COVERED + other baseline checks pass.
 *
 * Same eligibility treatment as Rule 1: "not checked" is not a blocker.
 */
function evaluatePartialApprove(input: AdjudicationInput): boolean {
  const eligibilityOk = !input.eligibility.isChecked || input.eligibility.isEligible;
  return (
    eligibilityOk &&
    input.coverageAnalysis.overallDecision === COVERAGE_PARTIALLY_COVERED &&
    input.completeness.score >= COMPLETENESS_THRESHOLD &&
    input.codingConfidence >= CODING_CONFIDENCE_THRESHOLD &&
    input.clinicalValidationScore >= CLINICAL_VALIDATION_THRESHOLD &&
    !input.isDuplicate
  );
}

/**
 * Rule 4: Human Review
 * High value OR clinical < 70 OR coding < 60 OR complaint OR legal.
 */
function evaluateHumanReview(input: AdjudicationInput): string | null {
  if (input.claimAmount > input.highValueThreshold) {
    return `High-value claim: amount ${input.claimAmount} exceeds threshold ${input.highValueThreshold}`;
  }

  if (input.clinicalValidationScore < CLINICAL_VALIDATION_HUMAN_REVIEW) {
    return `Clinical validation score ${input.clinicalValidationScore} is below minimum threshold of ${CLINICAL_VALIDATION_HUMAN_REVIEW}`;
  }

  if (input.codingConfidence < CODING_CONFIDENCE_HUMAN_REVIEW) {
    return `Coding confidence ${input.codingConfidence} is below minimum threshold of ${CODING_CONFIDENCE_HUMAN_REVIEW}`;
  }

  if (input.isComplaint) {
    return 'Claim is associated with a complaint and requires human review';
  }

  if (input.hasLegalCorrespondence) {
    return 'Claim has legal correspondence and requires human review';
  }

  return null;
}

// ─── Service ───────────────────────────────────────

export class AdjudicationService {
  /**
   * Evaluate a claim against the adjudication rules engine and return
   * an immutable decision result. Pure function with no side effects.
   */
  adjudicate(input: AdjudicationInput): AdjudicationResult {
    const ctx: RuleContext = {
      rulesFired: [],
      denialReasons: [],
    };

    // Rule 4 (Human Review) is checked first — it can override other decisions
    const humanReviewReason = evaluateHumanReview(input);
    if (humanReviewReason !== null) {
      ctx.rulesFired.push('RULE_4_HUMAN_REVIEW');

      return {
        decision: 'HUMAN_REVIEW',
        reason: humanReviewReason,
        denialReasons: [],
        payableAmount: 0,
        adjudicatedBy: 'PENDING_HUMAN',
        requiresHumanReview: true,
        humanReviewReason,
        rulesFired: [...ctx.rulesFired],
      };
    }

    // Rule 2 (Auto-Deny) — reject early if ineligible, duplicate, or fully excluded
    if (evaluateAutoDeny(input, ctx)) {
      ctx.rulesFired.push('RULE_2_AUTO_DENY');

      return {
        decision: 'DENIED',
        reason: ctx.denialReasons.join('; '),
        denialReasons: [...ctx.denialReasons],
        payableAmount: 0,
        adjudicatedBy: 'SYSTEM',
        requiresHumanReview: false,
        humanReviewReason: null,
        rulesFired: [...ctx.rulesFired],
      };
    }

    // Rule 1 (Auto-Approve) — all checks pass, full coverage
    if (evaluateAutoApprove(input)) {
      ctx.rulesFired.push('RULE_1_AUTO_APPROVE');

      return {
        decision: 'APPROVED',
        reason: 'All validation checks passed. Claim is fully covered.',
        denialReasons: [],
        payableAmount: input.coverageAnalysis.totalPayable,
        adjudicatedBy: 'SYSTEM',
        requiresHumanReview: false,
        humanReviewReason: null,
        rulesFired: [...ctx.rulesFired],
      };
    }

    // Rule 3 (Partial Approve) — some items covered, some excluded
    if (evaluatePartialApprove(input)) {
      ctx.rulesFired.push('RULE_3_PARTIAL_APPROVE');

      const exclusionNote =
        input.coverageAnalysis.exclusionsTriggered.length > 0
          ? ` Excluded items: ${input.coverageAnalysis.exclusionsTriggered.join(', ')}.`
          : '';

      return {
        decision: 'PARTIALLY_APPROVED',
        reason: `Claim partially covered. Payable: ${input.coverageAnalysis.totalPayable}, Denied: ${input.coverageAnalysis.totalDenied}.${exclusionNote}`,
        denialReasons: input.coverageAnalysis.exclusionsTriggered.map(
          (e) => `Excluded: ${e}`,
        ),
        payableAmount: input.coverageAnalysis.totalPayable,
        adjudicatedBy: 'SYSTEM',
        requiresHumanReview: false,
        humanReviewReason: null,
        rulesFired: [...ctx.rulesFired],
      };
    }

    // Fallback: no rule matched cleanly — route to human review
    ctx.rulesFired.push('RULE_FALLBACK_HUMAN_REVIEW');
    const fallbackReason = this.generateFallbackReason(input);

    return {
      decision: 'HUMAN_REVIEW',
      reason: fallbackReason,
      denialReasons: [],
      payableAmount: 0,
      adjudicatedBy: 'PENDING_HUMAN',
      requiresHumanReview: true,
      humanReviewReason: fallbackReason,
      rulesFired: [...ctx.rulesFired],
    };
  }

  private generateFallbackReason(input: AdjudicationInput): string {
    const reasons: string[] = [];

    if (input.completeness.score < COMPLETENESS_THRESHOLD) {
      reasons.push(`completeness score ${input.completeness.score}% is below ${COMPLETENESS_THRESHOLD}%`);
    }
    if (input.codingConfidence < CODING_CONFIDENCE_THRESHOLD) {
      reasons.push(`coding confidence ${input.codingConfidence.toFixed(1)}% is below ${CODING_CONFIDENCE_THRESHOLD}%`);
    }
    if (input.clinicalValidationScore < CLINICAL_VALIDATION_THRESHOLD) {
      reasons.push(`clinical score ${input.clinicalValidationScore}% is below ${CLINICAL_VALIDATION_THRESHOLD}%`);
    }
    if (
      input.coverageAnalysis.overallDecision !== COVERAGE_FULLY_COVERED &&
      input.coverageAnalysis.overallDecision !== COVERAGE_PARTIALLY_COVERED
    ) {
      reasons.push(`coverage decision is ${input.coverageAnalysis.overallDecision}`);
    }

    return reasons.length > 0
      ? `Manual review required: ${reasons.join('; ')}`
      : 'No adjudication rule matched conclusively. Manual review required.';
  }
}
