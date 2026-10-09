import { Router } from 'express';
import { z } from 'zod';
import * as teamsController from '../controllers/teams.controller';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validate } from '../middleware/validate';

const router = Router();

// ─── Validation Schemas ────────────────────────────

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const memberParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});

const createTeamBodySchema = z.object({
  name: z.string().min(2).max(200),
  leadId: z.string().uuid().optional(),
});

const updateTeamBodySchema = z.object({
  name: z.string().min(2).max(200).optional(),
  leadId: z.string().uuid().nullable().optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

const addMemberBodySchema = z.object({
  userId: z.string().uuid(),
});

// ─── Routes ────────────────────────────────────────

router.get(
  '/',
  authenticate,
  requirePermission('teams:read'),
  teamsController.listTeams
);

router.post(
  '/',
  authenticate,
  requirePermission('teams:create'),
  validate({ body: createTeamBodySchema }),
  teamsController.createTeam
);

router.get(
  '/:id',
  authenticate,
  requirePermission('teams:read'),
  validate({ params: idParamsSchema }),
  teamsController.getTeam
);

router.put(
  '/:id',
  authenticate,
  requirePermission('teams:update'),
  validate({ params: idParamsSchema, body: updateTeamBodySchema }),
  teamsController.updateTeam
);

router.delete(
  '/:id',
  authenticate,
  requirePermission('teams:delete'),
  validate({ params: idParamsSchema }),
  teamsController.deleteTeam
);

router.post(
  '/:id/members',
  authenticate,
  requirePermission('teams:update'),
  validate({ params: idParamsSchema, body: addMemberBodySchema }),
  teamsController.addMember
);

router.delete(
  '/:id/members/:userId',
  authenticate,
  requirePermission('teams:update'),
  validate({ params: memberParamsSchema }),
  teamsController.removeMember
);

export default router;
