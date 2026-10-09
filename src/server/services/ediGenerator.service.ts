// ─── Types ─────────────────────────────────────────

export interface EdiAddress {
  readonly line1?: string;
  readonly line2?: string;
  readonly city?: string;
  readonly state?: string;
  readonly postalCode?: string;
  readonly country?: string;
}

export interface EdiInput {
  readonly claimReference: string;
  readonly submitterName: string;
  readonly submitterIdentifier: string;
  readonly receiverName: string;
  readonly receiverIdentifier: string;
  readonly member: {
    readonly membershipNumber: string;
    readonly firstName: string;
    readonly lastName: string;
    readonly dateOfBirth: string;
    readonly address: EdiAddress | null;
  };
  readonly provider: {
    readonly providerName: string;
    readonly facilityName: string;
    readonly address: EdiAddress | null;
    readonly taxId?: string;
    readonly npi?: string;
  };
  readonly claim: {
    readonly totalAmount: number;
    readonly currency: string;
    readonly treatmentDate: string;
    readonly admissionDate?: string;
    readonly dischargeDate?: string;
    readonly facilityTypeCode?: string;
  };
  readonly diagnoses: ReadonlyArray<{
    readonly code: string;
    readonly isPrimary: boolean;
  }>;
  readonly procedures: ReadonlyArray<{
    readonly code: string;
    readonly description: string;
    readonly amount: number;
    readonly serviceDate: string;
  }>;
  readonly financial?: {
    readonly totalPayable: number;
    readonly deductibleApplied: number;
    readonly coInsuranceApplied: number;
    readonly networkPenaltyApplied: number;
    readonly benefitLimitExcess: number;
    readonly annualMaximumExcess: number;
    readonly paymentCurrency: string;
    readonly fxRate: number | null;
    readonly lineItems: ReadonlyArray<{
      readonly procedureCode: string;
      readonly chargedAmount: number;
      readonly allowedAmount: number;
      readonly paidAmount: number;
      readonly deductible: number;
      readonly coInsurance: number;
      readonly adjustmentReason: string | null;
    }>;
  };
  readonly otherInsurance?: {
    readonly payerName: string;
    readonly payerIdentifier: string;
    readonly policyNumber: string;
    readonly primaryPayerPaidAmount: number;
    readonly adjustments: ReadonlyArray<{
      readonly groupCode: string;
      readonly reasonCode: string;
      readonly amount: number;
    }>;
  };
}

export interface EdiOutput {
  readonly ediContent: string;
  readonly ediType: '837P' | '837I';
  readonly controlNumber: string;
  readonly segmentCount: number;
}

// ─── Constants ─────────────────────────────────────

const ELEMENT_SEPARATOR = '*';
const SEGMENT_TERMINATOR = '~';
const ISA_FIXED_LENGTH_PADDED = true;
const COMPONENT_SEPARATOR = ':';
const REPETITION_SEPARATOR = '^';
const AUTH_QUALIFIER = '00';
const SECURITY_QUALIFIER = '00';
const INTERCHANGE_ID_QUALIFIER = 'ZZ';
const VERSION_CODE = '00501';
const ACK_REQUESTED = '0';
const USAGE_INDICATOR = 'P'; // Production
const FUNCTIONAL_ID_837P = 'HC';
const FUNCTIONAL_ID_837I = 'HC';
const RESPONSIBLE_AGENCY = 'X';
const VERSION_RELEASE = '005010X222A1';
const VERSION_RELEASE_837I = '005010X223A2';
const TRANSACTION_SET_837 = '837';
const BHT_PURPOSE_CODE = '00'; // Original
const BHT_TYPE_CODE = '18'; // Re-submission
const CLAIM_FREQUENCY_CODE = '1'; // Original
const PLACE_OF_SERVICE_OFFICE = '11';

// ─── Helpers ───────────────────────────────────────

/**
 * Generate a 9-digit control number based on the current timestamp.
 */
function generateControlNumber(): string {
  const now = Date.now();
  return String(now % 1_000_000_000).padStart(9, '0');
}

/**
 * Build a single EDI segment from an array of elements.
 */
function segment(id: string, ...elements: string[]): string {
  return `${id}${ELEMENT_SEPARATOR}${elements.join(ELEMENT_SEPARATOR)}${SEGMENT_TERMINATOR}`;
}

/**
 * Pad a string to a fixed length (right-padded with spaces) for ISA segments.
 */
function padRight(value: string, length: number): string {
  if (!ISA_FIXED_LENGTH_PADDED) {
    return value;
  }
  return value.padEnd(length, ' ');
}

