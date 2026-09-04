/**
 * Zero available + escrow balances for ALL users.
 * Also closes open shipment escrows so ledger state stays consistent.
 *
 * Usage:
 *   node scripts/zero-all-wallets.js --yes
 *
 * Without --yes the script only prints a dry-run summary and exits.
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';

const confirmed = process.argv.includes('--yes') || process.argv.includes('-y');

async function main() {
  const { rows: before } = await pool.query(`
    SELECT
      COUNT(*)::int AS wallet_rows,
      COALESCE(SUM(available_cents), 0)::bigint AS total_available_cents,
      COALESCE(SUM(escrow_cents), 0)::bigint AS total_escrow_cents,
      COUNT(*) FILTER (WHERE available_cents <> 0 OR escrow_cents <> 0)::int AS non_zero_wallets
    FROM wallets
  `);

  const { rows: escrowBefore } = await pool.query(`
    SELECT
      COUNT(*)::int AS open_escrows,
      COALESCE(SUM(amount_cents), 0)::bigint AS open_escrow_cents
    FROM shipment_escrows
    WHERE status IN ('held', 'frozen')
  `);

  const summary = {
    wallets: before[0],
    openShipmentEscrows: escrowBefore[0],
  };

  console.log('Current totals:');
  console.log(JSON.stringify(summary, null, 2));

  if (!confirmed) {
    console.log('\nDry run only. Re-run with --yes to zero all balances:');
    console.log('  node scripts/zero-all-wallets.js --yes');
    return;
  }

  await pool.query('BEGIN');
  try {
    const wallets = await pool.query(`
      UPDATE wallets
         SET available_cents = 0,
             escrow_cents = 0,
             updated_at = NOW()
       WHERE available_cents <> 0 OR escrow_cents <> 0
    `);

    // Legacy column on users (may still be read in older paths).
    await pool.query(`
      UPDATE users
         SET wallet_balance = 0,
             updated_at = NOW()
       WHERE COALESCE(wallet_balance, 0) <> 0
    `);

    const escrows = await pool.query(`
      UPDATE shipment_escrows
         SET status = 'refunded',
             updated_at = NOW()
       WHERE status IN ('held', 'frozen')
    `);

    await pool.query('COMMIT');

    const { rows: after } = await pool.query(`
      SELECT
        COUNT(*)::int AS wallet_rows,
        COALESCE(SUM(available_cents), 0)::bigint AS total_available_cents,
        COALESCE(SUM(escrow_cents), 0)::bigint AS total_escrow_cents,
        COUNT(*) FILTER (WHERE available_cents <> 0 OR escrow_cents <> 0)::int AS non_zero_wallets
      FROM wallets
    `);

    const { rows: escrowAfter } = await pool.query(`
      SELECT COUNT(*)::int AS open_escrows
      FROM shipment_escrows
      WHERE status IN ('held', 'frozen')
    `);

    console.log('\nDone.');
    console.log(
      JSON.stringify(
        {
          walletsUpdated: wallets.rowCount,
          shipmentEscrowsClosed: escrows.rowCount,
          after: {
            wallets: after[0],
            openShipmentEscrows: escrowAfter[0],
          },
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
