import { pool } from './pool.js';

// =====================================================================
// truncate-all.js
//
// Empties ALL data tables in the database (public schema) while keeping
// the schema itself intact (tables, columns, indexes, triggers).
//
// - TRUNCATE ... RESTART IDENTITY CASCADE resets identity/serial counters
//   and clears foreign-key references automatically.
// - Discovers tables dynamically, so it keeps working as new migrations
//   add tables.
// - Preserves `schema_migrations` so the app does NOT re-run every
//   migration afterwards.
//
// WARNING: THIS DELETES EVERY ROW IN EVERY TABLE. There is no undo.
// Intended for local/development/staging databases only.
//
// Run with:
//   node src/db/truncate-all.js
// =====================================================================

async function truncateAll() {
  const { rows } = await pool.query(`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename <> 'schema_migrations'
    ORDER BY tablename
  `);

  if (rows.length === 0) {
    console.log('No tables found to truncate.');
    return;
  }

  const tableList = rows.map((r) => `"${r.tablename}"`).join(', ');
  await pool.query(`TRUNCATE TABLE ${tableList} RESTART IDENTITY CASCADE`);

  console.log(`Truncated ${rows.length} table(s):`);
  for (const r of rows) console.log(`  - ${r.tablename}`);
  console.log('Done. Schema and schema_migrations preserved.');
}

truncateAll()
  .catch((err) => {
    console.error('Truncate failed:', err);
    process.exit(1);
  })
  .finally(() => pool.end());