/**
 * Format a date string (YYYY-MM-DD or ISO) to YYYYMMDD for EDI.
 */
function formatDate(dateStr: string): string {
  const cleaned = dateStr.replace(/[-T:Z]/g, '').slice(0, 8);
  if (cleaned.length === 8) {
    return cleaned;
  }
  // Fallback: parse and format
  const d = new Date(dateStr);
  const year = d.getFullYear().toString();
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * Format a date string to YYMMDD for ISA date.
 */
function formatIsaDate(dateStr: string): string {
  const full = formatDate(dateStr);
  return full.slice(2);
}

/**
 * Format current time to HHMM for ISA time.
 */
function formatIsaTime(): string {
  const now = new Date();
  const hours = now.getHours().toString().padStart(2, '0');
  const minutes = now.getMinutes().toString().padStart(2, '0');
  return `${hours}${minutes}`;
}

/**
 * Format an amount to a string with two decimal places.
 */
function formatAmount(amount: number): string {
  return amount.toFixed(2);
}

/**
 * Build the ISA (Interchange Control Header) segment.
 */
function buildIsaSegment(
  input: EdiInput,
  controlNumber: string,
): string {
  const today = new Date().toISOString().slice(0, 10);
  return segment(
    'ISA',
    AUTH_QUALIFIER,
    padRight('', 10),
    SECURITY_QUALIFIER,
    padRight('', 10),
    INTERCHANGE_ID_QUALIFIER,
    padRight(input.submitterIdentifier, 15),
    INTERCHANGE_ID_QUALIFIER,
    padRight(input.receiverIdentifier, 15),
    formatIsaDate(today),
    formatIsaTime(),
    REPETITION_SEPARATOR,
    VERSION_CODE,
    controlNumber.padStart(9, '0'),
    ACK_REQUESTED,
    USAGE_INDICATOR,
    COMPONENT_SEPARATOR,
  );
}

/**
 * Build the GS (Functional Group Header) segment.
 */
function buildGsSegment(
  input: EdiInput,
  controlNumber: string,
  versionRelease: string,
): string {
  const today = new Date().toISOString().slice(0, 10);
  return segment(
    'GS',
    FUNCTIONAL_ID_837P,
    input.submitterIdentifier,
    input.receiverIdentifier,
    formatDate(today),
    formatIsaTime(),
    controlNumber,
    RESPONSIBLE_AGENCY,
    versionRelease,
  );
}

/**
 * Build the ST (Transaction Set Header) segment.
 */
function buildStSegment(controlNumber: string, versionRelease: string): string {
  return segment('ST', TRANSACTION_SET_837, controlNumber.slice(0, 4).padStart(4, '0'), versionRelease);
}

/**
 * Build the BHT (Beginning of Hierarchical Transaction) segment.
 */
function buildBhtSegment(input: EdiInput): string {
  const today = new Date().toISOString().slice(0, 10);
  return segment(
    'BHT',
    '0019',
    BHT_PURPOSE_CODE,
    input.claimReference,
    formatDate(today),
    formatIsaTime(),
    BHT_TYPE_CODE,
  );
}

/**
 * Build the HL loop for the billing provider.
 */
function buildProviderHlSegments(input: EdiInput): readonly string[] {
  const segments: string[] = [];

  // HL segment — billing provider (HL level 1)
  segments.push(segment('HL', '1', '', '20', '1'));

  // NM1 — billing provider name (entity ID: 85)
  segments.push(
    segment(
      'NM1',
      '85',
      '2', // Non-person entity
      input.provider.facilityName,
      '',
      '',
      '',
      '',
      input.provider.taxId ? 'FI' : 'XX',
      input.provider.taxId ?? input.provider.npi ?? '',
    ),
  );

  // N3 — billing provider address
  const provAddr = input.provider.address;
  if (provAddr) {
    segments.push(
      segment('N3', provAddr.line1 ?? '', provAddr.line2 ?? ''),
    );

    // N4 — billing provider city/state/zip
    segments.push(
      segment(
        'N4',
        provAddr.city ?? '',
        provAddr.state ?? '',
        provAddr.postalCode ?? '',
        provAddr.country ?? '',
      ),
    );
  }

  // REF — provider NPI
  if (input.provider.npi) {
    segments.push(segment('REF', 'PQ', input.provider.npi));
  }

  return segments;
}

/**
 * Build the HL loop for the subscriber (member).
 */
function buildSubscriberHlSegments(input: EdiInput): readonly string[] {
  const segments: string[] = [];

  // HL segment — subscriber (HL level 2, parent 1)
  segments.push(segment('HL', '2', '1', '22', '0'));

  // SBR — subscriber information
  segments.push(segment('SBR', 'P', '18', '', '', '', '', '', '', 'CI'));

  // NM1 — subscriber name (entity ID: IL)
  segments.push(
    segment(
      'NM1',
      'IL',
      '1', // Person
      input.member.lastName,
      input.member.firstName,
      '',
      '',
      '',
      'MI',
      input.member.membershipNumber,
    ),
  );

  // N3 — subscriber address
  const memAddr = input.member.address;
  if (memAddr) {
    segments.push(segment('N3', memAddr.line1 ?? '', memAddr.line2 ?? ''));
    segments.push(
      segment(
        'N4',
        memAddr.city ?? '',
        memAddr.state ?? '',
        memAddr.postalCode ?? '',
        memAddr.country ?? '',
      ),
    );
  }

  // DMG — subscriber demographics
  if (input.member.dateOfBirth) {
    segments.push(
      segment('DMG', 'D8', formatDate(input.member.dateOfBirth), 'U'),
    );
  }

  return segments;
}

/**
 * Build CLM (Claim Information) segment.
 */
function buildClmSegment(input: EdiInput, placeOfService: string): string {
  const facilityCode = input.claim.facilityTypeCode ?? placeOfService;
  return segment(
    'CLM',
    input.claimReference,
    formatAmount(input.claim.totalAmount),
    '',
    '',
    `${facilityCode}${COMPONENT_SEPARATOR}B${COMPONENT_SEPARATOR}${CLAIM_FREQUENCY_CODE}`,
    'Y',
    'A',
    'Y',
    'Y',
  );
}

/**
 * Build HI (Health Care Diagnosis Code) segments.
 * Primary diagnosis uses ABK qualifier; secondary uses ABF.
 */
function buildHiSegments(
  diagnoses: ReadonlyArray<{ readonly code: string; readonly isPrimary: boolean }>,
): readonly string[] {
  const segments: string[] = [];

  // Sort: primary first, then secondary
  const sorted = [...diagnoses].sort((a, b) => {
    if (a.isPrimary && !b.isPrimary) return -1;
    if (!a.isPrimary && b.isPrimary) return 1;
    return 0;
  });

  for (const diag of sorted) {
    const qualifier = diag.isPrimary ? 'ABK' : 'ABF';
    segments.push(
      segment('HI', `${qualifier}${COMPONENT_SEPARATOR}${diag.code}`),
    );
  }

  return segments;
}

/**
 * Build SV1 (Professional Service) segments for each procedure line.
 */
function buildSv1Segments(
  procedures: ReadonlyArray<{
    readonly code: string;
    readonly description: string;
    readonly amount: number;
    readonly serviceDate: string;
  }>,
): readonly string[] {
  const segments: string[] = [];

  for (const proc of procedures) {
    // SV1 — professional service
    segments.push(
      segment(
        'SV1',
        `HC${COMPONENT_SEPARATOR}${proc.code}`,
        formatAmount(proc.amount),
        'UN',
        '1',
        PLACE_OF_SERVICE_OFFICE,
        '',
        '',
      ),
    );

    // DTP — service date (472 = Service)
    segments.push(
      segment('DTP', '472', 'D8', formatDate(proc.serviceDate)),
    );
  }

  return segments;
}

/**
 * Build SV2 (Institutional Service) segments for each procedure line.
 */
function buildSv2Segments(
  procedures: ReadonlyArray<{
    readonly code: string;
    readonly description: string;
    readonly amount: number;
    readonly serviceDate: string;
  }>,
): readonly string[] {
  const segments: string[] = [];

  for (const proc of procedures) {
    // SV2 — institutional service
    segments.push(
      segment(
        'SV2',
        '',
        `HC${COMPONENT_SEPARATOR}${proc.code}`,
        formatAmount(proc.amount),
        'UN',
        '1',
      ),
    );

    // DTP — service date
    segments.push(
      segment('DTP', '472', 'D8', formatDate(proc.serviceDate)),
    );
  }

  return segments;
}

/**
 * Build DTP segments for admission and discharge dates.
 */
function buildDateSegments(input: EdiInput): readonly string[] {
  const segments: string[] = [];

  // DTP — statement dates
  segments.push(
    segment('DTP', '434', 'D8', formatDate(input.claim.treatmentDate)),
  );

  if (input.claim.admissionDate) {
    segments.push(
      segment('DTP', '435', 'D8', formatDate(input.claim.admissionDate)),
    );
  }

  if (input.claim.dischargeDate) {
    segments.push(
      segment('DTP', '096', 'D8', formatDate(input.claim.dischargeDate)),
    );
  }

  return segments;
}

/**
 * Build AMT (Monetary Amount) and CAS (Claim Adjustment) segments for claim-level financials.
 * These follow the CLM segment per X12 837 specification.
 */
function buildClaimFinancialSegments(financial: NonNullable<EdiInput['financial']>): readonly string[] {
  const segments: string[] = [];

  // AMT — Total payable amount (what the payer will pay)
  segments.push(segment('AMT', 'T3', formatAmount(financial.totalPayable)));

  // AMT — Total billed/claimed amount
  const totalClaimed = financial.lineItems.reduce((sum, li) => sum + li.chargedAmount, 0);
  segments.push(segment('AMT', 'AU', formatAmount(totalClaimed)));

  // CAS — Patient Responsibility group (PR)
  if (financial.deductibleApplied > 0) {
    segments.push(segment('CAS', 'PR', '1', formatAmount(financial.deductibleApplied)));
  }

  if (financial.coInsuranceApplied > 0) {
    segments.push(segment('CAS', 'PR', '2', formatAmount(financial.coInsuranceApplied)));
  }

  // CAS — Contractual Obligation group (CO)
  if (financial.networkPenaltyApplied > 0) {
    segments.push(segment('CAS', 'CO', '45', formatAmount(financial.networkPenaltyApplied)));
  }

  if (financial.benefitLimitExcess > 0) {
    segments.push(segment('CAS', 'CO', '119', formatAmount(financial.benefitLimitExcess)));
  }

  // CAS — Other Adjustment (OA) for annual maximum
  if (financial.annualMaximumExcess > 0) {
    segments.push(segment('CAS', 'OA', '23', formatAmount(financial.annualMaximumExcess)));
  }

  // REF — FX conversion rate (if applicable)
  if (financial.fxRate != null && financial.fxRate !== 1.0) {
    segments.push(segment('REF', 'F5', financial.fxRate.toFixed(6)));
  }

  return segments;
}

/**
 * Build SVD (Line Adjudication Information) segments for each service line.
 * Each SVD follows its corresponding SV1/SV2 + DTP pair.
 */
function buildLineFinancialSegments(
  lineItem: NonNullable<EdiInput['financial']>['lineItems'][number],
  payerIdentifier: string,
): readonly string[] {
  const segments: string[] = [];

  // SVD — Adjudication info per line
  segments.push(
    segment(
      'SVD',
      payerIdentifier,
      formatAmount(lineItem.paidAmount),
      `HC${COMPONENT_SEPARATOR}${lineItem.procedureCode}`,
      '',
      '1',
    ),
  );

  // CAS — Line-level deductible
  if (lineItem.deductible > 0) {
    segments.push(segment('CAS', 'PR', '1', formatAmount(lineItem.deductible)));
  }

  // CAS — Line-level co-insurance
  if (lineItem.coInsurance > 0) {
    segments.push(segment('CAS', 'PR', '2', formatAmount(lineItem.coInsurance)));
  }

  // AMT — Line allowed amount
  segments.push(segment('AMT', 'B6', formatAmount(lineItem.allowedAmount)));

  return segments;
}

/**
 * Build COB (Coordination of Benefits) segments for secondary insurance.
 */
function buildCobSegments(otherInsurance: NonNullable<EdiInput['otherInsurance']>): readonly string[] {
  const segments: string[] = [];

  // SBR — Other subscriber information (secondary payer)
  segments.push(segment('SBR', 'S', '18', otherInsurance.policyNumber, '', '', '', '', '', 'CI'));

  // OI — Other Insurance Coverage Information
  segments.push(segment('OI', '', '', 'Y', 'P', '', 'Y'));

  // NM1 — Other payer name
  segments.push(segment('NM1', 'PR', '2', otherInsurance.payerName, '', '', '', '', 'PI', otherInsurance.payerIdentifier));

  // AMT — Primary payer paid amount
  segments.push(segment('AMT', 'D', formatAmount(otherInsurance.primaryPayerPaidAmount)));

  // CAS — Primary payer adjustments
  for (const adj of otherInsurance.adjustments) {
    segments.push(segment('CAS', adj.groupCode, adj.reasonCode, formatAmount(adj.amount)));
  }

  return segments;
}

/**
 * Build the complete list of EDI segments and join them into a string.
 */
function assembleEdiDocument(
  input: EdiInput,
  ediType: '837P' | '837I',
): EdiOutput {
  const controlNumber = generateControlNumber();
  const versionRelease = ediType === '837P' ? VERSION_RELEASE : VERSION_RELEASE_837I;
  const placeOfService = ediType === '837P' ? PLACE_OF_SERVICE_OFFICE : '21'; // 21 = Inpatient Hospital

  const allSegments: string[] = [];

  // Envelope segments
  allSegments.push(buildIsaSegment(input, controlNumber));
  allSegments.push(buildGsSegment(input, controlNumber, versionRelease));
  allSegments.push(buildStSegment(controlNumber, versionRelease));
  allSegments.push(buildBhtSegment(input));

  // Provider HL loop
  allSegments.push(...buildProviderHlSegments(input));

  // Subscriber HL loop
  allSegments.push(...buildSubscriberHlSegments(input));

  // COB segments (if secondary insurance)
  if (input.otherInsurance) {
    allSegments.push(...buildCobSegments(input.otherInsurance));
  }

  // CLM segment
  allSegments.push(buildClmSegment(input, placeOfService));

  // Date segments
  allSegments.push(...buildDateSegments(input));

  // Claim-level financial segments (AMT/CAS after dates, before diagnoses)
  if (input.financial) {
    allSegments.push(...buildClaimFinancialSegments(input.financial));
  }

  // Diagnosis codes
  allSegments.push(...buildHiSegments(input.diagnoses));

  // Service lines with per-line financial detail
  if (ediType === '837P') {
    if (input.financial?.lineItems && input.financial.lineItems.length > 0) {
      for (let i = 0; i < input.procedures.length; i++) {
        const proc = input.procedures[i];
        allSegments.push(
          segment('SV1', `HC${COMPONENT_SEPARATOR}${proc.code}`, formatAmount(proc.amount), 'UN', '1', PLACE_OF_SERVICE_OFFICE, '', ''),
        );
        allSegments.push(segment('DTP', '472', 'D8', formatDate(proc.serviceDate)));

        const matchedLine = input.financial.lineItems.find(li => li.procedureCode === proc.code)
          ?? input.financial.lineItems[i];
        if (matchedLine) {
          allSegments.push(...buildLineFinancialSegments(matchedLine, input.receiverIdentifier));
        }
      }
    } else {
      allSegments.push(...buildSv1Segments(input.procedures));
    }
  } else {
    if (input.financial?.lineItems && input.financial.lineItems.length > 0) {
      for (let i = 0; i < input.procedures.length; i++) {
        const proc = input.procedures[i];
        allSegments.push(
          segment('SV2', '', `HC${COMPONENT_SEPARATOR}${proc.code}`, formatAmount(proc.amount), 'UN', '1'),
        );
        allSegments.push(segment('DTP', '472', 'D8', formatDate(proc.serviceDate)));

        const matchedLine = input.financial.lineItems.find(li => li.procedureCode === proc.code)
          ?? input.financial.lineItems[i];
        if (matchedLine) {
          allSegments.push(...buildLineFinancialSegments(matchedLine, input.receiverIdentifier));
        }
      }
    } else {
      allSegments.push(...buildSv2Segments(input.procedures));
    }
  }

  // Count content segments (ST through SE, inclusive of SE)
  // SE count excludes ISA, GS, GE, IEA but includes ST and SE
  const contentSegmentCount = allSegments.length - 2 + 1; // -ISA,-GS, +SE itself

  // Trailer segments
  allSegments.push(
    segment('SE', String(contentSegmentCount), controlNumber.slice(0, 4).padStart(4, '0')),
  );
  allSegments.push(segment('GE', '1', controlNumber));
  allSegments.push(
    segment('IEA', '1', controlNumber.padStart(9, '0')),
  );

  const ediContent = allSegments.join('\n');

  return {
    ediContent,
    ediType,
    controlNumber,
    segmentCount: allSegments.length,
  };
}

// ─── Service ───────────────────────────────────────

export class EdiGeneratorService {
  /**
   * Generate an EDI 837P (Professional) document from claim data.
   * Pure function — no database calls or side effects.
   */
  generate837P(input: EdiInput): EdiOutput {
    return assembleEdiDocument(input, '837P');
  }

  /**
   * Generate an EDI 837I (Institutional) document from claim data.
   * Uses SV2 segments instead of SV1 for institutional service lines.
   * Pure function — no database calls or side effects.
   */
  generate837I(input: EdiInput): EdiOutput {
    return assembleEdiDocument(input, '837I');
  }
}
