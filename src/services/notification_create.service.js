import * as notificationRepository from '../repositories/notification.repository.js';
import { publish } from './notification_hub.js';
import { mapNotification } from './notification.service.js';
import { sendPushToUser } from './fcm.service.js';

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
  const normalizedUserId = String(userId);
  const normalizedRole = String(role || '').toLowerCase();

  const row = await notificationRepository.createNotification({
    userId: normalizedUserId,
    role: normalizedRole,
    type,
    title,
    body,
    route,
  });

  const notification = mapNotification(row);
  const unreadCount = await notificationRepository.countUnread(
    normalizedUserId,
    normalizedRole
  );

  publish(normalizedUserId, normalizedRole, {
    event: 'notification',
    notification,
    unreadCount,
  });

  void sendPushToUser(normalizedUserId, {
    title,
    body,
    data: { type, route: route || '', notificationId: notification.id },
  }).catch(() => {});

  return notification;
}
