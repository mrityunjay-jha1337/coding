import { Router } from 'express';
import { z } from 'zod';
import * as claimsController from '../controllers/claims.controller';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validate } from '../middleware/validate';

const router = Router();

// ─── Validation Schemas ────────────────────────────

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const codingIdParamsSchema = z.object({
  id: z.string().uuid(),
  codingId: z.string().uuid(),
});

const appealIdParamsSchema = z.object({
  id: z.string().uuid(),
  appealId: z.string().uuid(),
});

const queryIdParamsSchema = z.object({
  id: z.string().uuid(),
  queryId: z.string().uuid(),
});

const preAuthIdParamsSchema = z.object({
  preAuthId: z.string().uuid(),
});

const submitAppealBodySchema = z.object({
  reason: z.string().min(1),
  supportingDocs: z.array(z.string()).optional(),
});

const reviewAppealBodySchema = z.object({
  outcome: z.enum(['UPHELD', 'OVERTURNED']),
  notes: z.string().optional(),
});

const updateStatusBodySchema = z.object({
  status: z.string().min(1),
});

const assignBodySchema = z.object({
  handlerId: z.string().uuid(),
});

const updateCodingBodySchema = z.object({
  reviewerAction: z.enum(['accepted', 'corrected', 'rejected']),
  correctedCode: z.string().optional(),
  note: z.string().optional(),
});

const generateQueryBodySchema = z.object({
  queryType: z.enum([
    'missing_info',
    'clarification',
    'additional_docs',
    'medical_clarification',
    'financial_reconciliation',
    'identity_verification',
  ]),
  missingFields: z.array(z.string()).min(1),
  ambiguities: z.array(z.string()).optional(),
  recipientEmail: z.string().email(),
  recipientName: z.string().optional(),
  autoSend: z.boolean().optional(),
});

const respondToQueryBodySchema = z.object({
  responseText: z.string().min(1),
});

const preAuthCheckBodySchema = z.object({
  memberId: z.string().uuid(),
  treatmentType: z.string().min(1),
  treatmentDate: z.string().min(1),
});

const preAuthRequestBodySchema = z.object({
  memberId: z.string().uuid(),
  treatmentType: z.string().min(1),
  treatmentDate: z.string().min(1),
  estimatedAmount: z.number().optional(),
  procedures: z.array(z.string()).optional(),
});

const approvePreAuthBodySchema = z.object({
  authorizationNumber: z.string().min(1),
  authorizedAmount: z.number(),
  validFrom: z.string().min(1),
  validTo: z.string().min(1),
  notes: z.string().optional(),
});

const denyPreAuthBodySchema = z.object({
  notes: z.string().optional(),
});

// ─── ICD-10 Search (must be before /:id to avoid "coding" being treated as an ID) ─

router.get(
  '/coding/search',
  authenticate,
  claimsController.searchIcd10,
);

// ─── Claims CRUD ───────────────────────────────────

router.get(
  '/',
  authenticate,
  requirePermission('claims:read', 'claims:read:assigned', 'claims:read:queue'),
  claimsController.listClaims,
);

router.get(
  '/:id',
  authenticate,
  requirePermission('claims:read', 'claims:read:assigned'),
  validate({ params: idParamsSchema }),
  claimsController.getClaimDetail,
);

router.put(
  '/:id/status',
  authenticate,
  requirePermission('claims:update', 'claims:update:assigned', 'claims:process'),
  validate({ params: idParamsSchema, body: updateStatusBodySchema }),
  claimsController.updateClaimStatus,
);

router.put(
  '/:id/assign',
  authenticate,
  requirePermission('claims:reassign'),
  validate({ params: idParamsSchema, body: assignBodySchema }),
  claimsController.assignClaim,
);

router.get(
  '/:id/coding',
  authenticate,
  requirePermission('claims:read', 'claims:read:assigned'),
  validate({ params: idParamsSchema }),
  claimsController.getClaimCoding,
);

