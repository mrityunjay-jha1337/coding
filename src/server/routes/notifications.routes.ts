import { Router } from 'express';
import * as notificationsController from '../controllers/notifications.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// ─── Routes ────────────────────────────────────────

router.get(
  '/',
  authenticate,
  notificationsController.listNotifications,
);

router.put(
  '/read-all',
  authenticate,
  notificationsController.markAllAsRead,
);

router.get(
  '/unread-count',
  authenticate,
  notificationsController.getUnreadCount,
);

router.put(
  '/:id/read',
  authenticate,
  notificationsController.markAsRead,
);

export default router;
