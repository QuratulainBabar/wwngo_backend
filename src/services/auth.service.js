import { pool } from '../db/pool.js';
import crypto from 'crypto';
import { isAllowedCountryCode, normalizeCountryCode, env } from '../config/env.js';
import { AppError } from '../utils/errors.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { verifyTokenHash } from '../utils/password.js';
import {
  createOtpRecord,
  generateOtp,
  assertOtpFormat,
  isDemoOtp,
  DEMO_OTP_CODE,
  normalizeEmail,
} from '../utils/otp.js';
import {
  assertValidInternationalPhone,
  normalizePhone,
} from '../utils/phone.js';
import { sendOtpEmail } from './email.service.js';
import { sendSmsOtp, sendWhatsAppOtp } from './sms.service.js';
import {
  createRefreshToken,
  revokeRefreshToken,
  signAccessToken,
  signResetToken,
  verifyResetToken,
} from './token.service.js';

const USER_COLUMNS = `
  id, name, email, phone, country_code, bio, rating, review_count,
  wallet_balance, is_verified, kyc_status, account_status, created_at,
  email_verified, phone_verified, role, avatar_url
`;

const ALLOWED_ROLES = ['sender', 'traveler', 'receiver'];

function mapUser(row) {
  if (!row) return null;
  const createdAt = new Date(row.created_at);
  const phone = row.phone;
  let dialCode = null;
  let phoneNumber = null;
  try {
    const parsed = assertValidInternationalPhone({ phone });
    dialCode = parsed.dialCode || null;
    phoneNumber = parsed.phoneNumber || null;
  } catch {
    // Keep raw phone when legacy values cannot be split.
  }

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone,
    dialCode,
    phoneNumber,
    countryCode: row.country_code,
    bio: row.bio,
    rating: Number(row.rating),
    reviewCount: row.review_count,
    walletBalance: Number(row.wallet_balance),
    isVerified: row.is_verified,
    kycStatus: row.kyc_status,
    accountStatus: row.account_status,
    emailVerified: Boolean(row.email_verified),
    phoneVerified: Boolean(row.phone_verified),
    role: row.role ?? null,
    avatarUrl: row.avatar_url || null,
    memberSince: createdAt.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    createdAt: row.created_at,
  };
}

function normalizeContact(contact, method) {
  return method === 'email' ? normalizeEmail(contact) : normalizePhone(contact);
}

function contactTypeForMethod(method) {
  return method === 'email' ? 'email' : method;
}

async function dispatchOtpCode({ contact, method, code, purposeLabel, subject }) {
  if (method === 'email') {
    // Do not block the HTTP response on slow Gmail SMTP (Flutter client times out at 20s).
    void sendOtpEmail(contact, code, { purposeLabel, subject }).catch((err) => {
      console.error(
        `[AUTH] background OTP email failed for ${contact}:`,
        err?.message || err
      );
    });
    return;
  }
  if (method === 'whatsapp') {
    await sendWhatsAppOtp(contact, code);
    return;
  }
  await sendSmsOtp(contact, code);
}

async function assertOtpRateLimit(contact, purpose) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM otp_codes
     WHERE contact = $1 AND purpose = $2
       AND created_at > NOW() - ($3::text || ' minutes')::interval`,
    [contact, purpose, String(env.otp.sendWindowMinutes)]
  );

  if (rows[0].cnt >= env.otp.maxSendsPerWindow) {
    throw new AppError('Too many codes requested. Try again later.', 429, 'OTP_RATE_LIMITED');
  }
}

async function clearFailedLogins(userId) {
  await pool.query(
    'UPDATE users SET failed_login_attempts = 0, locked_until = NULL WHERE id = $1',
    [userId]
  );
}

async function recordFailedLogin(userId) {
  await pool.query(
    `UPDATE users
     SET failed_login_attempts = failed_login_attempts + 1,
         locked_until = CASE
           WHEN failed_login_attempts + 1 >= $2
           THEN NOW() + ($3::text || ' minutes')::interval
           ELSE locked_until
         END
     WHERE id = $1`,
    [userId, env.security.maxFailedLogins, String(env.security.lockoutMinutes)]
  );
}

function assertNotLocked(userRow) {
  if (userRow?.locked_until && new Date(userRow.locked_until) > new Date()) {
    throw new AppError('Account temporarily locked. Try again later.', 429, 'ACCOUNT_LOCKED');
  }
}

async function findUserByEmail(email) {
  const normalized = normalizeEmail(email);
  if (!normalized) return null;
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS}, password_hash, failed_login_attempts, locked_until
     FROM users
     WHERE LOWER(BTRIM(email)) = $1
     ORDER BY terms_accepted_at DESC NULLS LAST, created_at ASC
     LIMIT 1`,
    [normalized]
  );
  return rows[0] || null;
}

