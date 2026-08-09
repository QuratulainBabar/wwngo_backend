import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import * as escrowService from './escrow.service.js';

export async function listUsers({ limit = 50, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT id, name, email, phone, role, kyc_status, account_status, is_admin,
            rating, review_count, created_at
     FROM users
     ORDER BY created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return rows;
}

export async function suspendUser(userId, { suspend = true } = {}) {
  const status = suspend ? 'suspended' : 'active';
  const { rows } = await pool.query(
    `UPDATE users SET account_status = $2::account_status, updated_at = NOW()
     WHERE id = $1 RETURNING id, email, account_status`,
    [userId, status]
  );
  if (!rows[0]) throw new AppError('User not found', 404, 'NOT_FOUND');
  return rows[0];
}

export async function listEscrows({ limit = 50 } = {}) {
  const { rows } = await pool.query(
    `SELECT e.*, u.email, u.name
     FROM shipment_escrows e
     JOIN users u ON u.id = e.user_id
     ORDER BY e.updated_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function listNfcAudit({ limit = 100 } = {}) {
  const { rows } = await pool.query(
    `SELECT n.*, d.public_id AS delivery_public_id
     FROM nfc_checkpoints n
     JOIN deliveries d ON d.id = n.delivery_id
     ORDER BY n.created_at DESC
     LIMIT $1`,
    [limit]
  );
  return rows;
}

export async function listDisputes({ status = null, limit = 50 } = {}) {
  const params = [limit];
  let where = '';
  if (status) {
    where = 'WHERE status = $2::dispute_status';
    params.push(status);
  }
  const { rows } = await pool.query(
    `SELECT dis.*, d.public_id AS delivery_public_id, u.email AS opened_by_email
     FROM disputes dis
     JOIN deliveries d ON d.id = dis.delivery_id
     JOIN users u ON u.id = dis.opened_by
     ${where}
     ORDER BY dis.created_at DESC
     LIMIT $1`,
    params
  );
  return rows;
}

export async function resolveDispute(disputeId, adminId, { resolution, dismiss = false } = {}) {
  const status = dismiss ? 'dismissed' : 'resolved';
  const { rows } = await pool.query(
    `UPDATE disputes SET status = $2::dispute_status, resolution = $3,
            resolved_by = $4, resolved_at = NOW()
     WHERE id = $1 RETURNING *`,
    [disputeId, status, resolution || null, adminId]
  );
  if (!rows[0]) throw new AppError('Dispute not found', 404, 'NOT_FOUND');
  return rows[0];
}

export async function addBanEntry({ banType, valueHash, reason, createdBy }) {
  const { rows } = await pool.query(
    `INSERT INTO ban_entries (ban_type, value_hash, reason, created_by)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (ban_type, value_hash) DO UPDATE SET active = TRUE, reason = EXCLUDED.reason
     RETURNING *`,
    [banType, valueHash, reason, createdBy]
  );
  return rows[0];
}

export async function adminRefundEscrow(shipmentId, reason) {
  return escrowService.refundEscrowForDelivery(shipmentId, reason || 'Admin refund');
}

export async function dashboardStats() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM users) AS users,
       (SELECT COUNT(*)::int FROM deliveries WHERE status NOT IN ('cancelled', 'delivered')) AS active_deliveries,
       (SELECT COUNT(*)::int FROM deliveries WHERE status = 'delivered') AS delivered,
       (SELECT COUNT(*)::int FROM disputes WHERE status = 'open') AS open_disputes,
       (SELECT COALESCE(SUM(amount_cents), 0)::int FROM shipment_escrows WHERE status = 'held') AS escrow_held_cents`
  );
  return rows[0];
}
