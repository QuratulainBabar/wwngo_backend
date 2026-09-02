import crypto from 'crypto';
import { env } from '../config/env.js';
import { hashToken } from './password.js';

/** Always exactly 6 digits in [100000, 999999] — no leading zeros. */
export const OTP_LENGTH = 6;

/** Fixed demo code accepted for signup / login verification (never shown in UI). */
export const DEMO_OTP_CODE = '123456';

export function generateOtp() {
  // Inclusive range so the emailed code is always visibly 6 digits.
  const code = crypto.randomInt(100000, 1000000).toString();
  if (code.length !== OTP_LENGTH) {
    throw new Error('OTP generation failed: expected 6 digits');
  }
  return code;
}

export function assertOtpFormat(code) {
  const normalized = String(code ?? '').trim();
  if (!/^\d{6}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function isDemoOtp(code) {
  return assertOtpFormat(code) === DEMO_OTP_CODE;
}

export async function createOtpRecord(code) {
  const normalized = assertOtpFormat(code);
  if (!normalized) {
    throw new Error('OTP must be exactly 6 digits');
  }
  return {
    code: normalized,
    codeHash: await hashToken(normalized),
    expiresAt: new Date(Date.now() + env.otp.expiresMinutes * 60 * 1000),
  };
}

export function normalizeEmail(email) {
  return String(email ?? '').trim().toLowerCase();
}
