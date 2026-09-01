import pg from 'pg';
import { env } from '../config/env.js';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: env.db.poolMax,
  idleTimeoutMillis: env.db.idleTimeoutMillis,
  connectionTimeoutMillis: env.db.connectionTimeoutMillis,
  // Applied per connection — caps runaway queries so they can't hold a pooled
  // connection indefinitely and starve every other request.
  statement_timeout: env.db.statementTimeoutMillis,
  // Keep TCP connections alive so a remote DB link doesn't pay a fresh
  // TCP + TLS handshake on every burst after idle teardown.
  keepAlive: true,
  ...(env.db.ssl ? { ssl: { rejectUnauthorized: false } } : {}),
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL pool error', err);
});
