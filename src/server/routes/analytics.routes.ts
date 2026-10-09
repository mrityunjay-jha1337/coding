import { Router } from 'express';
import { z } from 'zod';
import * as analyticsController from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validate } from '../middleware/validate';

const router = Router();

// ─── Validation Schemas ────────────────────────────

const dateRangeQuerySchema = z.object({
  dateFrom: z.string().datetime({ offset: true }).optional().or(z.string().date().optional()),
  dateTo: z.string().datetime({ offset: true }).optional().or(z.string().date().optional()),
}).passthrough();

const volumeQuerySchema = z.object({
  dateFrom: z.string().min(1, 'dateFrom is required'),
  dateTo: z.string().min(1, 'dateTo is required'),
  groupBy: z.enum(['day', 'week', 'month']).optional().default('day'),
}).passthrough();

const handlerQuerySchema = z.object({
  teamId: z.string().uuid().optional(),
}).passthrough();

// ─── Routes ────────────────────────────────────────

router.get(
  '/overview',
  authenticate,
  requirePermission('analytics:read'),
  validate({ query: dateRangeQuerySchema }),
  analyticsController.getOverview,
);

router.get(
  '/pipeline',
  authenticate,
  requirePermission('analytics:read'),
  analyticsController.getPipelineStatus,
);

router.get(
  '/teams',
  authenticate,
  requirePermission('analytics:read'),
  analyticsController.getTeamPerformance,
);

router.get(
  '/coding',
  authenticate,
  requirePermission('analytics:read'),
  validate({ query: dateRangeQuerySchema }),
  analyticsController.getCodingAnalytics,
);

router.get(
  '/sla',
  authenticate,
  requirePermission('analytics:read'),
  analyticsController.getSlaStatus,
);

router.get(
  '/volume',
  authenticate,
  requirePermission('analytics:read'),
  validate({ query: volumeQuerySchema }),
  analyticsController.getVolumeAnalysis,
);

router.get(
  '/handlers',
  authenticate,
  requirePermission('analytics:read'),
  validate({ query: handlerQuerySchema }),
  analyticsController.getHandlerMetrics,
);

export default router;
