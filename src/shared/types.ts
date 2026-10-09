// Shared types for ICD-10 Coding Pipeline

export type DetectedLanguage = string; // 'english' | 'non-english' | 'mixed'
export type CodingPath = 'direct' | 'translation' | 'both';
export type ConfidenceLevel = 'high' | 'medium' | 'low';

export interface PageText {
  pageNumber: number;
  text: string;
}

export interface PdfExtractionResult {
  fileName: string;
  totalPages: number;
  pages: PageText[];
  fullText: string;
  isScanned: boolean;
  legibilityScore?: number;
  handwrittenPercent?: number;
  extractedAt: string;
}

export interface LanguageDetectionResult {
  language: DetectedLanguage;
  specificLanguage?: string;
  nonLatinCharRatio: number;
  englishCharRatio: number;
  detectedScripts: string[];
  confidence: number;
  sampleText: string;
}

export interface TranslationResult {
  originalText: string;
  translatedText: string;
  sourceLanguage: string;
  targetLanguage: string;
  preservedTerms: string[];
}

export interface ICDCode {
  id?: string;
  code: string;
  description: string;
  llmDescription?: string;
  isValidated?: boolean;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  evidenceSourceText: string;
  evidenceTranslatedText: string;
  pageNumber: number | null;
  section: string;
  pathUsed: CodingPath;
  reasoningSummary: string;
  needsHumanReview: boolean;
}

export interface CodingResult {
  codes: ICDCode[];
  modelUsed: string;
  processingPath: CodingPath;
  rawResponse?: string;
}

export interface ReconciliationResult {
  finalCodes: ICDCode[];
  directOnlyCodes: ICDCode[];
  translationOnlyCodes: ICDCode[];
  agreedCodes: ICDCode[];
  warnings: string[];
}

export interface PipelineResult {
  claimId?: string;
  fileName: string;
  processedAt: string;
  extraction: PdfExtractionResult;
  languageDetection: LanguageDetectionResult;
  translation: TranslationResult | null;
  directCoding: CodingResult | null;
  translationCoding: CodingResult | null;
  reconciliation: ReconciliationResult;
  processingTimeMs: number;
  errors: string[];
}

export interface ProcessingStatus {
  step: string;
  message: string;
  progress: number; // 0-100
}

export interface ApiErrorResponse {
  error: string;
  details?: string;
}
