/**
 * Set receiver on delivery WW-44489 to azan@gmail.com and create a matching trip
 * for traveler amjadkhan5093@gmail.com on the same route.
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';

async function main() {
  const { rows: users } = await pool.query(
    `SELECT id, email, name
     FROM users
     WHERE LOWER(email) IN (
       LOWER('azan@gmail.com'),
       LOWER('amjadkhan5093@gmail.com'),
       LOWER('tufailkhan5093@gmail.com')
     )`
  );
  const byEmail = Object.fromEntries(
    users.map((u) => [u.email.toLowerCase(), u])
  );

  const receiver = byEmail['azan@gmail.com'];
  const traveler = byEmail['amjadkhan5093@gmail.com'];
  if (!receiver) throw new Error('Receiver not found: azan@gmail.com');
  if (!traveler) throw new Error('Traveler not found: amjadkhan5093@gmail.com');

  const { rows: deliveries } = await pool.query(
    `SELECT id, public_id, status, from_city, from_code, to_city, to_code,
            travel_date, delivery_type, receiver_email, receiver_id
     FROM deliveries
     WHERE public_id = 'WW-44489'`
  );
  const delivery = deliveries[0];
  if (!delivery) throw new Error('Delivery WW-44489 not found');

  await pool.query('BEGIN');
  try {
    const { rows: updatedRows } = await pool.query(
      `UPDATE deliveries
          SET receiver_email = $1,
              receiver_id = $2,
              receiver_accepted_at = NULL,
              updated_at = NOW()
        WHERE id = $3
        RETURNING id, public_id, receiver_email, receiver_id, from_city, to_city, travel_date`,
      [receiver.email, receiver.id, delivery.id]
    );

    const stamp = Date.now().toString().slice(-5);
    const tripPublicId = `TR-${stamp}`;

    const { rows: tripRows } = await pool.query(
      `INSERT INTO trips (
         public_id, traveler_id, trip_type, status,
         from_city, from_code, to_city, to_code,
         travel_date, luggage_capacity_kg, flight_number
       ) VALUES (
         $1, $2, 'city_to_city', 'open_bid',
         $3, $4, $5, $6,
         $7, 15, NULL
       )
       RETURNING id, public_id, status, from_city, to_city, travel_date, traveler_id`,
      [
        tripPublicId,
        traveler.id,
        delivery.from_city,
        delivery.from_code,
        delivery.to_city,
        delivery.to_code,
        delivery.travel_date,
      ]
    );

    await pool.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          delivery: updatedRows[0],
          receiver: { id: receiver.id, email: receiver.email, name: receiver.name },
          trip: tripRows[0],
          traveler: { id: traveler.id, email: traveler.email, name: traveler.name },
        },
        null,
        2
      )
    );
  } catch (err) {
    await pool.query('ROLLBACK');
    throw err;
  }
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  })
  .finally(() => pool.end());
