/**
 * Reset WW-44489 to "traveler selected / payment pending" so sender can Pay Now again.
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';

const PUBLIC_ID = 'WW-44489';

async function main() {
  const { rows } = await pool.query(
    `SELECT * FROM deliveries WHERE public_id = $1`,
    [PUBLIC_ID]
  );
  const d = rows[0];
  if (!d) throw new Error(`Delivery ${PUBLIC_ID} not found`);

  const { rows: travelers } = await pool.query(
    `SELECT id, email, name FROM users WHERE LOWER(email) = LOWER($1)`,
    ['amjadkhan5093@gmail.com']
  );
  const traveler = travelers[0];
  if (!traveler) throw new Error('Traveler not found');

  let tripId = d.trip_id;
  if (!tripId) {
    const { rows: trips } = await pool.query(
      `SELECT id FROM trips WHERE traveler_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [traveler.id]
    );
    tripId = trips[0]?.id;
  }
  if (!tripId) throw new Error('No trip found for traveler');

  await pool.query('BEGIN');
  try {
    await pool.query(`DELETE FROM shipment_escrows WHERE shipment_id = $1`, [PUBLIC_ID]);
    await pool.query(
      `DELETE FROM wallet_ledger
       WHERE shipment_id = $1 OR description ILIKE '%' || $1 || '%'`,
      [PUBLIC_ID]
    );
    await pool.query(`DELETE FROM nfc_checkpoints WHERE delivery_id = $1`, [d.id]).catch(() => {});
    await pool.query(`DELETE FROM disputes WHERE delivery_id = $1`, [d.id]).catch(() => {});
    await pool.query(
      `DELETE FROM delivery_status_history WHERE delivery_id = $1`,
      [d.id]
    ).catch(() => {});

    // Posted + traveler linked + receiver accepted → Pay Now path (paymentPending).
    await pool.query(
      `UPDATE deliveries
          SET status = 'posted',
              traveler_id = $2,
              trip_id = $3,
              bid_amount = COALESCE(bid_amount, max_budget, 75),
              disputed = FALSE,
              chat_unlocked = FALSE,
              receiver_accepted_at = COALESCE(receiver_accepted_at, NOW()),
              receiver_id = COALESCE(receiver_id, $4),
              receiver_email = COALESCE(receiver_email, 'azan@gmail.com'),
              receiver_paid_at = NULL,
              receiver_payment_due_at = NULL,
              receiver_fee_cents = 0,
              updated_at = NOW()
        WHERE id = $1`,
      [d.id, traveler.id, tripId, d.receiver_id]
    );

    await pool.query(
      `UPDATE trips SET status = 'open_bid', updated_at = NOW() WHERE id = $1`,
      [tripId]
    );

    // Ensure accepted sender→traveler request.
    const { rows: reqs } = await pool.query(
      `SELECT id FROM trip_sender_requests
       WHERE delivery_id = $1 AND traveler_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [d.id, traveler.id]
    );

    let requestId = reqs[0]?.id;
    if (!requestId) {
      const { rows: inserted } = await pool.query(
        `INSERT INTO trip_sender_requests (
           delivery_id, trip_id, sender_id, traveler_id, match_score, status
         ) VALUES ($1, $2, $3, $4, 90, 'accepted')
         RETURNING id`,
        [d.id, tripId, d.sender_id, traveler.id]
      );
      requestId = inserted[0].id;
    } else {
      await pool.query(
        `UPDATE trip_sender_requests
            SET status = 'accepted', trip_id = $2, updated_at = NOW()
          WHERE id = $1`,
        [requestId, tripId]
      );
    }

    // Counter offer accepted + delivery posted ⇒ Flutter paymentPending / Pay Now.
    const { rows: offers } = await pool.query(
      `SELECT id FROM trip_counter_offers
       WHERE delivery_id = $1 AND traveler_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [d.id, traveler.id]
    );

    const amount = Number(d.bid_amount || d.max_budget || 75);
    if (offers[0]) {
      await pool.query(
        `UPDATE trip_counter_offers
            SET status = 'accepted',
                amount = $2,
                sender_request_id = $3,
                trip_id = $4,
                updated_at = NOW()
          WHERE id = $1`,
        [offers[0].id, amount, requestId, tripId]
      );
    } else {
      await pool.query(
        `INSERT INTO trip_counter_offers (
           sender_request_id, delivery_id, trip_id, sender_id, traveler_id, amount, status
         ) VALUES ($1, $2, $3, $4, $5, $6, 'accepted')`,
        [requestId, d.id, tripId, d.sender_id, traveler.id, amount]
      );
    }

    await pool.query('COMMIT');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }

  const { rows: after } = await pool.query(
    `SELECT d.public_id, d.status, d.bid_amount, d.traveler_id, d.receiver_accepted_at IS NOT NULL AS receiver_ok,
            u.email AS traveler_email,
            (SELECT status FROM trip_sender_requests WHERE delivery_id = d.id AND traveler_id = d.traveler_id LIMIT 1) AS request_status,
            (SELECT status FROM trip_counter_offers WHERE delivery_id = d.id AND traveler_id = d.traveler_id LIMIT 1) AS offer_status,
            (SELECT COUNT(*)::int FROM shipment_escrows WHERE shipment_id = d.public_id) AS escrows
     FROM deliveries d
     LEFT JOIN users u ON u.id = d.traveler_id
     WHERE d.public_id = $1`,
    [PUBLIC_ID]
  );

  console.log(JSON.stringify(after[0], null, 2));
  console.log('\nPay Now: Sender → WW-44489 matching travelers → Amjad → Pay Now');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
