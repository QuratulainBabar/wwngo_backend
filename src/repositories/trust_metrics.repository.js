import { pool } from '../db/pool.js';
import { normalizeRole } from './wallet.repository.js';

/**
 * Aggregate delivery trust stats for a user in a given role.
 * Sender: deliveries where sender_id = user.
 * Receiver: deliveries accepted by / addressed to this user.
 * Traveler: no traveler ownership yet — zeros.
 */
export async function getTrustAggregates(userId, role) {
  const normalized = normalizeRole(role);

  if (normalized === 'traveler') {
    return {
      completed: 0,
      cancelled: 0,
      disputed: 0,
      closed: 0,
    };
  }

  if (normalized === 'receiver') {
    const { rows: userRows } = await pool.query(
      `SELECT email, phone FROM users WHERE id = $1`,
      [userId]
    );
    const email = userRows[0]?.email || '';
    const phoneDigits = String(userRows[0]?.phone || '').replace(/\D/g, '');

    const { rows } = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'delivered')::int AS completed,
         COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
         COUNT(*) FILTER (WHERE disputed = TRUE)::int AS disputed,
         COUNT(*) FILTER (
           WHERE status IN ('delivered', 'cancelled') OR disputed = TRUE
         )::int AS closed
       FROM deliveries
       WHERE receiver_id = $1
          OR (receiver_email IS NOT NULL AND LOWER(receiver_email) = LOWER($2))
          OR (
            $3 <> ''
            AND receiver_phone IS NOT NULL
            AND regexp_replace(receiver_phone, '\\D', '', 'g') = $3
          )`,
      [userId, email, phoneDigits]
    );

    const row = rows[0] || {};
    return {
      completed: Number(row.completed) || 0,
      cancelled: Number(row.cancelled) || 0,
      disputed: Number(row.disputed) || 0,
      closed: Number(row.closed) || 0,
    };
  }

  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'delivered')::int AS completed,
       COUNT(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
       COUNT(*) FILTER (WHERE disputed = TRUE)::int AS disputed,
       COUNT(*) FILTER (
         WHERE status IN ('delivered', 'cancelled') OR disputed = TRUE
       )::int AS closed
     FROM deliveries
     WHERE sender_id = $1`,
    [userId]
  );

  const row = rows[0] || {};
  return {
    completed: Number(row.completed) || 0,
    cancelled: Number(row.cancelled) || 0,
    disputed: Number(row.disputed) || 0,
    closed: Number(row.closed) || 0,
  };
}
