import { pool } from './pool.js';
import { hashPassword } from '../utils/password.js';

const ADMIN_EMAIL = (process.env.ADMIN_SEED_EMAIL || 'admin@admin.com').trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_SEED_PASSWORD || '11223344';
const ADMIN_PHONE = process.env.ADMIN_SEED_PHONE || '+10000000001';
const ADMIN_NAME = process.env.ADMIN_SEED_NAME || 'Admin';
const ADMIN_COUNTRY = process.env.ADMIN_SEED_COUNTRY || 'US';

async function seed() {
  const passwordHash = await hashPassword(ADMIN_PASSWORD);

  const { rows: existing } = await pool.query(
    'SELECT id, email, is_admin FROM users WHERE LOWER(email) = $1 LIMIT 1',
    [ADMIN_EMAIL]
  );

  if (existing[0]) {
    await pool.query(
      `UPDATE users
       SET password_hash = $1,
           is_admin = TRUE,
           account_status = 'active',
           email_verified = TRUE,
           is_verified = TRUE,
           updated_at = NOW()
       WHERE id = $2`,
      [passwordHash, existing[0].id]
    );
    console.log(`Admin updated: ${ADMIN_EMAIL}`);
    return;
  }

  await pool.query(
    `INSERT INTO users (
       name, email, phone, password_hash, country_code,
       terms_accepted_at, email_verified, phone_verified,
       is_verified, is_admin, account_status, role
     ) VALUES (
       $1, $2, $3, $4, $5,
       NOW(), TRUE, TRUE,
       TRUE, TRUE, 'active', 'sender'
     )`,
    [ADMIN_NAME, ADMIN_EMAIL, ADMIN_PHONE, passwordHash, ADMIN_COUNTRY]
  );

  console.log(`Admin created: ${ADMIN_EMAIL}`);
}

seed()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
