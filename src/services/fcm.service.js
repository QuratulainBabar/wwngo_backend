import { pool } from '../db/pool.js';
import { env } from '../config/env.js';

/**
 * Firebase Cloud Messaging (legacy HTTP API).
 * Set FCM_SERVER_KEY in .env to enable push delivery.
 */
export async function sendPushToUser(userId, { title, body, data = {} } = {}) {
  const serverKey = env.fcm?.serverKey;
  if (!serverKey) return { sent: false, reason: 'not_configured' };

  const { rows } = await pool.query(
    `SELECT token FROM device_tokens WHERE user_id = $1`,
    [userId]
  );
  if (!rows.length) return { sent: false, reason: 'no_tokens' };

  const tokens = rows.map((r) => r.token);
  let sent = 0;

  for (const token of tokens) {
    try {
      const res = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          Authorization: `key=${serverKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          to: token,
          notification: { title, body },
          data: Object.fromEntries(
            Object.entries(data).map(([k, v]) => [k, String(v ?? '')])
          ),
          priority: 'high',
        }),
      });
      if (res.ok) sent += 1;
    } catch (err) {
      console.warn('[FCM] send failed:', err?.message || err);
    }
  }

  return { sent: sent > 0, count: sent };
}

export async function registerDeviceToken(userId, { token, platform = 'unknown' } = {}) {
  const normalized = String(token || '').trim();
  if (!normalized) return null;

  const { rows } = await pool.query(
    `INSERT INTO device_tokens (user_id, token, platform)
     VALUES ($1, $2, $3)
     ON CONFLICT (user_id, token) DO UPDATE SET platform = EXCLUDED.platform, updated_at = NOW()
     RETURNING *`,
    [userId, normalized, String(platform).slice(0, 32)]
  );
  return rows[0];
}

export async function removeDeviceToken(userId, token) {
  await pool.query(`DELETE FROM device_tokens WHERE user_id = $1 AND token = $2`, [
    userId,
    String(token || '').trim(),
  ]);
}
