/**
 * Manual wallet credit: node scripts/credit-wallet.js <email> <dollars> [role]
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import * as walletRepo from '../src/repositories/wallet.repository.js';

const email = process.argv[2];
const dollars = Number(process.argv[3]);
const roleArg = process.argv[4];

if (!email || !Number.isFinite(dollars) || dollars <= 0) {
  console.error('Usage: node scripts/credit-wallet.js <email> <dollars> [role]');
  process.exit(1);
}

const amountCents = Math.round(dollars * 100);

async function main() {
  const { rows } = await pool.query(
    `SELECT id, name, email, role, wallet_balance
     FROM users
     WHERE LOWER(email) = LOWER($1)`,
    [email]
  );

  const user = rows[0];
  if (!user) {
    throw new Error(`User not found: ${email}`);
  }

  const role = walletRepo.normalizeRole(roleArg || user.role || 'sender');

  const before = await walletRepo.getWallet(user.id, role);
  const { wallet } = await walletRepo.appendLedgerEntry({
    userId: user.id,
    role,
    type: 'top_up',
    amountCents,
    availableDeltaCents: amountCents,
    description: `Manual credit $${dollars.toFixed(2)}`,
  });

  console.log(JSON.stringify({
    user: { id: user.id, name: user.name, email: user.email, role: user.role },
    creditedRole: role,
    amountDollars: dollars,
    beforeAvailableCents: Number(before.available_cents),
    afterAvailableCents: Number(wallet.available_cents),
    walletBalance: Number(wallet.available_cents) / 100,
  }, null, 2));
}

main()
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  })
  .finally(() => pool.end());