async function findUserByPhone(phone) {
  const { rows } = await pool.query(
    `SELECT ${USER_COLUMNS}, password_hash FROM users WHERE phone = $1`,
    [phone]
  );
  return rows[0] || null;
}

async function findUserById(id) {
  const { rows } = await pool.query(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]);
  return rows[0] || null;
}

function assertAccountActive(user) {
  if (user.account_status === 'suspended') {
    throw new AppError('Your account has been suspended', 403, 'ACCOUNT_SUSPENDED');
  }
}

export async function registerUser({
  name,
  email,
  phone,
  dialCode,
  phoneNumber,
  password,
  countryCode,
  acceptedTerms,
}) {
  if (!acceptedTerms) {
    throw new AppError('You must accept the Terms & Privacy Policy', 400, 'TERMS_REQUIRED');
  }

  const normalizedCountry = normalizeCountryCode(countryCode);
  if (!isAllowedCountryCode(normalizedCountry)) {
    throw new AppError('Invalid country code', 400, 'INVALID_COUNTRY');
  }

  let normalizedPhone;
  try {
    ({ phone: normalizedPhone } = assertValidInternationalPhone({
      dialCode,
      phoneNumber,
      phone,
    }));
  } catch (err) {
    throw new AppError(err.message || 'Enter a valid phone number', err.status || 400, err.code || 'INVALID_PHONE');
  }

  const normalizedEmail = normalizeEmail(email);
  const passwordHash = await hashPassword(password);

  try {
    const { rows } = await pool.query(
      `INSERT INTO users (
        name, email, phone, password_hash, country_code, terms_accepted_at,
        email_verified, phone_verified
      ) VALUES ($1, $2, $3, $4, $5, NOW(), FALSE, FALSE)
      RETURNING ${USER_COLUMNS}`,
      [name.trim(), normalizedEmail, normalizedPhone, passwordHash, normalizedCountry]
    );

    const user = mapUser(rows[0]);
    const accessToken = signAccessToken(user);
    const refresh = await createRefreshToken(user.id);

    return { user, accessToken, refreshToken: refresh.token };
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint === 'users_email_unique') {
        throw new AppError('Email is already registered', 409, 'EMAIL_EXISTS');
      }
      if (err.constraint === 'users_phone_unique') {
        throw new AppError('Phone number is already registered', 409, 'PHONE_EXISTS');
      }
    }
    throw err;
  }
}

