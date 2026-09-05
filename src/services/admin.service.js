import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { hashPassword } from '../utils/password.js';
import * as escrowService from './escrow.service.js';
import { isFcmConfigured, sendPushToUser } from './fcm.service.js';
import * as notificationRepository from '../repositories/notification.repository.js';
import { publish } from './notification_hub.js';
import { mapNotification } from './notification.service.js';

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

export async function listDeliveries({
  limit = 50,
  offset = 0,
  status = null,
  filter = null,
} = {}) {
  const params = [limit, offset];
  const clauses = [];

  if (status) {
    params.push(status);
    clauses.push(`d.status = $${params.length}::delivery_status`);
  }

  if (filter === 'cancelled') {
    clauses.push(`d.status = 'cancelled'`);
  } else if (filter === 'disputed') {
    clauses.push(`(d.status = 'disputed' OR d.disputed = TRUE)`);
  } else if (filter === 'active') {
    clauses.push(`d.status NOT IN ('cancelled', 'delivered')`);
  }

  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT
       d.id,
       d.public_id,
       d.delivery_type,
       d.status,
       d.from_city,
       d.from_code,
       d.to_city,
       d.to_code,
       d.origin_country,
       d.destination_country,
       d.travel_date,
       d.parcel_category,
       d.parcel_size,
       d.weight_kg,
       d.max_budget,
       d.bid_amount,
       d.receiver_email,
       d.disputed,
       d.created_at,
       d.updated_at,
       sender.name AS sender_name,
       sender.email AS sender_email,
       traveler.name AS traveler_name,
       traveler.email AS traveler_email,
       receiver.name AS receiver_name,
       receiver.email AS receiver_email
     FROM deliveries d
     JOIN users sender ON sender.id = d.sender_id
     LEFT JOIN users traveler ON traveler.id = d.traveler_id
     LEFT JOIN users receiver ON receiver.id = d.receiver_id
     ${whereClause}
     ORDER BY d.created_at DESC
     LIMIT $1 OFFSET $2`,
    params
  );
  return rows;
}

export async function getDeliveryById(deliveryId) {
  const { rows } = await pool.query(
    `SELECT
       d.*,
       sender.name AS sender_name,
       sender.email AS sender_email,
       sender.phone AS sender_phone,
       traveler.name AS traveler_name,
       traveler.email AS traveler_email,
       traveler.phone AS traveler_phone,
       receiver.name AS receiver_name,
       receiver.email AS receiver_email,
       receiver.phone AS receiver_phone
     FROM deliveries d
     JOIN users sender ON sender.id = d.sender_id
     LEFT JOIN users traveler ON traveler.id = d.traveler_id
     LEFT JOIN users receiver ON receiver.id = d.receiver_id
     WHERE d.id::text = $1 OR d.public_id = $1
     LIMIT 1`,
    [deliveryId]
  );
  if (!rows[0]) throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  return rows[0];
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

const USER_EDITABLE = {
  name: { type: 'string', max: 255 },
  email: { type: 'string', max: 255 },
  phone: { type: 'string', max: 50 },
  country_code: { type: 'country' },
  bio: { type: 'string', max: 2000 },
  role: { type: 'role' },
  kyc_status: { type: 'enum', values: ['pending', 'submitted', 'approved', 'rejected'] },
  account_status: { type: 'enum', values: ['active', 'suspended'] },
  is_verified: { type: 'boolean' },
  email_verified: { type: 'boolean' },
  phone_verified: { type: 'boolean' },
  is_admin: { type: 'boolean' },
};

function normalizeUserPatch(patch = {}) {
  const updates = {};
  for (const [key, rule] of Object.entries(USER_EDITABLE)) {
    if (patch[key] === undefined) continue;
    let value = patch[key];

    if (rule.type === 'boolean') {
      if (typeof value === 'string') {
        value = value === 'true' || value === '1';
      } else {
        value = Boolean(value);
      }
      updates[key] = value;
      continue;
    }

    if (rule.type === 'enum') {
      const normalized = String(value || '').trim().toLowerCase();
      if (!rule.values.includes(normalized)) {
        throw new AppError(`Invalid ${key}`, 400, 'VALIDATION_ERROR');
      }
      updates[key] = normalized;
      continue;
    }

    if (rule.type === 'role') {
      if (value === null || value === '') {
        updates[key] = null;
        continue;
      }
      const normalized = String(value).trim().toLowerCase();
      if (!['sender', 'traveler', 'receiver'].includes(normalized)) {
        throw new AppError('Invalid role', 400, 'VALIDATION_ERROR');
      }
      updates[key] = normalized;
      continue;
    }

    if (rule.type === 'country') {
      const code = String(value || '').trim().toUpperCase();
      if (!/^[A-Z]{2}$/.test(code)) {
        throw new AppError('country_code must be a 2-letter ISO code', 400, 'VALIDATION_ERROR');
      }
      updates[key] = code;
      continue;
    }

    const text = String(value ?? '').trim();
    if (key === 'name' || key === 'email' || key === 'phone') {
      if (!text) throw new AppError(`${key} is required`, 400, 'VALIDATION_ERROR');
    }
    if (key === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      throw new AppError('Invalid email', 400, 'VALIDATION_ERROR');
    }
    if (rule.max && text.length > rule.max) {
      throw new AppError(`${key} is too long`, 400, 'VALIDATION_ERROR');
    }
    updates[key] = key === 'email' ? text.toLowerCase() : text;
  }
  return updates;
}

export async function updateUser(userId, patch = {}, { actorId = null } = {}) {
  const { rows: existingRows } = await pool.query(
    `SELECT id, is_admin FROM users
     WHERE id::text = $1 OR LOWER(email) = LOWER($1)
     LIMIT 1`,
    [userId]
  );
  const existing = existingRows[0];
  if (!existing) throw new AppError('User not found', 404, 'NOT_FOUND');

  const updates = normalizeUserPatch(patch);
  const password = patch.password !== undefined ? String(patch.password || '') : null;
  const hasPassword = password !== null;

  if (hasPassword) {
    if (password.length < 8) {
      throw new AppError('Password must be at least 8 characters', 400, 'VALIDATION_ERROR');
    }
    if (password.length > 128) {
      throw new AppError('Password is too long', 400, 'VALIDATION_ERROR');
    }
  }

  if (Object.keys(updates).length === 0 && !hasPassword) {
    throw new AppError('No valid fields to update', 400, 'VALIDATION_ERROR');
  }

  if (
    updates.is_admin === false &&
    existing.is_admin &&
    actorId &&
    String(actorId) === String(existing.id)
  ) {
    throw new AppError('You cannot remove your own admin access', 400, 'VALIDATION_ERROR');
  }

  const sets = [];
  const params = [existing.id];
  for (const [key, value] of Object.entries(updates)) {
    params.push(value);
    if (key === 'kyc_status') {
      sets.push(`kyc_status = $${params.length}::kyc_status`);
    } else if (key === 'account_status') {
      sets.push(`account_status = $${params.length}::account_status`);
    } else {
      sets.push(`${key} = $${params.length}`);
    }
  }

  if (hasPassword) {
    const passwordHash = await hashPassword(password);
    params.push(passwordHash);
    sets.push(`password_hash = $${params.length}`);
  }

  sets.push('updated_at = NOW()');

  try {
    const { rows } = await pool.query(
      `UPDATE users SET ${sets.join(', ')}
       WHERE id = $1
       RETURNING
         id, name, email, phone, country_code, bio, role,
         rating, review_count, wallet_balance, is_verified,
         kyc_status, account_status, is_admin,
         email_verified, phone_verified, avatar_url,
         created_at, updated_at`,
      params
    );

    if (hasPassword) {
      await pool.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [existing.id]
      );
    }

    return {
      ...rows[0],
      password_updated: hasPassword,
    };
  } catch (err) {
    if (err?.code === '23505') {
      throw new AppError('Email or phone already in use', 409, 'CONFLICT');
    }
    throw err;
  }
}

export async function listEscrows({ limit = 50, status = null } = {}) {
  const params = [limit];
  let where = '';
  if (status) {
    params.push(status);
    where = `WHERE e.status = $2::shipment_escrow_status`;
  }

  const { rows } = await pool.query(
    `SELECT
       e.*,
       u.name AS user_name,
       u.email AS user_email,
       d.id AS delivery_uuid,
       d.status AS delivery_status,
       d.from_city,
       d.to_city,
       d.origin_country,
       d.destination_country
     FROM shipment_escrows e
     JOIN users u ON u.id = e.user_id
     LEFT JOIN deliveries d ON d.public_id = e.shipment_id
     ${where}
     ORDER BY e.updated_at DESC
     LIMIT $1`,
    params
  );
  return rows;
}

export async function listNfcAudit({ limit = 100, fraudOnly = false } = {}) {
  const params = [limit];
  let where = '';
  if (fraudOnly) {
    where = 'WHERE n.fraud_flag = TRUE';
  }

  const { rows } = await pool.query(
    `SELECT
       n.*,
       d.public_id AS delivery_public_id,
       d.id AS delivery_uuid,
       d.status AS delivery_status,
       initiator.name AS initiator_name,
       initiator.email AS initiator_email,
       confirmer.name AS confirmer_name,
       confirmer.email AS confirmer_email
     FROM nfc_checkpoints n
     JOIN deliveries d ON d.id = n.delivery_id
     JOIN users initiator ON initiator.id = n.initiator_id
     LEFT JOIN users confirmer ON confirmer.id = n.confirmer_id
     ${where}
     ORDER BY n.created_at DESC
     LIMIT $1`,
    params
  );
  return rows;
}

export async function listTrips({
  limit = 50,
  offset = 0,
  status = null,
} = {}) {
  const params = [limit, offset];
  const clauses = [];
  if (status) {
    params.push(status);
    clauses.push(`t.status = $${params.length}::trip_status`);
  }
  const whereClause = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT
       t.*,
       u.name AS traveler_name,
       u.email AS traveler_email,
       u.phone AS traveler_phone,
       (
         SELECT COUNT(*)::int
         FROM trip_sender_requests r
         WHERE r.trip_id = t.id AND r.status = 'pending'
       ) AS pending_request_count
     FROM trips t
     JOIN users u ON u.id = t.traveler_id
     ${whereClause}
     ORDER BY t.created_at DESC
     LIMIT $1 OFFSET $2`,
    params
  );
  return rows;
}

