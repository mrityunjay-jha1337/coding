import fs from 'fs';
import { getICD10DataPath } from './s3DataLoader';

interface CodeEntry {
  short: string;
  long: string;
}

let codeDatabase: Record<string, CodeEntry> | null = null;

function getDatabase(): Record<string, CodeEntry> {
  if (!codeDatabase) {
    const jsonPath = getICD10DataPath();
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    codeDatabase = JSON.parse(raw) as Record<string, CodeEntry>;
    const count = Object.keys(codeDatabase).length;
    console.log(`[ICD-10 Lookup] Loaded ${count} entries from ${jsonPath}`);
  }
  return codeDatabase;
}

/**
 * Normalize a code to the standard dotted format used in the database.
 * "K2900" → "K29.00", "k29.00" → "K29.00", "K29" → "K29"
 */
function toDottedFormat(code: string): string {
  let normalized = code.replace(/[.\s-]/g, '').toUpperCase().trim();
  // Insert dot after position 3 for codes with 4+ chars
  if (normalized.length >= 4) {
    normalized = normalized.slice(0, 3) + '.' + normalized.slice(3);
  }
  return normalized;
}

/**
 * Look up a code in the ICD-10 database.
 * Normalizes to dotted format and returns the entry, or null if not found.
 */
export function lookupICD10(code: string): { code: string; short: string; long: string } | null {
  const db = getDatabase();
  const dotted = toDottedFormat(code);

  if (db[dotted]) {
    return { code: dotted, ...db[dotted] };
  }

  // Try exact uppercase match as fallback (for 3-char category codes)
  const upper = code.toUpperCase().trim();
  if (db[upper]) {
    return { code: upper, ...db[upper] };
  }

  return null;
}

/**
 * Check if a code exists in the database.
 */
export function isValidICD10Code(code: string): boolean {
  return lookupICD10(code) !== null;
}

/**
 * Find closest codes in the same category (first 3 characters).
 */
export function findClosestCodes(code: string, limit: number = 5): Array<{ code: string; short: string }> {
  const db = getDatabase();
  const prefix = toDottedFormat(code).slice(0, 3);

  const matches: Array<{ code: string; short: string }> = [];
  for (const [key, entry] of Object.entries(db)) {
    if (key.startsWith(prefix) && key.includes('.')) {
      matches.push({ code: key, short: entry.short });
      if (matches.length >= limit) break;
    }
  }
  return matches;
}

/**
 * Get total number of codes in the database.
 */
export function getCodeCount(): number {
  return Object.keys(getDatabase()).length;
}
