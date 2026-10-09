import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { processPdf } from '../services/pipelineOrchestrator';
import { ApiErrorResponse } from '../../shared/types';
import { authenticate } from '../middleware/auth';
import { prisma } from '../config/database';
import { nanoid } from 'nanoid';

const router = Router();

// Configure multer for temp file uploads
const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const uniqueName = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

// POST /api/process - Upload and process a PDF
router.post('/process', authenticate, upload.single('pdf'), async (req: Request, res: Response) => {
  // Allow up to 10 minutes for large PDF processing
  req.setTimeout(600_000);

  const file = req.file;
  const user = req.user;

  if (!file) {
    const error: ApiErrorResponse = { error: 'No PDF file uploaded' };
    return res.status(400).json(error);
  }

  if (!user) {
    return res.status(401).json({ error: 'Authentication details missing' });
  }

  console.log(`[API] Processing uploaded file for ${user.sub}: ${file.originalname} (${(file.size / 1024).toFixed(1)}KB)`);

  try {
    const result = await processPdf(file.path);
    result.fileName = file.originalname;

    // Simplistic claimant name extraction
    const claimantNameMatch = result.extraction.fullText.match(/(?:Name|Patient Name|NAME):\s*([^\n\r|]*)/i);
    const claimantName = claimantNameMatch ? claimantNameMatch[1].trim() : 'Workbench Extraction';

    // Use a transaction to persist results to DB
    const persistedResult = await prisma.$transaction(async (tx) => {
      const year = new Date().getFullYear();
      const seq = nanoid(5).toUpperCase();
      const claimReference = `EXT-${year}-${seq}`;

      // 1. Create the Claim
      const claim = await tx.claim.create({
        data: {
          orgId: user.orgId,
          claimReference,
          status: 'REVIEWING',
          priority: 50,
          claimant: { name: claimantName },
          processingTimeMs: result.processingTimeMs,
          // Store as a 0–100 percentage to match the worker pipeline; individual
          // code confidences are 0–1 fractions so we scale up.
          overallConfidence:
            (result.reconciliation.finalCodes.reduce((acc, c) => acc + c.confidence, 0) /
              (result.reconciliation.finalCodes.length || 1)) * 100,
        },
      });

      // 2. Create Claim Document
      await tx.claimDocument.create({
        data: {
          claimId: claim.id,
          fileKey: file.path,
          originalFilename: file.originalname,
          mimeType: file.mimetype,
          fileSizeBytes: file.size,
          docType: 'UNKNOWN',
          extractedText: result.extraction.fullText,
          translatedText: result.translation?.translatedText,
          language: result.languageDetection.specificLanguage || result.languageDetection.language,
          pageCount: result.extraction.totalPages,
          processingStatus: 'completed',
        },
      });

      // 3. Create Coding records and update result with IDs
      const finalCodes = await Promise.all(
        result.reconciliation.finalCodes.map(async (code) => {
          const dbCoding = await tx.claimCoding.create({
            data: {
              claimId: claim.id,
              code: code.code,
              codeType: 'ICD10',
              description: code.description,
              llmDescription: code.llmDescription,
              confidence: code.confidence,
              evidenceSource: code.evidenceSourceText,
              evidenceTranslated: code.evidenceTranslatedText,
              pageNumber: code.pageNumber,
              section: code.section,
              pathUsed: code.pathUsed,
              reasoning: code.reasoningSummary,
              needsReview: code.needsHumanReview,
            },
          });
          return { ...code, id: dbCoding.id };
        })
      );

      result.claimId = claim.id;
      result.reconciliation.finalCodes = finalCodes;
      return result;
    });

    res.json(persistedResult);
  } catch (error: any) {
    console.error('[API] Processing error:', error.message);
    const errorResponse: ApiErrorResponse = {
      error: 'Processing failed',
      details: error.message,
    };
    res.status(500).json(errorResponse);
  } finally {
    // Clean up temp file
    try {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
        console.log(`[API] Cleaned up temp file: ${file.filename}`);
      }
    } catch (cleanupError) {
      console.warn('[API] Failed to clean up temp file');
    }
  }
});

// GET /api/health - Health check
router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    env: {
      region: process.env.AWS_REGION || 'not set',
      hasCredentials: !!(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
    },
  });
});

// Error handling for multer
router.use((err: any, _req: Request, res: Response, _next: any) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 50MB.' });
    }
    return res.status(400).json({ error: err.message });
  }
  if (err.message === 'Only PDF files are allowed') {
    return res.status(400).json({ error: err.message });
  }
  console.error('[API] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

export default router;