export async function loginUser({ email, password }) {
  const userRow = await findUserByEmail(email);
  if (!userRow) {
    console.warn('[AUTH] login rejected: no account for that email');
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  assertAccountActive(userRow);
  assertNotLocked(userRow);

  const valid = await verifyPassword(password, userRow.password_hash);
  if (!valid) {
    console.warn('[AUTH] login rejected: password mismatch');
    await recordFailedLogin(userRow.id);
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  await clearFailedLogins(userRow.id);

  const user = mapUser(userRow);
  const accessToken = signAccessToken(user);
  const refresh = await createRefreshToken(user.id);

  return { user, accessToken, refreshToken: refresh.token };
}

/**
 * Password login step 1: validate credentials, store OTP, then queue the email.
 * HTTP returns after the OTP is saved so slow SMTP cannot time out the app.
 */
export async function sendPasswordLoginOtp({ email, password }) {
  console.log(`[AUTH] password-otp/send requested for ${normalizeEmail(email)}`);

  const userRow = await findUserByEmail(email);
  if (!userRow) {
    console.warn('[AUTH] password-otp/send rejected: no account for that email');
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  assertAccountActive(userRow);
  assertNotLocked(userRow);

  const valid = await verifyPassword(password, userRow.password_hash);
  if (!valid) {
    console.warn('[AUTH] password-otp/send rejected: password mismatch');
    await recordFailedLogin(userRow.id);
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  // Same contact normalization + SMTP helper as verify-email / password-reset.
  const contact = normalizeEmail(userRow.email);
  if (!contact) {
    throw new AppError('Email not linked to your account', 400, 'CONTACT_MISSING');
  }

  const purpose = 'login_gate';
  await assertOtpRateLimit(contact, purpose);

  await pool.query(
    `UPDATE otp_codes SET verified_at = NOW()
     WHERE user_id = $1 AND purpose = $2 AND verified_at IS NULL`,
    [userRow.id, purpose]
  );

  const code = generateOtp();
  const otp = await createOtpRecord(code);

  await pool.query(
    `INSERT INTO otp_codes (user_id, contact, contact_type, code_hash, purpose, expires_at)
     VALUES ($1, $2, 'email', $3, $4, $5)`,
    [userRow.id, contact, otp.codeHash, purpose, otp.expiresAt]
  );

  console.log(`[AUTH] password-otp queued SMTP email for ${contact}`);
  void sendOtpEmail(contact, code, {
    purposeLabel: 'login',
    subject: 'Your WWNGO login code',
  }).catch((err) => {
    console.error(
      `[AUTH] password-otp email failed for ${contact}:`,
      err?.message || err
    );
  });

  return {
    message: 'Verification code sent',
    expiresInMinutes: env.otp.expiresMinutes,
  };
}

/**
 * Password login step 2: verify emailed OTP, then issue the session.
 */
export async function completePasswordLoginOtp({ email, password, code }) {
  const normalizedCode = assertOtpFormat(code);
  if (!normalizedCode) {
    throw new AppError('Enter the 6-digit code', 400, 'INVALID_OTP');
  }

  const userRow = await findUserByEmail(email);
  if (!userRow) {
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  assertAccountActive(userRow);
  assertNotLocked(userRow);

  const validPassword = await verifyPassword(password, userRow.password_hash);
  if (!validPassword) {
    await recordFailedLogin(userRow.id);
    throw new AppError('Invalid email or password', 401, 'INVALID_CREDENTIALS');
  }

  const contact = normalizeEmail(userRow.email);
  const purpose = 'login_gate';

  if (isDemoOtp(normalizedCode)) {
    await pool.query(
      `UPDATE otp_codes SET verified_at = NOW()
       WHERE user_id = $1 AND purpose = $2 AND verified_at IS NULL`,
      [userRow.id, purpose]
    );
  } else {
    const { rows } = await pool.query(
      `SELECT oc.*
       FROM otp_codes oc
       WHERE oc.user_id = $1
         AND oc.contact = $2
         AND oc.contact_type = 'email'
         AND oc.purpose = $3
         AND oc.verified_at IS NULL
         AND oc.expires_at > NOW()
       ORDER BY oc.created_at DESC
       LIMIT 1`,
      [userRow.id, contact, purpose]
    );

    const otpRow = rows[0];
    if (!otpRow) {
      throw new AppError('Invalid or expired verification code', 400, 'INVALID_OTP');
    }

    const validOtp = await verifyTokenHash(normalizedCode, otpRow.code_hash);
    if (!validOtp) {
      throw new AppError('Invalid or expired verification code', 400, 'INVALID_OTP');
    }

    await pool.query('UPDATE otp_codes SET verified_at = NOW() WHERE id = $1', [otpRow.id]);
  }

  // Login OTP proves email ownership — mark verified so Verify Account is not required again.
  await pool.query(
    `UPDATE users SET email_verified = TRUE WHERE id = $1`,
    [userRow.id]
  );
  await clearFailedLogins(userRow.id);
  const fresh = await findUserById(userRow.id);
  return issueAuthSession(fresh || userRow);
}

export async function getUserProfile(userId) {
  const userRow = await findUserById(userId);
  if (!userRow) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }
  return mapUser(userRow);
}

export async function updateUserProfile(userId, { name, email, phone, dialCode, phoneNumber, countryCode }) {
  const userRow = await findUserById(userId);
  if (!userRow) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  assertAccountActive(userRow);

  const normalizedCountry = normalizeCountryCode(countryCode);
  if (!isAllowedCountryCode(normalizedCountry)) {
    throw new AppError('Invalid country code', 400, 'INVALID_COUNTRY');
  }

  let normalizedPhone;
  try {
    ({ phone: normalizedPhone } = assertValidInternationalPhone({
      dialCode,
      phoneNumber,
      phone,
    }));
  } catch (err) {
    throw new AppError(err.message || 'Enter a valid phone number', err.status || 400, err.code || 'INVALID_PHONE');
  }

  const normalizedEmail = normalizeEmail(email);
  const trimmedName = name.trim();

  if (!trimmedName) {
    throw new AppError('Full name is required', 400, 'VALIDATION_ERROR');
  }

  try {
    const { rows } = await pool.query(
      `UPDATE users
       SET name = $1, email = $2, phone = $3, country_code = $4
       WHERE id = $5
       RETURNING ${USER_COLUMNS}`,
      [trimmedName, normalizedEmail, normalizedPhone, normalizedCountry, userId]
    );

    return { user: mapUser(rows[0]), message: 'Profile updated' };
  } catch (err) {
    if (err.code === '23505') {
      if (err.constraint === 'users_email_unique') {
        throw new AppError('Email is already registered', 409, 'EMAIL_EXISTS');
      }
      if (err.constraint === 'users_phone_unique') {
        throw new AppError('Phone number is already registered', 409, 'PHONE_EXISTS');
      }
    }
    throw err;
  }
}

export async function updateUserRole(userId, { role }) {
  if (!ALLOWED_ROLES.includes(role)) {
    throw new AppError('Invalid role', 400, 'INVALID_ROLE');
  }

  const userRow = await findUserById(userId);
  if (!userRow) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  assertAccountActive(userRow);

  const { rows } = await pool.query(
    `UPDATE users SET role = $1 WHERE id = $2
     RETURNING ${USER_COLUMNS}`,
    [role, userId]
  );

  return { user: mapUser(rows[0]), message: 'Role updated' };
}

export async function logoutUser(refreshToken) {
  if (refreshToken) {
    await revokeRefreshToken(refreshToken);
  }
}

export async function sendPasswordResetOtp({ contact, method }) {
  const isEmail = method === 'email';
  const normalizedContact = normalizeContact(contact, isEmail ? 'email' : 'phone');
  const contactType = contactTypeForMethod(method);

  const userRow = isEmail
    ? await findUserByEmail(normalizedContact)
    : await findUserByPhone(normalizedContact);

  if (!userRow) {
    throw new AppError(
      isEmail ? 'No account found with this email' : 'No account found with this phone number',
      404,
      'USER_NOT_FOUND'
    );
  }

  assertAccountActive(userRow);
  await assertOtpRateLimit(normalizedContact, 'password_reset');

  await pool.query(
    `UPDATE otp_codes SET verified_at = NOW()
     WHERE user_id = $1 AND purpose = 'password_reset' AND verified_at IS NULL`,
    [userRow.id]
  );

  const code = generateOtp();
  const otp = await createOtpRecord(code);

  await pool.query(
    `INSERT INTO otp_codes (user_id, contact, contact_type, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4, 'password_reset', $5)`,
    [userRow.id, normalizedContact, contactType, otp.codeHash, otp.expiresAt]
  );

  await dispatchOtpCode({
    contact: normalizedContact,
    method,
    code,
    purposeLabel: 'password reset',
    subject: 'Your WWNGO password reset code',
  });

  return {
    message: 'Verification code sent',
    expiresInMinutes: env.otp.expiresMinutes,
  };
}

export async function verifyPasswordResetOtp({ contact, method, code }) {
  const normalizedCode = assertOtpFormat(code);
  if (!normalizedCode) {
    throw new AppError('Enter the 6-digit code', 400, 'INVALID_OTP');
  }

  const isEmail = method === 'email';
  const normalizedContact = normalizeContact(contact, isEmail ? 'email' : 'phone');
  const contactType = contactTypeForMethod(method);

  const { rows } = await pool.query(
    `SELECT oc.*, u.account_status
     FROM otp_codes oc
     JOIN users u ON u.id = oc.user_id
     WHERE oc.contact = $1
       AND oc.contact_type = $2
       AND oc.purpose = 'password_reset'
       AND oc.verified_at IS NULL
       AND oc.expires_at > NOW()
     ORDER BY oc.created_at DESC
     LIMIT 1`,
    [normalizedContact, contactType]
  );

  const otpRow = rows[0];
  if (!otpRow) {
    throw new AppError('Invalid or expired verification code', 400, 'INVALID_OTP');
  }

  if (otpRow.account_status === 'suspended') {
    throw new AppError('Your account has been suspended', 403, 'ACCOUNT_SUSPENDED');
  }

  const valid = await verifyTokenHash(normalizedCode, otpRow.code_hash);
  if (!valid) {
    throw new AppError('Invalid or expired verification code', 400, 'INVALID_OTP');
  }

  await pool.query('UPDATE otp_codes SET verified_at = NOW() WHERE id = $1', [otpRow.id]);

  const resetToken = signResetToken(otpRow.user_id, normalizedContact);

  return { resetToken, message: 'Code verified' };
}

export async function resetPassword({ resetToken, password }) {
  const payload = verifyResetToken(resetToken);
  const passwordHash = await hashPassword(password);

  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [
    passwordHash,
    payload.sub,
  ]);

  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [payload.sub]
  );

  return { message: 'Password updated successfully' };
}

export async function changePassword(userId, { currentPassword, newPassword }) {
  const { rows } = await pool.query('SELECT password_hash, account_status FROM users WHERE id = $1', [
    userId,
  ]);

  const userRow = rows[0];
  if (!userRow) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  assertAccountActive(userRow);

  const valid = await verifyPassword(currentPassword, userRow.password_hash);
  if (!valid) {
    throw new AppError('Current password is incorrect', 400, 'INVALID_PASSWORD');
  }

  const passwordHash = await hashPassword(newPassword);
  await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, userId]);

  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );

  return { message: 'Password updated successfully' };
}

