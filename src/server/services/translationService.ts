import { TranslationResult } from '../../shared/types';
import { invokeBedrockModel } from './bedrockClient';

const TRANSLATION_PROMPT = `You are a medical translator specializing in translating hospital medical records and clinical notes into English.

TASK: Translate the following medical text to English.

RULES:
1. Translate faithfully and completely - do NOT summarize or omit any content
2. Preserve all medical terminology accurately
3. Keep numerical values, dates, and measurements exactly as they appear
4. Translate medical abbreviations to their standard English equivalents
5. If a term has no direct English equivalent, provide the closest medical term and include the original term in parentheses
6. Maintain the original document structure (sections, lists, paragraphs)
7. Preserve patient identifiers as-is (do not translate names)
8. For mixed-language text: if a sentence or section is ALREADY in English, preserve it EXACTLY — do not paraphrase, rephrase, or re-translate English content. Only translate non-English portions.
9. Preserve all "--- Page Break ---" lines exactly as-is — do NOT translate, remove, or modify them
10. Preserve uncertainty markers like [?] exactly as-is — these indicate uncertain handwritten text

OUTPUT: Return ONLY the translated text. No explanations, no notes, no metadata.

`;

const MAX_CHUNK_SIZE = 8000;
const OVERLAP_CHARS = 400;

export async function translateMedicalText(
  text: string,
  sourceLanguage: string = 'unknown'
): Promise<TranslationResult> {
  if (!text || text.trim().length === 0) {
    return {
      originalText: text,
      translatedText: '',
      sourceLanguage,
      targetLanguage: 'english',
      preservedTerms: [],
    };
  }

  console.log(`[Translation] Translating ${text.length} chars from ${sourceLanguage} to English`);

  const langNote = sourceLanguage && sourceLanguage !== 'unknown' && sourceLanguage !== 'non-english'
    ? `Source language: ${sourceLanguage}\n`
    : '';

  let translatedText: string;

  if (text.length <= MAX_CHUNK_SIZE) {
    translatedText = await translateChunk(text, true, langNote);
  } else {
    const chunks = splitIntoChunks(text, MAX_CHUNK_SIZE);
    console.log(`[Translation] Split into ${chunks.length} chunks`);

    const translatedChunks: string[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const translated = await translateChunk(chunks[i], i === 0, langNote);
      translatedChunks.push(translated);
    }
    translatedText = translatedChunks.join('\n\n');
  }

  const preservedTerms = findPreservedTerms(text, translatedText);

  return {
    originalText: text,
    translatedText,
    sourceLanguage,
    targetLanguage: 'english',
    preservedTerms,
  };
}

async function translateChunk(text: string, isFirstChunk: boolean, langNote: string): Promise<string> {
  const contextNote = isFirstChunk
    ? ''
    : 'Note: This text is a continuation from a larger document. The beginning may contain context from the previous section to help with translation continuity. Translate faithfully and completely.\n\n';
  const prompt = TRANSLATION_PROMPT + langNote + contextNote + 'TEXT TO TRANSLATE:\n' + text;

  try {
    const response = await invokeBedrockModel(prompt, {
      maxTokens: 8192,
      temperature: 0.1,
    });
    return response.trim();
  } catch (error: any) {
    console.error('[Translation] Bedrock translation failed:', error.message);
    throw new Error(`Translation failed: ${error.message}`);
  }
}

function splitIntoChunks(text: string, maxSize: number): string[] {
  const chunks: string[] = [];
  const paragraphs = text.split(/\n\s*\n/);
  let currentChunk = '';

  for (const paragraph of paragraphs) {
    if (currentChunk.length + paragraph.length + 2 > maxSize) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
      }
      // Start new chunk with overlap from previous for context continuity
      const overlap = currentChunk.length > OVERLAP_CHARS
        ? currentChunk.slice(-OVERLAP_CHARS)
        : currentChunk;
      currentChunk = overlap + '\n\n' + paragraph;
    } else {
      currentChunk += (currentChunk ? '\n\n' : '') + paragraph;
    }
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks;
}

function findPreservedTerms(original: string, translated: string): string[] {
  const englishTerms = original.match(/[A-Z][a-zA-Z]{2,}/g) || [];
  const uniqueTerms = [...new Set(englishTerms)];
  return uniqueTerms.filter(term => translated.includes(term)).slice(0, 20);
}
