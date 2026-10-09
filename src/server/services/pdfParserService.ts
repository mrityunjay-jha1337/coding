import fs from 'fs';
import path from 'path';
import { PDFDocument, PDFName, PDFString, PDFHexString } from 'pdf-lib';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { PdfExtractionResult, PageText } from '../../shared/types';

const MIN_TEXT_LENGTH_PER_PAGE = 20;
const SCANNED_THRESHOLD = 0.5;
const WHOLE_PDF_TIMEOUT_MIN_MS = 60_000;
const WHOLE_PDF_TIMEOUT_MAX_MS = 300_000;
const MAX_MODEL_PROBE_ATTEMPTS = 4; // try all models in EXTRACT_MODEL_PRIORITY
const STREAM_RETRY_ATTEMPTS = 1; // retry once on transient stream-cancel errors

// Reuse a single Bedrock client
let bedrockClient: BedrockRuntimeClient | null = null;
function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    const region = process.env.AWS_REGION || 'us-east-1';
    const config: any = { region };
    if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
      config.credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID.trim(),
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY.trim(),
        ...(process.env.AWS_SESSION_TOKEN ? { sessionToken: process.env.AWS_SESSION_TOKEN.trim() } : {}),
      };
    }
    bedrockClient = new BedrockRuntimeClient(config);
  }
  return bedrockClient;
}

function resetBedrockClient(): void {
  bedrockClient = null;
}

function isPendingStreamCanceledError(err: any): boolean {
  const msg = String(err?.message || '').toLowerCase();
  return msg.includes('pending stream has been canceled');
}

const EXTRACTION_PROMPT = `Extract ALL text from this complete medical PDF (every page). This includes BOTH printed and HANDWRITTEN text in ANY language.

Rules:
- Read and transcribe all handwritten text, including messy or informal handwriting
- Preserve all words/characters exactly as written across all languages/scripts
- For handwritten text that is hard to read, give your best interpretation and mark uncertain characters with [?]
- Keep numbers, dates, and medical codes exactly as they appear
- For forms with printed labels and handwritten entries, output as "Label: handwritten value"
- For tables, preserve the content row by row
- If the PDF has MORE THAN ONE page, after each page's text output a single line containing exactly: --- Page Break ---
- Do NOT summarize, translate, or omit anything
- Return ONLY the extracted text (and page-break lines between pages), no commentary

Output the full extracted text now:`;

function bedrockSafeDocumentName(fileName: string): string {
  const base = path.basename(fileName, path.extname(fileName));
  let s = base.replace(/[^a-zA-Z0-9\-[\]() ]/g, '-').replace(/\s{2,}/g, ' ').trim();
  if (!s) s = 'document';
  return s.slice(0, 120);
}

function wholePdfTimeoutMs(pageCount: number): number {
  const scaled = WHOLE_PDF_TIMEOUT_MIN_MS + Math.max(0, pageCount - 1) * 45_000;
  return Math.min(WHOLE_PDF_TIMEOUT_MAX_MS, scaled);
}

function maxTokensForWholePdf(pageCount: number): number {
  return Math.min(65_536, Math.max(4096, 2048 + pageCount * 2048));
}

/**
 * Read textual content from PDF annotations (FreeText, Text, Stamp, etc.).
 *
 * Annotations are drawn ON TOP of page content and are invisible to
 * image-only OCR when the annotation text was added after rasterisation
 * (e.g. a FreeText overlay stamped onto a scanned form). Bedrock's document
 * API rasterises the page but can miss small overlay text. Reading the
 * `Contents` field of each annotation directly from the PDF object model
 * guarantees the text is captured.
 *
 * Returns one string per page, preserving page order.
 */