export async function verifyUserPassword(userId, password) {
  const { rows } = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
  const userRow = rows[0];
  if (!userRow) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  const valid = await verifyPassword(password, userRow.password_hash);
  if (!valid) {
    throw new AppError('Incorrect password', 400, 'INVALID_PASSWORD');
  }

  return { valid: true };
}

async function issueAuthSession(userRow, { ipAddress, userAgent } = {}) {
  const user = mapUser(userRow);
  const accessToken = signAccessToken(user);
  const refresh = await createRefreshToken(user.id);

  const securityLog = await import('./security_log.service.js');
  await securityLog.logSecurityEvent(user.id, {
    action: 'Signed in',
    device: userAgent || 'Mobile app',
    location: 'WWNGO',
    ipAddress,
  }).catch(() => {});

  return { user, accessToken, refreshToken: refresh.token };
}

export async function sendLoginOtp({ contact, method }) {
  const isEmail = method === 'email';
  const normalizedContact = normalizeContact(contact, isEmail ? 'email' : 'phone');
  const contactType = contactTypeForMethod(method);

  const userRow = isEmail
    ? await findUserByEmail(normalizedContact)
    : await findUserByPhone(normalizedContact);

  if (userRow) {
    assertAccountActive(userRow);
    assertNotLocked(userRow);
  }

  await assertOtpRateLimit(normalizedContact, 'login');

  await pool.query(
    `UPDATE otp_codes SET verified_at = NOW()
     WHERE contact = $1 AND purpose = 'login' AND verified_at IS NULL`,
    [normalizedContact]
  );

  const code = generateOtp();
  const otp = await createOtpRecord(code);

  await pool.query(
    `INSERT INTO otp_codes (user_id, contact, contact_type, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4, 'login', $5)`,
    [userRow?.id || null, normalizedContact, contactType, otp.codeHash, otp.expiresAt]
  );

  await dispatchOtpCode({
    contact: normalizedContact,
    method,
    code,
    purposeLabel: 'login',
    subject: 'Your WWNGO login code',
  });

  return {
    message: 'Verification code sent',
    expiresInMinutes: env.otp.expiresMinutes,
  };
}

