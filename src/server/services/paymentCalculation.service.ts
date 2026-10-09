import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export interface LineItemInput {
  readonly description: string;
  readonly amount: number;
  readonly isCovered: boolean;
  readonly benefitCategory: string;
  readonly denialReason?: string;
}

export interface PaymentCalculationInput {
  readonly claimAmount: number;
  readonly claimCurrency: string;
  readonly paymentCurrency: string;
  readonly treatmentDate: string;

  // Deductible
  readonly deductibleAmount: number;
  readonly deductibleUsed: number;
  readonly deductibleCurrency: string;

  // Co-insurance
  readonly coInsuranceRate: number | null;

  // Network penalty
  readonly isOutOfNetwork: boolean;
  readonly outOfNetworkPenaltyRate: number;

  // Benefit limits
  readonly benefitLimit: number | null;
  readonly benefitUsedThisYear: number;
  readonly benefitLimitCurrency: string;

  // Annual maximum
  readonly annualMaximum: number | null;
  readonly annualMaximumUsed: number;
  readonly annualMaximumCurrency: string;

  // Line items for itemised calculation
  readonly lineItems: ReadonlyArray<LineItemInput>;

  // Payment method
  readonly payeeType: string;
  readonly paymentMethod: string;
}

export interface LineItemResult {
  readonly description: string;
  readonly amountClaimed: number;
  readonly isCovered: boolean;
  readonly denialReason: string | null;
  readonly deductibleApplied: number;
  readonly coInsuranceApplied: number;
  readonly networkPenaltyApplied: number;
  readonly amountPayable: number;
}

export interface PaymentCalculationResult {
  readonly totalClaimed: number;
  readonly claimCurrency: string;

  // Deductions breakdown
  readonly deniedAmount: number;
  readonly deductibleApplied: number;
  readonly coInsuranceApplied: number;
  readonly networkPenaltyApplied: number;
  readonly benefitLimitExcess: number;
  readonly annualMaximumExcess: number;

  // Final amounts
  readonly totalDeductions: number;
  readonly totalPayable: number;
  readonly paymentCurrency: string;
  readonly fxRate: number | null;
  readonly totalPayableInPaymentCurrency: number;

  // Payee
  readonly payeeType: string;
  readonly paymentMethod: string;

  // Line item breakdown
  readonly lineItemResults: ReadonlyArray<LineItemResult>;

  // Explanation of Benefits summary
  readonly eobSummary: string;
}

export interface FxRate {
  readonly from: string;
  readonly to: string;
  readonly rate: number;
  readonly date: string;
}

// ─── Constants ─────────────────────────────────────

/**
 * Static FX rates expressed as 1 USD = X target currency.
 * Used for demo/approximation purposes only.
 */
const USD_RATES: Readonly<Record<string, number>> = {
  HKD: 7.80,
  GBP: 0.79,
  EUR: 0.92,
  JPY: 149.50,
  SGD: 1.34,
  THB: 35.20,
  AED: 3.67,
  CNY: 7.24,
  INR: 83.40,
  KES: 153.50,
  USD: 1.0,
};

const PAYEE_LABELS: Readonly<Record<string, string>> = {
  MEMBER: 'Member',
  HOSPITAL: 'Hospital',
  PRACTITIONER: 'Practitioner',
  GROUP: 'Group',
};

const PAYMENT_METHOD_LABELS: Readonly<Record<string, string>> = {
  BANK_TRANSFER: 'Bank Transfer',
  CHEQUE: 'Cheque',
};

// ─── Helpers (pure functions) ──────────────────────

/**
 * Round a monetary amount to 2 decimal places using
 * banker-safe rounding (avoids floating-point drift).
 */
