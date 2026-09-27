import 'dotenv/config';
import { pool } from '../src/db/pool.js';

const PUBLIC_ID = 'WW-44489';

const { rows: users } = await pool.query(
  `SELECT id, email, name FROM users
   WHERE LOWER(email) IN (
     LOWER('tufailkhan5093@gmail.com'),
     LOWER('amjadkhan5093@gmail.com'),
     LOWER('azan@gmail.com')
   )`
);

for (const u of users) {
  const { rows: w } = await pool.query(
    `SELECT available_cents, escrow_cents FROM wallets WHERE user_id = $1`,
    [u.id]
  );
  const { rows: ledger } = await pool.query(
    `SELECT type, amount_cents, available_delta_cents, description, created_at, hidden_from_history
     FROM wallet_ledger
     WHERE user_id = $1
       AND (shipment_id = $2 OR description ILIKE '%' || $2 || '%' OR description ILIKE '%Card fallback%')
     ORDER BY created_at DESC
     LIMIT 15`,
    [u.id, PUBLIC_ID]
  );
  const { rows: notifs } = await pool.query(
    `SELECT type, title, body, created_at
     FROM notifications
     WHERE user_id = $1 AND (body ILIKE '%' || $2 || '%' OR type = 'platformFee')
     ORDER BY created_at DESC
     LIMIT 5`,
    [u.id, PUBLIC_ID]
  );
  console.log('\n===', u.email, '===');
  console.log('wallet:', w[0] || null);
  console.log('ledger:', JSON.stringify(ledger, null, 2));
  console.log('notifs:', JSON.stringify(notifs, null, 2));
}

const { rows: escrows } = await pool.query(
  `SELECT * FROM shipment_escrows WHERE shipment_id = $1`,
  [PUBLIC_ID]
);
console.log('\nescrow:', escrows);

await pool.end();