export async function verifyLoginOtp({ contact, method, code }) {
  const normalizedCode = assertOtpFormat(code);
  if (!normalizedCode) {
    throw new AppError('Enter the 6-digit code', 400, 'INVALID_OTP');
  }

  const normalizedContact = normalizeContact(contact, method === 'email' ? 'email' : 'phone');
  const contactType = contactTypeForMethod(method);
  const isEmail = method === 'email';

  const { rows } = await pool.query(
    `SELECT oc.*, u.account_status
     FROM otp_codes oc
     LEFT JOIN users u ON u.id = oc.user_id
     WHERE oc.contact = $1
       AND oc.contact_type = $2
       AND oc.purpose = 'login'
       AND oc.verified_at IS NULL
       AND oc.expires_at > NOW()
     ORDER BY oc.created_at DESC
     LIMIT 1`,
    [normalizedContact, contactType]
  );

  const otpRow = rows[0];
  if (!otpRow) {
    throw new AppError('Invalid or expired verification code', 400, 'INVALID_OTP');
  }

  if (otpRow.account_status === 'suspended') {
    throw new AppError('Your account has been suspended', 403, 'ACCOUNT_SUSPENDED');
  }

  const valid = await verifyTokenHash(normalizedCode, otpRow.code_hash);
  if (!valid) {
    throw new AppError('Invalid or expired verification code', 400, 'INVALID_OTP');
  }

  await pool.query('UPDATE otp_codes SET verified_at = NOW() WHERE id = $1', [otpRow.id]);

  // Login OTP only authenticates — do not mark email/phone verified here.
  // Email/phone verification is handled by /verify-email and /verify-contact.
  let userRow;
  if (otpRow.user_id) {
    userRow = await findUserById(otpRow.user_id);
  } else {
    const passwordHash = await hashPassword(crypto.randomBytes(32).toString('hex'));
    const email = isEmail ? normalizedContact : `otp-${crypto.randomUUID()}@wwngo.temp`;
    const phone = isEmail
      ? `+33${crypto.randomInt(100000000, 999999999)}`
      : normalizedContact;

    const { rows: created } = await pool.query(
      `INSERT INTO users (
        name, email, phone, password_hash, country_code, email_verified, phone_verified
      ) VALUES ('WWNGO User', $1, $2, $3, 'FR', FALSE, FALSE)
      RETURNING ${USER_COLUMNS}`,
      [email, phone, passwordHash]
    );
    userRow = created[0];
  }

  await clearFailedLogins(userRow.id);
  return issueAuthSession(userRow);
}

