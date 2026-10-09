import { ICDCode, CodingResult, CodingPath, ConfidenceLevel } from '../../shared/types';
import { invokeBedrockModel, getResolvedModelId } from './bedrockClient';
import { lookupICD10 } from './icd10Lookup';

const ICD_CODING_PROMPT = `You are a senior certified medical coder with deep expertise in the ICD-10 classification system. You work with hospital documents from different countries and writing styles.

YOUR TASK: Analyze the medical document text below and extract ONLY ICD-10 diagnosis and procedure-encounter codes that have a DIRECT textual or procedural basis in the document. Do NOT speculate beyond what the text supports.

═══════════════════════════════════════════
STEP 1 — UNDERSTAND THE DOCUMENT TYPE
═══════════════════════════════════════════

Before coding, determine what kind of document this is:
- Clinical note / discharge summary → code diagnoses directly from clinical findings
- Hospital billing statement / receipt → code symptom/investigation encounters (R/Z chapters) or the narrow differential implied by the specific procedure performed
- Mixed document → use both clinical text and procedure context

For a billing receipt WITHOUT explicit diagnoses:
- Only assign codes for conditions or encounter types that are directly implied by a procedure LINE ITEM in the document.
- Prefer symptom-level codes (R-chapter) or "encounter for diagnostic examination" Z-codes (e.g., Z13.-, Z03.89) when no diagnosis is stated.
- Set confidence 50-75 and flag needsHumanReview: true.

═══════════════════════════════════════════
STEP 2 — ABSOLUTE RULES (ZERO HALLUCINATION)
═══════════════════════════════════════════

🚫 NEVER assign a code for a condition, treatment, or encounter that is not explicitly named OR directly implied by a specific line item in the document.

🚫 In particular, NEVER assign:
- Z51.11 (antineoplastic chemotherapy) unless the text mentions chemotherapy, oncology, cancer, neoplasm, or a cytotoxic drug.
- Z51.0 (radiotherapy) unless radiotherapy/radiation is mentioned.
- Z51.89 / Z51.81 etc. "encounter for other specified aftercare" unless the specific aftercare is named.
- Pregnancy/obstetric codes (O-chapter) unless pregnancy is mentioned.
- Injury codes (S/T-chapter) unless an injury mechanism is mentioned.
- Mental-health codes (F-chapter) unless psychiatric terms appear.

Every code you emit MUST have an \`evidenceSourceText\` field that quotes the EXACT substring from the document proving the code. If you cannot quote the document, do not emit the code.

═══════════════════════════════════════════
STEP 3 — ICD-10 CODING RULES (SPECIFICITY)
═══════════════════════════════════════════

Use valid ICD-10 diagnosis codes from the official code set (ICD-10, 10th Revision).
- Codes follow the format: [Letter][2+ digits] with optional decimal — e.g., K29.00, J18.9, E11.65, S72.001A
- Chapter range: A00–Z99
- Codes can be 3 to 7 characters (excluding the decimal point).
- Use the MOST SPECIFIC code supported by the evidence. Prefer a named procedure-encounter code over an "unspecified" chapter code:
    • "GASTROSCOPY" → Z13.818 (encounter for screening examination of upper GI) or the suspected dyspepsia code (K30) IF dyspepsia is stated. Avoid K92.9 "digestive system disease, unspecified".
    • "COLONOSCOPY" → Z12.11 (encounter for screening for colon neoplasm) or the indication actually stated. Avoid K63.9 "intestinal disease, unspecified".
    • "HISTOPATHOLOGICAL EXAMINATION" → attach to the specimen's named site if known; do not emit as a freestanding disease code.
    • "ULTRASOUND" → tie to the named anatomical region; use Z01.- "encounter for other special examination" if no target is stated.
- Each code MUST be a real, valid ICD-10 entry. Do NOT fabricate or guess codes.
- If unsure whether a specific code exists, use the broader parent code (e.g., K29 instead of guessing K29.15).
- Prefer specific codes over "unspecified" (*.9) codes whenever the procedure name narrows the differential.

Common chapters relevant to hospital notes:
- A00-B99: Infectious diseases
- C00-D49: Neoplasms
- E00-E89: Endocrine/metabolic
- I00-I99: Circulatory system
- J00-J99: Respiratory system
- K00-K95: Digestive system
- M00-M99: Musculoskeletal
- N00-N99: Genitourinary
- R00-R99: Symptoms/signs (use when no definitive diagnosis)
- S00-T88: Injury/poisoning
- Z00-Z99: Factors influencing health status (encounters, screening, etc.)

═══════════════════════════════════════════
STEP 3 — TEXT EXPECTATIONS
═══════════════════════════════════════════

The input text has already been translated to English. Code based on the English text provided.
- If small non-English fragments remain due to translation gaps, interpret them in medical context and map to the correct WHO ICD-10 codes
- Preserve original source text in evidence quotes exactly as it appears (do not normalize or rewrite source evidence)
- Text may contain [?] markers indicating uncertain handwritten characters — use surrounding context to infer the most likely medical term

═══════════════════════════════════════════
STEP 4 — REASONING AND CONFIDENCE
═══════════════════════════════════════════

For each code, think through:
1. What evidence in the document supports this code?
2. Is the evidence an explicit diagnosis, a procedure suggesting a condition, or an inference?
3. How specific can I be with the available information?

Confidence scoring:
- 90-100: Explicit diagnosis stated in the document
- 75-89: Strong inference from procedures/clinical context
- 60-74: Reasonable inference but would need clinical confirmation
- 40-59: Possible but speculative — flag for human review
- Below 40: Do not include

═══════════════════════════════════════════
OUTPUT FORMAT
═══════════════════════════════════════════

Return ONLY valid JSON. No markdown fences. No commentary before or after the JSON.

{
  "documentType": "billing_receipt | clinical_note | discharge_summary | mixed | other",
  "codes": [
    {
      "code": "K29.1",
      "description": "Other acute gastritis",
      "confidence": 78,
      "evidenceSourceText": "ENDOSCOPIC CHARGE - GASTROSCOPY $2,964",
      "pageNumber": 1,
      "section": "Procedure charges",
      "reasoningSummary": "Gastroscopy was performed, suggesting upper GI investigation. K29.1 assigned as the most likely indication for diagnostic gastroscopy.",
      "needsHumanReview": true
    }
  ]
}

═══════════════════════════════════════════
DOCUMENT TEXT TO CODE:
═══════════════════════════════════════════

<MEDICAL_DOCUMENT>
`;