async function extractAnnotationTextByPage(buffer: Buffer): Promise<string[]> {
  try {
    const doc = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const pages = doc.getPages();
    const perPage: string[] = [];

    for (const page of pages) {
      const pieces: string[] = [];
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (annots && typeof (annots as any).size === 'function') {
        const size = (annots as any).size();
        for (let i = 0; i < size; i++) {
          const annot = (annots as any).lookup(i);
          if (!annot || typeof annot.lookup !== 'function') continue;
          const contents = annot.lookup(PDFName.of('Contents'));
          let text: string | null = null;
          if (contents instanceof PDFString || contents instanceof PDFHexString) {
            text = contents.decodeText();
          } else if (contents && typeof (contents as any).decodeText === 'function') {
            text = (contents as any).decodeText();
          }
          if (text && text.trim().length > 0) {
            pieces.push(text.trim());
          }
        }
      }
      perPage.push(pieces.join('\n'));
    }

    return perPage;
  } catch (err: any) {
    console.warn(`[PDF Parser] Annotation extraction failed: ${err?.message ?? err}`);
    return [];
  }
}

function mergeAnnotationTextIntoPages(pages: PageText[], annotationByPage: string[]): PageText[] {
  if (annotationByPage.length === 0) return pages;
  return pages.map((p, idx) => {
    const annot = annotationByPage[idx];
    if (!annot || annot.length === 0) return p;
    const marker = '\n\n[PDF Annotations]\n' + annot;
    // Only append if the annotation text isn't already present in the OCR result.
    if (p.text.includes(annot)) return p;
    return { ...p, text: (p.text + marker).trim() };
  });
}

function parseExtractedIntoPages(raw: string, totalPages: number): PageText[] {
  const trimmed = raw.trim();
  if (!trimmed) return [{ pageNumber: 1, text: '' }];
  const parts = trimmed
    .split(/\n*---\s*Page Break\s*---\n*/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length <= 1) {
    return [{ pageNumber: 1, text: trimmed }];
  }
  let pages: PageText[] = parts.map((text, i) => ({ pageNumber: i + 1, text }));
  if (totalPages > 0 && pages.length > totalPages) {
    const head = pages.slice(0, totalPages - 1);
    const tail = pages.slice(totalPages - 1).map((p) => p.text).join('\n\n');
    pages = [...head, { pageNumber: totalPages, text: tail }];
  }
  if (totalPages > 0) {
    while (pages.length < totalPages) {
      pages.push({ pageNumber: pages.length + 1, text: '' });
    }
    pages = pages.slice(0, totalPages);
  }
  return pages;
}

/**
 * Extract text from the full PDF buffer in one Bedrock document call
 */
async function extractWholePdfViaModel(
  pdfBuffer: Buffer,
  modelId: string,
  documentName: string,
  timeoutMs: number,
  maxTokens: number,
  attempt = 0
): Promise<string> {
  const client = getBedrockClient();
  const b64 = pdfBuffer.toString('base64');

  const command = new ConverseCommand({
    modelId,
    system: [{ text: EXTRACTION_PROMPT }],
    messages: [
      {
        role: 'user',
        content: [
          {
            document: {
              format: 'pdf',
              name: documentName,
              source: { bytes: Buffer.from(b64, 'base64') },
            },
          } as any,
          {
            text: 'Extract all text from this entire PDF exactly as written. Include printed and handwritten text from every page. Return only extracted text (use --- Page Break --- between pages if there are multiple pages).',
          } as any,
        ],
      },
    ],
    inferenceConfig: { maxTokens },
  });

  const startMs = Date.now();
  console.log(`[PDF Parser]   Whole PDF: sending (${(b64.length / 1024).toFixed(0)}KB base64, timeout ${timeoutMs / 1000}s)...`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await client.send(command, { abortSignal: controller.signal });
    const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
    let text = '';
    const output = response.output;
    if (output && 'message' in output && output.message?.content) {
      for (const block of output.message.content) {
        if (block && 'text' in block && typeof block.text === 'string') {
          text += block.text;
        }
      }
    }
    console.log(`[PDF Parser]   Whole PDF: done in ${elapsed}s (${text.length} chars)`);
    return text;
  } catch (err: any) {
    if (isPendingStreamCanceledError(err) && attempt < STREAM_RETRY_ATTEMPTS) {
      console.warn(
        `[PDF Parser]   Whole PDF: stream canceled, retrying (${attempt + 1}/${STREAM_RETRY_ATTEMPTS})...`
      );
      resetBedrockClient();
      return extractWholePdfViaModel(pdfBuffer, modelId, documentName, timeoutMs, maxTokens, attempt + 1);
    }
    if (err?.name === 'AbortError') {
      throw new Error(`Whole PDF timed out after ${timeoutMs / 1000}s`);
    }
    throw err;
  } finally {
    clearTimeout(timeout);
  }
}