/**
 * Email verification: generate a real OTP and send it via Gmail SMTP.
 */
export async function sendEmailVerificationOtp(userId) {
  const userRow = await findUserById(userId);
  if (!userRow) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  assertAccountActive(userRow);

  if (userRow.email_verified) {
    throw new AppError('Email is already verified', 400, 'ALREADY_VERIFIED');
  }

  const contact = userRow.email;
  if (!contact) {
    throw new AppError('Email not linked to your account', 400, 'CONTACT_MISSING');
  }

  const purpose = 'verify_email';
  await assertOtpRateLimit(contact, purpose);

  await pool.query(
    `UPDATE otp_codes SET verified_at = NOW()
     WHERE user_id = $1 AND purpose = $2 AND verified_at IS NULL`,
    [userId, purpose]
  );

  const code = generateOtp();
  const otp = await createOtpRecord(code);

  await pool.query(
    `INSERT INTO otp_codes (user_id, contact, contact_type, code_hash, purpose, expires_at)
     VALUES ($1, $2, 'email', $3, $4, $5)`,
    [userId, contact, otp.codeHash, purpose, otp.expiresAt]
  );

  console.log(`[AUTH] email-verification OTP queued for ${contact}`);
  void sendOtpEmail(contact, code, {
    purposeLabel: 'email verification',
    subject: 'Verify your WWNGO email',
  }).catch((err) => {
    console.error(
      `[AUTH] email-verification email failed for ${contact}:`,
      err?.message || err
    );
  });

  return {
    message: 'Verification code sent',
    expiresInMinutes: env.otp.expiresMinutes,
  };
}

