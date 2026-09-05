/**
 * Create a sample posted delivery for a sender email.
 * Usage: node scripts/create-sample-delivery.js [email]
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';

const email = process.argv[2] || 'tufailkhan5093@gmail.com';

async function main() {
  const { rows: users } = await pool.query(
    `SELECT id, email, name, role
     FROM users
     WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  const user = users[0];
  if (!user) {
    throw new Error(`User not found: ${email}`);
  }

  const stamp = Date.now().toString().slice(-5);
  const publicId = `WW-${stamp}`;

  const { rows } = await pool.query(
    `INSERT INTO deliveries (
       public_id, sender_id, delivery_type, status,
       from_city, from_code, to_city, to_code,
       travel_date, parcel_category, parcel_size, weight_kg, max_budget,
       description, preferred_meetup_locations, acknowledged,
       platform_fee, platform_fee_share,
       receiver_email, receiver_phone, receiver_meetup_location
     ) VALUES (
       $1, $2, 'city_to_city', 'posted',
       'Paris', 'PAR', 'Lyon', 'LYS',
       CURRENT_DATE + 7, 'documents', 'small', 1.5, 75.00,
       $3, ARRAY['Gare du Nord', 'Airport pickup'], TRUE,
       5.00, 2.50,
       $4, '+33600000000', 'Gare de Lyon'
     )
     RETURNING id, public_id, status, from_city, to_city, travel_date, max_budget, created_at`,
    [
      publicId,
      user.id,
      'Sample parcel created via script for testing.',
      `receiver+${stamp}@example.com`,
    ]
  );

  console.log(
    JSON.stringify(
      {
        sender: { id: user.id, email: user.email, name: user.name },
        delivery: rows[0],
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