router.put(
  '/:id/coding/:codingId',
  authenticate,
  requirePermission('claims:review_coding', 'claims:review_coding:assigned', 'claims:override'),
  validate({ params: codingIdParamsSchema, body: updateCodingBodySchema }),
  claimsController.updateCoding,
);

router.get(
  '/:id/audit',
  authenticate,
  requirePermission('audit:read', 'claims:read'),
  validate({ params: idParamsSchema }),
  claimsController.getClaimAudit,
);

// ─── Claim File Builder ───────────────────────────

router.get(
  '/:id/file',
  authenticate,
  requirePermission('claims:read', 'claims:read:assigned'),
  validate({ params: idParamsSchema }),
  claimsController.getClaimFile,
);

router.get(
  '/:id/pdf',
  authenticate,
  requirePermission('claims:read', 'claims:read:assigned'),
  validate({ params: idParamsSchema }),
  claimsController.getClaimPdf,
);

router.get(
  '/:id/documents',
  authenticate,
  requirePermission('claims:read', 'claims:read:assigned'),
  validate({ params: idParamsSchema }),
  claimsController.getClaimDocuments,
);

// ─── Appeals ────────────────────────────────────────

router.post(
  '/:id/appeals',
  authenticate,
  requirePermission('claims:update', 'claims:update:assigned', 'claims:process'),
  validate({ params: idParamsSchema, body: submitAppealBodySchema }),
  claimsController.submitAppeal,
);

router.put(
  '/:id/appeals/:appealId',
  authenticate,
  requirePermission('claims:review_coding'),
  validate({ params: appealIdParamsSchema, body: reviewAppealBodySchema }),
  claimsController.reviewAppeal,
);

router.get(
  '/:id/appeals',
  authenticate,
  requirePermission('claims:read'),
  validate({ params: idParamsSchema }),
  claimsController.listAppeals,
);

// ─── Queries (Correspondence) ─────────────────────

router.post(
  '/:id/queries',
  authenticate,
  requirePermission('correspondence:draft', 'correspondence:send'),
  validate({ params: idParamsSchema, body: generateQueryBodySchema }),
  claimsController.generateQuery,
);

router.get(
  '/:id/queries',
  authenticate,
  requirePermission('claims:read'),
  validate({ params: idParamsSchema }),
  claimsController.listQueries,
);

router.post(
  '/:id/queries/:queryId/respond',
  authenticate,
  requirePermission('claims:update'),
  validate({ params: queryIdParamsSchema, body: respondToQueryBodySchema }),
  claimsController.respondToQuery,
);

// ─── Correspondence ───────────────────────────────

router.get(
  '/:id/correspondence',
  authenticate,
  requirePermission('claims:read'),
  validate({ params: idParamsSchema }),
  claimsController.getCorrespondence,
);

// ─── Pre-Authorization ───────────────────────────

router.post(
  '/:id/pre-auth/check',
  authenticate,
  requirePermission('claims:read'),
  validate({ params: idParamsSchema, body: preAuthCheckBodySchema }),
  claimsController.checkPreAuth,
);

router.post(
  '/:id/pre-auth/request',
  authenticate,
  requirePermission('claims:update'),
  validate({ params: idParamsSchema, body: preAuthRequestBodySchema }),
  claimsController.requestPreAuth,
);

router.get(
  '/:id/pre-auth',
  authenticate,
  requirePermission('claims:read'),
  validate({ params: idParamsSchema }),
  claimsController.listPreAuth,
);

router.put(
  '/pre-auth/:preAuthId/approve',
  authenticate,
  requirePermission('claims:override'),
  validate({ params: preAuthIdParamsSchema, body: approvePreAuthBodySchema }),
  claimsController.approvePreAuth,
);

router.put(
  '/pre-auth/:preAuthId/deny',
  authenticate,
  requirePermission('claims:override'),
  validate({ params: preAuthIdParamsSchema, body: denyPreAuthBodySchema }),
  claimsController.denyPreAuth,
);

export default router;
