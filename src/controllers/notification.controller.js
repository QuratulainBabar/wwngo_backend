import * as notificationService from '../services/notification.service.js';
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
