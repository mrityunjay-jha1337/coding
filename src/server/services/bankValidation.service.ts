import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export interface BankValidationResult {
  readonly isValid: boolean;
  readonly checks: ReadonlyArray<BankValidationCheck>;
  readonly errors: ReadonlyArray<string>;
  readonly warnings: ReadonlyArray<string>;
}

export interface BankValidationCheck {
  readonly field: string;
  readonly status: 'pass' | 'fail' | 'warn' | 'skip';
  readonly message: string;
}

// ─── Constants ─────────────────────────────────────

// IBAN lengths per country (ISO 13616)
const IBAN_LENGTHS: Record<string, number> = {
  AL: 28, AD: 24, AT: 20, AZ: 28, BH: 22, BY: 28, BE: 16, BA: 20,
  BR: 29, BG: 22, CR: 22, HR: 21, CY: 28, CZ: 24, DK: 18, DO: 28,
  EG: 29, EE: 20, FO: 18, FI: 18, FR: 27, GE: 22, DE: 22, GI: 23,
  GR: 27, GL: 18, GT: 28, HU: 28, IS: 26, IQ: 23, IE: 22, IL: 23,
  IT: 27, JO: 30, KZ: 20, XK: 20, KW: 30, LV: 21, LB: 28, LI: 21,
  LT: 20, LU: 20, MT: 31, MR: 27, MU: 30, MC: 27, MD: 24, ME: 22,
  NL: 18, MK: 19, NO: 15, PK: 24, PS: 29, PL: 28, PT: 25, QA: 29,
  RO: 24, LC: 32, SM: 27, SA: 24, RS: 22, SC: 31, SK: 24, SI: 19,
  ES: 24, SE: 24, CH: 21, TL: 23, TN: 24, TR: 26, UA: 29, AE: 23,
  GB: 22, VA: 22, VG: 24,
};

// SWIFT/BIC pattern: 4 bank + 2 country + 2 location + optional 3 branch
const SWIFT_PATTERN = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/;

// UK sort code: 6 digits, optionally formatted as XX-XX-XX
const SORT_CODE_PATTERN = /^(\d{2}-?\d{2}-?\d{2})$/;

// ISO 3166-1 alpha-2 country codes (subset for SWIFT validation)
const VALID_COUNTRY_CODES = new Set([
  'AD','AE','AF','AG','AL','AM','AO','AR','AT','AU','AZ','BA','BB','BD','BE',
  'BF','BG','BH','BI','BJ','BN','BO','BR','BS','BT','BW','BY','BZ','CA','CD',
  'CF','CG','CH','CI','CK','CL','CM','CN','CO','CR','CU','CV','CY','CZ','DE',
  'DJ','DK','DM','DO','DZ','EC','EE','EG','ER','ES','ET','FI','FJ','FK','FM',
  'FO','FR','GA','GB','GD','GE','GH','GI','GL','GM','GN','GQ','GR','GT','GW',
  'GY','HK','HN','HR','HT','HU','ID','IE','IL','IN','IQ','IR','IS','IT','JM',
  'JO','JP','KE','KG','KH','KI','KM','KN','KP','KR','KW','KY','KZ','LA','LB',
  'LC','LI','LK','LR','LS','LT','LU','LV','LY','MA','MC','MD','ME','MG','MH',
  'MK','ML','MM','MN','MO','MR','MT','MU','MV','MW','MX','MY','MZ','NA','NE',
  'NG','NI','NL','NO','NP','NR','NU','NZ','OM','PA','PE','PG','PH','PK','PL',
  'PS','PT','PW','PY','QA','RO','RS','RU','RW','SA','SB','SC','SD','SE','SG',
  'SI','SK','SL','SM','SN','SO','SR','SS','ST','SV','SY','SZ','TD','TG','TH',
  'TJ','TL','TM','TN','TO','TR','TT','TV','TW','TZ','UA','UG','US','UY','UZ',
  'VA','VC','VE','VG','VI','VN','VU','WS','YE','ZA','ZM','ZW',
]);

// ─── Validation Functions ──────────────────────────

/**
 * Validate an IBAN using ISO 13616 MOD-97 algorithm.
 */
