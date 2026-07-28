import * as notificationService from '../services/notification.service.js';
import { subscribe } from '../services/notification_hub.js';
import { asyncHandler } from '../utils/errors.js';

export const listNotifications = asyncHandler(async (req, res) => {
  const role = req.query.role;
  const data = await notificationService.listForUser(req.user.id, role, req.query);
  res.json({ success: true, data: { notifications: data } });
});

export const unreadCount = asyncHandler(async (req, res) => {
  const count = await notificationService.unreadCount(req.user.id, req.query.role);
  res.json({ success: true, data: { count } });
});

export const markRead = asyncHandler(async (req, res) => {
  const data = await notificationService.markRead(
    req.user.id,
    req.query.role || req.body?.role,
    req.params.id
  );
  res.json({ success: true, data });
});

export const markAllRead = asyncHandler(async (req, res) => {
  const data = await notificationService.markAllRead(
    req.user.id,
    req.query.role || req.body?.role
  );
  res.json({ success: true, data });
});

export const streamNotifications = asyncHandler(async (req, res) => {
  const role = String(req.query.role || '').toLowerCase();
  const userId = String(req.user.id);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(': connected\n\n');

  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 25000);

  const unsubscribe = subscribe(userId, role, res);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});
