import 'dotenv/config';
import { pool } from '../src/db/pool.js';

const email = process.argv[2] || 'admin@admin.com';

const { rows } = await pool.query(
  `UPDATE users
   SET is_admin = true, updated_at = NOW()
   WHERE LOWER(email) = LOWER($1)
   RETURNING id, email, name, is_admin`,
  [email]
);

if (!rows[0]) {
  console.log(`No user found for ${email}`);
  console.log('Create the admin account with: node scripts/ensure-admin.js');
  process.exit(1);
}

console.log('Promoted to admin:', rows[0]);
await pool.end();
