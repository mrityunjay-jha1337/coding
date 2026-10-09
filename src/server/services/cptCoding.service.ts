import { invokeBedrockModel, getResolvedModelId } from './bedrockClient';
import { logger } from '../config/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CPTCode {
  readonly code: string;
  readonly description: string;
  readonly category: string;
  readonly confidence: number;
  readonly evidenceText: string;
  readonly relatedIcdCodes: ReadonlyArray<string>;
  readonly isConsistentWithDiagnosis: boolean;
  readonly needsReview: boolean;
}

export interface CPTCodingResult {
  readonly codes: ReadonlyArray<CPTCode>;
  readonly modelUsed: string;
  readonly processingPath: string;
  readonly unbundlingWarnings: ReadonlyArray<string>;
}

export interface CPTExtractionInput {
  readonly englishText: string;
  readonly treatmentDescription?: string;
  readonly procedures?: ReadonlyArray<string>;
  readonly icdCodes?: ReadonlyArray<{ code: string; description: string }>;
  readonly treatmentType?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const VALID_CATEGORIES: ReadonlyArray<string> = [
  'Surgery',
  'Radiology',
  'Pathology',
  'Medicine',
  'E&M',
];

const CPT_CODE_BASE_PATTERN = /^\d{5}$/;
const CPT_CODE_MODIFIER_PATTERN = /^\d{5}-[A-Z0-9]{1,2}$/;

// ---------------------------------------------------------------------------
// Prompt template
// ---------------------------------------------------------------------------

const CPT_CODING_PROMPT = `You are a senior certified medical coder with deep expertise in CPT (Current Procedural Terminology) coding for insurance claims processing. You work with Bupa Global claims from multiple countries.

YOUR TASK: Analyze the clinical text below and extract all CPT procedure codes supported by the evidence.

═══════════════════════════════════════════
STEP 1 — UNDERSTAND THE CONTEXT
═══════════════════════════════════════════

Review the clinical text, any treatment descriptions, listed procedures, and ICD-10 diagnosis codes already assigned. Use all available information to identify the procedures that were performed.

═══════════════════════════════════════════
STEP 2 — CPT CODING RULES
═══════════════════════════════════════════

Use valid CPT codes from the official AMA CPT code set.
- CPT codes are exactly 5 digits (e.g., 99213, 47562, 70553).
- Codes fall into these categories:
  - E&M (Evaluation & Management): 99201-99499
  - Surgery: 10004-69990
  - Radiology: 70010-79999
  - Pathology: 80047-89398
  - Medicine: 90281-99607
- Use the MOST SPECIFIC code supported by the evidence.
- Each code MUST be a real, valid CPT entry. Do NOT fabricate codes.

═══════════════════════════════════════════
STEP 3 — PROCEDURE-DIAGNOSIS CONSISTENCY
═══════════════════════════════════════════

For each CPT code, check whether the procedure is clinically consistent with the ICD-10 diagnosis codes provided:
- A cholecystectomy (47562) is consistent with gallstones (K80.x)
- A knee arthroscopy (29881) is consistent with meniscus tear (M23.x)
- Flag any procedures that seem inconsistent with the diagnoses

═══════════════════════════════════════════
STEP 4 — UNBUNDLING CHECK
═══════════════════════════════════════════

Check for common CPT unbundling issues:
- Multiple E&M codes that should not be billed together
- Surgical procedures that include components billed separately (e.g., anesthesia included in the procedure)
- Lab panel components billed individually when a panel code exists
- Return warnings for any potential unbundling violations

═══════════════════════════════════════════
STEP 5 — CONFIDENCE SCORING
═══════════════════════════════════════════

For each code:
- 0.90-1.00: Procedure explicitly stated with clear documentation
- 0.75-0.89: Strong inference from clinical context
- 0.60-0.74: Reasonable inference, needs clinical confirmation
- 0.40-0.59: Possible but speculative — flag for review
- Below 0.40: Do not include

═══════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════

Return ONLY valid JSON. No markdown fences. No commentary before or after the JSON.

{
  "procedures": [
    {
      "code": "47562",
      "description": "Laparoscopic cholecystectomy",
      "category": "Surgery",
      "confidence": 0.92,
      "evidenceText": "Underwent laparoscopic cholecystectomy...",
      "relatedIcdCodes": ["K80.20"],
      "isConsistentWithDiagnosis": true,
      "reasoningSummary": "Patient had gallstones, laparoscopic cholecystectomy is standard treatment"
    }
  ],
  "unbundlingWarnings": ["Warning message if any"]
}

═══════════════════════════════════════════
CLINICAL TEXT TO CODE:
═══════════════════════════════════════════

`;

const CPT_CODING_SUFFIX = `

═══════════════════════════════════════════
END OF CLINICAL TEXT — NOW OUTPUT YOUR CPT CODES AS JSON
═══════════════════════════════════════════

Important: Respond with ONLY the JSON object containing "procedures" and "unbundlingWarnings". Nothing else.`;

// ---------------------------------------------------------------------------
// Common CPT codes reference
// ---------------------------------------------------------------------------

function buildCommonCPTCodes(): ReadonlyMap<string, string> {
  const entries: ReadonlyArray<readonly [string, string]> = [
    // E&M — Office visits
    ['99201', 'Office visit, new patient, level 1'],
    ['99202', 'Office visit, new patient, level 2'],
    ['99203', 'Office visit, new patient, level 3'],
    ['99204', 'Office visit, new patient, level 4'],
    ['99205', 'Office visit, new patient, level 5'],
    ['99211', 'Office visit, established patient, level 1'],
    ['99212', 'Office visit, established patient, level 2'],
    ['99213', 'Office visit, established patient, level 3'],
    ['99214', 'Office visit, established patient, level 4'],
    ['99215', 'Office visit, established patient, level 5'],
    // E&M — Hospital admission
    ['99221', 'Initial hospital care, level 1'],
    ['99222', 'Initial hospital care, level 2'],
    ['99223', 'Initial hospital care, level 3'],
    // E&M — Subsequent hospital
    ['99231', 'Subsequent hospital care, level 1'],
    ['99232', 'Subsequent hospital care, level 2'],
    ['99233', 'Subsequent hospital care, level 3'],
    // E&M — Discharge
    ['99238', 'Hospital discharge day management, 30 min or less'],
    ['99239', 'Hospital discharge day management, more than 30 min'],
    // E&M — Emergency
    ['99281', 'Emergency department visit, level 1'],
    ['99282', 'Emergency department visit, level 2'],
    ['99283', 'Emergency department visit, level 3'],
    ['99284', 'Emergency department visit, level 4'],
    ['99285', 'Emergency department visit, level 5'],
    // Surgery
    ['10060', 'Incision and drainage of abscess, simple'],
    ['10061', 'Incision and drainage of abscess, complicated'],
    ['10120', 'Incision and removal of foreign body, simple'],
    ['10160', 'Puncture aspiration of abscess'],
    ['19301', 'Mastectomy, partial'],
    ['19303', 'Mastectomy, simple, complete'],
    ['20610', 'Arthrocentesis, aspiration, major joint'],
    ['27130', 'Total hip arthroplasty'],
    ['27447', 'Total knee arthroplasty'],
    ['29881', 'Arthroscopy, knee, surgical, with meniscectomy'],
    ['29882', 'Arthroscopy, knee, surgical, with meniscus repair'],
    ['33533', 'Coronary artery bypass, single arterial graft'],
    ['33534', 'Coronary artery bypass, two arterial grafts'],
    ['36415', 'Venipuncture, routine'],
    ['36430', 'Blood transfusion'],
    ['43235', 'Upper GI endoscopy, diagnostic'],
    ['43239', 'Upper GI endoscopy with biopsy'],
    ['43249', 'Upper GI endoscopy with balloon dilation'],
    ['44950', 'Appendectomy'],
    ['44970', 'Laparoscopic appendectomy'],
    ['45378', 'Colonoscopy, diagnostic'],
    ['45380', 'Colonoscopy with biopsy'],
    ['45385', 'Colonoscopy with polyp removal'],
    ['47562', 'Laparoscopic cholecystectomy'],
    ['47563', 'Laparoscopic cholecystectomy with cholangiography'],
    ['47600', 'Cholecystectomy'],
    ['49505', 'Inguinal hernia repair, age 5+, initial'],
    ['49507', 'Inguinal hernia repair, age 5+, incarcerated'],
    ['49650', 'Laparoscopic inguinal hernia repair'],
    ['50590', 'Lithotripsy, extracorporeal shock wave'],
    ['52000', 'Cystourethroscopy'],
    ['55700', 'Biopsy of prostate'],
    ['57520', 'Conization of cervix'],
    ['58150', 'Total abdominal hysterectomy'],
    ['58661', 'Laparoscopic removal of adnexal structures'],
    ['58662', 'Laparoscopic excision of lesions of ovary'],
    ['59400', 'Routine obstetric care, vaginal delivery'],
    ['59510', 'Routine obstetric care, cesarean delivery'],
    ['62323', 'Injection, interlaminar epidural or subarachnoid, lumbar'],
    ['63030', 'Laminotomy, single interspace, lumbar'],
    ['64483', 'Transforaminal epidural injection, lumbar'],
    ['66984', 'Cataract surgery, extracapsular with IOL insertion'],
    ['66821', 'YAG laser capsulotomy'],
    ['67028', 'Intravitreal injection'],
    ['69436', 'Tympanostomy'],
    // Radiology
    ['70553', 'MRI brain without and with contrast'],
    ['71045', 'Chest X-ray, single view'],
    ['71046', 'Chest X-ray, 2 views'],
    ['71048', 'Chest X-ray, 4+ views'],
    ['72110', 'X-ray lumbar spine, complete'],
    ['72148', 'MRI lumbar spine without contrast'],
    ['72149', 'MRI lumbar spine with contrast'],
    ['73721', 'MRI any joint, lower extremity, without contrast'],
    ['74177', 'CT abdomen and pelvis with contrast'],
    ['74178', 'CT abdomen and pelvis without and with contrast'],
    ['76856', 'Ultrasound, pelvic, non-obstetric, complete'],
    ['76830', 'Ultrasound, transvaginal'],
    ['76700', 'Ultrasound, abdominal, complete'],
    ['76805', 'Ultrasound, obstetric, complete'],
    ['77067', 'Screening mammography, bilateral'],
    ['77065', 'Diagnostic mammography, unilateral'],
    ['77066', 'Diagnostic mammography, bilateral'],
    // Pathology / Lab
    ['80048', 'Basic metabolic panel'],
    ['80050', 'General health panel'],
    ['80053', 'Comprehensive metabolic panel'],
    ['80061', 'Lipid panel'],
    ['81001', 'Urinalysis, automated with microscopy'],
    ['82947', 'Glucose, blood, quantitative'],
    ['83036', 'Hemoglobin A1c'],
    ['84443', 'Thyroid stimulating hormone (TSH)'],
    ['85025', 'Complete blood count (CBC) with differential'],
    ['85027', 'Complete blood count (CBC) without differential'],
    ['86900', 'Blood typing, ABO'],
    ['86901', 'Blood typing, Rh(D)'],
    ['87086', 'Urine culture'],
    ['88305', 'Surgical pathology, level IV'],
    ['88307', 'Surgical pathology, level V'],
    // Medicine
    ['90834', 'Psychotherapy, 45 minutes'],
    ['90837', 'Psychotherapy, 60 minutes'],
    ['90847', 'Family psychotherapy with patient'],
    ['90853', 'Group psychotherapy'],
    ['91010', 'Esophageal motility study'],
    ['92004', 'Ophthalmological services, new patient, comprehensive'],
    ['92014', 'Ophthalmological services, established patient, comprehensive'],
    ['93000', 'Electrocardiogram (ECG), complete'],
    ['93005', 'Electrocardiogram (ECG), tracing only'],
    ['93010', 'Electrocardiogram (ECG), interpretation only'],
    ['93306', 'Echocardiography, transthoracic, complete'],
    ['93798', 'Cardiac rehabilitation'],
    ['94010', 'Spirometry'],
    ['94060', 'Bronchodilation responsiveness'],
    ['95004', 'Allergy skin tests'],
    ['96372', 'Therapeutic injection, subcutaneous or intramuscular'],
    ['96374', 'Therapeutic injection, intravenous push'],
    ['96413', 'Chemotherapy administration, IV infusion, first hour'],
    ['97110', 'Therapeutic exercises'],
    ['97140', 'Manual therapy techniques'],
    ['97530', 'Therapeutic activities'],
    ['99601', 'Home infusion/specialty drug administration'],
  ];

  return new Map(entries);
}

// ---------------------------------------------------------------------------
// Unbundling rule definitions
// ---------------------------------------------------------------------------

interface UnbundlingRule {
  readonly name: string;
  readonly check: (codes: ReadonlyArray<CPTCode>) => ReadonlyArray<string>;
}

const UNBUNDLING_RULES: ReadonlyArray<UnbundlingRule> = [
  {
    name: 'Multiple E&M codes',
    check(codes) {
      const emCodes = codes.filter((c) => c.category === 'E&M');
      if (emCodes.length > 1) {
        const codeList = emCodes.map((c) => c.code).join(', ');
        return [
          `Multiple E&M codes detected (${codeList}). Typically only one E&M code should be billed per encounter unless different dates of service apply.`,
        ];
      }
      return [];
    },
  },
  {
    name: 'Surgical procedure with separate anesthesia',
    check(codes) {
      const surgicalCodes = codes.filter((c) => c.category === 'Surgery');
      const anesthesiaCodes = codes.filter(
        (c) => c.code >= '00100' && c.code <= '01999',
      );
      if (surgicalCodes.length > 0 && anesthesiaCodes.length > 0) {
        return [
          `Anesthesia code(s) billed separately alongside surgical procedure(s). Many surgical CPT codes include moderate sedation/anesthesia — verify whether separate anesthesia billing is appropriate.`,
        ];
      }
      return [];
    },
  },
  {
    name: 'Lab panel component unbundling',
    check(codes) {
      const warnings: string[] = [];
      const codeSet = new Set(codes.map((c) => c.code));

      // CMP (80053) includes BMP (80048) components
      if (codeSet.has('80053') && codeSet.has('80048')) {
        warnings.push(
          'Comprehensive metabolic panel (80053) includes all basic metabolic panel (80048) components. Do not bill both.',
        );
      }

      // CBC components
      if (codeSet.has('85025') && codeSet.has('85027')) {
        warnings.push(
          'CBC with differential (85025) includes CBC without differential (85027). Do not bill both.',
        );
      }

      // Individual glucose with metabolic panel
      if (
        (codeSet.has('80053') || codeSet.has('80048')) &&
        codeSet.has('82947')
      ) {
        warnings.push(
          'Glucose (82947) is included in the metabolic panel. Do not bill separately when a panel is ordered.',
        );
      }

      // General health panel includes CMP and CBC
      if (codeSet.has('80050') && (codeSet.has('80053') || codeSet.has('85025'))) {
        warnings.push(
          'General health panel (80050) includes CMP and CBC components. Do not bill panel components separately.',
        );
      }

      return warnings;
    },
  },
];

// ---------------------------------------------------------------------------
// CPTCodingService
// ---------------------------------------------------------------------------

export class CPTCodingService {
  static readonly COMMON_CPT_CODES: ReadonlyMap<string, string> =
    buildCommonCPTCodes();

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  async extractCPTCodes(input: CPTExtractionInput): Promise<CPTCodingResult> {
    if (!input.englishText || input.englishText.trim().length === 0) {
      logger.warn('[CPT Coding] Empty input text received');
      return {
        codes: [],
        modelUsed: getResolvedModelId(),
        processingPath: 'cpt-extraction',
        unbundlingWarnings: [],
      };
    }

    logger.info(
      `[CPT Coding] Extracting codes, text length: ${input.englishText.length}`,
    );

    const prompt = this.buildPrompt(input);

    try {
      const rawResponse = await invokeBedrockModel(prompt, {
        maxTokens: 8192,
        temperature: 0.1,
      });

      const parsed = this.parseResponse(rawResponse);
      const validatedCodes = parsed.codes.map((code) =>
        this.enrichCode(code),
      );

      const llmWarnings = parsed.unbundlingWarnings;
      const ruleWarnings = CPTCodingService.checkUnbundling(validatedCodes);
      const allWarnings = deduplicateWarnings([...llmWarnings, ...ruleWarnings]);

      logger.info(
        `[CPT Coding] Extracted ${validatedCodes.length} codes, ${allWarnings.length} unbundling warnings`,
      );

      return {
        codes: validatedCodes,
        modelUsed: getResolvedModelId(),
        processingPath: 'cpt-extraction',
        unbundlingWarnings: allWarnings,
      };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      logger.error(`[CPT Coding] Extraction failed: ${message}`);
      throw new Error(`CPT coding failed: ${message}`);
    }
  }

