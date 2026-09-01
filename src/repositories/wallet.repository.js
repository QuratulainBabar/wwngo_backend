import { pool } from '../db/pool.js';

const WALLET_ROLES = new Set(['sender', 'traveler', 'receiver']);

export function normalizeRole(role) {
  const value = String(role || 'sender').toLowerCase();
  return WALLET_ROLES.has(value) ? value : 'sender';
}

/**
 * Ensure a wallet row exists for (userId, role). Returns the row.
 * New users get available_cents = 0 and escrow_cents = 0.
 */
export async function ensureWallet(userId, role, client = pool) {
  const normalized = normalizeRole(role);
  const { rows } = await client.query(
    `INSERT INTO wallets (user_id, role)
     VALUES ($1, $2::wallet_role)
     ON CONFLICT (user_id, role) DO UPDATE SET updated_at = wallets.updated_at
     RETURNING *`,
    [userId, normalized]
  );
  return rows[0];
}

export async function getWallet(userId, role) {
  return ensureWallet(userId, role);
}

/**
 * Read-only wallet fetch — never writes. Returns a zeroed row when the wallet
 * doesn't exist yet, so hot read endpoints don't pay an INSERT..ON CONFLICT
 * (and a WAL write) on every view.
 */
export async function getWalletReadOnly(userId, role) {
  const normalized = normalizeRole(role);
  const { rows } = await pool.query(
    `SELECT * FROM wallets WHERE user_id = $1 AND role = $2::wallet_role`,
    [userId, normalized]
  );
  return (
    rows[0] || {
      user_id: userId,
      role: normalized,
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

export async function listLedgerEntries(userId, role, { limit = 50, includeHidden = false } = {}) {
  const normalized = normalizeRole(role);
  const capped = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const params = [userId, normalized, capped];
  let hiddenClause = '';
  if (!includeHidden) {
    hiddenClause = 'AND hidden_from_history = FALSE';
  }

  const { rows } = await pool.query(
    `SELECT *
     FROM wallet_ledger
     WHERE user_id = $1
       AND role = $2::wallet_role
       ${hiddenClause}
     ORDER BY created_at DESC
     LIMIT $3`,
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

/**
 * Append a ledger row and update wallet balances atomically.
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
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const wallet = await ensureWallet(userId, role, client);
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

    // Keep users.wallet_balance in sync with total available across roles.
    await client.query(
      `UPDATE users
       SET wallet_balance = (
         SELECT COALESCE(SUM(available_cents), 0) / 100.0
         FROM wallets
         WHERE user_id = $1
       ),
       updated_at = NOW()
       WHERE id = $1`,
      [userId]
    );

    await client.query('COMMIT');
    return { wallet: walletRows[0], entry: entryRows[0] };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
