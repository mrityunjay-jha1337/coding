import { PrismaClient, Prisma, Notification } from '@prisma/client';
import { logger } from '../config/logger';
import { emitNotification } from '../socket/index';

// ─── Types ─────────────────────────────────────────

export interface NotifyParams {
  readonly userId: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly data?: Record<string, unknown>;
  readonly channels?: ReadonlyArray<'in_app' | 'email'>;
}

export interface NotificationListFilters {
  readonly unreadOnly?: boolean;
  readonly page?: number;
  readonly limit?: number;
}

export interface NotificationListResult {
  readonly notifications: ReadonlyArray<Notification>;
  readonly total: number;
  readonly unreadCount: number;
}

// ─── Constants ─────────────────────────────────────

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 20;

// ─── Service ───────────────────────────────────────

export class NotificationService {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Create an in-app notification record and optionally dispatch to other channels.
   * Emits a Socket.io event to the target user.
   */
  async notify(params: NotifyParams): Promise<void> {
    const channels = params.channels ?? ['in_app'];

    // Always create the in-app record
    await this.prisma.notification.create({
      data: {
        userId: params.userId,
        type: params.type,
        title: params.title,
        body: params.body,
        data: (params.data ?? {}) as Prisma.InputJsonValue,
        channel: 'in_app',
      },
    });

    // Emit real-time Socket.io notification
    emitNotification(params.userId, {
      type: params.type,
      title: params.title,
      body: params.body,
      data: params.data,
    });

    // Email channel placeholder
    if (channels.includes('email')) {
      logger.info(
        { userId: params.userId, type: params.type },
        'Email notification would be sent (placeholder for nodemailer integration)',
      );
    }
  }

  /**
   * Paginated notification list for a user with unread count.
   */
  async listNotifications(
    userId: string,
    filters?: NotificationListFilters,
  ): Promise<NotificationListResult> {
    const page = filters?.page ?? DEFAULT_PAGE;
    const limit = filters?.limit ?? DEFAULT_LIMIT;
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { userId };
    if (filters?.unreadOnly) {
      where.readAt = null;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      this.prisma.notification.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
      }),
      this.prisma.notification.count({ where: where as any }),
      this.prisma.notification.count({
        where: { userId, readAt: null },
      }),
    ]);

    return { notifications, total, unreadCount };
  }

  /**
   * Mark a single notification as read.
   */
  async markAsRead(notificationId: string): Promise<void> {
    await this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  /**
   * Mark all notifications for a user as read.
   */
  async markAllAsRead(userId: string): Promise<void> {
    await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
  }

  /**
   * Count of unread notifications for a user.
   */
  async getUnreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }
}