  // -----------------------------------------------------------------------
  // Static helpers
  // -----------------------------------------------------------------------

  static checkUnbundling(codes: ReadonlyArray<CPTCode>): ReadonlyArray<string> {
    return UNBUNDLING_RULES.flatMap((rule) => rule.check(codes));
  }

  static validateCodeFormat(code: string): boolean {
    const trimmed = code.trim();
    return (
      CPT_CODE_BASE_PATTERN.test(trimmed) ||
      CPT_CODE_MODIFIER_PATTERN.test(trimmed)
    );
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private buildPrompt(input: CPTExtractionInput): string {
    const sections: string[] = [CPT_CODING_PROMPT];

    sections.push(`<CLINICAL_TEXT>\n${input.englishText}\n</CLINICAL_TEXT>\n`);

    if (input.treatmentDescription) {
      sections.push(
        `<TREATMENT_DESCRIPTION>\n${input.treatmentDescription}\n</TREATMENT_DESCRIPTION>\n`,
      );
    }

    if (input.procedures && input.procedures.length > 0) {
      sections.push(
        `<LISTED_PROCEDURES>\n${input.procedures.join('\n')}\n</LISTED_PROCEDURES>\n`,
      );
    }

    if (input.icdCodes && input.icdCodes.length > 0) {
      const icdList = input.icdCodes
        .map((c) => `- ${c.code}: ${c.description}`)
        .join('\n');
      sections.push(
        `<ICD10_CODES_ALREADY_ASSIGNED>\n${icdList}\n</ICD10_CODES_ALREADY_ASSIGNED>\n`,
      );
    }

    if (input.treatmentType) {
      sections.push(`Treatment type: ${input.treatmentType}\n`);
    }

    sections.push(CPT_CODING_SUFFIX);

    return sections.join('\n');
  }

  private parseResponse(raw: string): {
    readonly codes: ReadonlyArray<CPTCode>;
    readonly unbundlingWarnings: ReadonlyArray<string>;
  } {
    try {
      const jsonStr = extractJsonFromResponse(raw);
      const parsed = JSON.parse(jsonStr);
      const rawProcedures: unknown[] = parsed.procedures ?? [];
      const rawWarnings: unknown[] = parsed.unbundlingWarnings ?? [];

      const codes: CPTCode[] = rawProcedures
        .filter((p): p is Record<string, unknown> => isNonNullObject(p))
        .filter((p) => {
          const code = String(p.code ?? '').trim();
          if (!CPTCodingService.validateCodeFormat(code)) {
            logger.warn(
              `[CPT Coding] Dropping invalid code format: "${code}"`,
            );
            return false;
          }
          return true;
        })
        .map((p) => mapRawToCPTCode(p));

      const warnings = rawWarnings
        .map((w) => String(w).trim())
        .filter((w) => w.length > 0);

      return { codes, unbundlingWarnings: warnings };
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : String(error);
      logger.error(`[CPT Coding] Failed to parse LLM response: ${message}`);
      logger.error(
        `[CPT Coding] Raw response (first 500 chars): ${raw.substring(0, 500)}`,
      );
      return { codes: [], unbundlingWarnings: [] };
    }
  }

  private enrichCode(code: CPTCode): CPTCode {
    const knownDescription = CPTCodingService.COMMON_CPT_CODES.get(code.code);
    const category = normalizeCategory(code.category);
    const needsReview =
      code.needsReview || code.confidence < 0.6 || !knownDescription;

    return {
      ...code,
      description: knownDescription ?? code.description,
      category,
      needsReview,
    };
  }
}

// ---------------------------------------------------------------------------
// Pure utility functions
// ---------------------------------------------------------------------------

function extractJsonFromResponse(raw: string): string {
  let str = raw.trim();

  // Remove markdown code blocks if present
  const fenceMatch = str.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    str = fenceMatch[1].trim();
  }

