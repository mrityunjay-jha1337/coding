import { Router } from 'express';
import { z } from 'zod';
import * as connectorsController from '../controllers/connectors.controller';
import { authenticate } from '../middleware/auth';
import { requirePermission } from '../middleware/rbac';
import { validate } from '../middleware/validate';

const router = Router();

const idParamsSchema = z.object({
  id: z.string().uuid(),
});

const filterRulesSchema = z.object({
  rules: z.array(
    z.object({
      type: z.enum(['sender_domain', 'subject_keyword', 'has_attachments', 'label', 'exclusion', 'client_routing', 'priority']),
      value: z.string().min(1),
      action: z.string().optional(),
    })
  ),
});

// Gmail connector management (requires auth + connectors:manage permission)
router.get(
  '/gmail',
  authenticate,
  requirePermission('connectors:manage'),
  connectorsController.listConnectors
);

router.post(
  '/gmail/connect',
  authenticate,
  requirePermission('connectors:manage'),
  connectorsController.initiateOAuth
);

router.get(
  '/gmail/callback',
  connectorsController.handleOAuthCallback
);

router.get(
  '/gmail/:id/status',
  authenticate,
  requirePermission('connectors:manage'),
  validate({ params: idParamsSchema }),
  connectorsController.getConnectorStatus
);

router.delete(
  '/gmail/:id',
  authenticate,
  requirePermission('connectors:manage'),
  validate({ params: idParamsSchema }),
  connectorsController.disconnectConnector
);

router.put(
  '/gmail/:id/rules',
  authenticate,
  requirePermission('connectors:manage'),
  validate({ params: idParamsSchema, body: filterRulesSchema }),
  connectorsController.updateFilterRules
);

// Webhook (no auth — called by Google Pub/Sub)
router.post(
  '/gmail/webhook',
  connectorsController.webhookHandler
);

export default router;