const ICD_CODING_SUFFIX = `
</MEDICAL_DOCUMENT>

═══════════════════════════════════════════
END OF DOCUMENT — NOW OUTPUT YOUR ICD-10 CODES AS JSON
═══════════════════════════════════════════

Important: The document text above is COMPLETE. Do NOT output more document text.
Respond with ONLY the JSON object containing "documentType" and "codes" array. Nothing else.`;

function buildLanguageContext(path: CodingPath, sourceLanguage?: string): string {
  if (path === 'direct' && sourceLanguage && sourceLanguage !== 'english' && sourceLanguage !== 'English') {
    return `\nIMPORTANT: This text is in ${sourceLanguage} (translation was not available). Extract ICD-10 codes directly from the original language. Many medical terms are recognizable across languages. Focus on medical terminology, procedure names, and diagnostic terms you can identify.\n\n`;
  }
  if (path === 'translation') {
    return `\nNote: This text was translated to English from ${sourceLanguage || 'another language'}. Code based on the English translation. Some medical terms may have been preserved in their original language.\n\n`;
  }
  return '\n';
}

export async function extractICDCodes(
  text: string,
  path: CodingPath,
  sourceText?: string,
  sourceLanguage?: string
): Promise<CodingResult> {
  if (!text || text.trim().length === 0) {
    return {
      codes: [],
      modelUsed: getResolvedModelId(),
      processingPath: path,
    };
  }

  console.log(`[ICD Coding] Extracting codes via ${path} path, text length: ${text.length}, language: ${sourceLanguage || 'unknown'}`);

  const languageContext = buildLanguageContext(path, sourceLanguage);
  const prompt = ICD_CODING_PROMPT + languageContext + text + ICD_CODING_SUFFIX;

  try {
    const rawResponse = await invokeBedrockModel(prompt, {
      maxTokens: 8192,
      temperature: 0.1,
    });

    const codes = parseICDResponse(rawResponse, path, sourceText);

    console.log(`[ICD Coding] Extracted ${codes.length} codes via ${path} path`);

    return {
      codes,
      modelUsed: getResolvedModelId(),
      processingPath: path,
      rawResponse,
    };
  } catch (error: any) {
    console.error('[ICD Coding] Extraction failed:', error.message);
    throw new Error(`ICD coding failed (${path} path): ${error.message}`);
  }
}

/**
 * Codes that should NEVER be emitted unless the source text explicitly
 * mentions the underlying clinical scenario. Used as a last-line defence
 * against well-known LLM hallucinations on billing-receipt inputs.
 */
const CODE_GUARDRAILS: ReadonlyArray<{
  readonly codePrefix: string;
  readonly requiredKeywords: readonly string[];
  readonly label: string;
}> = [
  {
    codePrefix: 'Z51.1',
    requiredKeywords: ['chemo', 'antineoplastic', 'oncolog', 'cancer', 'neoplas', 'cytotox', 'tumor', 'tumour', 'carcinoma'],
    label: 'antineoplastic chemotherapy',
  },
  {
    codePrefix: 'Z51.0',
    requiredKeywords: ['radiother', 'radiation therapy', 'radiation treatment'],
    label: 'radiotherapy',
  },
  {
    codePrefix: 'Z51.89',
    requiredKeywords: ['aftercare', 'follow-up', 'follow up'],
    label: 'specified aftercare',
  },
];

