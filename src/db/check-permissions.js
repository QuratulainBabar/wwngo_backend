import { pool } from './pool.js';

try {
  const user = await pool.query('SELECT current_user, current_database()');
  const schema = await pool.query(
    "SELECT nspname, pg_get_userbyid(nspowner) AS owner FROM pg_namespace WHERE nspname = 'public'"
  );
  const create = await pool.query(
    "SELECT has_schema_privilege(current_user, 'public', 'CREATE') AS can_create"
  );

  console.log('Connected as:', user.rows[0]);
  console.log('Public schema:', schema.rows[0]);
  console.log('Can create in public:', create.rows[0]);
} finally {
  await pool.end();
}
