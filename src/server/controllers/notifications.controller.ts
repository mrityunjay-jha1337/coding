import { Request, Response, NextFunction } from 'express';
import { NotificationService } from '../services/notification.service';
import { prisma } from '../config/database';

const notificationService = new NotificationService(prisma);

// ─── Handlers ─────────────────────────────────────

export async function listNotifications(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const unreadOnly = req.query.unreadOnly === 'true';
    const page = req.query.page ? Number(req.query.page) : undefined;
    const limit = req.query.limit ? Number(req.query.limit) : undefined;

    const result = await notificationService.listNotifications(req.user.sub, {
      unreadOnly,
      page,
      limit,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function markAsRead(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { id } = req.params;
    await notificationService.markAsRead(id);

    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function markAllAsRead(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    await notificationService.markAllAsRead(req.user.sub);

    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function getUnreadCount(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const count = await notificationService.getUnreadCount(req.user.sub);

    res.status(200).json({ count });
  } catch (err) {
    next(err);
  }
}