export async function verifyEmailVerificationOtp(userId, { code }) {
  const normalizedCode = assertOtpFormat(code);
  if (!normalizedCode) {
    throw new AppError('Enter the 6-digit code', 400, 'INVALID_OTP');
  }

  const userRow = await findUserById(userId);
  if (!userRow) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  if (userRow.email_verified) {
    return { user: mapUser(userRow), message: 'Email already verified' };
  }

  const contact = userRow.email;
  const purpose = 'verify_email';

  if (isDemoOtp(normalizedCode)) {
    await pool.query(
      `UPDATE otp_codes SET verified_at = NOW()
       WHERE user_id = $1 AND purpose = $2 AND verified_at IS NULL`,
      [userId, purpose]
    );
  } else {
    const { rows } = await pool.query(
      `SELECT oc.*
       FROM otp_codes oc
       WHERE oc.user_id = $1
         AND oc.contact = $2
         AND oc.contact_type = 'email'
         AND oc.purpose = $3
         AND oc.verified_at IS NULL
         AND oc.expires_at > NOW()
       ORDER BY oc.created_at DESC
       LIMIT 1`,
      [userId, contact, purpose]
    );

    const otpRow = rows[0];
    if (!otpRow) {
      throw new AppError('Invalid or expired verification code', 400, 'INVALID_OTP');
    }

    const valid = await verifyTokenHash(normalizedCode, otpRow.code_hash);
    if (!valid) {
      throw new AppError('Invalid or expired verification code', 400, 'INVALID_OTP');
    }

    await pool.query('UPDATE otp_codes SET verified_at = NOW() WHERE id = $1', [otpRow.id]);
  }

  await pool.query(
    `UPDATE users SET email_verified = TRUE, is_verified = TRUE WHERE id = $1`,
    [userId]
  );

  const updated = await findUserById(userId);
  return { user: mapUser(updated), message: 'Email verified' };
}

