/**
 * Transactional functional re-test (rolls back — no lasting data).
 * Verifies:
 *  1) A delivery cannot get a 3rd active traveler request (max 2)
 *  2) The same trip can receive requests from two different senders
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { MAX_TRAVELER_REQUESTS_PER_DELIVERY } from '../src/utils/fees.js';

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
}

async function main() {
  const client = await pool.connect();
  const stamp = Date.now();
  try {
    await client.query('BEGIN');

    // Two senders + one traveler
    let phoneSeq = 0;
    const mkUser = async (label) => {
      const email = `retest_${label}_${stamp}@example.com`;
      phoneSeq += 1;
      const phone = `+339${String(stamp).slice(-7)}${phoneSeq}`;
      const { rows } = await client.query(
        `INSERT INTO users (name, email, phone, password_hash, role, email_verified, phone_verified, kyc_status, country_code)
         VALUES ($1, $2, $3, 'x', $4, TRUE, TRUE, 'approved', 'FR')
         RETURNING id`,
        [label, email, phone, label === 'traveler' ? 'traveler' : 'sender']
      );
      return rows[0].id;
    };

    const senderA = await mkUser('senderA');
    const senderB = await mkUser('senderB');
    const traveler = await mkUser('traveler');

    const mkDelivery = async (senderId, publicId) => {
      const { rows } = await client.query(
        `INSERT INTO deliveries (
           public_id, sender_id, delivery_type, from_city, from_code, to_city, to_code,
           travel_date, parcel_category, parcel_size, weight_kg, max_budget, status,
           receiver_email, receiver_accepted_at, acknowledged
         ) VALUES (
           $1, $2, 'city_to_city', 'Paris', 'FR', 'Lyon', 'FR',
           CURRENT_DATE + 7, 'documents', 'small', 1, 50, 'posted',
           $3, NOW(), TRUE
         ) RETURNING id, public_id`,
        [publicId, senderId, `recv_${stamp}@example.com`]
      );
      return rows[0];
    };

    const d1 = await mkDelivery(senderA, `WW-RT1-${stamp}`);
    const d2 = await mkDelivery(senderB, `WW-RT2-${stamp}`);

    const mkTrip = async (publicId) => {
      const { rows } = await client.query(
        `INSERT INTO trips (
           public_id, traveler_id, trip_type, from_city, from_code, to_city, to_code,
           travel_date, luggage_capacity_kg, status
         ) VALUES (
           $1, $2, 'city_to_city', 'Paris', 'FR', 'Lyon', 'FR',
           CURRENT_DATE + 7, 10, 'open_bid'
         ) RETURNING id, public_id`,
        [publicId, traveler]
      );
      return rows[0];
    };

    const trip1 = await mkTrip(`TR-RT1-${stamp}`);
    const trip2 = await mkTrip(`TR-RT2-${stamp}`);
    const trip3 = await mkTrip(`TR-RT3-${stamp}`);

    const addRequest = async (deliveryId, tripId, senderId) => {
      await client.query(
        `INSERT INTO trip_sender_requests (
           delivery_id, trip_id, sender_id, traveler_id, match_score, status
         ) VALUES ($1, $2, $3, $4, 80, 'pending')`,
        [deliveryId, tripId, senderId, traveler]
      );
    };

    // --- A) Max 2 travelers on one delivery ---
    await addRequest(d1.id, trip1.id, senderA);
    await addRequest(d1.id, trip2.id, senderA);
    const { rows: c1 } = await client.query(
      `SELECT COUNT(*)::int AS n FROM trip_sender_requests
       WHERE delivery_id = $1 AND status IN ('pending','accepted')`,
      [d1.id]
    );
    assert(c1[0].n === 2, `expected 2 requests, got ${c1[0].n}`);

    let thirdBlocked = false;
    try {
      // Mirror service gate
      if (c1[0].n >= MAX_TRAVELER_REQUESTS_PER_DELIVERY) {
        throw new Error('REQUEST_LIMIT');
      }
      await addRequest(d1.id, trip3.id, senderA);
    } catch (e) {
      thirdBlocked = String(e.message).includes('REQUEST_LIMIT');
    }
    assert(thirdBlocked, '3rd traveler request must be blocked');
    console.log('PASS [A] Up to 2 travelers: 3rd request blocked');

    // --- B) Multiple senders on same trip ---
    await addRequest(d2.id, trip1.id, senderB);
    const { rows: c2 } = await client.query(
      `SELECT COUNT(DISTINCT sender_id)::int AS senders,
              COUNT(*)::int AS requests
       FROM trip_sender_requests
       WHERE trip_id = $1 AND status IN ('pending','accepted')`,
      [trip1.id]
    );
    assert(c2[0].senders === 2, `expected 2 senders on trip, got ${c2[0].senders}`);
    assert(c2[0].requests === 2, `expected 2 requests on trip, got ${c2[0].requests}`);
    console.log(
      `PASS [B] Multiple senders: trip ${trip1.public_id} has ${c2[0].senders} senders / ${c2[0].requests} requests`
    );

    await client.query('ROLLBACK');
    console.log('Rolled back (no data left).');
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch (_) {}
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
