import { ICDCode, CodingResult, ReconciliationResult } from '../../shared/types';

const AGREEMENT_CONFIDENCE_BOOST = 10;
const MIN_CONFIDENCE_THRESHOLD = 40;

export function reconcileResults(
  directResult: CodingResult | null,
  translationResult: CodingResult | null
): ReconciliationResult {
  const directCodes = directResult?.codes || [];
  const translationCodes = translationResult?.codes || [];

  console.log(
    `[Reconciliation] Merging ${directCodes.length} direct codes + ${translationCodes.length} translation codes`
  );

  // If both paths are empty, return early
  if (directCodes.length === 0 && translationCodes.length === 0) {
    return emptyResult();
  }

  let finalCodes: ICDCode[] = [];
  let directOnly: ICDCode[] = [];
  let translationOnly: ICDCode[] = [];
  let agreed: ICDCode[] = [];
  const warnings: string[] = [];

  if (directCodes.length > 0 && translationCodes.length === 0) {
    finalCodes = directCodes.filter(c => c.confidence >= MIN_CONFIDENCE_THRESHOLD);
    directOnly = directCodes;
    warnings.push('Only direct path produced results. Translation coding returned no codes.');
  } else if (directCodes.length === 0 && translationCodes.length > 0) {
    finalCodes = translationCodes.filter(c => c.confidence >= MIN_CONFIDENCE_THRESHOLD);
    translationOnly = translationCodes;
    warnings.push('Only translation path produced results. Direct coding returned no codes.');
  } else {
    // Both paths have results - reconcile
    const translationCodeMap = new Map<string, ICDCode>();
    for (const code of translationCodes) {
      const normalized = normalizeCode(code.code);
      translationCodeMap.set(normalized, code);
    }

    const matchedTranslationCodes = new Set<string>();

    // Match direct codes against translation codes
    for (const directCode of directCodes) {
      const normalized = normalizeCode(directCode.code);
      const translationMatch = translationCodeMap.get(normalized);

      if (translationMatch) {
        // Both paths agree on this code
        matchedTranslationCodes.add(normalized);

        const mergedConfidence = Math.min(
          100,
          Math.max(directCode.confidence, translationMatch.confidence) + AGREEMENT_CONFIDENCE_BOOST
        );

        agreed.push({
          code: directCode.code,
          description: directCode.description || translationMatch.description,
          confidence: mergedConfidence,
          confidenceLevel: mergedConfidence >= 85 ? 'high' : mergedConfidence >= 65 ? 'medium' : 'low',
          evidenceSourceText: directCode.evidenceSourceText || translationMatch.evidenceSourceText,
          evidenceTranslatedText: translationMatch.evidenceTranslatedText || translationMatch.evidenceSourceText,
          pageNumber: directCode.pageNumber || translationMatch.pageNumber,
          section: directCode.section || translationMatch.section,
          pathUsed: 'both',
          reasoningSummary: `Agreed by both paths. Direct: ${directCode.reasoningSummary}. Translation: ${translationMatch.reasoningSummary}`,
          needsHumanReview: mergedConfidence < 70,
        });
      } else {
        // Only found by direct path
        directOnly.push({
          ...directCode,
          needsHumanReview: true,
          reasoningSummary: `Found only via direct coding. ${directCode.reasoningSummary}`,
        });

        // Check if there's a close match (same category)
        const category = normalized.substring(0, 3);
        const closeMatches = translationCodes.filter(
          tc => normalizeCode(tc.code).startsWith(category)
        );
        if (closeMatches.length > 0) {
          warnings.push(
            `Code ${directCode.code} found only in direct path, but similar codes (${closeMatches.map(c => c.code).join(', ')}) found in translation path. May need review.`
          );
        }
      }
    }

    // Find translation-only codes
    for (const transCode of translationCodes) {
      const normalized = normalizeCode(transCode.code);
      if (!matchedTranslationCodes.has(normalized)) {
        translationOnly.push({
          ...transCode,
          needsHumanReview: true,
          reasoningSummary: `Found only via translation path. ${transCode.reasoningSummary}`,
        });
      }
    }

    finalCodes = [
      ...agreed,
      ...directOnly.filter(c => c.confidence >= MIN_CONFIDENCE_THRESHOLD),
      ...translationOnly.filter(c => c.confidence >= MIN_CONFIDENCE_THRESHOLD),
    ];
  }

  // Common sorting and deduplication for all cases
  finalCodes.sort((a, b) => b.confidence - a.confidence);


  // Deduplicate by code
  const seen = new Set<string>();
  const deduped = finalCodes.filter(c => {
    const norm = normalizeCode(c.code);
    if (seen.has(norm)) return false;
    seen.add(norm);
    return true;
  });

  // Add summary warnings
  if (directOnly.length > 0) {
    warnings.push(`${directOnly.length} code(s) found only by direct coding path.`);
  }
  if (translationOnly.length > 0) {
    warnings.push(`${translationOnly.length} code(s) found only by translation coding path.`);
  }
  if (agreed.length > 0) {
    warnings.push(`${agreed.length} code(s) agreed upon by both paths (confidence boosted).`);
  }

  const lowConfidence = deduped.filter(c => c.confidence < 60);
  if (lowConfidence.length > 0) {
    warnings.push(`${lowConfidence.length} code(s) have low confidence (<60%) and need human review.`);
  }

  console.log(
    `[Reconciliation] Final: ${deduped.length} codes (${agreed.length} agreed, ${directOnly.length} direct-only, ${translationOnly.length} translation-only)`
  );

  return {
    finalCodes: deduped,
    directOnlyCodes: directOnly,
    translationOnlyCodes: translationOnly,
    agreedCodes: agreed,
    warnings,
  };
}

function normalizeCode(code: string): string {
  return code.replace(/[.\s-]/g, '').toUpperCase();
}

function emptyResult(): ReconciliationResult {
  return {
    finalCodes: [],
    directOnlyCodes: [],
    translationOnlyCodes: [],
    agreedCodes: [],
    warnings: ['No ICD codes were extracted from either coding path.'],
  };
}
