import { LanguageDetectionResult } from '../../shared/types';
import franc from 'franc';

// Unicode ranges for non-Latin scripts
const SCRIPT_PATTERNS: Record<string, RegExp> = {
  cjk: /[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g,
  arabic: /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/g,
  devanagari: /[\u0900-\u097F\uA8E0-\uA8FF]/g,
  thai: /[\u0E00-\u0E7F]/g,
  korean: /[\uAC00-\uD7AF\u1100-\u11FF\u3130-\u318F]/g,
  japanese_kana: /[\u3040-\u309F\u30A0-\u30FF\u31F0-\u31FF]/g,
  cyrillic: /[\u0400-\u04FF\u0500-\u052F]/g,
  bengali: /[\u0980-\u09FF]/g,
  tamil: /[\u0B80-\u0BFF]/g,
  telugu: /[\u0C00-\u0C7F]/g,
  gujarati: /[\u0A80-\u0AFF]/g,
  hebrew: /[\u0590-\u05FF\uFB1D-\uFB4F]/g,
  georgian: /[\u10A0-\u10FF\u2D00-\u2D2F]/g,
  armenian: /[\u0530-\u058F]/g,
  ethiopic: /[\u1200-\u137F]/g,
  myanmar: /[\u1000-\u109F]/g,
  khmer: /[\u1780-\u17FF]/g,
  lao: /[\u0E80-\u0EFF]/g,
  sinhala: /[\u0D80-\u0DFF]/g,
  kannada: /[\u0C80-\u0CFF]/g,
  malayalam: /[\u0D00-\u0D7F]/g,
  gurmukhi: /[\u0A00-\u0A7F]/g,
};

const LATIN_PATTERN = /[a-zA-Z]/g;

// If English characters make up at least this fraction, consider the text English
const ENGLISH_DOMINANT_THRESHOLD = 0.75;
// If non-Latin characters make up at least this fraction, consider the text non-English
const NON_ENGLISH_THRESHOLD = 0.10;

/**
 * ISO 639-3 codes for languages that use primarily Latin script.
 * franc returns these codes; we map them to human-readable names.
 */
const LATIN_SCRIPT_LANGUAGES: Record<string, string> = {
  fra: 'French', spa: 'Spanish', deu: 'German', por: 'Portuguese',
  ita: 'Italian', nld: 'Dutch', ron: 'Romanian', pol: 'Polish',
  ces: 'Czech', slk: 'Slovak', hun: 'Hungarian', fin: 'Finnish',
  swe: 'Swedish', nor: 'Norwegian', nno: 'Norwegian Nynorsk', nob: 'Norwegian Bokmal',
  dan: 'Danish', tur: 'Turkish', vie: 'Vietnamese', ind: 'Indonesian',
  msa: 'Malay', cat: 'Catalan', hrv: 'Croatian', slv: 'Slovenian',
  lit: 'Lithuanian', lav: 'Latvian', est: 'Estonian', sqi: 'Albanian',
  eus: 'Basque', glg: 'Galician', afr: 'Afrikaans', swa: 'Swahili',
  tgl: 'Tagalog', ceb: 'Cebuano', hat: 'Haitian Creole',
};

/**
 * Map from detected script name to most likely language.
 */
const SCRIPT_TO_LANGUAGE: Record<string, string> = {
  cjk: 'Chinese', japanese_kana: 'Japanese', korean: 'Korean',
  arabic: 'Arabic', devanagari: 'Hindi', bengali: 'Bengali',
  tamil: 'Tamil', telugu: 'Telugu', thai: 'Thai', cyrillic: 'Russian',
  hebrew: 'Hebrew', georgian: 'Georgian', armenian: 'Armenian',
  gujarati: 'Gujarati', kannada: 'Kannada', malayalam: 'Malayalam',
  gurmukhi: 'Punjabi', myanmar: 'Burmese', khmer: 'Khmer',
  lao: 'Lao', sinhala: 'Sinhala', ethiopic: 'Amharic',
};

/**
 * Use franc to detect the specific language for Latin-script text.
 * This catches French, Spanish, German, etc. that Unicode heuristics miss.
 */
function detectLatinScriptLanguage(text: string): { isEnglish: boolean; detectedLanguage: string } {
  const sample = text.slice(0, 2000);
  if (sample.length < 50) {
    return { isEnglish: true, detectedLanguage: 'English' };
  }

  const langCode = franc(sample);

  if (langCode === 'und' || langCode === 'eng') {
    return { isEnglish: true, detectedLanguage: 'English' };
  }

  const languageName = LATIN_SCRIPT_LANGUAGES[langCode];
  if (languageName) {
    return { isEnglish: false, detectedLanguage: languageName };
  }

  // Unknown franc code — default to English
  return { isEnglish: true, detectedLanguage: 'English' };
}

export function detectLanguage(text: string): LanguageDetectionResult {
  if (!text || text.trim().length === 0) {
    return {
      language: 'english',
      specificLanguage: 'English',
      nonLatinCharRatio: 0,
      englishCharRatio: 0,
      detectedScripts: [],
      confidence: 0,
      sampleText: '',
    };
  }

  // Count against non-whitespace total so whitespace-heavy docs don't skew ratios
  const nonWhitespace = text.replace(/\s/g, '');
  const totalChars = nonWhitespace.length || 1;

  const englishMatches = nonWhitespace.match(LATIN_PATTERN) || [];
  const englishRatio = englishMatches.length / totalChars;

  // Detect which non-Latin scripts are present
  const detectedScripts: string[] = [];
  let totalNonLatinCount = 0;

  for (const [script, pattern] of Object.entries(SCRIPT_PATTERNS)) {
    const matches = nonWhitespace.match(new RegExp(pattern.source, 'g')) || [];
    if (matches.length > 0) {
      detectedScripts.push(script);
      totalNonLatinCount += matches.length;
    }
  }

  const nonLatinRatio = totalNonLatinCount / totalChars;

  let language: string;
  let confidence: number;
  let specificLanguage: string = 'English';

  if (nonLatinRatio < NON_ENGLISH_THRESHOLD && englishRatio >= ENGLISH_DOMINANT_THRESHOLD) {
    // Unicode heuristic says English — double-check with franc for Latin-script languages
    const francResult = detectLatinScriptLanguage(text);
    if (!francResult.isEnglish) {
      language = 'non-english';
      specificLanguage = francResult.detectedLanguage;
      confidence = 85;
      detectedScripts.push(`latin-${francResult.detectedLanguage.toLowerCase()}`);
      console.log(`[Language Detection] franc override: "${francResult.detectedLanguage}" (was classified as English by Unicode heuristic)`);
    } else {
      language = 'english';
      specificLanguage = 'English';
      confidence = Math.round(Math.min(englishRatio * 100, 100));
    }
  } else if (nonLatinRatio >= NON_ENGLISH_THRESHOLD && englishRatio >= 0.20) {
    // Mix of English and another language
    language = 'mixed';
    confidence = Math.round(Math.min((nonLatinRatio + englishRatio) * 100, 100));
    specificLanguage = SCRIPT_TO_LANGUAGE[detectedScripts[0]] || 'Unknown';
  } else if (nonLatinRatio >= NON_ENGLISH_THRESHOLD) {
    // Predominantly non-English
    language = 'non-english';
    confidence = Math.round(Math.min(nonLatinRatio * 3 * 100, 100));
    specificLanguage = SCRIPT_TO_LANGUAGE[detectedScripts[0]] || 'Unknown';
  } else {
    // Low character density or ambiguous — default to English
    language = 'english';
    specificLanguage = 'English';
    confidence = Math.round(Math.min(englishRatio * 1.5 * 100, 100));
  }

  console.log(
    `[Language Detection] English chars: ${englishMatches.length}/${totalChars} (${(englishRatio * 100).toFixed(1)}%), ` +
    `Non-Latin chars: ${totalNonLatinCount}/${totalChars} (${(nonLatinRatio * 100).toFixed(1)}%), ` +
    `Scripts: [${detectedScripts.join(', ')}], ` +
    `Detected: ${language} / ${specificLanguage} (confidence: ${confidence}%)`
  );

  return {
    language,
    specificLanguage,
    nonLatinCharRatio: Math.round(nonLatinRatio * 1000) / 1000,
    englishCharRatio: Math.round(englishRatio * 1000) / 1000,
    detectedScripts,
    confidence,
    sampleText: text.substring(0, 200).trim(),
  };
}
