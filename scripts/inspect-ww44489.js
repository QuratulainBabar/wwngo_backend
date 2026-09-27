import 'dotenv/config';
import { pool } from '../src/db/pool.js';

const { rows } = await pool.query(
  `SELECT public_id, status, traveler_id, trip_id, bid_amount, sender_id,
          receiver_id, receiver_email, chat_unlocked
   FROM deliveries WHERE public_id = $1`,
  ['WW-44489']
);
console.log('delivery', rows[0]);

const { rows: escrows } = await pool.query(
  `SELECT shipment_id, status, amount_cents FROM shipment_escrows WHERE shipment_id = $1`,
  ['WW-44489']
);
console.log('escrow', escrows);

const { rows: statuses } = await pool.query(
  `SELECT enumlabel FROM pg_enum e
   JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'delivery_status'
   ORDER BY enumsortorder`
);
console.log('statuses', statuses.map((r) => r.enumlabel));

const { rows: reqs } = await pool.query(
  `SELECT tsr.id, tsr.status, tsr.trip_id, u.email
   FROM trip_sender_requests tsr
   JOIN deliveries d ON d.id = tsr.delivery_id
   JOIN users u ON u.id = tsr.traveler_id
   WHERE d.public_id = $1`,
  ['WW-44489']
);
console.log('requests', reqs);

await pool.end();
