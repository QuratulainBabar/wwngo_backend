import { pool } from '../db/pool.js';
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

function sameId(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

/**
 * Ensure the reviewer/reviewee pair is valid for this shipment and role.
 * Allowed:
 *   sender → traveler
 *   traveler → receiver
 *   receiver → traveler
 */
async function assertValidReviewPair({
  reviewerId,
  revieweeId,
  role,
  shipmentId,
}) {
  if (!shipmentId) {
    throw new AppError(
      'shipmentId is required to submit a delivery review',
      400,
      'VALIDATION_ERROR'
    );
  }

  const { rows } = await pool.query(
    `SELECT id, public_id, status, sender_id, traveler_id, receiver_id
     FROM deliveries
     WHERE public_id = $1 OR id::text = $1
     LIMIT 1`,
    [shipmentId]
  );
  const delivery = rows[0];
  if (!delivery) {
    throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  }

  const isParty =
    sameId(delivery.sender_id, reviewerId) ||
    sameId(delivery.traveler_id, reviewerId) ||
    sameId(delivery.receiver_id, reviewerId);
  if (!isParty) {
    throw new AppError(
      'You can only review parties on your own deliveries',
      403,
      'FORBIDDEN'
    );
  }

  if (role === 'traveler') {
    if (!sameId(delivery.traveler_id, revieweeId)) {
      throw new AppError(
        'Reviewee must be the traveler for this delivery',
        400,
        'INVALID_REVIEWEE'
      );
    }
    const allowed =
      sameId(delivery.sender_id, reviewerId) ||
      sameId(delivery.receiver_id, reviewerId);
    if (!allowed) {
      throw new AppError(
        'Only the sender or receiver can review the traveler',
        403,
        'FORBIDDEN'
      );
    }
    return delivery;
  }

  if (role === 'receiver') {
    if (!sameId(delivery.receiver_id, revieweeId)) {
      throw new AppError(
        'Reviewee must be the receiver for this delivery',
        400,
        'INVALID_REVIEWEE'
      );
    }
    if (!sameId(delivery.traveler_id, reviewerId)) {
      throw new AppError(
        'Only the traveler can review the receiver',
        403,
        'FORBIDDEN'
      );
    }
    return delivery;
  }

  if (role === 'sender') {
    if (!sameId(delivery.sender_id, revieweeId)) {
      throw new AppError(
        'Reviewee must be the sender for this delivery',
        400,
        'INVALID_REVIEWEE'
      );
    }
    // Keep traveler→sender allowed for backwards compatibility if used.
    if (!sameId(delivery.traveler_id, reviewerId)) {
      throw new AppError(
        'Only the traveler can review the sender',
        403,
        'FORBIDDEN'
      );
    }
    return delivery;
  }

  throw new AppError('Invalid review role', 400, 'VALIDATION_ERROR');
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

  await assertValidReviewPair({
    reviewerId,
    revieweeId,
    role,
    shipmentId,
  });

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