export async function getTripById(tripId) {
  const { rows } = await pool.query(
    `SELECT
       t.*,
       u.name AS traveler_name,
       u.email AS traveler_email,
       u.phone AS traveler_phone
     FROM trips t
     JOIN users u ON u.id = t.traveler_id
     WHERE t.id::text = $1 OR t.public_id = $1
     LIMIT 1`,
    [tripId]
  );
  if (!rows[0]) throw new AppError('Trip not found', 404, 'NOT_FOUND');
  return rows[0];
}

export async function cancelTrip(tripId, { reason = null } = {}) {
  const trip = await getTripById(tripId);
  if (trip.status === 'cancelled') {
    throw new AppError('Trip is already cancelled', 400, 'INVALID_STATUS');
  }
  if (trip.status !== 'open_bid') {
    throw new AppError(
      'Only open trips can be cancelled by admin',
      400,
      'INVALID_STATUS',
    );
  }

  const { rows } = await pool.query(
    `UPDATE trips
     SET status = 'cancelled', updated_at = NOW()
     WHERE id = $1 AND status = 'open_bid'
     RETURNING *`,
    [trip.id]
  );
  if (!rows[0]) {
    throw new AppError('Unable to cancel this trip', 400, 'CANCEL_FAILED');
  }

  // Soft-cancel pending sender requests tied to this trip.
  await pool.query(
    `UPDATE trip_sender_requests
     SET status = 'cancelled', updated_at = NOW()
     WHERE trip_id = $1 AND status = 'pending'`,
    [trip.id]
  );

  return {
    ...rows[0],
    traveler_name: trip.traveler_name,
    traveler_email: trip.traveler_email,
    cancel_reason: reason || 'Cancelled by admin',
  };
}