function violatesGuardrail(code: string, sourceText: string): { violated: boolean; label?: string } {
  if (!sourceText) return { violated: false };
  const haystack = sourceText.toLowerCase();
  for (const rule of CODE_GUARDRAILS) {
    if (code.toUpperCase().startsWith(rule.codePrefix)) {
      const anyKeywordPresent = rule.requiredKeywords.some((k) => haystack.includes(k));
      if (!anyKeywordPresent) {
        return { violated: true, label: rule.label };
      }
    }
  }
  return { violated: false };
}

function parseICDResponse(
  raw: string,
  path: CodingPath,
  sourceText?: string
): ICDCode[] {
  try {
    // Try to extract JSON from the response (handle markdown wrapping)
    let jsonStr = raw.trim();

    // Remove markdown code blocks if present
    const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Try to find JSON object
    const objectStart = jsonStr.indexOf('{');
    const objectEnd = jsonStr.lastIndexOf('}');
    if (objectStart !== -1 && objectEnd !== -1) {
      jsonStr = jsonStr.substring(objectStart, objectEnd + 1);
    }

    const parsed = JSON.parse(jsonStr);
    if (parsed.documentType) {
      console.log(`[ICD Coding] Document type detected: ${parsed.documentType}`);
    }
    const rawCodes = parsed.codes || [];

    return rawCodes
    .filter((c: any) => {
      const code = String(c.code || '').trim();
      if (!code) return false;
      // Lenient check: starts with a letter followed by at least 2 digits
      if (!/^[A-Za-z]\d{2}/i.test(code)) {
        console.warn(`[ICD Coding] Dropping invalid code format: "${code}"`);
        return false;
      }
      // Drop codes with no evidence substring — the prompt requires one,
      // so missing evidence means the model invented the code.
      const evidence = String(c.evidenceSourceText || '').trim();
      if (!evidence) {
        console.warn(`[ICD Coding] Dropping code "${code}" — no evidenceSourceText provided by model`);
        return false;
      }
      // Guardrails: reject known-hallucination codes when their underlying
      // clinical keywords are completely absent from the source document.
      const guardrail = violatesGuardrail(code, sourceText || '');
      if (guardrail.violated) {
        console.warn(
          `[ICD Coding] Dropping hallucinated code "${code}" (${guardrail.label}) — no supporting text in document`,
        );
        return false;
      }
      return true;
    })
    .map((c: any) => {
      const rawCode = normalizeCodeFormat(String(c.code || '').trim());
      const dbEntry = lookupICD10(rawCode);

      if (dbEntry) {
        console.log(`[ICD Coding] Code "${rawCode}" validated against ICD-10 database`);
      }

      const officialDescription = dbEntry?.long || dbEntry?.short || '';
      const llmDescription = String(c.description || '').trim();
      const conf = normalizeConfidence(c.confidence);

      return {
        code: dbEntry?.code || rawCode,
        description: officialDescription || llmDescription,
        llmDescription,
        isValidated: !!dbEntry,
        confidence: conf,
        confidenceLevel: getConfidenceLevel(conf),
        evidenceSourceText: String(c.evidenceSourceText || '').trim(),
        evidenceTranslatedText: path === 'translation'
          ? String(c.evidenceSourceText || '').trim()
          : '',
        pageNumber: c.pageNumber || null,
        section: String(c.section || 'Unknown').trim(),
        pathUsed: path,
        reasoningSummary: String(c.reasoningSummary || '').trim(),
        needsHumanReview: c.needsHumanReview === true || conf < 75,
      };
    });
  } catch (error: any) {

    console.error('[ICD Coding] Failed to parse LLM response:', error.message);
    console.error('[ICD Coding] Raw response (first 500 chars):', raw.substring(0, 500));
    return [];
  }
}

function normalizeConfidence(value: any): number {
  if (typeof value === 'number') {
    return Math.max(0, Math.min(100, Math.round(value)));
  }
  if (typeof value === 'string') {
    const num = parseFloat(value);
    if (!isNaN(num)) return Math.max(0, Math.min(100, Math.round(num)));
    if (value.toLowerCase() === 'high') return 90;
    if (value.toLowerCase() === 'medium') return 75;
    if (value.toLowerCase() === 'low') return 50;
  }
  return 50;
}

function getConfidenceLevel(confidence: number): ConfidenceLevel {
  if (confidence >= 90) return 'high';
  if (confidence >= 75) return 'medium';
  return 'low';
}

/**
 * Normalize an ICD-10 code to standard dotted format (e.g., "K2900" → "K29.00").
 * Uppercases, strips whitespace/dashes, and inserts dot after 3rd char if missing.
 */
function normalizeCodeFormat(code: string): string {
  let normalized = code.toUpperCase().replace(/[\s-]/g, '');
  // If 4+ chars and no dot, insert dot after position 3
  if (normalized.length >= 4 && !normalized.includes('.')) {
    normalized = normalized.slice(0, 3) + '.' + normalized.slice(3);
  }
  return normalized;
}
