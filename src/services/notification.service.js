import { AppError } from '../utils/errors.js';
import * as notificationRepository from '../repositories/notification.repository.js';

const ALLOWED_ROLES = new Set(['sender', 'traveler', 'receiver']);

function relativeTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  const diffMs = Date.now() - d.getTime();
  if (Number.isNaN(diffMs)) return '';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function mapNotification(row) {
  return {
    id: row.id,
    role: row.role,
    type: row.type,
    title: row.title,
    body: row.body,
    route: row.route,
    unread: row.unread,
    time: relativeTime(row.created_at),
    createdAt: row.created_at,
  };
}

function requireRole(role) {
  const normalized = String(role || '').toLowerCase();
  if (!ALLOWED_ROLES.has(normalized)) {
    throw new AppError('role must be sender, traveler, or receiver', 400, 'VALIDATION_ERROR');
  }
  return normalized;
}

export async function listForUser(userId, role, query = {}) {
  const normalized = requireRole(role);
  const limit = Math.min(Number(query.limit) || 50, 100);
  const rows = await notificationRepository.listNotifications(userId, normalized, { limit });
  return rows.map(mapNotification);
}

export async function unreadCount(userId, role) {
  const normalized = requireRole(role);
  return notificationRepository.countUnread(userId, normalized);
}

export async function markRead(userId, role, id) {
  const normalized = requireRole(role);
  const row = await notificationRepository.markRead(userId, normalized, id);
  if (!row) throw new AppError('Notification not found', 404, 'NOT_FOUND');
  return mapNotification(row);
}

export async function markAllRead(userId, role) {
  const normalized = requireRole(role);
  await notificationRepository.markAllRead(userId, normalized);
  return { ok: true };
}
