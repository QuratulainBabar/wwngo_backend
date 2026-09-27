/**
 * Rebuild WW-44489 as a fresh delivery:
 *   sender   = amjadkhan5093@gmail.com
 *   traveler = tufailkhan5093@gmail.com
 *   receiver = azan@gmail.com
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';

const PUBLIC_ID = 'WW-44489';

async function userByEmail(email) {
  const { rows } = await pool.query(
    `SELECT id, email, name FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  if (!rows[0]) throw new Error(`User not found: ${email}`);
  return rows[0];
}

async function main() {
  const sender = await userByEmail('amjadkhan5093@gmail.com');
  const traveler = await userByEmail('tufailkhan5093@gmail.com');
  const receiver = await userByEmail('azan@gmail.com');

  const { rows } = await pool.query(
    `SELECT * FROM deliveries WHERE public_id = $1`,
    [PUBLIC_ID]
  );
  const existing = rows[0];

  await pool.query('BEGIN');
  try {
    let deliveryId = existing?.id;

    if (existing) {
      await pool.query(`DELETE FROM shipment_escrows WHERE shipment_id = $1`, [PUBLIC_ID]);
      await pool.query(
        `DELETE FROM wallet_ledger
         WHERE shipment_id = $1 OR description ILIKE '%' || $1 || '%'`,
        [PUBLIC_ID]
      );
      await pool.query(`DELETE FROM nfc_checkpoints WHERE delivery_id = $1`, [deliveryId]).catch(() => {});
      await pool.query(`DELETE FROM disputes WHERE delivery_id = $1`, [deliveryId]).catch(() => {});
      await pool.query(`DELETE FROM delivery_status_history WHERE delivery_id = $1`, [deliveryId]).catch(() => {});
      await pool.query(`DELETE FROM trip_counter_offers WHERE delivery_id = $1`, [deliveryId]).catch(() => {});
      await pool.query(`DELETE FROM trip_sender_requests WHERE delivery_id = $1`, [deliveryId]).catch(() => {});
      await pool.query(`DELETE FROM chat_messages WHERE conversation_id IN (
        SELECT id FROM conversations WHERE delivery_id = $1
      )`, [deliveryId]).catch(() => {});
      await pool.query(`DELETE FROM conversation_reads WHERE conversation_id IN (
        SELECT id FROM conversations WHERE delivery_id = $1
      )`, [deliveryId]).catch(() => {});
      await pool.query(`DELETE FROM conversations WHERE delivery_id = $1`, [deliveryId]).catch(() => {});
      await pool.query(`DELETE FROM reviews WHERE shipment_id = $1`, [PUBLIC_ID]).catch(() => {});
    }

    // Traveler trip on same route
    let tripId;
    const { rows: trips } = await pool.query(
      `SELECT id FROM trips
       WHERE traveler_id = $1
         AND LOWER(COALESCE(from_city, '')) = 'paris'
         AND LOWER(COALESCE(to_city, '')) = 'lyon'
       ORDER BY created_at DESC LIMIT 1`,
      [traveler.id]
    );
    if (trips[0]) {
      tripId = trips[0].id;
      await pool.query(
        `UPDATE trips
            SET status = 'open_bid',
                travel_date = CURRENT_DATE + 7,
                luggage_capacity_kg = COALESCE(luggage_capacity_kg, 15),
                updated_at = NOW()
          WHERE id = $1`,
        [tripId]
      );
    } else {
      const stamp = Date.now().toString().slice(-5);
      const { rows: createdTrip } = await pool.query(
        `INSERT INTO trips (
           public_id, traveler_id, trip_type, status,
           from_city, from_code, to_city, to_code,
           travel_date, luggage_capacity_kg
         ) VALUES (
           $1, $2, 'city_to_city', 'open_bid',
           'Paris', 'PAR', 'Lyon', 'LYS',
           CURRENT_DATE + 7, 15
         ) RETURNING id`,
        [`TR-${stamp}`, traveler.id]
      );
      tripId = createdTrip[0].id;
    }

    if (existing) {
      await pool.query(
        `UPDATE deliveries
            SET sender_id = $2,
                traveler_id = $3,
                trip_id = $4,
                receiver_id = $5,
                receiver_email = $6,
                receiver_phone = COALESCE(receiver_phone, '+33600000000'),
                receiver_meetup_location = COALESCE(receiver_meetup_location, 'Gare de Lyon'),
                receiver_accepted_at = NOW(),
                status = 'posted',
                delivery_type = 'city_to_city',
                from_city = 'Paris',
                from_code = 'PAR',
                to_city = 'Lyon',
                to_code = 'LYS',
                travel_date = CURRENT_DATE + 7,
                parcel_category = 'documents',
                parcel_size = 'small',
                weight_kg = 1.5,
                max_budget = 75.00,
                bid_amount = 75.00,
                description = 'Fresh test delivery (roles reset).',
                preferred_meetup_locations = ARRAY['Gare du Nord', 'Airport pickup'],
                acknowledged = TRUE,
                platform_fee = 5.00,
                platform_fee_share = 2.50,
                disputed = FALSE,
                chat_unlocked = FALSE,
                receiver_paid_at = NULL,
                receiver_payment_due_at = NULL,
                receiver_fee_cents = 0,
                updated_at = NOW()
          WHERE id = $1`,
        [deliveryId, sender.id, traveler.id, tripId, receiver.id, receiver.email]
      );
    } else {
      const { rows: created } = await pool.query(
        `INSERT INTO deliveries (
           public_id, sender_id, traveler_id, trip_id, delivery_type, status,
           from_city, from_code, to_city, to_code,
           travel_date, parcel_category, parcel_size, weight_kg, max_budget, bid_amount,
           description, preferred_meetup_locations, acknowledged,
           platform_fee, platform_fee_share,
           receiver_email, receiver_phone, receiver_meetup_location,
           receiver_id, receiver_accepted_at, receiver_fee_cents, chat_unlocked
         ) VALUES (
           $1, $2, $3, $4, 'city_to_city', 'posted',
           'Paris', 'PAR', 'Lyon', 'LYS',
           CURRENT_DATE + 7, 'documents', 'small', 1.5, 75.00, 75.00,
           'Fresh test delivery (roles reset).',
           ARRAY['Gare du Nord', 'Airport pickup'], TRUE,
           5.00, 2.50,
           $5, '+33600000000', 'Gare de Lyon',
           $6, NOW(), 0, FALSE
         ) RETURNING id`,
        [PUBLIC_ID, sender.id, traveler.id, tripId, receiver.email, receiver.id]
      );
      deliveryId = created[0].id;
    }

    // Traveler selected — accepted request + accepted offer (Pay Now pending).
    const { rows: reqIns } = await pool.query(
      `INSERT INTO trip_sender_requests (
         delivery_id, trip_id, sender_id, traveler_id, match_score, status
       ) VALUES ($1, $2, $3, $4, 95, 'accepted')
       RETURNING id`,
      [deliveryId, tripId, sender.id, traveler.id]
    );
    const requestId = reqIns[0].id;

    await pool.query(
      `INSERT INTO trip_counter_offers (
         sender_request_id, delivery_id, trip_id, sender_id, traveler_id, amount, status
       ) VALUES ($1, $2, $3, $4, $5, 75.00, 'accepted')`,
      [requestId, deliveryId, tripId, sender.id, traveler.id]
    );

    await pool.query('COMMIT');

    const { rows: after } = await pool.query(
      `SELECT d.public_id, d.status, d.bid_amount,
              s.email AS sender_email, s.name AS sender_name,
              t.email AS traveler_email, t.name AS traveler_name,
              r.email AS receiver_email, r.name AS receiver_name,
              tr.public_id AS trip_public_id,
              (SELECT status FROM trip_sender_requests WHERE delivery_id = d.id LIMIT 1) AS request_status,
              (SELECT status FROM trip_counter_offers WHERE delivery_id = d.id LIMIT 1) AS offer_status
       FROM deliveries d
       JOIN users s ON s.id = d.sender_id
       LEFT JOIN users t ON t.id = d.traveler_id
       LEFT JOIN users r ON r.id = d.receiver_id
       LEFT JOIN trips tr ON tr.id = d.trip_id
       WHERE d.public_id = $1`,
      [PUBLIC_ID]
    );

    console.log(JSON.stringify(after[0], null, 2));
    console.log('\nFresh WW-44489 ready. Sender Amjad → Pay Now for Tufail.');
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
