import { Router } from 'express';
import { z } from 'zod';
import * as usersController from '../controllers/users.controller';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validate } from '../middleware/validate';

const router = Router();

// ─── Validation Schemas ────────────────────────────

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const listUsersQuerySchema = z.object({
  search: z.string().max(200).optional(),
  roleId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'LOCKED']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const updateUserBodySchema = z.object({
  name: z.string().min(2).max(100).optional(),
  specialisation: z.string().max(200).optional(),
  status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'LOCKED']).optional(),
});

const inviteUserBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  roleName: z.string().min(1),
  teamId: z.string().uuid().optional(),
  specialisation: z.string().max(200).optional(),
});

// ─── Routes ────────────────────────────────────────

router.get(
  '/',
  authenticate,
  requirePermission('users:read'),
  validate({ query: listUsersQuerySchema }),
  usersController.listUsers
);

router.post(
  '/invite',
  authenticate,
  requirePermission('users:create'),
  validate({ body: inviteUserBodySchema }),
  usersController.inviteUser
);

router.get(
  '/:id',
  authenticate,
  requirePermission('users:read'),
  validate({ params: idParamsSchema }),
  usersController.getUser
);

router.put(
  '/:id',
  authenticate,
  requirePermission('users:update'),
  validate({ params: idParamsSchema, body: updateUserBodySchema }),
  usersController.updateUser
);

router.delete(
  '/:id',
  authenticate,
  requirePermission('users:delete'),
  validate({ params: idParamsSchema }),
  usersController.deactivateUser
);

export default router;
