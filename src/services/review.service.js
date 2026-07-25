import * as reviewRepository from '../repositories/review.repository.js';
import { AppError } from '../utils/errors.js';
import { normalizeRole } from '../repositories/wallet.repository.js';

function formatReviewDate(createdAt) {
  const date = new Date(createdAt);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function initialFromName(name) {
  const trimmed = String(name || '').trim();
  return trimmed.length > 0 ? trimmed[0].toUpperCase() : '?';
}

function mapReview(row) {
  const reviewerName = row.reviewer_name || 'User';
  return {
    id: row.id,
    reviewerName,
    initial: initialFromName(reviewerName),
    rating: Number(row.rating),
    text: row.body,
    date: formatReviewDate(row.created_at),
    shipmentId: row.shipment_id ?? null,
    role: row.role,
    createdAt: row.created_at,
  };
}

/**
 * GET reviews received by the authenticated user for a role.
 */
export async function listMyReviews(userId, role, { limit } = {}) {
  const rows = await reviewRepository.listForReviewee(userId, role, { limit });
  return {
    reviews: rows.map(mapReview),
  };
}

/**
 * POST a review about another user.
 * body: { revieweeId, role, rating, text, shipmentId? }
 */
export async function createReview(reviewerId, payload) {
  const revieweeId = String(payload.revieweeId || '').trim();
  const text = String(payload.text || '').trim();
  const rating = Number(payload.rating);
  const role = normalizeRole(payload.role);
  const shipmentId = payload.shipmentId
    ? String(payload.shipmentId).trim()
    : null;

  if (!revieweeId) {
    throw new AppError('revieweeId is required', 400, 'VALIDATION_ERROR');
  }
  if (revieweeId === reviewerId) {
    throw new AppError('You cannot review yourself', 400, 'VALIDATION_ERROR');
  }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    throw new AppError('rating must be an integer from 1 to 5', 400, 'VALIDATION_ERROR');
  }
  if (!text) {
    throw new AppError('Review text is required', 400, 'VALIDATION_ERROR');
  }

  try {
    const row = await reviewRepository.createReview({
      revieweeId,
      reviewerId,
      role,
      rating,
      body: text,
      shipmentId,
    });
    return mapReview(row);
  } catch (err) {
    if (err?.code === '23505') {
      throw new AppError(
        'You already reviewed this delivery',
        409,
        'REVIEW_EXISTS'
      );
    }
    if (err?.code === '23503') {
      throw new AppError('User not found', 404, 'NOT_FOUND');
    }
    throw err;
  }
}
