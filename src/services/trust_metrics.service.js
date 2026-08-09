import * as trustMetricsRepository from '../repositories/trust_metrics.repository.js';
import { normalizeRole } from '../repositories/wallet.repository.js';

function ratePercent(count, total) {
  if (!total || total <= 0) return 0;
  return Math.round((count / total) * 1000) / 10; // one decimal place
}

/**
 * Trust indicators for the authenticated user's role profile.
 */
export async function getTrustMetrics(userId, role) {
  const normalized = normalizeRole(role);
  const agg = await trustMetricsRepository.getTrustAggregates(userId, normalized);
  const closed = agg.closed;

  return {
    role: normalized,
    completedDeliveries: agg.completed,
    cancellationRate: ratePercent(agg.cancelled, closed),
    disputeRate: ratePercent(agg.disputed, closed),
  };
}