// Claude first for extraction (Maverick fallback).
const EXTRACT_MODEL_PRIORITY = [
  'us.anthropic.claude-sonnet-4-20250514-v1:0',
  'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
  'us.meta.llama4-maverick-17b-instruct-v1:0',
  'us.anthropic.claude-opus-4-6-v1',
];

let resolvedExtractModel: string | null = null;

export async function parsePdf(filePath: string): Promise<PdfExtractionResult> {
  const pipelineStart = Date.now();
  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  console.log(`[PDF Parser] File: ${fileName}, size: ${(buffer.length / 1024).toFixed(0)}KB`);

  // Step 1: Get page count via pdf-lib
  let totalPages = 1;
  try {
    const doc = await PDFDocument.load(buffer);
    totalPages = doc.getPageCount();
    console.log(`[PDF Parser] Step 1 done — ${totalPages} pages`);
  } catch (err: any) {
    console.warn('[PDF Parser] Step 1 (page count) failed:', err.message);
  }

  const docName = bedrockSafeDocumentName(fileName);
  const extractTimeoutMs = wholePdfTimeoutMs(totalPages);
  const extractMaxTokens = maxTokensForWholePdf(totalPages);

  // Step 2: Extract text from the entire PDF in one document call
  let pages: PageText[] = [];
  let usedClaude = false;

  const modelId = process.env.BEDROCK_EXTRACT_MODEL || resolvedExtractModel;

  if (modelId) {
    try {
      console.log(`[PDF Parser] Step 2: Extracting full PDF via ${modelId} (single request)...`);
      const rawText = await extractWholePdfViaModel(
        buffer,
        modelId,
        docName,
        extractTimeoutMs,
        extractMaxTokens
      );
      pages = parseExtractedIntoPages(rawText, totalPages);
      usedClaude = true;
    } catch (err: any) {
      console.error(`[PDF Parser] Step 2 FAILED: ${err.message}`);
    }
  }

  if (!usedClaude) {
    const candidates = EXTRACT_MODEL_PRIORITY.slice(0, MAX_MODEL_PROBE_ATTEMPTS);
    for (const candidateId of candidates) {
      try {
        console.log(`[PDF Parser] Step 2: Trying model ${candidateId} (whole PDF)...`);
        const rawText = await extractWholePdfViaModel(
          buffer,
          candidateId,
          docName,
          extractTimeoutMs,
          extractMaxTokens
        );
        if (rawText?.trim()) {
          resolvedExtractModel = candidateId;
          console.log(`[PDF Parser] Model resolved: ${candidateId}`);
          pages = parseExtractedIntoPages(rawText, totalPages);
          usedClaude = true;
          break;
        }
      } catch (err: any) {
        console.warn(`[PDF Parser] Model ${candidateId} failed: ${err.message}`);
        continue;
      }
    }
  }

  if (!usedClaude || pages.length === 0 || pages.every(p => !p.text.trim())) {
    console.warn('[PDF Parser] Claude extraction failed/empty — no text extracted');
    pages = [{ pageNumber: 1, text: '' }];
  }

  // Step 3: Merge annotation text (FreeText overlays, sticky-note contents)
  // into each page's extracted text. Bedrock can miss small stamped overlays,
  // so reading annotations directly from the PDF object model is a safety net.
  try {
    const annotationByPage = await extractAnnotationTextByPage(buffer);
    if (annotationByPage.some((t) => t && t.trim().length > 0)) {
      // Pad annotationByPage so it matches the number of pages we have.
      while (annotationByPage.length < pages.length) annotationByPage.push('');
      pages = mergeAnnotationTextIntoPages(pages, annotationByPage);
      const annotChars = annotationByPage.reduce((sum, t) => sum + (t?.length ?? 0), 0);
      console.log(`[PDF Parser] Merged ${annotChars} chars of annotation text into pages`);
    }
  } catch (err: any) {
    console.warn(`[PDF Parser] Failed to merge annotation text: ${err?.message ?? err}`);
  }

  const fullText = pages.map(p => p.text).join('\n\n--- Page Break ---\n\n');
  const isScanned = detectScanned(pages);
  const totalMs = Date.now() - pipelineStart;

  const cjkCount = (fullText.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) || []).length;
  const viaModel = usedClaude ? resolvedExtractModel || process.env.BEDROCK_EXTRACT_MODEL || 'bedrock' : 'none';
  console.log(
    `[PDF Parser] DONE in ${(totalMs / 1000).toFixed(1)}s — ${pages.length} pages, ${fullText.length} chars, ${cjkCount} CJK, via: ${viaModel}`
  );

  const legibility = computeLegibilityScore({ fullText, pages });

  return {
    fileName,
    totalPages,
    pages,
    fullText,
    isScanned,
    legibilityScore: legibility.legibilityScore,
    handwrittenPercent: legibility.handwrittenPercent,
    extractedAt: new Date().toISOString(),
  };
}

