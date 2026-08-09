import { pool } from '../db/pool.js';

export async function logSecurityEvent(userId, { action, device, location, ipAddress } = {}) {
  if (!userId || !action) return null;
  const { rows } = await pool.query(
    `INSERT INTO security_logs (user_id, action, device, location, ip_address)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [
      userId,
      String(action).slice(0, 128),
      device ? String(device).slice(0, 256) : null,
      location ? String(location).slice(0, 256) : null,
      ipAddress ? String(ipAddress).slice(0, 45) : null,
    ]
  );
  return rows[0];
}

export async function listSecurityLogs(userId, { limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, action, device, location, ip_address, created_at
     FROM security_logs
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [userId, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    action: r.action,
    device: r.device || 'Unknown device',
    location: r.location || 'Unknown location',
    ipAddress: r.ip_address,
    timestamp: r.created_at,
  }));
}
