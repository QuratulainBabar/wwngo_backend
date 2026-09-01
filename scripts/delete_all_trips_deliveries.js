/**
 * Dev cleanup: remove all trips, delivery requests, and related rows.
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';

async function count(client) {
  const { rows } = await client.query(`
    SELECT
      (SELECT COUNT(*)::int FROM deliveries) AS deliveries,
      (SELECT COUNT(*)::int FROM trips) AS trips,
      (SELECT COUNT(*)::int FROM trip_sender_requests) AS sender_requests,
      (SELECT COUNT(*)::int FROM trip_counter_offers) AS counter_offers,
      (SELECT COUNT(*)::int FROM shipment_escrows) AS escrows
  `);
  return rows[0];
}

async function main() {
  const client = await pool.connect();
  try {
    console.log('Before:', await count(client));

    await client.query('BEGIN');

    await client.query(
      `DELETE FROM shipment_escrows WHERE shipment_id IN (SELECT public_id FROM deliveries)`
    );
    await client.query(
      `DELETE FROM wallet_ledger WHERE shipment_id IN (SELECT public_id FROM deliveries)`
    );
    await client.query(
      `DELETE FROM reviews WHERE shipment_id IN (SELECT public_id FROM deliveries)`
    );
    await client.query(`
      DELETE FROM notifications
      WHERE route LIKE '/shipment/%'
         OR route LIKE '/bid-requests/%'
         OR route LIKE '/traveler-requests/%'
         OR route LIKE '/delivery/%'
    `);
    await client.query('DELETE FROM deliveries');
    await client.query('DELETE FROM trips');

    // Release wallet escrow no longer backed by shipment_escrows rows.
    await client.query(`
      UPDATE wallets
      SET available_cents = available_cents + escrow_cents,
          escrow_cents = 0
      WHERE escrow_cents > 0
        AND NOT EXISTS (
          SELECT 1 FROM shipment_escrows se
          WHERE se.user_id = wallets.user_id AND se.role = wallets.role
        )
    `);

    await client.query('COMMIT');

    console.log('After:', await count(client));
    console.log('All trips and delivery requests deleted.');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('Delete failed:', err.message);
  process.exit(1);
});
