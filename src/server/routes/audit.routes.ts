import { Router } from 'express';
import * as auditController from '../controllers/audit.controller';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';

const router = Router();

// ─── Routes ────────────────────────────────────────

router.get(
  '/events',
  authenticate,
  requirePermission('audit:read'),
  auditController.queryEvents,
);

router.get(
  '/events/:id',
  authenticate,
  requirePermission('audit:read'),
  auditController.getEventById,
);

export default router;
