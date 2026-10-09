// Structured Data Extractor — extracts structured claim data from clinical/billing text
// Pure functions, no DB dependency

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ItemisedCharge {
  description: string;
  amount: number;
}

export interface StructuredClaimData {
  claimant: {
    name: string | null;
    dateOfBirth: string | null;
    policyNumber: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
  };
  incident: {
    date: string | null;
    dischargeDate: string | null;
    location: string | null;
    physician: string | null;
    reason: string | null;
  };
  treatment: {
    primaryDiagnosis: string | null;
    secondaryDiagnoses: string[];
    procedures: string[];
    medications: string[];
  };
  financials: {
    totalClaimed: number | null;
    currency: string | null;
    itemisedCharges: ItemisedCharge[];
  };
  completeness: number;
  missingCriticalFields: string[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CRITICAL_FIELDS = [
  'claimant.name',
  'claimant.dateOfBirth',
  'claimant.policyNumber',
  'incident.date',
  'treatment.primaryDiagnosis',
] as const;

const WEIGHTED_FIELDS: ReadonlyArray<{ path: string; weight: number }> = [
  { path: 'claimant.name', weight: 3 },
  { path: 'claimant.dateOfBirth', weight: 3 },
  { path: 'claimant.policyNumber', weight: 3 },
  { path: 'claimant.contactEmail', weight: 1 },
  { path: 'claimant.contactPhone', weight: 1 },
  { path: 'incident.date', weight: 3 },
  { path: 'incident.dischargeDate', weight: 1 },
  { path: 'incident.location', weight: 1 },
  { path: 'incident.physician', weight: 1 },
  { path: 'incident.reason', weight: 1 },
  { path: 'treatment.primaryDiagnosis', weight: 3 },
  { path: 'treatment.secondaryDiagnoses', weight: 1 },
  { path: 'treatment.procedures', weight: 1 },
  { path: 'treatment.medications', weight: 1 },
  { path: 'financials.totalClaimed', weight: 2 },
  { path: 'financials.currency', weight: 1 },
  { path: 'financials.itemisedCharges', weight: 1 },
] as const;

// ─── Regex patterns ──────────────────────────────────────────────────────────

const PATTERNS = {
  // Match common name labels (Patient/Patient Name/Claimant/Insured/Subscriber/
  // Member/Full Name) followed by ':' and capture until end-of-line OR the next
  // labelled field on the same line (e.g. " DOB:", " Policy:") so we don't
  // accidentally swallow trailing fields.
  name: /(?:Patient(?:\s+Name)?|Claimant(?:\s+Name)?|Insured(?:\s+Name)?|Subscriber(?:\s+Name)?|Member(?:\s+Name)?|Full\s+Name|Name)\s*[:\-]\s*([^\n\r]+?)(?=\s{2,}[A-Z][\w\s]{0,20}:|\s*(?:DOB|Date\s+of\s+Birth|Policy|Membership|Email|Phone|Tel)\b|$)/i,
  dob: /(?:DOB|Date\s+of\s+Birth|Born)\s*:\s*(.+)/i,
  policyNumber: /(?:Policy(?:\s+No(?:\.)?|\s+Number)?)\s*:\s*([A-Za-z0-9\-]+)/i,
  email: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/,
  phone: /(?:\+?\d{1,3}[\s\-]?)?(?:\(?\d{2,4}\)?[\s\-]?)?\d{3,4}[\s\-]?\d{3,4}/,
  incidentDate: /(?:Date\s+of\s+Admission|Admission\s+Date|Incident\s+Date|Date\s+of\s+Incident)\s*[:\s]\s*(.+)/i,
  dischargeDate: /(?:Date\s+of\s+Discharge|Discharge\s+Date|Discharged)\s*:\s*(.+)/i,
  location: /(?:Hospital|Facility|Location|Clinic)\s*:\s*(.+)/i,
  physician: /(?:Physician|Doctor|Dr\.?|Attending|Consultant)\s*:\s*(.+)/i,
  reason: /(?:Reason\s+for\s+(?:Admission|Visit)|Chief\s+Complaint|Presenting\s+Complaint)\s*:\s*(.+)/i,
  diagnosis: /(?:Diagnosis|Dx|Assessment|Primary\s+Diagnosis)\s*:\s*(.+)/i,
  secondaryDiagnosis: /(?:Secondary\s+Diagnos[ie]s|Other\s+Diagnos[ie]s|Additional\s+Diagnos[ie]s)\s*:\s*(.+)/i,
  procedure: /(?:Procedure|Operation|Surgery|Intervention)\s*:\s*(.+)/i,
  medication: /(?:Medications?|Rx|Prescribed|Drugs?)\s*:\s*(.+)/i,
  amount: /(?:[£$€¥]|HKD|USD|GBP|EUR|JPY)\s*([\d,]+(?:\.\d{1,2})?)/,
  totalClaimed: /(?:Total(?:\s+Claimed|\s+Amount|\s+Charge)?|Grand\s+Total|Amount\s+Due|TOTAL[\s:]+PAYABLE)\s*[:\s]*\s*(?:([£$€¥])|(HKD|USD|GBP|EUR|JPY|CHF))\s*([\d,]+(?:\.\d{1,2})?)/i,
  dateFormats: /(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}|\d{4}[/\-]\d{1,2}[/\-]\d{1,2}|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{1,2},?\s+\d{4})/i,
} as const;

const CURRENCY_MAP: Readonly<Record<string, string>> = {
  '£': 'GBP',
  '$': 'USD',
  '€': 'EUR',
  '¥': 'JPY',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractMatch(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  if (!match || !match[1]) return null;
  return match[1].trim();
}

function extractAllMatches(text: string, pattern: RegExp): string[] {
  const results: string[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(pattern);
    if (match && match[1]) {
      const items = match[1]
        .split(/[,;]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0);
      results.push(...items);
    }
  }
  return results;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/,/g, '');
  const value = parseFloat(cleaned);
  return Number.isFinite(value) ? value : null;
}

function extractCurrencyAndAmount(
  text: string
): { currency: string | null; amount: number | null } {
  const totalMatch = text.match(PATTERNS.totalClaimed);
  if (totalMatch) {
    const symbol = totalMatch[1] || null;
    const isoCode = totalMatch[2] || null;
    const amount = parseAmount(totalMatch[3]);
    return {
      currency: isoCode ?? (symbol ? (CURRENCY_MAP[symbol] ?? symbol) : null),
      amount,
    };
  }
  return { currency: null, amount: null };
}

function extractItemisedCharges(text: string): ItemisedCharge[] {
  const charges: ItemisedCharge[] = [];
  const lines = text.split('\n');
  for (const line of lines) {
    const match = line.match(/(.+?)\s+([£$€¥])\s*([\d,]+(?:\.\d{1,2})?)/);
    if (match) {
      const description = match[1].trim();
      const amount = parseAmount(match[3]);
      // Skip lines that look like headers or totals
      if (
        amount !== null &&
        !/total|grand|amount\s+due/i.test(description)
      ) {
        charges.push({ description, amount });
      }
    }
  }
  return charges;
}

function detectCurrencyFromText(text: string): string | null {
  const symbolMatch = text.match(/[£$€¥]/);
  if (symbolMatch) return CURRENCY_MAP[symbolMatch[0]] ?? symbolMatch[0];
  
  const isoMatch = text.match(/\b(HKD|USD|GBP|EUR|JPY|CHF)\b/i);
  if (isoMatch) return isoMatch[1].toUpperCase();

  return null;
}

function isFieldPopulated(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (typeof value === 'number') return true;
  if (Array.isArray(value)) return value.length > 0;
  return false;
}

function getNestedValue(
  data: StructuredClaimData,
  path: string
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

// ─── Class ───────────────────────────────────────────────────────────────────

export class StructuredDataExtractor {
  /**
   * Extract structured claim data from clinical/billing text.
   * Pure function -- no side effects, no DB access.
   */
  extractStructuredData(text: string): StructuredClaimData {
    const name = extractMatch(text, PATTERNS.name);
    const dateOfBirth = extractMatch(text, PATTERNS.dob);
    const policyNumber = extractMatch(text, PATTERNS.policyNumber);
    const emailMatch = text.match(PATTERNS.email);
    const contactEmail = emailMatch ? emailMatch[0] : null;
    const phoneMatch = text.match(PATTERNS.phone);
    const contactPhone = phoneMatch ? phoneMatch[0] : null;

    const incidentDate = extractMatch(text, PATTERNS.incidentDate);
    const dischargeDate = extractMatch(text, PATTERNS.dischargeDate);
    const location = extractMatch(text, PATTERNS.location);
    const physician = extractMatch(text, PATTERNS.physician);
    const reason = extractMatch(text, PATTERNS.reason);

    const primaryDiagnosis = extractMatch(text, PATTERNS.diagnosis);
    const secondaryDiagnoses = extractAllMatches(text, PATTERNS.secondaryDiagnosis);
    const procedures = extractAllMatches(text, PATTERNS.procedure);
    const medications = extractAllMatches(text, PATTERNS.medication);

    const { currency: totalCurrency, amount: totalClaimed } =
      extractCurrencyAndAmount(text);
    const itemisedCharges = extractItemisedCharges(text);
    const currency = totalCurrency ?? detectCurrencyFromText(text);

    const data: StructuredClaimData = {
      claimant: {
        name,
        dateOfBirth,
        policyNumber,
        contactEmail,
        contactPhone,
      },
      incident: {
        date: incidentDate,
        dischargeDate,
        location,
        physician,
        reason,
      },
      treatment: {
        primaryDiagnosis,
        secondaryDiagnoses,
        procedures,
        medications,
      },
      financials: {
        totalClaimed,
        currency,
        itemisedCharges,
      },
      completeness: 0,
      missingCriticalFields: [],
    };

    return {
      ...data,
      completeness: this.computeCompleteness(data),
      missingCriticalFields: this.getMissingCriticalFields(data),
    };
  }

  /**
   * Compute a 0-100 completeness score based on populated fields.
   * Critical fields (name, DOB, policy#, diagnosis, dates) are weighted higher.
   */
  computeCompleteness(data: StructuredClaimData): number {
    let earnedWeight = 0;
    let totalWeight = 0;

    for (const field of WEIGHTED_FIELDS) {
      totalWeight += field.weight;
      const value = getNestedValue(data, field.path);
      if (isFieldPopulated(value)) {
        earnedWeight += field.weight;
      }
    }

    if (totalWeight === 0) return 0;
    return Math.round((earnedWeight / totalWeight) * 100);
  }

  /**
   * Return list of critical field names that are missing/empty.
   */
  getMissingCriticalFields(data: StructuredClaimData): string[] {
    const missing: string[] = [];
    for (const fieldPath of CRITICAL_FIELDS) {
      const value = getNestedValue(data, fieldPath);
      if (!isFieldPopulated(value)) {
        missing.push(fieldPath);
      }
    }
    return missing;
  }
}
