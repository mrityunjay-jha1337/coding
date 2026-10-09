import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validate } from '../middleware/validate';
import { prisma } from '../config/database';
import { processingQueue } from '../queues/index';
import { getQueueStats } from '../queues/index';
import { nanoid } from 'nanoid';

const router = Router();
const upload = multer({ dest: 'uploads/', limits: { fileSize: 50 * 1024 * 1024 } });

// POST /api/v1/process/upload — Manual PDF upload (async, returns claim ID)
router.post(
  '/upload',
  authenticate,
  requirePermission('claims:update', 'claims:process'),
  upload.single('pdf'),
  async (req, res, next) => {
    try {
      if (!req.user) { res.status(401).json({ error: 'Authentication required' }); return; }
      if (!req.file) { res.status(400).json({ error: 'No PDF file uploaded' }); return; }

      const year = new Date().getFullYear();
      const seq = nanoid(5).toUpperCase();
      const claimReference = `CLM-${year}-${seq}`;

      // Create claim record
      const claim = await prisma.claim.create({
        data: {
          orgId: req.user.orgId,
          claimReference,
          status: 'NEW',
          priority: 50,
        },
      });

      // Create document record. Source files are always preserved as
      // ClaimDocument rows so the Documents tab lists every input — PDFs,
      // medical bills, JSON exports, and anything else the user uploaded.
      const filename = req.file.originalname.toLowerCase();
      const inferredDocType =
        filename.endsWith('.json') || req.file.mimetype === 'application/json'
          ? 'CLAIM_FORM'
          : filename.includes('invoice') || filename.includes('bill')
            ? 'INVOICE'
            : filename.includes('claim') || req.file.mimetype === 'application/pdf'
              ? 'CLAIM_FORM'
              : 'UNKNOWN';

      await prisma.claimDocument.create({
        data: {
          claimId: claim.id,
          fileKey: req.file.path,
          originalFilename: req.file.originalname,
          mimeType: req.file.mimetype,
          fileSizeBytes: req.file.size,
          docType: inferredDocType,
          processingStatus: 'pending',
        },
      });

      // Enqueue for processing
      await processingQueue.add('process-claim', {
        claimId: claim.id,
        orgId: req.user.orgId,
        fileName: req.file.originalname,
      });

      res.status(202).json({
        claimId: claim.id,
        claimReference,
        status: 'NEW',
        message: 'Claim created and queued for processing',
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/process/queue — Queue status
router.get(
  '/queue',
  authenticate,
  requirePermission('claims:read'),
  async (_req, res, next) => {
    try {
      const stats = await getQueueStats();
      res.status(200).json(stats);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/v1/process/pipeline/:id — Pipeline status for a claim
router.get(
  '/pipeline/:id',
  authenticate,
  requirePermission('claims:read'),
  validate({ params: z.object({ id: z.string().uuid() }) }),
  async (req, res, next) => {
    try {
      const claim = await prisma.claim.findUnique({
        where: { id: req.params.id },
        select: {
          id: true,
          claimReference: true,
          status: true,
          overallConfidence: true,
          processingTimeMs: true,
          errors: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!claim) {
        res.status(404).json({ error: 'Claim not found' });
        return;
      }

      res.status(200).json(claim);
    } catch (err) {
      next(err);
    }
  }
);

export default router;
