import { logger } from '../config/logger';

// ─── Constants ────────────────────────────────────

const FX_CACHE_KEY = 'fx:rates';
const FX_CACHE_TTL = 24 * 60 * 60; // 24 hours

// Fallback static rates: 1 USD = X target currency
export const STATIC_USD_RATES: Readonly<Record<string, number>> = {
  USD: 1.0,
  HKD: 7.82,
  GBP: 0.79,
  EUR: 0.92,
  JPY: 149.5,
  SGD: 1.35,
  THB: 36.0,
  AED: 3.67,
  CNY: 7.24,
  INR: 83.1,
  KES: 153.0,
};

// ─── Types ────────────────────────────────────────

export interface FxRateResult {
  readonly rate: number;
  readonly source: 'identity' | 'cache' | 'static' | 'fallback';
}

// ─── Core Rate Lookup (synchronous, pure) ─────────

/**
 * Get exchange rate between two currencies using static USD pivot rates.
 * Synchronous — no Redis needed. Use `getRateAsync` for cache-first lookup.
 */
export function getRate(from: string, to: string): FxRateResult {
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();

  if (fromUpper === toUpper) {
    return { rate: 1.0, source: 'identity' };
  }

  const fromRate = STATIC_USD_RATES[fromUpper];
  const toRate = STATIC_USD_RATES[toUpper];

  if (fromRate !== undefined && toRate !== undefined) {
    const rate = parseFloat((toRate / fromRate).toFixed(6));
    return { rate, source: 'static' };
  }

  logger.warn({ from: fromUpper, to: toUpper }, 'No FX rate available — using 1.0');
  return { rate: 1.0, source: 'fallback' };
}

// ─── Async Rate Lookup with Redis Cache ───────────

/**
 * Get exchange rate with Redis cache check.
 * Falls back to static rates if cache miss.
 * Requires redis import — only call from server context.
 */
export async function getRateAsync(from: string, to: string): Promise<FxRateResult> {
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();

  if (fromUpper === toUpper) {
    return { rate: 1.0, source: 'identity' };
  }

  try {
    const { redis } = await import('../config/redis');
    const cached = await redis.hget(FX_CACHE_KEY, `${fromUpper}:${toUpper}`);
    if (cached) {
      return { rate: parseFloat(cached), source: 'cache' };
    }
  } catch {
    // Redis unavailable — fall through to static
  }

  // Fallback to static rates
  const result = getRate(from, to);

  // Try to cache for next time
  try {
    const { redis } = await import('../config/redis');
    if (result.source === 'static') {
      await redis.hset(FX_CACHE_KEY, `${fromUpper}:${toUpper}`, result.rate.toFixed(6));
      await redis.expire(FX_CACHE_KEY, FX_CACHE_TTL);
    }
  } catch {
    // Cache write failure is non-critical
  }

  return result;
}

/**
 * Refresh rates from an external API.
 * Call from a scheduled job (daily).
 * Placeholder — replace with actual FX provider API.
 */
export async function refreshRates(): Promise<void> {
  try {
    // Example: Open Exchange Rates
    // const response = await fetch(`https://openexchangerates.org/api/latest.json?app_id=${apiKey}`);
    // const data = await response.json();
    // const { redis } = await import('../config/redis');
    // for (const [currency, rate] of Object.entries(data.rates)) {
    //   await redis.hset(FX_CACHE_KEY, `USD:${currency}`, String(rate));
    // }
    // await redis.expire(FX_CACHE_KEY, FX_CACHE_TTL);
    logger.info('FX rates refreshed (placeholder — implement API call)');
  } catch (err) {
    logger.error({ err }, 'Failed to refresh FX rates — using cached/static rates');
  }
}
