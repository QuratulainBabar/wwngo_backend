import 'dotenv/config';
import { pool } from '../src/db/pool.js';

const email = process.argv[2] || 'tufailkhan5093@gmail.com';

async function main() {
  const { rows: users } = await pool.query(
    `SELECT id, name, email FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );

  if (!users[0]) {
    console.log(`No user found for ${email}`);
    process.exit(1);
  }

  const user = users[0];
  console.log('User:', { id: user.id, name: user.name, email: user.email });

  const { rows: tokens, rowCount } = await pool.query(
    `SELECT token, platform, created_at, updated_at
     FROM device_tokens
     WHERE user_id = $1
     ORDER BY updated_at DESC`,
    [user.id]
  );

  console.log('FCM token count:', rowCount);
  if (!rowCount) {
    console.log('No FCM token registered for this user.');
    await pool.end();
    return;
  }

  tokens.forEach((t, i) => {
    const token = t.token;
    console.log(`${i + 1}.`, {
      platform: t.platform,
      updated_at: t.updated_at,
      created_at: t.created_at,
      token_preview: `${token.slice(0, 24)}...${token.slice(-8)}`,
      token_length: token.length,
    });
  });

  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
