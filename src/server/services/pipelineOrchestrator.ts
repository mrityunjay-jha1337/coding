import { PipelineResult, CodingResult } from '../../shared/types';
import { parsePdf } from './pdfParserService';
import { detectLanguage } from './languageDetectionService';
import { translateMedicalText } from './translationService';
import { extractICDCodes } from './icdCodingService';
import { reconcileResults } from './reconciliationService';

/**
 * Pipeline flow:
 * 1. Extract text from PDF via Claude Vision (handles handwritten, all languages)
 * 2. Detect language of extracted text
 * 3. Translate extracted text to English (if non-English)
 * 4. Extract ICD-10 codes from English text (single path — trust LLM output)
 * 5. Return structured results
 */
export async function processPdf(filePath: string): Promise<PipelineResult> {
  const startTime = Date.now();
  const errors: string[] = [];

  // ── Step 1: Extract text from PDF using visual model ──
  console.log('[Pipeline] Step 1: Extracting text from PDF (visual model)...');
  const extraction = await parsePdf(filePath);

  if (!extraction.fullText.trim()) {
    return emptyResult(extraction, Date.now() - startTime, [
      'No text could be extracted from the PDF. It may be a blank or corrupted document.',
    ]);
  }

  console.log(`[Pipeline] Step 1 done: ${extraction.fullText.length} chars extracted`);

  // ── Step 2: Detect language ──
  console.log('[Pipeline] Step 2: Detecting language...');
  const languageDetection = detectLanguage(extraction.fullText);
  const detectedLang = languageDetection.specificLanguage || languageDetection.language;

  // ── Step 3: Translate to English (only if non-English text detected) ──
  let translation = null;
  let englishText = extraction.fullText;
  const needsTranslation = languageDetection.language !== 'english';

  if (needsTranslation) {
    console.log(`[Pipeline] Step 3: Translating extracted text to English (detected: ${detectedLang})...`);
    try {
      translation = await translateMedicalText(extraction.fullText, detectedLang);
      if (translation.translatedText.trim()) {
        englishText = translation.translatedText;
        console.log(`[Pipeline] Step 3 done: ${englishText.length} chars translated`);
      } else {
        errors.push('Translation returned empty text. Falling back to original text for coding.');
      }
    } catch (error: any) {
      errors.push(`Translation failed: ${error.message}. Falling back to original text for coding.`);
    }
  } else {
    console.log('[Pipeline] Step 3: Skipped — text is already in English.');
  }

  // ── Step 4: Extract ICD-10 codes from English text (single path) ──
  console.log('[Pipeline] Step 4: Extracting ICD-10 codes from English text...');
  let codingResult: CodingResult | null = null;

  try {
    const codingPath = needsTranslation ? 'translation' : 'direct';
    codingResult = await extractICDCodes(
      englishText, codingPath, extraction.fullText, detectedLang
    );
    console.log(`[Pipeline] Step 4 done: ${codingResult.codes.length} codes extracted`);
  } catch (error: any) {
    errors.push(`ICD-10 extraction failed: ${error.message}`);
  }

  // ── Step 5: Build reconciliation result from single path ──
  const reconciliation = codingResult
    ? reconcileResults(codingResult, null)
    : {
        finalCodes: [],
        directOnlyCodes: [],
        translationOnlyCodes: [],
        agreedCodes: [],
        warnings: errors.length > 0 ? errors : ['No ICD codes were extracted.'],
      };

  // Append pipeline errors to reconciliation warnings
  if (errors.length > 0) {
    reconciliation.warnings.push(...errors);
  }

  // ── Build result ──
  const processingTimeMs = Date.now() - startTime;
  console.log(`[Pipeline] Complete: ${reconciliation.finalCodes.length} final codes in ${(processingTimeMs / 1000).toFixed(1)}s`);

  return {
    fileName: extraction.fileName,
    processedAt: new Date().toISOString(),
    extraction,
    languageDetection,
    translation,
    directCoding: codingResult,
    translationCoding: null,
    reconciliation,
    processingTimeMs,
    errors,
  };
}

function emptyResult(extraction: any, processingTimeMs: number, errors: string[]): PipelineResult {
  return {
    fileName: extraction.fileName,
    processedAt: new Date().toISOString(),
    extraction,
    languageDetection: {
      language: 'english',
      specificLanguage: 'English',
      nonLatinCharRatio: 0,
      englishCharRatio: 0,
      detectedScripts: [],
      confidence: 0,
      sampleText: '',
    },
    translation: null,
    directCoding: null,
    translationCoding: null,
    reconciliation: {
      finalCodes: [],
      directOnlyCodes: [],
      translationOnlyCodes: [],
      agreedCodes: [],
      warnings: errors,
    },
    processingTimeMs,
    errors,
  };
}
