import { Router } from 'express';
import { z } from 'zod';
import * as bupaController from '../controllers/bupa.controller';
import * as bupaAnalyticsController from '../controllers/bupaAnalytics.controller';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validate } from '../middleware/validate';

const router = Router();

// ─── Validation Schemas ────────────────────────────

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const memberIdParamsSchema = z.object({
  memberId: z.string().uuid(),
});

const eligibilityBodySchema = z.object({
  treatmentDate: z.string().min(1),
  treatmentCountry: z.string().min(1),
  treatmentType: z.string().optional(),
  claimAmount: z.number().optional(),
});

const createMemberBodySchema = z.object({
  membershipNumber: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dateOfBirth: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  planId: z.string().uuid(),
  planTier: z.enum(['MAJOR_MEDICAL', 'SELECT', 'PREMIER', 'ELITE', 'ULTIMATE']),
  policyStartDate: z.string().min(1),
  policyEndDate: z.string().min(1),
  deductibleAmount: z.number().optional(),
  deductibleCurrency: z.string().optional(),
  coInsuranceRate: z.number().optional(),
  networkOption: z.enum(['STANDARD', 'COMPREHENSIVE']).optional(),
  geographicCover: z.enum(['WORLDWIDE', 'WORLDWIDE_EXCL_US']).optional(),
});

const processClaimBodySchema = z.object({
  filePath: z.string().min(1),
  membershipNumber: z.string().optional(),
  claimantName: z.string().optional(),
  claimantDob: z.string().optional(),
  facilityName: z.string().optional(),
  practitionerName: z.string().optional(),
  treatmentCountry: z.string().optional(),
  treatmentDate: z.string().optional(),
  treatmentType: z.string().optional(),
  claimAmount: z.number().optional(),
  currency: z.string().optional(),
});

// ─── Analytics Routes ─────────────────────────────────

router.get(
  '/analytics/dashboard',
  authenticate,
  requirePermission('claims:read'),
  bupaAnalyticsController.getDashboard,
);

router.get(
  '/analytics/stp',
  authenticate,
  requirePermission('claims:read'),
  bupaAnalyticsController.getStpMetrics,
);

router.get(
  '/analytics/plans',
  authenticate,
  requirePermission('claims:read'),
  bupaAnalyticsController.getPlanUtilisation,
);

router.get(
  '/analytics/providers',
  authenticate,
  requirePermission('claims:read'),
  bupaAnalyticsController.getProviderAnalysis,
);

router.get(
  '/analytics/denials',
  authenticate,
  requirePermission('claims:read'),
  bupaAnalyticsController.getDenialAnalysis,
);

router.get(
  '/analytics/members',
  authenticate,
  requirePermission('claims:read'),
  bupaAnalyticsController.getMemberMetrics,
);

// ─── Member Routes ───────────────────────────────────

router.get(
  '/members',
  authenticate,
  requirePermission('claims:read'),
  bupaController.listMembers,
);

router.post(
  '/members',
  authenticate,
  requirePermission('claims:create'),
  validate({ body: createMemberBodySchema }),
  bupaController.createMember,
);

router.get(
  '/members/lookup',
  authenticate,
  requirePermission('claims:read'),
  bupaController.lookupMember,
);

router.get(
  '/members/:id',
  authenticate,
  requirePermission('claims:read'),
  validate({ params: idParamsSchema }),
  bupaController.getMember,
);

router.post(
  '/members/:memberId/eligibility',
  authenticate,
  requirePermission('claims:read'),
  validate({ params: memberIdParamsSchema, body: eligibilityBodySchema }),
  bupaController.checkEligibility,
);

// ─── Provider Routes ─────────────────────────────────

router.get(
  '/providers',
  authenticate,
  requirePermission('claims:read'),
  bupaController.listProviders,
);

router.get(
  '/providers/lookup',
  authenticate,
  requirePermission('claims:read'),
  bupaController.lookupProvider,
);

router.get(
  '/providers/:id',
  authenticate,
  requirePermission('claims:read'),
  validate({ params: idParamsSchema }),
  bupaController.getProvider,
);

// ─── Plan Routes ─────────────────────────────────────

router.get(
  '/plans',
  authenticate,
  requirePermission('claims:read'),
  bupaController.listPlans,
);

router.get(
  '/plans/:id',
  authenticate,
  requirePermission('claims:read'),
  validate({ params: idParamsSchema }),
  bupaController.getPlan,
);

// ─── Bupa Pipeline Route ─────────────────────────────

router.post(
  '/process',
  authenticate,
  requirePermission('claims:create'),
  validate({ body: processClaimBodySchema }),
  bupaController.processBupaClaim,
);

// ─── EDI / JSON Export Routes ────────────────────────

router.get(
  '/claims/:id/edi',
  authenticate,
  requirePermission('claims:read'),
  validate({ params: idParamsSchema }),
  bupaController.getClaimEdi,
);

router.get(
  '/claims/:id/export-json',
  authenticate,
  requirePermission('claims:read'),
  validate({ params: idParamsSchema }),
  bupaController.getClaimExportJson,
);

// ─── Batch Export Routes ────────────────────────────

const batchExportBodySchema = z.object({
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  status: z.array(z.string()).optional(),
  planTier: z.string().optional(),
  claimIds: z.array(z.string().uuid()).optional(),
  format: z.enum(['INDIVIDUAL', 'COMBINED', 'ZIP']).optional(),
});

router.post(
  '/batch-export/edi',
  authenticate,
  requirePermission('claims:read'),
  validate({ body: batchExportBodySchema }),
  bupaController.batchExportEdi,
);

export default router;