  // Find the outermost JSON object
  const objectStart = str.indexOf('{');
  const objectEnd = str.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd !== -1 && objectEnd > objectStart) {
    return str.substring(objectStart, objectEnd + 1);
  }

  return str;
}

function isNonNullObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mapRawToCPTCode(raw: Record<string, unknown>): CPTCode {
  const confidence = normalizeConfidence(raw.confidence);
  const relatedIcdCodes = Array.isArray(raw.relatedIcdCodes)
    ? raw.relatedIcdCodes.map((c: unknown) => String(c))
    : [];

  return {
    code: String(raw.code ?? '').trim(),
    description: String(raw.description ?? '').trim(),
    category: String(raw.category ?? 'Medicine').trim(),
    confidence,
    evidenceText: String(raw.evidenceText ?? '').trim(),
    relatedIcdCodes,
    isConsistentWithDiagnosis: raw.isConsistentWithDiagnosis === true,
    needsReview: raw.needsReview === true || confidence < 0.6,
  };
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === 'number') {
    // Handle both 0-1 and 0-100 scales; normalize to 0-1
    const normalized = value > 1 ? value / 100 : value;
    return Math.max(0, Math.min(1, Math.round(normalized * 100) / 100));
  }
  if (typeof value === 'string') {
    const num = parseFloat(value);
    if (!isNaN(num)) {
      const normalized = num > 1 ? num / 100 : num;
      return Math.max(0, Math.min(1, Math.round(normalized * 100) / 100));
    }
  }
  return 0.5;
}

function normalizeCategory(category: string): string {
  const trimmed = category.trim();
  const match = VALID_CATEGORIES.find(
    (valid) => valid.toLowerCase() === trimmed.toLowerCase(),
  );
  return match ?? 'Medicine';
}

function deduplicateWarnings(warnings: ReadonlyArray<string>): ReadonlyArray<string> {
  const seen = new Set<string>();
  return warnings.filter((w) => {
    const lower = w.toLowerCase();
    if (seen.has(lower)) {
      return false;
    }
    seen.add(lower);
    return true;
  });
}
