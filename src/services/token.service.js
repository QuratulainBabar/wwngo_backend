import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { verifyTokenHash } from '../utils/password.js';
import { AppError } from '../utils/errors.js';

function parseDurationMs(duration) {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit];
}

/** Fast deterministic hash for refresh-token DB lookup (O(1)). */
function sha256Token(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function isSha256Hash(value) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/i.test(value);
}

export function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, type: 'access' },
    env.jwt.accessSecret,
    { expiresIn: env.jwt.accessExpiresIn }
  );
}

export async function createRefreshToken(userId) {
  const token = crypto.randomBytes(48).toString('hex');
  const tokenHash = sha256Token(token);
  const expiresAt = new Date(Date.now() + parseDurationMs(env.jwt.refreshExpiresIn));

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

export async function rotateRefreshToken(oldToken) {
  const lookup = sha256Token(oldToken);

  // Prefer O(1) sha256 lookup (new tokens).
  let { rows } = await pool.query(
    `SELECT rt.id, rt.user_id, rt.token_hash, rt.expires_at, rt.revoked_at,
            u.account_status
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1
       AND rt.revoked_at IS NULL
       AND rt.expires_at > NOW()
     LIMIT 1`,
    [lookup]
  );

  let matched = rows[0] || null;

  // Legacy bcrypt-hashed refresh tokens (pre sha256 migration).
  if (!matched) {
    const { rows: candidates } = await pool.query(
      `SELECT rt.id, rt.user_id, rt.token_hash, rt.expires_at, rt.revoked_at,
              u.account_status
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.revoked_at IS NULL AND rt.expires_at > NOW()`
    );

    for (const row of candidates) {
      if (isSha256Hash(row.token_hash)) continue;
      if (await verifyTokenHash(oldToken, row.token_hash)) {
        matched = row;
        break;
      }
    }
  }

  if (!matched) {
    throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }

  if (matched.account_status === 'suspended') {
    throw new AppError('Account suspended', 403, 'ACCOUNT_SUSPENDED');
  }

  await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [matched.id]);

  const { rows: userRows } = await pool.query(
    'SELECT id, email FROM users WHERE id = $1',
    [matched.user_id]
  );
  const user = userRows[0] || { id: matched.user_id };
  const accessToken = signAccessToken(user);
  const refresh = await createRefreshToken(matched.user_id);

  return { accessToken, refreshToken: refresh.token, userId: matched.user_id };
}

export async function revokeRefreshToken(token) {
  const lookup = sha256Token(token);
  const { rowCount } = await pool.query(
    `UPDATE refresh_tokens
     SET revoked_at = NOW()
     WHERE token_hash = $1 AND revoked_at IS NULL`,
    [lookup]
  );
  if (rowCount > 0) return true;

  // Legacy bcrypt rows.
  const { rows } = await pool.query(
    'SELECT id, token_hash FROM refresh_tokens WHERE revoked_at IS NULL'
  );

  for (const row of rows) {
    if (isSha256Hash(row.token_hash)) continue;
    if (await verifyTokenHash(token, row.token_hash)) {
      await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [row.id]);
      return true;
    }
  }

  return false;
}

export function signResetToken(userId, contact) {
  return jwt.sign(
    { sub: userId, contact, type: 'password_reset' },
    env.jwt.resetSecret,
    { expiresIn: env.jwt.resetExpiresIn }
  );
}

export function verifyResetToken(token) {
  try {
    const payload = jwt.verify(token, env.jwt.resetSecret);
    if (payload.type !== 'password_reset') {
      throw new AppError('Invalid reset token', 400, 'INVALID_RESET_TOKEN');
    }
    return payload;
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw new AppError('Invalid or expired reset token', 400, 'INVALID_RESET_TOKEN');
  }
}

export function verifyAccessToken(token) {
  try {
    const payload = jwt.verify(token, env.jwt.accessSecret);
    if (payload.type !== 'access') {
      throw new AppError('Invalid access token', 401, 'INVALID_TOKEN');
    }
    return payload;
  } catch {
    throw new AppError('Invalid or expired access token', 401, 'INVALID_TOKEN');
  }
}