function roundCurrency(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

/**
 * Format a monetary value for display (e.g. "47,091.00").
 */
function formatMoney(amount: number): string {
  return amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Return a static FX rate between two currencies.
 * Both legs are converted through USD as the pivot currency.
 *
 * If either currency is unknown the rate defaults to 1.0 and a
 * warning is logged.
 */
function getFxRate(from: string, to: string): FxRate {
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();

  if (fromUpper === toUpper) {
    return { from: fromUpper, to: toUpper, rate: 1.0, date: new Date().toISOString().slice(0, 10) };
  }

  const fromToUsd = USD_RATES[fromUpper];
  const toToUsd = USD_RATES[toUpper];

  if (fromToUsd === undefined) {
    logger.warn({ currency: fromUpper }, 'Unknown source currency for FX conversion — defaulting rate to 1.0');
    return { from: fromUpper, to: toUpper, rate: 1.0, date: new Date().toISOString().slice(0, 10) };
  }

  if (toToUsd === undefined) {
    logger.warn({ currency: toUpper }, 'Unknown target currency for FX conversion — defaulting rate to 1.0');
    return { from: fromUpper, to: toUpper, rate: 1.0, date: new Date().toISOString().slice(0, 10) };
  }

  // from → USD → to
  // If 1 USD = 7.80 HKD then 1 HKD = 1/7.80 USD
  // If 1 USD = 0.79 GBP then to convert HKD→GBP: amount / 7.80 * 0.79
  const rate = roundCurrency(toToUsd / fromToUsd * 1_000_000) / 1_000_000;

  return { from: fromUpper, to: toUpper, rate, date: new Date().toISOString().slice(0, 10) };
}

/**
 * Build a human-readable Explanation of Benefits block.
 */
function generateEobSummary(
  result: Omit<PaymentCalculationResult, 'eobSummary'>,
): string {
  const ccy = result.claimCurrency;
  const payeeName = PAYEE_LABELS[result.payeeType] ?? result.payeeType;
  const methodName = PAYMENT_METHOD_LABELS[result.paymentMethod] ?? result.paymentMethod;

  const coInsuranceLabel = 'Co-Insurance';
  const lines = [
    'EXPLANATION OF BENEFITS',
    '-----------------------',
    `Total Claimed: ${ccy} ${formatMoney(result.totalClaimed)}`,
    `Denied Items: ${ccy} ${formatMoney(result.deniedAmount)}`,
    `Deductible Applied: ${ccy} ${formatMoney(result.deductibleApplied)}`,
    `${coInsuranceLabel}: ${ccy} ${formatMoney(result.coInsuranceApplied)}`,
    `Network Penalty: ${ccy} ${formatMoney(result.networkPenaltyApplied)}`,
    `Benefit Limit Excess: ${ccy} ${formatMoney(result.benefitLimitExcess)}`,
    `Annual Maximum Excess: ${ccy} ${formatMoney(result.annualMaximumExcess)}`,
    '-----------------------',
    `Total Deductions: ${ccy} ${formatMoney(result.totalDeductions)}`,
    `Total Payable: ${ccy} ${formatMoney(result.totalPayable)}`,
  ];

  if (result.fxRate !== null) {
    lines.push(
      `FX Rate (${result.claimCurrency} → ${result.paymentCurrency}): ${result.fxRate}`,
      `Total Payable (${result.paymentCurrency}): ${result.paymentCurrency} ${formatMoney(result.totalPayableInPaymentCurrency)}`,
    );
  }

  lines.push(`Payment Method: ${methodName}`, `Payee: ${payeeName}`);

  return lines.join('\n');
}

// ─── Mutable accumulator used only inside calculate() ──

interface LineItemAccumulator {
  description: string;
  amountClaimed: number;
  isCovered: boolean;
  denialReason: string | null;
  deductibleApplied: number;
  coInsuranceApplied: number;
  networkPenaltyApplied: number;
  amountPayable: number;
}

// ─── Service ───────────────────────────────────────

export class PaymentCalculationService {
  // ── Public static helpers ────────────────────────

  static getFxRate(from: string, to: string): FxRate {
    return getFxRate(from, to);
  }

  static roundCurrency(amount: number): number {
    return roundCurrency(amount);
  }

  static generateEobSummary(
    result: Omit<PaymentCalculationResult, 'eobSummary'>,
  ): string {
    return generateEobSummary(result);
  }

  // ── Main calculation ─────────────────────────────

  calculate(input: PaymentCalculationInput): PaymentCalculationResult {
    const {
      claimCurrency,
      paymentCurrency,
      deductibleAmount,
      deductibleUsed,
      coInsuranceRate,
      isOutOfNetwork,
      outOfNetworkPenaltyRate,
      benefitLimit,
      benefitUsedThisYear,
      annualMaximum,
      annualMaximumUsed,
      lineItems,
      payeeType,
      paymentMethod,
    } = input;

    // ── Step 1: Separate covered vs denied ─────────

    let deniedAmount = 0;
    const accumulators: LineItemAccumulator[] = lineItems.map((item) => {
      if (!item.isCovered) {
        deniedAmount = roundCurrency(deniedAmount + item.amount);
        return {
          description: item.description,
          amountClaimed: item.amount,
          isCovered: false,
          denialReason: item.denialReason ?? 'Not covered under policy',
          deductibleApplied: 0,
          coInsuranceApplied: 0,
          networkPenaltyApplied: 0,
          amountPayable: 0,
        };
      }

      return {
        description: item.description,
        amountClaimed: item.amount,
        isCovered: true,
        denialReason: null,
        deductibleApplied: 0,
        coInsuranceApplied: 0,
        networkPenaltyApplied: 0,
        amountPayable: item.amount,
      };
    });

    // ── Step 2: Apply deductible to covered items ──

    let remainingDeductible = roundCurrency(
      Math.max(0, deductibleAmount - deductibleUsed),
    );
    let totalDeductibleApplied = 0;

    for (const acc of accumulators) {
      if (!acc.isCovered || remainingDeductible <= 0) continue;

      const deductibleForItem = roundCurrency(
        Math.min(acc.amountPayable, remainingDeductible),
      );
      acc.deductibleApplied = deductibleForItem;
      acc.amountPayable = roundCurrency(acc.amountPayable - deductibleForItem);
      remainingDeductible = roundCurrency(remainingDeductible - deductibleForItem);
      totalDeductibleApplied = roundCurrency(totalDeductibleApplied + deductibleForItem);
    }

    // ── Step 3: Apply co-insurance ─────────────────

    let totalCoInsuranceApplied = 0;

    if (coInsuranceRate !== null && coInsuranceRate > 0) {
      for (const acc of accumulators) {
        if (!acc.isCovered || acc.amountPayable <= 0) continue;

        const coInsuranceForItem = roundCurrency(acc.amountPayable * coInsuranceRate);
        acc.coInsuranceApplied = coInsuranceForItem;
        acc.amountPayable = roundCurrency(acc.amountPayable - coInsuranceForItem);
        totalCoInsuranceApplied = roundCurrency(totalCoInsuranceApplied + coInsuranceForItem);
      }
    }

    // ── Step 4: Apply network penalty ──────────────

    let totalNetworkPenaltyApplied = 0;

    if (isOutOfNetwork && outOfNetworkPenaltyRate > 0) {
      for (const acc of accumulators) {
        if (!acc.isCovered || acc.amountPayable <= 0) continue;

        const penaltyForItem = roundCurrency(acc.amountPayable * outOfNetworkPenaltyRate);
        acc.networkPenaltyApplied = penaltyForItem;
        acc.amountPayable = roundCurrency(acc.amountPayable - penaltyForItem);
        totalNetworkPenaltyApplied = roundCurrency(totalNetworkPenaltyApplied + penaltyForItem);
      }
    }

    // ── Step 5: Apply benefit limit cap ────────────

    let coveredPayableSum = accumulators.reduce(
      (sum, acc) => (acc.isCovered ? roundCurrency(sum + acc.amountPayable) : sum),
      0,
    );

    let benefitLimitExcess = 0;

    if (benefitLimit !== null) {
      const availableBenefit = roundCurrency(
        Math.max(0, benefitLimit - benefitUsedThisYear),
      );

      if (coveredPayableSum > availableBenefit) {
        benefitLimitExcess = roundCurrency(coveredPayableSum - availableBenefit);

        // Proportionally reduce each covered item
        if (coveredPayableSum > 0) {
          const reductionRatio = availableBenefit / coveredPayableSum;
          for (const acc of accumulators) {
            if (!acc.isCovered) continue;
            acc.amountPayable = roundCurrency(acc.amountPayable * reductionRatio);
          }
        }

        coveredPayableSum = availableBenefit;
      }
    }

    // ── Step 6: Apply annual maximum cap ───────────

    let annualMaximumExcess = 0;

    if (annualMaximum !== null) {
      const availableAnnual = roundCurrency(
        Math.max(0, annualMaximum - annualMaximumUsed),
      );

      if (coveredPayableSum > availableAnnual) {
        annualMaximumExcess = roundCurrency(coveredPayableSum - availableAnnual);

        // Proportionally reduce each covered item
        if (coveredPayableSum > 0) {
          const reductionRatio = availableAnnual / coveredPayableSum;
          for (const acc of accumulators) {
            if (!acc.isCovered) continue;
            acc.amountPayable = roundCurrency(acc.amountPayable * reductionRatio);
          }
        }

        coveredPayableSum = availableAnnual;
      }
    }

    // ── Step 7: Currency conversion ────────────────

    const totalPayable = roundCurrency(coveredPayableSum);
    let fxRateValue: number | null = null;
    let totalPayableInPaymentCurrency = totalPayable;

    if (claimCurrency.toUpperCase() !== paymentCurrency.toUpperCase()) {
      const fx = getFxRate(claimCurrency, paymentCurrency);
      fxRateValue = fx.rate;
      totalPayableInPaymentCurrency = roundCurrency(totalPayable * fx.rate);
    }

    // ── Freeze line-item results ───────────────────

    const lineItemResults: ReadonlyArray<LineItemResult> = accumulators.map(
      (acc) => ({
        description: acc.description,
        amountClaimed: acc.amountClaimed,
        isCovered: acc.isCovered,
        denialReason: acc.denialReason,
        deductibleApplied: acc.deductibleApplied,
        coInsuranceApplied: acc.coInsuranceApplied,
        networkPenaltyApplied: acc.networkPenaltyApplied,
        amountPayable: acc.amountPayable,
      }),
    );

    // ── Aggregate totals ───────────────────────────

    const totalClaimed = roundCurrency(
      lineItems.reduce((sum, item) => sum + item.amount, 0),
    );

    const totalDeductions = roundCurrency(
      deniedAmount +
      totalDeductibleApplied +
      totalCoInsuranceApplied +
      totalNetworkPenaltyApplied +
      benefitLimitExcess +
      annualMaximumExcess,
    );

    // ── Build partial result (without EOB) ─────────

    const partialResult: Omit<PaymentCalculationResult, 'eobSummary'> = {
      totalClaimed,
      claimCurrency,
      deniedAmount: roundCurrency(deniedAmount),
      deductibleApplied: roundCurrency(totalDeductibleApplied),
      coInsuranceApplied: roundCurrency(totalCoInsuranceApplied),
      networkPenaltyApplied: roundCurrency(totalNetworkPenaltyApplied),
      benefitLimitExcess: roundCurrency(benefitLimitExcess),
      annualMaximumExcess: roundCurrency(annualMaximumExcess),
      totalDeductions,
      totalPayable,
      paymentCurrency,
      fxRate: fxRateValue,
      totalPayableInPaymentCurrency,
      payeeType,
      paymentMethod,
      lineItemResults,
    };

    // ── Step 8: Generate EOB summary ───────────────

    const eobSummary = generateEobSummary(partialResult);

    return { ...partialResult, eobSummary };
  }
}
