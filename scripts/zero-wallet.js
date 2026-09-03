/**
 * Zero wallet for a user by email.
 * Usage: node scripts/zero-wallet.js <email>
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';

const email = process.argv[2];
if (!email) {
  console.error('Usage: node scripts/zero-wallet.js <email>');
  process.exit(1);
}

async function main() {
  const { rows: users } = await pool.query(
    `SELECT id, email, name FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  if (!users[0]) {
    throw new Error(`User not found: ${email}`);
  }
  const user = users[0];

  const { rows: before } = await pool.query(
    `SELECT available_cents, escrow_cents FROM wallets WHERE user_id = $1`,
    [user.id]
  );

  await pool.query('BEGIN');
  await pool.query(
    `UPDATE wallets
     SET available_cents = 0, escrow_cents = 0, updated_at = NOW()
     WHERE user_id = $1`,
    [user.id]
  );
  await pool.query(
    `UPDATE users SET wallet_balance = 0, updated_at = NOW() WHERE id = $1`,
    [user.id]
  );
  await pool.query('COMMIT');

  const { rows: after } = await pool.query(
    `SELECT available_cents, escrow_cents FROM wallets WHERE user_id = $1`,
    [user.id]
  );

  console.log(
    JSON.stringify(
      {
        user: { id: user.id, email: user.email, name: user.name },
        before: before[0] || { available_cents: 0, escrow_cents: 0 },
        after: after[0] || { available_cents: 0, escrow_cents: 0 },
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  })
  .finally(() => pool.end());
