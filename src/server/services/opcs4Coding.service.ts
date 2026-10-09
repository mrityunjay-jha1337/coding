import { invokeBedrockModel, getResolvedModelId } from './bedrockClient';
import { logger } from '../config/logger';

// ─── Types ─────────────────────────────────────────

export interface OPCS4Code {
  readonly code: string;
  readonly description: string;
  readonly chapter: string;
  readonly confidence: number;
  readonly evidenceText: string;
  readonly relatedIcdCodes: ReadonlyArray<string>;
  readonly isConsistentWithDiagnosis: boolean;
  readonly needsReview: boolean;
}

export interface OPCS4CodingResult {
  readonly codes: ReadonlyArray<OPCS4Code>;
  readonly modelUsed: string;
  readonly processingPath: string;
  readonly warnings: ReadonlyArray<string>;
}

export interface OPCS4ExtractionInput {
  readonly englishText: string;
  readonly treatmentDescription?: string;
  readonly procedures?: ReadonlyArray<string>;
  readonly icdCodes?: ReadonlyArray<{ code: string; description: string }>;
  readonly treatmentType?: string;
}

// ─── Constants ─────────────────────────────────────

// OPCS-4 format: 1 letter + 3 digits + optional .digit (e.g., G45.1, W37.2, H22.9)
// Valid chapters: A-H, J-N, P-Z (I and O excluded)
export const OPCS4_PATTERN = /^[A-HJ-NP-Z]\d{2}(\.\d)?$/i;

const VALID_CHAPTERS = new Set('ABCDEFGHJKLMNPQRSTUVWXYZ'.split(''));

// Common OPCS-4 codes for quick validation/enrichment
export const COMMON_OPCS4_CODES: ReadonlyMap<string, string> = new Map([
  // Chapter G — Upper digestive tract
  ['G45.1', 'Diagnostic oesophagogastroduodenoscopy'],
  ['G65.8', 'Other specified diagnostic endoscopic examination of colon'],
  ['G80.1', 'Excision of lesion of colon (endoscopic)'],

  // Chapter H — Lower digestive tract
  ['H01.1', 'Emergency excision of appendix'],
  ['H33.1', 'Laparoscopic cholecystectomy'],

  // Chapter J — Heart
  ['J09.1', 'Aortic valve replacement using prosthesis'],
  ['J40.4', 'Percutaneous transluminal balloon angioplasty of coronary artery'],

  // Chapter K — Arteries and veins
  ['K50.1', 'Primary repair of inguinal hernia'],

  // Chapter T — Soft tissue
  ['T20.1', 'Primary repair of tendon of hand'],

  // Chapter W — Musculoskeletal
  ['W37.1', 'Primary total replacement of hip joint using cement'],
  ['W40.1', 'Primary total replacement of knee joint using cement'],
  ['W19.1', 'Primary open reduction of fracture of bone and internal fixation'],

  // Chapter X — Miscellaneous operations
  ['X29.2', 'Computed tomography of head'],
  ['X32.1', 'Magnetic resonance imaging of head'],

  // Chapter Y — Subsidiary classification of methods of operation
  ['Y53.1', 'Approach to organ under ultrasonic guidance'],
  ['Y76.8', 'Other specified general anaesthetic using endotracheal intubation'],
]);

// Confidence thresholds
const REVIEW_THRESHOLD = 0.6;

// ─── Validation ────────────────────────────────────

/**
 * Validate an OPCS-4 code format.
 */
export function isValidOPCS4Code(code: string): boolean {
  return OPCS4_PATTERN.test(code.toUpperCase().trim());
}

/**
 * Get the chapter letter from an OPCS-4 code.
 */
export function getChapter(code: string): string {
  return code.charAt(0).toUpperCase();
}

/**
 * Check if the chapter letter is valid for OPCS-4.
 */
export function isValidChapter(chapter: string): boolean {
  return VALID_CHAPTERS.has(chapter.toUpperCase());
}

// ─── Service ───────────────────────────────────────

export async function extractOPCS4Codes(input: OPCS4ExtractionInput): Promise<OPCS4CodingResult> {
  const modelId = await getResolvedModelId();
  const warnings: string[] = [];

  const icdContext = input.icdCodes?.length
    ? `\nAssociated ICD-10 diagnoses:\n${input.icdCodes.map(c => `- ${c.code}: ${c.description}`).join('\n')}`
    : '';

  const prompt = `You are an expert UK medical coder specialising in OPCS-4 (Office of Population Censuses and Surveys Classification of Surgical Operations and Procedures, 4th revision).

Analyse the following clinical text and extract all OPCS-4 procedure codes.
${icdContext}

Rules:
1. OPCS-4 codes consist of: 1 letter (A-H, J-N, P-Z — letters I and O are excluded) + 3 digits + optional decimal digit
   Examples: G45.1, W37.1, H33.1, J40.4
2. Assign the MOST SPECIFIC code supported by the evidence
3. Include a confidence score (0.0-1.0):
   - 0.90-1.00: Procedure explicitly stated with OPCS-4 code
   - 0.75-0.89: Procedure clearly described, code inferred with high confidence
   - 0.60-0.74: Reasonable inference, may need confirmation
   - 0.40-0.59: Speculative, flag for review
4. For each code, cite the specific text evidence
5. Check consistency with ICD-10 diagnoses if provided

Return valid JSON array:
[{
  "code": "W37.1",
  "description": "Primary total replacement of hip joint using cement",
  "chapter": "W",
  "confidence": 0.92,
  "evidenceText": "Patient underwent cemented total hip replacement",
  "relatedIcdCodes": ["M16.1"],
  "isConsistentWithDiagnosis": true
}]

Clinical text:
${input.englishText.slice(0, 10000)}`;

  const response = await invokeBedrockModel(prompt, {
    modelId,
    maxTokens: 4096,
    temperature: 0.1,
  });

  // Parse and validate response
  let rawCodes: any[];
  try {
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    rawCodes = jsonMatch ? JSON.parse(jsonMatch[0]) : [];
  } catch {
    logger.warn('Failed to parse OPCS-4 extraction response');
    rawCodes = [];
  }

  const codes: OPCS4Code[] = [];
  for (const raw of rawCodes) {
    const code = String(raw.code ?? '').toUpperCase().trim();

    // Validate format
    if (!OPCS4_PATTERN.test(code)) {
      warnings.push(`Invalid OPCS-4 format: ${code}`);
      continue;
    }

    // Validate chapter
    const chapter = code.charAt(0);
    if (!VALID_CHAPTERS.has(chapter)) {
      warnings.push(`Invalid OPCS-4 chapter: ${chapter} in code ${code}`);
      continue;
    }

    const confidence = Math.max(0, Math.min(1, Number(raw.confidence) || 0));

    // Enrich from known codes
    const knownDescription = COMMON_OPCS4_CODES.get(code);

    codes.push({
      code,
      description: knownDescription ?? String(raw.description ?? ''),
      chapter,
      confidence,
      evidenceText: String(raw.evidenceText ?? ''),
      relatedIcdCodes: Array.isArray(raw.relatedIcdCodes) ? raw.relatedIcdCodes : [],
      isConsistentWithDiagnosis: Boolean(raw.isConsistentWithDiagnosis),
      needsReview: confidence < REVIEW_THRESHOLD,
    });
  }

  return {
    codes,
    modelUsed: modelId,
    processingPath: 'opcs4_extraction',
    warnings,
  };
}
