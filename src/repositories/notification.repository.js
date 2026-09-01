import { pool } from '../db/pool.js';

/** Keep only the newest notifications per user + role. */
export const INBOX_KEEP = 20;

export async function createNotification({
  userId,
  role,
  type,
  title,
  body,
  route = null,
}) {
  // The partial unique index (see migration 019) covers only
  // type = 'parcelRequest' with a non-null route. For every other type the
  // arbiter matches nothing, so the insert proceeds normally; for a duplicate
  // parcelRequest it fires DO NOTHING and RETURNING yields no row. Callers must
  // treat a null return as "already existed — do not re-notify".
  const { rows } = await pool.query(
    `INSERT INTO notifications (user_id, role, type, title, body, route)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (user_id, role, route) WHERE type = 'parcelRequest' AND route IS NOT NULL
     DO NOTHING
     RETURNING *`,
    [userId, role, type, title, body || '', route]
  );
  return rows[0] || null;
}

/** Drop oldest inbox rows so only the newest [keep] remain. */
export async function trimInbox(userId, role, keep = INBOX_KEEP) {
  await pool.query(
    `DELETE FROM notifications
     WHERE id IN (
       SELECT id FROM (
         SELECT id,
                ROW_NUMBER() OVER (ORDER BY created_at DESC, id DESC) AS rn
         FROM notifications
         WHERE user_id = $1 AND role = $2
       ) ranked
       WHERE rn > $3
     )`,
    [userId, role, keep]
  );
}

export async function listNotifications(userId, role, { limit = INBOX_KEEP } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM notifications
     WHERE user_id = $1 AND role = $2
     ORDER BY created_at DESC
     LIMIT $3`,
    [userId, role, limit]
  );
  return rows;
}

export async function countUnread(userId, role) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM (
       SELECT unread
       FROM notifications
       WHERE user_id = $1 AND role = $2
       ORDER BY created_at DESC, id DESC
       LIMIT $3
     ) latest
     WHERE unread = TRUE`,
    [userId, role, INBOX_KEEP]
  );
  return Number(rows[0]?.count) || 0;
}

export async function markRead(userId, role, id) {
  const { rows } = await pool.query(
    `UPDATE notifications
     SET unread = FALSE
     WHERE id = $1 AND user_id = $2 AND role = $3
     RETURNING *`,
    [id, userId, role]
  );
  return rows[0] || null;
}

export async function markAllRead(userId, role) {
  await pool.query(
    `UPDATE notifications
     SET unread = FALSE
     WHERE user_id = $1 AND role = $2 AND unread = TRUE`,
    [userId, role]
  );
}

/** Mark unread inbox items that deep-link to a given route (exact match). */
export async function markUnreadByRoute(userId, role, route) {
  const { rows } = await pool.query(
    `UPDATE notifications
     SET unread = FALSE
     WHERE user_id = $1
       AND role = $2
       AND unread = TRUE
       AND route = $3
     RETURNING id`,
    [userId, role, route]
  );
  return rows.length;
}

/** True if an inbox item already exists for this deep-link route. */
export async function existsByUserRoleRoute(userId, role, route) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM notifications
     WHERE user_id = $1 AND role = $2 AND route = $3
     LIMIT 1`,
    [userId, role, route]
  );
  return rows.length > 0;
}
