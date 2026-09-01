import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import { sendPushToUser } from '../src/services/fcm.service.js';

const email = process.argv[2] || 'tufailkhan5093@gmail.com';
const title = process.argv[3] || 'WWNGO Test';
const body =
  process.argv[4] ||
  'Push notifications are working! This is a test from the backend.';

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
  console.log('Sending test push to:', {
    id: user.id,
    name: user.name,
    email: user.email,
    title,
    body,
  });

  const result = await sendPushToUser(user.id, {
    title,
    body,
    data: { route: '/notifications', type: 'test' },
  });

  console.log('Result:', result);
  await pool.end();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
