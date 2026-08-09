import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';

/** Accept UUID or public id (WW-xxxxx). */
export async function resolveDeliveryId(idOrPublicId) {
  const raw = String(idOrPublicId || '').trim();
  if (!raw) throw new AppError('Delivery id is required', 400, 'VALIDATION_ERROR');

  const isUuid = /^[0-9a-f-]{36}$/i.test(raw);
  if (isUuid) return raw;

  const { rows } = await pool.query(
    `SELECT id FROM deliveries WHERE public_id = $1 LIMIT 1`,
    [raw]
  );
  if (!rows[0]) throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  return rows[0].id;
}

export async function resolveDeliveryRow(idOrPublicId) {
  const id = await resolveDeliveryId(idOrPublicId);
  const { rows } = await pool.query(`SELECT * FROM deliveries WHERE id = $1`, [id]);
  if (!rows[0]) throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  return rows[0];
}