function detectScanned(pages: PageText[]): boolean {
  if (pages.length === 0) return true;
  const lowTextPages = pages.filter(p => p.text.length < MIN_TEXT_LENGTH_PER_PAGE).length;
  return lowTextPages / pages.length > SCANNED_THRESHOLD;
}

// ─── Legibility Scoring ──────────────────────────────

/**
 * Compute a composite legibility score (0-100) from extraction metrics.
 *
 * Components:
 *   - Clarity (40%): Inverse of [?] uncertainty marker ratio
 *   - Completeness (30%): Character-per-page ratio vs expected minimum
 *   - Coherence (20%): Language detection confidence
 *   - Print bonus (10%): Lower handwriting percentage = higher score
 */
export function computeLegibilityScore(params: {
  fullText: string;
  pages: ReadonlyArray<{ text: string }>;
  languageConfidence?: number;
}): { legibilityScore: number; handwrittenPercent: number; uncertaintyRatio: number } {
  const { fullText, pages } = params;
  const EXPECTED_CHARS_PER_PAGE = 200;

  // Clarity: ratio of uncertain markers
  const uncertaintyMarkers = (fullText.match(/\[\?\]/g) || []).length;
  const totalWords = fullText.split(/\s+/).filter(Boolean).length || 1;
  const uncertaintyRatio = Math.min(1, uncertaintyMarkers / totalWords);
  const clarityScore = (1 - uncertaintyRatio) * 100;

  // Completeness: characters per page vs expected 200 chars minimum
  const avgCharsPerPage = pages.length > 0
    ? pages.reduce((sum, p) => sum + p.text.length, 0) / pages.length
    : 0;
  const completenessScore = Math.min(100, (avgCharsPerPage / EXPECTED_CHARS_PER_PAGE) * 100);

  // Coherence: language detection confidence (passed from pipeline)
  const coherenceScore = params.languageConfidence ?? 80;

  // Handwritten estimate: based on uncertainty markers and low char density
  const lowDensityPages = pages.filter(p => p.text.length < MIN_TEXT_LENGTH_PER_PAGE * 2).length;
  const handwrittenPercent = Math.min(100, Math.round(
    (uncertaintyRatio * 60) +
    (lowDensityPages / Math.max(1, pages.length) * 40),
  ));
  const printBonusScore = (1 - handwrittenPercent / 100) * 100;

  // Weighted composite
  const legibilityScore = Math.round(
    clarityScore * 0.40 +
    completenessScore * 0.30 +
    coherenceScore * 0.20 +
    printBonusScore * 0.10,
  );

  return {
    legibilityScore: Math.max(0, Math.min(100, legibilityScore)),
    handwrittenPercent,
    uncertaintyRatio: Math.round(uncertaintyRatio * 100) / 100,
  };
}
