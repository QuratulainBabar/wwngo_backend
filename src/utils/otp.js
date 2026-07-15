import crypto from 'crypto';
import { env } from '../config/env.js';
import { hashToken } from './password.js';

export function generateOtp() {
  const max = 10 ** env.otp.length;
  const code = crypto.randomInt(0, max).toString().padStart(env.otp.length, '0');
  return code;
}

/** Fixed demo OTP used for email/phone verification while real delivery is disabled. */
export function getDemoOtp() {
  return env.otp.demoCode;
}

export async function createOtpRecord(code) {
  return {
    code,
    codeHash: await hashToken(code),
    expiresAt: new Date(Date.now() + env.otp.expiresMinutes * 60 * 1000),
  };
}

export function normalizeEmail(email) {
  return email.trim().toLowerCase();
}