export function validateIBAN(iban: string): BankValidationCheck {
  const cleaned = iban.replace(/[\s-]/g, '').toUpperCase();

  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(cleaned)) {
    return { field: 'iban', status: 'fail', message: 'Invalid IBAN format: must start with 2-letter country code + 2 check digits' };
  }

  const countryCode = cleaned.slice(0, 2);
  if (!VALID_COUNTRY_CODES.has(countryCode)) {
    return { field: 'iban', status: 'fail', message: `Unknown IBAN country code: ${countryCode}` };
  }

  const expectedLength = IBAN_LENGTHS[countryCode];
  if (expectedLength && cleaned.length !== expectedLength) {
    return { field: 'iban', status: 'fail', message: `IBAN for ${countryCode} must be ${expectedLength} characters, got ${cleaned.length}` };
  }

  // MOD-97 checksum validation (ISO 7064)
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  const numericString = rearranged.replace(/[A-Z]/g, (ch) => String(ch.charCodeAt(0) - 55));

  let remainder = 0;
  for (let i = 0; i < numericString.length; i++) {
    remainder = (remainder * 10 + parseInt(numericString[i], 10)) % 97;
  }

  if (remainder !== 1) {
    return { field: 'iban', status: 'fail', message: 'IBAN checksum validation failed — the number may be incorrect' };
  }

  return { field: 'iban', status: 'pass', message: `Valid IBAN for ${countryCode}` };
}

/**
 * Validate a SWIFT/BIC code format and country code.
 */
export function validateSWIFT(swift: string): BankValidationCheck {
  const cleaned = swift.replace(/[\s-]/g, '').toUpperCase();

  if (!SWIFT_PATTERN.test(cleaned)) {
    return {
      field: 'swiftCode',
      status: 'fail',
      message: `Invalid SWIFT/BIC format: expected 8 or 11 characters (BANKCCLL or BANKCCLLBBB), got "${cleaned}"`,
    };
  }

  const countryCode = cleaned.slice(4, 6);
  if (!VALID_COUNTRY_CODES.has(countryCode)) {
    return {
      field: 'swiftCode',
      status: 'fail',
      message: `Unknown country code in SWIFT: ${countryCode}`,
    };
  }

  return { field: 'swiftCode', status: 'pass', message: `Valid SWIFT/BIC for ${countryCode}` };
}

/**
 * Validate a UK sort code format.
 */
export function validateSortCode(sortCode: string): BankValidationCheck {
  const cleaned = sortCode.replace(/[\s-]/g, '');

  if (!/^\d{6}$/.test(cleaned)) {
    return { field: 'sortCode', status: 'fail', message: 'Sort code must be 6 digits' };
  }

  return { field: 'sortCode', status: 'pass', message: 'Valid sort code format' };
}

/**
 * Cross-check IBAN against standalone account number.
 * If IBAN is provided for a GB account, the last 8 digits should match the account number.
 */
export function crossCheckIbanAccount(iban: string, accountNumber: string): BankValidationCheck {
  const cleanIban = iban.replace(/[\s-]/g, '').toUpperCase();
  const cleanAccount = accountNumber.replace(/[\s-]/g, '');
  const countryCode = cleanIban.slice(0, 2);

  if (countryCode === 'GB' && cleanIban.length === 22) {
    const ibanAccount = cleanIban.slice(14);
    if (ibanAccount !== cleanAccount.padStart(8, '0')) {
      return {
        field: 'accountNumber',
        status: 'warn',
        message: `Account number "${cleanAccount}" doesn't match IBAN-embedded account "${ibanAccount}" — please verify`,
      };
    }
  }

  return { field: 'accountNumber', status: 'pass', message: 'Account number consistent with IBAN' };
}

// ─── Service ───────────────────────────────────────

export class BankValidationService {
  /**
   * Validate all provided bank details.
   * Returns validation result with per-field checks.
   */
  validate(params: {
    iban?: string | null;
    swiftCode?: string | null;
    sortCode?: string | null;
    accountNumber?: string | null;
  }): BankValidationResult {
    const checks: BankValidationCheck[] = [];
    const errors: string[] = [];
    const warnings: string[] = [];

    if (params.iban) {
      const ibanCheck = validateIBAN(params.iban);
      checks.push(ibanCheck);
      if (ibanCheck.status === 'fail') errors.push(ibanCheck.message);
    }

    if (params.swiftCode) {
      const swiftCheck = validateSWIFT(params.swiftCode);
      checks.push(swiftCheck);
      if (swiftCheck.status === 'fail') errors.push(swiftCheck.message);
    }

    if (params.sortCode) {
      const sortCheck = validateSortCode(params.sortCode);
      checks.push(sortCheck);
      if (sortCheck.status === 'fail') errors.push(sortCheck.message);
    }

    if (params.iban && params.accountNumber) {
      const crossCheck = crossCheckIbanAccount(params.iban, params.accountNumber);
      checks.push(crossCheck);
      if (crossCheck.status === 'warn') warnings.push(crossCheck.message);
      if (crossCheck.status === 'fail') errors.push(crossCheck.message);
    }

    return {
      isValid: errors.length === 0,
      checks,
      errors,
      warnings,
    };
  }
}