export async function sendCrossVerificationOtp(userId, { method }) {
  if (method === 'email') {
    return sendEmailVerificationOtp(userId);
  }

  // Phone / WhatsApp OTP via Twilio when configured; demo OTP still accepted on verify.
  const userRow = await findUserById(userId);
  if (!userRow) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  assertAccountActive(userRow);

  if (userRow.phone_verified) {
    throw new AppError('Phone is already verified', 400, 'ALREADY_VERIFIED');
  }

  const contact = userRow.phone;
  if (!contact) {
    throw new AppError('Contact not linked to your account', 400, 'CONTACT_MISSING');
  }

  const purpose = 'verify_phone';
  await assertOtpRateLimit(contact, purpose);

  await pool.query(
    `UPDATE otp_codes SET verified_at = NOW()
     WHERE user_id = $1 AND purpose = $2 AND verified_at IS NULL`,
    [userId, purpose]
  );

  const code = generateOtp();
  const otp = await createOtpRecord(code);
  const contactType = contactTypeForMethod(method);

  await pool.query(
    `INSERT INTO otp_codes (user_id, contact, contact_type, code_hash, purpose, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [userId, contact, contactType, otp.codeHash, purpose, otp.expiresAt]
  );

  try {
    await dispatchOtpCode({
      contact,
      method: method === 'whatsapp' ? 'whatsapp' : 'phone',
      code,
      purposeLabel: 'phone verification',
      subject: 'Your WWNGO verification code',
    });
  } catch (err) {
    // OTP is already stored — real SMS code and demo OTP (123456) both work on verify.
    console.warn('[auth] SMS dispatch failed — demo OTP still works:', err?.message);
  }

  return {
    message: 'Verification code sent',
    expiresInMinutes: env.otp.expiresMinutes,
  };
}

export async function verifyCrossVerificationOtp(userId, { method, code }) {
  if (method === 'email') {
    return verifyEmailVerificationOtp(userId, { code });
  }

  const normalizedCode = assertOtpFormat(code);
  if (!normalizedCode) {
    throw new AppError('Enter the 6-digit code', 400, 'INVALID_OTP');
  }

  const userRow = await findUserById(userId);
  if (!userRow) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  if (userRow.phone_verified) {
    return { user: mapUser(userRow), message: 'Phone already verified' };
  }

  const contact = userRow.phone;
  const purpose = 'verify_phone';
  const contactType = contactTypeForMethod(method);

  if (isDemoOtp(normalizedCode)) {
    await pool.query(
      `UPDATE otp_codes SET verified_at = NOW()
       WHERE user_id = $1 AND purpose = $2 AND verified_at IS NULL`,
      [userId, purpose]
    );
  } else {
    const { rows } = await pool.query(
      `SELECT oc.*
       FROM otp_codes oc
       WHERE oc.user_id = $1
         AND oc.contact = $2
         AND oc.contact_type = $3
         AND oc.purpose = $4
         AND oc.verified_at IS NULL
         AND oc.expires_at > NOW()
       ORDER BY oc.created_at DESC
       LIMIT 1`,
      [userId, contact, contactType, purpose]
    );

    const otpRow = rows[0];
    if (!otpRow) {
      throw new AppError('Invalid or expired verification code', 400, 'INVALID_OTP');
    }

    const valid = await verifyTokenHash(normalizedCode, otpRow.code_hash);
    if (!valid) {
      throw new AppError('Invalid or expired verification code', 400, 'INVALID_OTP');
    }

    await pool.query('UPDATE otp_codes SET verified_at = NOW() WHERE id = $1', [otpRow.id]);
  }

  await pool.query('UPDATE users SET phone_verified = TRUE WHERE id = $1', [userId]);

  const updated = await findUserById(userId);
  return { user: mapUser(updated), message: 'Contact verified' };
}

export async function uploadUserAvatar(userId, file) {
  if (!file?.buffer?.length) {
    throw new AppError('Avatar image is required', 400, 'VALIDATION_ERROR');
  }

  const { storeFile } = await import('./storage.service.js');
  const crypto = await import('crypto');
  const ext = (file.originalname || '').split('.').pop()?.toLowerCase() || 'jpg';
  const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
  const relativePath = `avatars/${userId}/${crypto.randomUUID()}.${safeExt}`;

  const stored = await storeFile({
    buffer: file.buffer,
    relativePath,
    mimeType: file.mimetype,
    originalName: file.originalname,
  });

  await pool.query(
    `UPDATE users SET avatar_url = $2, updated_at = NOW() WHERE id = $1`,
    [userId, stored.publicUrl]
  );

  const updated = await findUserById(userId);
  return { user: mapUser(updated), avatarUrl: stored.publicUrl };
}

export async function registerFcmToken(userId, { token, platform }) {
  const fcm = await import('./fcm.service.js');
  await fcm.registerDeviceToken(userId, { token, platform });
  return { message: 'Device token registered' };
}

export async function getSecurityLogs(userId) {
  const securityLog = await import('./security_log.service.js');
  const logs = await securityLog.listSecurityLogs(userId);
  return { logs };
}
