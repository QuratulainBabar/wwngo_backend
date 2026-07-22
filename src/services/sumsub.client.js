import crypto from 'crypto';
import { env } from '../config/env.js';
import { AppError } from '../utils/errors.js';

const SUMSUB_KYC_ENABLED = true;

function assertConfigured() {
  if (!env.sumsub.appToken || !env.sumsub.secretKey) {
    throw new AppError(
      'Sumsub is not configured. Set SUMSUB_APP_TOKEN and SUMSUB_SECRET_KEY on the server.',
      503,
      'SUMSUB_NOT_CONFIGURED'
    );
  }
  if (!env.sumsub.sandbox) {
    // Prefer sandbox during development; production tokens still work.
    console.warn('Sumsub: App Token is not a sandbox (sbx:) token.');
  }
}

function signRequest(ts, method, pathWithQuery, body = '') {
  const payload = `${ts}${method.toUpperCase()}${pathWithQuery}${body}`;
  return crypto.createHmac('sha256', env.sumsub.secretKey).update(payload).digest('hex');
}

/**
 * Signed request to the Sumsub REST API.
 * Secrets stay on the backend — never exposed to Flutter.
 */
export async function sumsubRequest(method, pathWithQuery, { body } = {}) {
  if (!SUMSUB_KYC_ENABLED) {
    throw new AppError(
      'Identity verification is temporarily unavailable.',
      503,
      'KYC_DISABLED'
    );
  }

  assertConfigured();

  const bodyStr = body == null ? '' : typeof body === 'string' ? body : JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000).toString();
  const signature = signRequest(ts, method, pathWithQuery, bodyStr);
  const url = `${env.sumsub.baseUrl}${pathWithQuery}`;

  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-App-Token': env.sumsub.appToken,
      'X-App-Access-Ts': ts,
      'X-App-Access-Sig': signature,
    },
    body: bodyStr || undefined,
  });

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message =
      data?.description ||
      data?.errorName ||
      data?.message ||
      `Sumsub request failed (${response.status})`;
    throw new AppError(message, response.status >= 500 ? 502 : 400, 'SUMSUB_API_ERROR');
  }

  return data;
}

export async function createSdkAccessToken({
  userId,
  levelName = env.sumsub.levelName,
  email,
  phone,
  ttlInSecs = env.sumsub.tokenTtlSecs,
}) {
  const body = {
    userId: String(userId),
    levelName,
    ttlInSecs,
  };

  if (email || phone) {
    body.applicantIdentifiers = {};
    if (email) body.applicantIdentifiers.email = email;
    if (phone) body.applicantIdentifiers.phone = phone;
  }

  return sumsubRequest('POST', '/resources/accessTokens/sdk', { body });
}

export async function getApplicantByExternalUserId(externalUserId) {
  const encoded = encodeURIComponent(String(externalUserId));
  return sumsubRequest('GET', `/resources/applicants/-;externalUserId=${encoded}/one`);
}

export function verifyWebhookDigest({ rawBody, digestHeader, digestAlgHeader }) {
  const secret = env.sumsub.webhookSecret;
  if (!secret) {
    throw new AppError('Sumsub webhook secret is not configured', 503, 'SUMSUB_NOT_CONFIGURED');
  }

  const algoMap = {
    HMAC_SHA1_HEX: 'sha1',
    HMAC_SHA256_HEX: 'sha256',
    HMAC_SHA512_HEX: 'sha512',
  };
  const algo = algoMap[digestAlgHeader] || 'sha256';
  const calculated = crypto.createHmac(algo, secret).update(rawBody).digest('hex');
  const received = String(digestHeader || '');

  if (!received) return false;

  const a = Buffer.from(calculated, 'utf8');
  const b = Buffer.from(received, 'utf8');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Maps Sumsub review payload → local kyc_status enum.
 */
export function mapSumsubReviewToKycStatus(applicant) {
  const review = applicant?.review || {};
  const reviewStatus = String(review.reviewStatus || '').toLowerCase();
  const answer = String(review.reviewResult?.reviewAnswer || '').toUpperCase();

  if (answer === 'GREEN') return 'approved';
  if (answer === 'RED') return 'rejected';

  if (['pending', 'queued', 'onhold', 'on_hold', 'prechecked', 'awaitingService'].includes(reviewStatus)) {
    return 'submitted';
  }

  if (reviewStatus === 'completed') {
    // Completed without a clear answer — treat as still in review pipeline.
    return answer ? 'submitted' : 'submitted';
  }

  if (['init', 'incomplete'].includes(reviewStatus) || !reviewStatus) {
    return 'pending';
  }

  return 'submitted';
}
