import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { hashPassword } from '../src/utils/password.js';

const email = 'admin@admin.com';
const password = '11223344';

async function main() {
  const hash = await hashPassword(password);

  // Keep regular app accounts non-admin.
  await pool.query(
    `UPDATE users
     SET is_admin = false, updated_at = NOW()
     WHERE LOWER(email) = LOWER('tufailkhan5093@gmail.com')`
  );

  const existing = await pool.query(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );

  let admin;
  if (existing.rows[0]) {
    const { rows } = await pool.query(
      `UPDATE users
       SET password_hash = $2,
           is_admin = true,
           account_status = 'active',
           email_verified = true,
           phone_verified = true,
           kyc_status = 'approved',
           is_verified = true,
           name = 'WWNGO Admin',
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, email, name, is_admin, account_status`,
      [existing.rows[0].id, hash]
    );
    admin = rows[0];
  } else {
    const { rows } = await pool.query(
      `INSERT INTO users (
         name, email, phone, password_hash, country_code,
         is_admin, account_status, email_verified, phone_verified,
         kyc_status, is_verified, role
       ) VALUES (
         'WWNGO Admin', $1, '+19999999999', $2, 'US',
         true, 'active', true, true,
         'approved', true, 'sender'
       )
       RETURNING id, email, name, is_admin, account_status`,
      [email, hash]
    );
    admin = rows[0];
  }

  const { rows: tufailRows } = await pool.query(
    `SELECT email, is_admin
     FROM users
     WHERE LOWER(email) = LOWER('tufailkhan5093@gmail.com')`
  );

  console.log({
    admin,
    tufail: tufailRows[0] || null,
    credentials: { email, password },
  });

  await pool.end();
}

main().catch(async (err) => {
  console.error(err);
  await pool.end().catch(() => {});
  process.exit(1);
});
