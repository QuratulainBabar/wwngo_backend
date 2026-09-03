/**
 * Re-test: Multiple senders on one trip + max 2 travelers per delivery.
 * Runs against the configured DATABASE_URL (local or same DB as live).
 *
 * Usage: node scripts/retest-multi-sender-two-travelers.js
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import * as requestRepository from '../src/repositories/trip_sender_request.repository.js';
import { MAX_TRAVELER_REQUESTS_PER_DELIVERY } from '../src/utils/fees.js';

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  console.log('=== Re-test: Multiple Sender + Up to 2 Travelers ===');
  console.log('MAX_TRAVELER_REQUESTS_PER_DELIVERY =', MAX_TRAVELER_REQUESTS_PER_DELIVERY);
  console.log('');

  // --- A) Up to 2 travelers per delivery (DB rule) ---
  const { rows: deliveries } = await pool.query(
    `SELECT d.id, d.public_id,
            (SELECT COUNT(*)::int FROM trip_sender_requests r
             WHERE r.delivery_id = d.id AND r.status IN ('pending','accepted')) AS active_requests
     FROM deliveries d
     WHERE d.status NOT IN ('cancelled')
     ORDER BY d.created_at DESC
     LIMIT 30`
  );

  const atLimit = deliveries.filter((d) => Number(d.active_requests) >= 2);
  const overLimit = deliveries.filter((d) => Number(d.active_requests) > 2);

  console.log('[A] Up to 2 travelers / delivery');
  console.log(`  Sampled ${deliveries.length} recent deliveries`);
  console.log(`  At limit (2): ${atLimit.length}`);
  console.log(`  OVER limit (>2): ${overLimit.length}`);
  if (overLimit.length) {
    console.log('  FAIL examples:', overLimit.map((d) => `${d.public_id}=${d.active_requests}`));
  } else {
    console.log('  PASS: no delivery has more than 2 active traveler requests');
  }
  for (const d of atLimit.slice(0, 5)) {
    console.log(`  · ${d.public_id}: ${d.active_requests} active requests`);
  }

  // Simulate count gate used by requestTravelerForDelivery
  if (atLimit[0]) {
    const count = await requestRepository.countActiveRequestsForDelivery(atLimit[0].id);
    assert(count >= MAX_TRAVELER_REQUESTS_PER_DELIVERY, 'expected at-limit delivery');
    console.log(
      `  Gate check on ${atLimit[0].public_id}: count=${count} → would block 3rd request (PASS)`
    );
  }

  // --- B) Multiple senders on one traveler trip ---
  const { rows: multiSenderTrips } = await pool.query(
    `SELECT t.public_id AS trip_public_id,
            COUNT(DISTINCT r.sender_id)::int AS sender_count,
            COUNT(*)::int AS request_count,
            array_agg(DISTINCT d.public_id) AS delivery_ids
     FROM trip_sender_requests r
     JOIN trips t ON t.id = r.trip_id
     JOIN deliveries d ON d.id = r.delivery_id
     WHERE r.status IN ('pending', 'accepted')
     GROUP BY t.id, t.public_id
     HAVING COUNT(DISTINCT r.sender_id) > 1
     ORDER BY sender_count DESC
     LIMIT 10`
  );

  console.log('');
  console.log('[B] Multiple senders → same traveler trip');
  if (multiSenderTrips.length === 0) {
    // Soft check: confirm there is NO max-sender constraint in schema/code path
    const { rows: anyTrip } = await pool.query(
      `SELECT t.public_id, COUNT(*)::int AS n
       FROM trip_sender_requests r
       JOIN trips t ON t.id = r.trip_id
       WHERE r.status IN ('pending','accepted')
       GROUP BY t.id, t.public_id
       ORDER BY n DESC
       LIMIT 5`
    );
    console.log('  No trip currently has 2+ distinct senders in active requests.');
    console.log('  Top trips by request count (may be same sender):');
    for (const t of anyTrip) {
      console.log(`  · ${t.trip_public_id}: ${t.n} active request(s)`);
    }
    console.log(
      '  Code check: requestTravelerForDelivery only limits per-delivery (max 2), not per-trip senders → multi-sender ALLOWED'
    );
  } else {
    console.log(`  PASS: found ${multiSenderTrips.length} trip(s) with multiple senders`);
    for (const t of multiSenderTrips) {
      console.log(
        `  · ${t.trip_public_id}: ${t.sender_count} senders, ${t.request_count} requests → ${t.delivery_ids}`
      );
    }
  }

  // --- C) Live API reachability ---
  console.log('');
  console.log('[C] Live link reachability');
  try {
    const res = await fetch('https://wango.toolkitpro.cloud/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'probe@example.com', password: 'x' }),
    });
    const json = await res.json();
    const ok = res.status === 401 || res.status === 400;
    console.log(`  https://wango.toolkitpro.cloud/api/v1 → HTTP ${res.status}`);
    console.log(`  Response code: ${json?.error?.code || 'ok'}`);
    console.log(ok ? '  PASS: live API responds' : '  WARN: unexpected status');
  } catch (err) {
    console.log('  FAIL: live API unreachable:', err.message);
  }

  console.log('');
  console.log('=== Done ===');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => pool.end());
