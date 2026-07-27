import * as notificationRepository from '../repositories/notification.repository.js';
import { publish } from './notification_hub.js';
import { mapNotification } from './notification.service.js';

/**
 * Persist a notification and push it to any connected SSE clients.
 */
export async function createNotification({
  userId,
  role,
  type,
  title,
  body,
  route = null,
}) {
  const row = await notificationRepository.createNotification({
    userId,
    role,
    type,
    title,
    body,
    route,
  });

  const notification = mapNotification(row);
  const unreadCount = await notificationRepository.countUnread(userId, role);

  publish(userId, role, {
    event: 'notification',
    notification,
    unreadCount,
  });

  return notification;
}
