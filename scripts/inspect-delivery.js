import 'dotenv/config';
import { pool } from '../src/db/pool.js';

const publicId = process.argv[2];
if (!publicId) {
  console.error('Usage: node scripts/inspect-delivery.js <publicId>');
  process.exit(1);
}

const { rows } = await pool.query(
  `SELECT public_id, status, receiver_id, receiver_accepted_at, receiver_paid_at,
          receiver_email, receiver_phone, sender_id, traveler_id, created_at, updated_at
   FROM deliveries
   WHERE public_id = $1`,
  [publicId]
);

console.log(JSON.stringify(rows[0] || null, null, 2));
await pool.end();
