import { pool } from '../db/pool.js';
import * as reviewRepository from '../repositories/review.repository.js';
import * as notificationCreateService from './notification_create.service.js';
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

/** Which party role a user holds on this delivery, or null if not a party. */
function partyRoleOnDelivery(delivery, userId) {
  if (sameId(delivery.sender_id, userId)) return 'sender';
  if (sameId(delivery.traveler_id, userId)) return 'traveler';
  if (sameId(delivery.receiver_id, userId)) return 'receiver';
  return null;
}

function profileRouteForRole(role) {
  switch (role) {
    case 'traveler':
      return '/traveler-profile';
    case 'receiver':
      return '/receiver-profile';
    default:
      return '/profile';
  }
}

/**
 * Ensure the reviewer/reviewee pair is valid for this shipment and role.
 * Allowed (any distinct party pair):
 *   sender → traveler | receiver
 *   traveler → sender | receiver
 *   receiver → sender | traveler
 * `role` is the reviewee's party role on the delivery.
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

  const reviewerParty = partyRoleOnDelivery(delivery, reviewerId);
  const revieweeParty = partyRoleOnDelivery(delivery, revieweeId);

  if (!reviewerParty || !revieweeParty) {
    throw new AppError(
      'You can only review parties on your own deliveries',
      403,
      'FORBIDDEN'
    );
  }
  if (reviewerParty === revieweeParty) {
    throw new AppError('You cannot review yourself', 400, 'VALIDATION_ERROR');
  }
  if (role !== revieweeParty) {
    throw new AppError(
      `Reviewee must be the ${role} for this delivery`,
      400,
      'INVALID_REVIEWEE'
    );
  }

  return delivery;
}

async function notifyRevieweeOfReview({
  revieweeId,
  revieweeRole,
  reviewerName,
  rating,
  shipmentPublicId,
}) {
  const stars = Number(rating) || 0;
  const starLabel = `${stars}-star`;
  const shipmentLabel = shipmentPublicId ? ` for ${shipmentPublicId}` : '';
  const name = String(reviewerName || '').trim() || 'Someone';

  await notificationCreateService.createNotification({
    userId: revieweeId,
    role: revieweeRole,
    type: 'reviewReceived',
    title: 'New review received',
    body: `${name} left you a ${starLabel} review${shipmentLabel}.`,
    route: profileRouteForRole(revieweeRole),
  });
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

  const delivery = await assertValidReviewPair({
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
    const mapped = mapReview(row);

    await notifyRevieweeOfReview({
      revieweeId,
      revieweeRole: role,
      reviewerName: mapped.reviewerName,
      rating: mapped.rating,
      shipmentPublicId: delivery.public_id || shipmentId,
    }).catch((err) => {
      console.error(
        '[reviews] notify reviewee failed:',
        err?.message || err
      );
    });

    return mapped;
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