export async function getUserDetail(userId) {
  const { rows: users } = await pool.query(
    `SELECT
       id, name, email, phone, country_code, bio, role,
       rating, review_count, wallet_balance, is_verified,
       kyc_status, account_status, is_admin,
       email_verified, phone_verified, avatar_url,
       created_at, updated_at
     FROM users
     WHERE id::text = $1 OR LOWER(email) = LOWER($1)
     LIMIT 1`,
    [userId]
  );
  const user = users[0];
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

  const { rows: wallets } = await pool.query(
    `SELECT available_cents, escrow_cents, updated_at
     FROM wallets
     WHERE user_id = $1
     LIMIT 1`,
    [user.id]
  );

  const { rows: ledger } = await pool.query(
    `SELECT id, role, type, amount_cents, available_delta_cents, escrow_delta_cents,
            description, shipment_id, created_at
     FROM wallet_ledger
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 40`,
    [user.id]
  );

  const { rows: deliveries } = await pool.query(
    `SELECT
       d.id, d.public_id, d.status, d.delivery_type, d.max_budget,
       d.from_city, d.to_city, d.origin_country, d.destination_country,
       d.travel_date, d.created_at, d.disputed,
       CASE
         WHEN d.sender_id = $1 THEN 'sender'
         WHEN d.traveler_id = $1 THEN 'traveler'
         WHEN d.receiver_id = $1 THEN 'receiver'
         ELSE NULL
       END AS user_role_in_delivery
     FROM deliveries d
     WHERE d.sender_id = $1 OR d.traveler_id = $1 OR d.receiver_id = $1
     ORDER BY d.created_at DESC
     LIMIT 40`,
    [user.id]
  );

  const { rows: trips } = await pool.query(
    `SELECT id, public_id, trip_type, status, travel_date,
            from_city, to_city, origin_country, destination_country,
            luggage_capacity_kg, created_at
     FROM trips
     WHERE traveler_id = $1
     ORDER BY created_at DESC
     LIMIT 20`,
    [user.id]
  );

  const { rows: tokenRows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM device_tokens
     WHERE user_id = $1`,
    [user.id]
  );

  return {
    user,
    wallets,
    ledger,
    deliveries,
    trips,
    device_token_count: tokenRows[0]?.count || 0,
    fcm_configured: isFcmConfigured(),
  };
}

export async function sendTestNotification(
  userId,
  { title = null, body = null, role = null } = {},
) {
  const { rows: users } = await pool.query(
    `SELECT id, name, email, role
     FROM users
     WHERE id::text = $1 OR LOWER(email) = LOWER($1)
     LIMIT 1`,
    [userId]
  );
  const user = users[0];
  if (!user) throw new AppError('User not found', 404, 'NOT_FOUND');

  const titleFinal = String(title || '').trim() || 'WWNGO Test';
  const bodyFinal =
    String(body || '').trim() ||
    'This is a test notification from the WWNGO admin panel.';

  const allowedRoles = ['sender', 'traveler', 'receiver'];
  const roleFinal = allowedRoles.includes(String(role || '').toLowerCase())
    ? String(role).toLowerCase()
    : allowedRoles.includes(String(user.role || '').toLowerCase())
      ? String(user.role).toLowerCase()
      : 'sender';

  if (titleFinal.length > 120) {
    throw new AppError('Title is too long', 400, 'VALIDATION_ERROR');
  }
  if (bodyFinal.length > 500) {
    throw new AppError('Body is too long', 400, 'VALIDATION_ERROR');
  }

  const { rows: tokenRows } = await pool.query(
    `SELECT COUNT(*)::int AS count FROM device_tokens WHERE user_id = $1`,
    [user.id]
  );
  const deviceTokens = tokenRows[0]?.count || 0;

  const row = await notificationRepository.createNotification({
    userId: user.id,
    role: roleFinal,
    type: 'admin_test',
    title: titleFinal,
    body: bodyFinal,
    route: '/notifications',
  });
  const notification = mapNotification(row);
  const unreadCount = await notificationRepository.countUnread(user.id, roleFinal);
  publish(user.id, roleFinal, {
    event: 'notification',
    notification,
    unreadCount,
  });

  const push = await sendPushToUser(user.id, {
    title: titleFinal,
    body: bodyFinal,
    data: {
      type: 'admin_test',
      route: '/notifications',
      notificationId: notification.id,
    },
  });

  return {
    user: { id: user.id, name: user.name, email: user.email },
    notification,
    push,
    deviceTokens,
    fcmConfigured: isFcmConfigured(),
  };
}

export async function listDisputes({ status = null, limit = 50 } = {}) {
  const params = [limit];
  let where = '';
  if (status === 'open') {
    where = `WHERE dis.status IN ('open', 'under_review')`;
  } else if (status) {
    where = 'WHERE dis.status = $2::dispute_status';
    params.push(status);
  }
  const { rows } = await pool.query(
    `SELECT
       dis.*,
       d.public_id AS delivery_public_id,
       d.id AS delivery_uuid,
       d.status AS delivery_status,
       d.delivery_type,
       d.from_city,
       d.to_city,
       d.origin_country,
       d.destination_country,
       d.max_budget,
       d.disputed AS delivery_disputed,
       opener.name AS opened_by_name,
       opener.email AS opened_by_email,
       sender.name AS sender_name,
       sender.email AS sender_email,
       resolver.name AS resolved_by_name
     FROM disputes dis
     JOIN deliveries d ON d.id = dis.delivery_id
     JOIN users opener ON opener.id = dis.opened_by
     JOIN users sender ON sender.id = d.sender_id
     LEFT JOIN users resolver ON resolver.id = dis.resolved_by
     ${where}
     ORDER BY dis.created_at DESC
     LIMIT $1`,
    params
  );
  return rows;
}

export async function resolveDispute(
  disputeId,
  adminId,
  { resolution, dismiss = false, closeAs = null } = {},
) {
  const client = await pool.connect();
  let committed = false;
  try {
    await client.query('BEGIN');

    const { rows: disputeRows } = await client.query(
      `SELECT * FROM disputes WHERE id = $1 FOR UPDATE`,
      [disputeId]
    );
    const dispute = disputeRows[0];
    if (!dispute) throw new AppError('Dispute not found', 404, 'NOT_FOUND');

    if (!['open', 'under_review'].includes(dispute.status)) {
      throw new AppError('Dispute is already closed', 400, 'INVALID_STATUS');
    }

    const nextStatus = dismiss ? 'dismissed' : 'resolved';
    const { rows } = await client.query(
      `UPDATE disputes
       SET status = $2::dispute_status,
           resolution = $3,
           resolved_by = $4,
           resolved_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [disputeId, nextStatus, resolution || null, adminId]
    );

    await client.query(
      `UPDATE deliveries
       SET disputed = FALSE, updated_at = NOW()
       WHERE id = $1`,
      [dispute.delivery_id]
    );

    await client.query('COMMIT');
    committed = true;

    const closeTarget = closeAs === 'delivered' || closeAs === 'cancelled' ? closeAs : null;
    if (closeTarget) {
      const deliveryState = await import('./delivery_state.service.js');
      await deliveryState.transitionDelivery({
        deliveryId: dispute.delivery_id,
        toStatus: closeTarget,
        actorId: adminId,
        note: resolution || `Admin ${nextStatus} dispute`,
        extraSets: { disputed: false },
      });
    }

    return rows[0];
  } catch (err) {
    if (!committed) {
      await client.query('ROLLBACK').catch(() => {});
    }
    throw err;
  } finally {
    client.release();
  }
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

