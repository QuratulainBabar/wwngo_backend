import * as notificationRepository from '../repositories/notification.repository.js';
import { publish } from './notification_hub.js';
import { mapNotification } from './notification.service.js';
import { sendPushToUser } from './fcm.service.js';
import { localizePushForUser } from '../i18n/notification_i18n.js';

/**
 * Persist a notification and push it to any connected SSE clients.
 * Inbox rows stay English (client translates). FCM system tray uses the
 * recipient's preferred_language so background/closed alerts are localized.
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

  // Null means a duplicate parcelRequest was suppressed by the unique index
  // (migration 019). Skip the SSE publish and FCM push so the receiver is only
  // ever alerted once per parcel, even under concurrent list fetches.
  if (!row) return null;

  await notificationRepository.trimInbox(normalizedUserId, normalizedRole);

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

  void (async () => {
    const localized = await localizePushForUser(normalizedUserId, {
      title,
      body,
    });
    await sendPushToUser(normalizedUserId, {
      title: localized.title,
      body: localized.body,
      data: {
        type,
        route: route || '',
        notificationId: notification.id,
        language: localized.language,
      },
    });
  })().catch(() => {});

  return notification;
}
