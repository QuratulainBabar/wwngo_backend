import * as trustMetricsService from '../services/trust_metrics.service.js';
import { asyncHandler } from '../utils/errors.js';

/**
 * GET /api/v1/trust-metrics?role=sender
 */
export const getTrustMetrics = asyncHandler(async (req, res) => {
  const data = await trustMetricsService.getTrustMetrics(
    req.user.id,
    req.query.role
  );
  res.json({ success: true, data });
});
