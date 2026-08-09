import * as kycService from '../services/kyc.service.js';
import { asyncHandler } from '../utils/errors.js';

/**
 * POST /api/v1/kyc/access-token
 * Returns a short-lived Sumsub SDK access token for the authenticated user.
 */
export const createAccessToken = asyncHandler(async (req, res) => {
  const data = await kycService.issueAccessToken(req.user.id);
  res.json({ success: true, data });
});

/**
 * GET /api/v1/kyc/status
 * Syncs from Sumsub (when possible) and returns the latest KYC status.
 */
export const getStatus = asyncHandler(async (req, res) => {
  const sync = req.query.sync !== 'false';
  const data = await kycService.getKycStatus(req.user.id, { sync });
  res.json({ success: true, data });
});

/**
 * POST /api/v1/webhooks/sumsub
 * Sumsub review webhooks (signature verified).
 */
export const sumsubWebhook = asyncHandler(async (req, res) => {
  const rawBody = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === 'string' ? req.body : JSON.stringify(req.body || {}));
  const data = await kycService.handleSumsubWebhook({
    rawBody,
    digestHeader: req.headers['x-payload-digest'],
    digestAlgHeader: req.headers['x-payload-digest-alg'],
  });
  res.json({ success: true, data });
});
