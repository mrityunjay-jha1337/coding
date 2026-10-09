import { format, formatDistanceToNowStrict } from 'date-fns';

export function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

export function formatPercent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`;
}

/**
 * Format a claim/coding confidence value as a percentage string.
 *
 * Historically, `overallConfidence` has been written to the database in two
 * different scales depending on the code path (0–1 for some pipelines, 0–100
 * for others). This helper normalises both so the UI always displays a
 * meaningful percentage. Values <= 1 are treated as a 0–1 fraction and scaled
 * up; values > 1 are treated as an already-scaled 0–100 percentage.
 */
export function formatConfidence(
  value?: number | null,
  digits = 1,
  fallback = 'Pending',
): string {
  if (value == null || Number.isNaN(value)) return fallback;
  const pct = value <= 1 ? value * 100 : value;
  return `${pct.toFixed(digits)}%`;
}

export function formatDateTime(value?: string | Date | null) {
  if (!value) return 'Not available';
  return format(new Date(value), 'MMM d, yyyy HH:mm');
}

export function formatRelative(value?: string | Date | null) {
  if (!value) return 'Not available';
  return formatDistanceToNowStrict(new Date(value), { addSuffix: true });
}

export function formatDurationMs(value?: number | null) {
  if (!value) return '0m';
  const seconds = Math.round(value / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${remainingSeconds}s`;
}
