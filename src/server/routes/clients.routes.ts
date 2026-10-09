import { Router } from 'express';
import { z } from 'zod';
import * as clientsController from '../controllers/clients.controller';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validate } from '../middleware/validate';

const router = Router();

// ─── Validation Schemas ────────────────────────────

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const onboardClientBodySchema = z.object({
  name: z.string().min(2).max(200),
  contactEmail: z.string().email(),
  policyLines: z.array(z.string()).optional(),
  slaConfig: z.record(z.string(), z.unknown()).optional(),
});

const updateClientBodySchema = z.object({
  name: z.string().min(2).max(200).optional(),
  contactEmail: z.string().email().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE', 'ONBOARDING']).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const updateSlaBodySchema = z.object({
  config: z.record(z.string(), z.unknown()),
});

const mapTeamBodySchema = z.object({
  teamId: z.string().uuid(),
});

// ─── Routes ────────────────────────────────────────

router.get(
  '/',
  authenticate,
  requirePermission('clients:read'),
  clientsController.listClients
);

router.post(
  '/',
  authenticate,
  requirePermission('clients:create'),
  validate({ body: onboardClientBodySchema }),
  clientsController.onboardClient
);

router.get(
  '/:id',
  authenticate,
  requirePermission('clients:read'),
  validate({ params: idParamsSchema }),
  clientsController.getClient
);

router.put(
  '/:id',
  authenticate,
  requirePermission('clients:update'),
  validate({ params: idParamsSchema, body: updateClientBodySchema }),
  clientsController.updateClient
);

router.put(
  '/:id/sla',
  authenticate,
  requirePermission('clients:update'),
  validate({ params: idParamsSchema, body: updateSlaBodySchema }),
  clientsController.updateSlaConfig
);

router.post(
  '/:id/teams',
  authenticate,
  requirePermission('clients:update'),
  validate({ params: idParamsSchema, body: mapTeamBodySchema }),
  clientsController.mapClientToTeam
);

export default router;
