import { api } from './client';
import type { NotificationRecord } from './types';

export const notificationsApi = {
  list: (params?: { unreadOnly?: boolean; page?: number; limit?: number }) =>
    api.get<{ notifications?: NotificationRecord[]; data?: NotificationRecord[]; total: number; page: number; limit: number }>(
      '/notifications',
      { params: params as Record<string, string | number | boolean | undefined> },
    ),
  markAllRead: () => api.put<{ success: boolean }>('/notifications/read-all'),
  getUnreadCount: () => api.get<{ count: number }>('/notifications/unread-count'),
  markRead: (id: string) => api.put<{ success: boolean }>(`/notifications/${id}/read`),
};
