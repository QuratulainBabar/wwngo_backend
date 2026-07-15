import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { pool } from '../db/pool.js';
import { hashToken, verifyTokenHash } from '../utils/password.js';
import { AppError } from '../utils/errors.js';

function parseDurationMs(duration) {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return value * multipliers[unit];
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
  const tokenHash = await hashToken(token);
  const expiresAt = new Date(Date.now() + parseDurationMs(env.jwt.refreshExpiresIn));

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  return { token, expiresAt };
}

export async function rotateRefreshToken(oldToken) {
  const { rows } = await pool.query(
    `SELECT rt.id, rt.user_id, rt.token_hash, rt.expires_at, rt.revoked_at,
            u.account_status
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.revoked_at IS NULL AND rt.expires_at > NOW()`
  );

  let matched = null;
  for (const row of rows) {
    if (await verifyTokenHash(oldToken, row.token_hash)) {
      matched = row;
      break;
    }
  }

  if (!matched) {
    throw new AppError('Invalid or expired refresh token', 401, 'INVALID_REFRESH_TOKEN');
  }

  if (matched.account_status === 'suspended') {
    throw new AppError('Account suspended', 403, 'ACCOUNT_SUSPENDED');
  }

  await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = $1', [matched.id]);

  const accessToken = signAccessToken({ id: matched.user_id });
  const refresh = await createRefreshToken(matched.user_id);

  return { accessToken, refreshToken: refresh.token, userId: matched.user_id };
}

export async function revokeRefreshToken(token) {
  const { rows } = await pool.query(
    'SELECT id, token_hash FROM refresh_tokens WHERE revoked_at IS NULL'
  );

  for (const row of rows) {
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
