import { pool } from '../db/pool.js';

const WALLET_ROLES = new Set(['sender', 'traveler', 'receiver']);

/** Activity context for ledger rows — not a separate wallet partition. */
export function normalizeRole(role) {
  const value = String(role || 'sender').toLowerCase();
  return WALLET_ROLES.has(value) ? value : 'sender';
}

/**
 * Ensure a single wallet row exists for [userId]. Returns the row.
 */
export async function ensureWallet(userId, client = pool) {
  const { rows } = await client.query(
    `INSERT INTO wallets (user_id)
     VALUES ($1)
     ON CONFLICT (user_id) DO UPDATE SET updated_at = wallets.updated_at
     RETURNING *`,
    [userId]
  );
  return rows[0];
}

export async function getWallet(userId) {
  return ensureWallet(userId);
}

/**
 * Read-only wallet fetch — never writes. Returns a zeroed row when the wallet
 * doesn't exist yet.
 */
export async function getWalletReadOnly(userId) {
  const { rows } = await pool.query(
    `SELECT * FROM wallets WHERE user_id = $1`,
    [userId]
  );
  return (
    rows[0] || {
      user_id: userId,
      available_cents: 0,
      escrow_cents: 0,
    }
  );
}

/** True if any ledger row for this user has the given description. */
export async function hasLedgerDescription(userId, description) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM wallet_ledger
     WHERE user_id = $1
       AND description = $2
     LIMIT 1`,
    [userId, description]
  );
  return rows.length > 0;
}

/**
 * Unified transaction history for the user. [activityRole] optionally filters
 * by the role tag stored on each ledger row.
 */
export async function listLedgerEntries(
  userId,
  { limit = 50, includeHidden = false, activityRole = null } = {}
) {
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const params = [userId, capped];
  let hiddenClause = '';
  if (!includeHidden) {
    hiddenClause = 'AND hidden_from_history = FALSE';
  }

  let roleClause = '';
  if (activityRole) {
    params.splice(1, 0, normalizeRole(activityRole));
    roleClause = 'AND role = $2::wallet_role';
  }

  const limitParam = activityRole ? '$3' : '$2';

  const { rows } = await pool.query(
    `SELECT *
     FROM wallet_ledger
     WHERE user_id = $1
       ${roleClause}
       ${hiddenClause}
     ORDER BY created_at DESC
     LIMIT ${limitParam}`,
    params
  );
  return rows;
}

export async function getShipmentEscrow(shipmentId) {
  const { rows } = await pool.query(
    `SELECT * FROM shipment_escrows WHERE shipment_id = $1`,
    [shipmentId]
  );
  return rows[0] || null;
}

/** True when [userId] is sender, traveler, or receiver on the delivery. */
export async function userIsPartyToShipment(userId, shipmentId) {
  const { rows } = await pool.query(
    `SELECT 1
     FROM deliveries
     WHERE public_id = $1
       AND (sender_id = $2 OR traveler_id = $2 OR receiver_id = $2)
     LIMIT 1`,
    [shipmentId, userId]
  );
  return rows.length > 0;
}

/**
 * Active (held / frozen) escrow rows for deliveries this user participates in.
 */
export async function listRelatedShipmentEscrows(userId) {
  const { rows } = await pool.query(
    `SELECT se.shipment_id, se.amount_cents, se.status, se.role
     FROM shipment_escrows se
     INNER JOIN deliveries d ON d.public_id = se.shipment_id
     WHERE (d.sender_id = $1 OR d.traveler_id = $1 OR d.receiver_id = $1)
       AND se.status IN ('held', 'frozen')
     ORDER BY se.updated_at DESC`,
    [userId]
  );
  return rows;
}

/**
 * Append a ledger row and update the user's single wallet atomically.
 * [role] tags the activity context (sender / traveler / receiver).
 * Returns { wallet, entry }.
 */
export async function appendLedgerEntry({
  userId,
  role,
  type,
  amountCents,
  availableDeltaCents = 0,
  escrowDeltaCents = 0,
  description,
  shipmentId = null,
  hiddenFromHistory = false,
  client: existingClient = null,
}) {
  const owned = !existingClient;
  const client = existingClient || await pool.connect();
  try {
    if (owned) await client.query('BEGIN');

    const wallet = await ensureWallet(userId, client);
    const nextAvailable = Number(wallet.available_cents) + Number(availableDeltaCents);
    const nextEscrow = Number(wallet.escrow_cents) + Number(escrowDeltaCents);

    if (nextAvailable < 0) {
      const err = new Error('Insufficient available balance');
      err.code = 'INSUFFICIENT_BALANCE';
      throw err;
    }
    if (nextEscrow < 0) {
      const err = new Error('Insufficient escrow balance');
      err.code = 'INSUFFICIENT_ESCROW';
      throw err;
    }

    const { rows: walletRows } = await client.query(
      `UPDATE wallets
       SET available_cents = $1,
           escrow_cents = $2,
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [nextAvailable, nextEscrow, wallet.id]
    );

    const { rows: entryRows } = await client.query(
      `INSERT INTO wallet_ledger (
         user_id, role, type, amount_cents,
         available_delta_cents, escrow_delta_cents,
         description, shipment_id, hidden_from_history
       ) VALUES (
         $1, $2::wallet_role, $3::wallet_ledger_type, $4,
         $5, $6, $7, $8, $9
       )
       RETURNING *`,
      [
        userId,
        normalizeRole(role),
        type,
        amountCents,
        availableDeltaCents,
        escrowDeltaCents,
        description,
        shipmentId,
        hiddenFromHistory,
      ]
    );

    await client.query(
      `UPDATE users
       SET wallet_balance = (
         SELECT COALESCE(available_cents, 0) / 100.0
         FROM wallets
         WHERE user_id = $1
       ),
       updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    if (owned) await client.query('COMMIT');
    return { wallet: walletRows[0], entry: entryRows[0] };
  } catch (err) {
    if (owned) await client.query('ROLLBACK');
    throw err;
  } finally {
    if (owned) client.release();
  }
}
