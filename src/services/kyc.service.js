import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { env } from '../config/env.js';
import {
  createSdkAccessToken,
  getApplicantByExternalUserId,
  mapSumsubReviewToKycStatus,
  verifyWebhookDigest,
} from './sumsub.client.js';
import { getUserProfile } from './auth.service.js';

// TEMPORARILY DISABLED - SUMSUB KYC
// Public service methods below are local placeholders. The original Sumsub
// implementations remain in this file under *SumsubDisabled names.
export async function issueAccessToken() {
  throw new AppError(
    'Identity verification is temporarily unavailable.',
    503,
    'KYC_DISABLED'
  );
}

export async function getKycStatus(userId) {
  const profile = await getUserProfile(userId);
  return {
    kycStatus: 'disabled',
    reviewStatus: null,
    applicantId: null,
    synced: false,
    user: profile,
  };
}

export async function handleSumsubWebhook() {
  return { accepted: true, disabled: true };
}

const USER_KYC_COLUMNS = `
  id, name, email, phone, country_code, bio, rating, review_count,
  wallet_balance, is_verified, kyc_status, account_status, created_at,
  email_verified, phone_verified, role, sumsub_applicant_id, sumsub_review_status
`;

async function findUserRow(userId) {
  const { rows } = await pool.query(
    `SELECT ${USER_KYC_COLUMNS} FROM users WHERE id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function findUserByApplicantId(applicantId) {
  if (!applicantId) return null;
  const { rows } = await pool.query(
    `SELECT ${USER_KYC_COLUMNS} FROM users WHERE sumsub_applicant_id = $1`,
    [applicantId]
  );
  return rows[0] || null;
}

async function findUserByExternalId(externalUserId) {
  if (!externalUserId) return null;
  const { rows } = await pool.query(
    `SELECT ${USER_KYC_COLUMNS} FROM users WHERE id::text = $1`,
    [String(externalUserId)]
  );
  return rows[0] || null;
}

async function persistKycUpdate(userId, { kycStatus, applicantId, reviewStatus }) {
  const sets = ['updated_at = NOW()'];
  const params = [];
  let i = 1;

  if (kycStatus) {
    sets.push(`kyc_status = $${i++}`);
    params.push(kycStatus);
    if (kycStatus === 'approved') {
      sets.push('is_verified = TRUE');
    } else if (kycStatus === 'rejected' || kycStatus === 'pending') {
      sets.push('is_verified = FALSE');
    }
  }

  if (applicantId) {
    sets.push(`sumsub_applicant_id = $${i++}`);
    params.push(applicantId);
  }

  if (reviewStatus != null) {
    sets.push(`sumsub_review_status = $${i++}`);
    params.push(reviewStatus);
  }

  params.push(userId);
  const { rows } = await pool.query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${i} RETURNING ${USER_KYC_COLUMNS}`,
    params
  );
  return rows[0];
}

/**
 * POST /kyc/access-token — temporary SDK token for the signed-in user.
 */
// TEMPORARILY DISABLED - SUMSUB KYC
async function issueAccessTokenSumsubDisabled(userId) {
  const user = await findUserRow(userId);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  if (user.account_status === 'suspended') {
    throw new AppError('Your account has been suspended', 403, 'ACCOUNT_SUSPENDED');
  }

  if (!env.sumsub.levelName) {
    throw new AppError(
      'SUMSUB_LEVEL_NAME is not configured on the server',
      503,
      'SUMSUB_NOT_CONFIGURED'
    );
  }

  const tokenResponse = await createSdkAccessToken({
    userId: user.id,
    levelName: env.sumsub.levelName,
    email: user.email,
    phone: user.phone,
  });

  // Mark as submitted when the user starts verification (unless already decided).
  if (user.kyc_status === 'pending' || user.kyc_status === 'rejected') {
    await persistKycUpdate(user.id, {
      kycStatus: 'submitted',
      reviewStatus: 'sdk_token_issued',
    });
  }

  return {
    accessToken: tokenResponse.token,
    userId: tokenResponse.userId || String(user.id),
    levelName: env.sumsub.levelName,
    expiresIn: env.sumsub.tokenTtlSecs,
  };
}

/**
 * GET /kyc/status — sync from Sumsub when possible, then return local profile status.
 */
// TEMPORARILY DISABLED - SUMSUB KYC
async function getKycStatusSumsubDisabled(userId, { sync = true } = {}) {
  const user = await findUserRow(userId);
  if (!user) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  let synced = false;
  let reviewStatus = user.sumsub_review_status;

  if (sync && env.sumsub.appToken && env.sumsub.secretKey) {
    try {
      const applicant = await getApplicantByExternalUserId(user.id);
      const mapped = mapSumsubReviewToKycStatus(applicant);
      reviewStatus = applicant?.review?.reviewStatus || reviewStatus;

      await persistKycUpdate(user.id, {
        kycStatus: mapped,
        applicantId: applicant?.id || user.sumsub_applicant_id,
        reviewStatus,
      });
      synced = true;
    } catch (err) {
      // Applicant may not exist yet (user has not opened SDK). Keep local status.
      if (err.code !== 'SUMSUB_API_ERROR' && err.status !== 404) {
        // Non-404 Sumsub errors should surface for debugging when sync is critical.
        if (err.status && err.status >= 500) throw err;
      }
    }
  }

  const profile = await getUserProfile(userId);
  return {
    kycStatus: profile.kycStatus,
    reviewStatus: reviewStatus || null,
    applicantId: (await findUserRow(userId))?.sumsub_applicant_id || null,
    synced,
    user: profile,
  };
}

/**
 * Webhook handler — source of truth for final KYC decisions.
 */
// TEMPORARILY DISABLED - SUMSUB KYC
async function handleSumsubWebhookSumsubDisabled({
  rawBody,
  digestHeader,
  digestAlgHeader,
}) {
  const valid = verifyWebhookDigest({ rawBody, digestHeader, digestAlgHeader });
  if (!valid) {
    throw new AppError('Invalid Sumsub webhook signature', 401, 'INVALID_WEBHOOK_SIGNATURE');
  }

  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new AppError('Invalid webhook payload', 400, 'INVALID_WEBHOOK_PAYLOAD');
  }

  const applicantId = payload.applicantId || payload.applicant?.id;
  const externalUserId = payload.externalUserId || payload.applicant?.externalUserId;

  let user =
    (await findUserByApplicantId(applicantId)) ||
    (await findUserByExternalId(externalUserId));

  if (!user) {
    // Acknowledge unknown applicants so Sumsub does not retry forever.
    return { accepted: true, matched: false };
  }

  const reviewAnswer = String(
    payload.reviewResult?.reviewAnswer ||
      payload.applicant?.review?.reviewResult?.reviewAnswer ||
      ''
  ).toUpperCase();
  const reviewStatus = String(
    payload.reviewStatus || payload.applicant?.review?.reviewStatus || payload.type || ''
  );

  let kycStatus;
  if (reviewAnswer === 'GREEN') kycStatus = 'approved';
  else if (reviewAnswer === 'RED') kycStatus = 'rejected';
  else kycStatus = mapSumsubReviewToKycStatus({
    review: {
      reviewStatus,
      reviewResult: { reviewAnswer },
    },
  });

  // applicantCreated / applicantPending should not overwrite approved.
  if (user.kyc_status === 'approved' && kycStatus !== 'rejected') {
    kycStatus = 'approved';
  }

  await persistKycUpdate(user.id, {
    kycStatus,
    applicantId: applicantId || user.sumsub_applicant_id,
    reviewStatus,
  });

  return { accepted: true, matched: true, userId: user.id, kycStatus };
}