/**
 * Wipe operational data for testing: deliveries, trips, chats, notifications,
 * reviews, FCM tokens, escrows. Users / auth are kept; wallets are zeroed.
 */
export async function clearOperationalData({ actorId } = {}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const before = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM deliveries) AS deliveries,
        (SELECT COUNT(*)::int FROM trips) AS trips,
        (SELECT COUNT(*)::int FROM notifications) AS notifications,
        (SELECT COUNT(*)::int FROM chat_messages) AS chat_messages,
        (SELECT COUNT(*)::int FROM reviews) AS reviews,
        (SELECT COUNT(*)::int FROM device_tokens) AS device_tokens,
        (SELECT COUNT(*)::int FROM shipment_escrows) AS shipment_escrows,
        (SELECT COUNT(*)::int FROM wallet_ledger) AS wallet_ledger,
        (SELECT COALESCE(SUM(available_cents), 0)::bigint FROM wallets) AS wallet_available_cents,
        (SELECT COALESCE(SUM(escrow_cents), 0)::bigint FROM wallets) AS wallet_escrow_cents
    `);

    await client.query('DELETE FROM shipment_escrows');
    await client.query('DELETE FROM wallet_ledger');
    await client.query('DELETE FROM notifications');
    await client.query('DELETE FROM chat_messages');
    await client.query('DELETE FROM conversation_reads');
    await client.query('DELETE FROM conversations');
    await client.query('DELETE FROM reviews');
    await client.query('DELETE FROM device_tokens');

    await client.query(`
      UPDATE wallets
         SET available_cents = 0,
             escrow_cents = 0,
             updated_at = NOW()
       WHERE available_cents <> 0 OR escrow_cents <> 0
    `);
    await client.query(`
      UPDATE users
         SET wallet_balance = 0,
             updated_at = NOW()
       WHERE COALESCE(wallet_balance, 0) <> 0
    `);

    // Children cascade from deliveries/trips (NFC, meetup, requests, offers, disputes, etc.).
    const deletedDeliveries = await client.query('DELETE FROM deliveries');
    const deletedTrips = await client.query('DELETE FROM trips');

    const after = await client.query(`
      SELECT
        (SELECT COUNT(*)::int FROM deliveries) AS deliveries,
        (SELECT COUNT(*)::int FROM trips) AS trips,
        (SELECT COUNT(*)::int FROM notifications) AS notifications,
        (SELECT COUNT(*)::int FROM chat_messages) AS chat_messages,
        (SELECT COUNT(*)::int FROM reviews) AS reviews,
        (SELECT COUNT(*)::int FROM device_tokens) AS device_tokens,
        (SELECT COUNT(*)::int FROM shipment_escrows) AS shipment_escrows,
        (SELECT COUNT(*)::int FROM wallet_ledger) AS wallet_ledger,
        (SELECT COALESCE(SUM(available_cents), 0)::bigint FROM wallets) AS wallet_available_cents,
        (SELECT COALESCE(SUM(escrow_cents), 0)::bigint FROM wallets) AS wallet_escrow_cents
    `);

    await client.query('COMMIT');

    console.log(
      `[admin] clearOperationalData by ${actorId || 'unknown'}:`,
      before.rows[0],
      '→',
      after.rows[0]
    );

    return {
      deleted: {
        deliveries: deletedDeliveries.rowCount || 0,
        trips: deletedTrips.rowCount || 0,
        notifications: before.rows[0]?.notifications || 0,
        chatMessages: before.rows[0]?.chat_messages || 0,
        reviews: before.rows[0]?.reviews || 0,
        deviceTokens: before.rows[0]?.device_tokens || 0,
        shipmentEscrows: before.rows[0]?.shipment_escrows || 0,
        walletLedger: before.rows[0]?.wallet_ledger || 0,
        walletAvailableCents: Number(before.rows[0]?.wallet_available_cents || 0),
        walletEscrowCents: Number(before.rows[0]?.wallet_escrow_cents || 0),
      },
      remaining: after.rows[0],
      message:
        'Deliveries, trips, messages, notifications, reviews, FCM tokens, and escrows were cleared. Wallets were zeroed. Users were kept.',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function dashboardStats() {
  const { rows } = await pool.query(
    `SELECT
       (SELECT COUNT(*)::int FROM users) AS users,
       (SELECT COUNT(*)::int FROM users WHERE account_status = 'suspended') AS suspended_users,
       (SELECT COUNT(*)::int FROM users WHERE kyc_status = 'approved') AS kyc_approved,
       (SELECT COUNT(*)::int FROM users WHERE kyc_status IN ('pending', 'submitted')) AS kyc_pending,
       (SELECT COUNT(*)::int FROM trips) AS trips,
       (SELECT COUNT(*)::int FROM trips WHERE status = 'open_bid') AS trips_open,
       (SELECT COUNT(*)::int FROM trips WHERE status = 'in_transit') AS trips_in_transit,
       (SELECT COUNT(*)::int FROM deliveries) AS deliveries,
       (SELECT COUNT(*)::int FROM deliveries WHERE status NOT IN ('cancelled', 'delivered')) AS active_deliveries,
       (SELECT COUNT(*)::int FROM deliveries WHERE status = 'delivered') AS delivered,
       (SELECT COUNT(*)::int FROM deliveries WHERE status = 'cancelled') AS cancelled_deliveries,
       (SELECT COUNT(*)::int FROM disputes WHERE status IN ('open', 'under_review')) AS open_disputes,
       (SELECT COUNT(*)::int FROM shipment_escrows WHERE status = 'held') AS escrows_held,
       (SELECT COALESCE(SUM(amount_cents), 0)::bigint FROM shipment_escrows WHERE status = 'held') AS escrow_held_cents,
       (SELECT COUNT(*)::int FROM shipment_escrows WHERE status = 'frozen') AS escrows_frozen,
       (SELECT COUNT(*)::int FROM nfc_checkpoints WHERE fraud_flag = TRUE) AS nfc_fraud_flags,
       (SELECT COUNT(*)::int FROM nfc_checkpoints WHERE created_at >= NOW() - INTERVAL '7 days') AS nfc_scans_7d`
  );

  const { rows: recentDeliveries } = await pool.query(
    `SELECT
       d.id, d.public_id, d.status, d.from_city, d.to_city,
       d.origin_country, d.destination_country, d.created_at, d.max_budget,
       sender.name AS sender_name,
       traveler.name AS traveler_name
     FROM deliveries d
     LEFT JOIN users sender ON sender.id = d.sender_id
     LEFT JOIN users traveler ON traveler.id = d.traveler_id
     ORDER BY d.created_at DESC
     LIMIT 8`
  );

  const { rows: recentDisputes } = await pool.query(
    `SELECT
       dis.id, dis.status, dis.reason, dis.created_at,
       d.public_id AS delivery_public_id,
       d.id AS delivery_uuid,
       opener.name AS opened_by_name
     FROM disputes dis
     JOIN deliveries d ON d.id = dis.delivery_id
     LEFT JOIN users opener ON opener.id = dis.opened_by
     WHERE dis.status IN ('open', 'under_review')
     ORDER BY dis.created_at DESC
     LIMIT 6`
  );

  const { rows: recentUsers } = await pool.query(
    `SELECT id, name, email, role, kyc_status, account_status, created_at
     FROM users
     ORDER BY created_at DESC
     LIMIT 6`
  );

  return {
    ...rows[0],
    recent_deliveries: recentDeliveries,
    recent_disputes: recentDisputes,
    recent_users: recentUsers,
  };
}
