import * as reviewService from '../services/review.service.js';
import { asyncHandler } from '../utils/errors.js';

/**
 * GET /api/v1/reviews?role=sender&limit=20
 * Reviews received by the authenticated user.
 */
export const listMyReviews = asyncHandler(async (req, res) => {
  const data = await reviewService.listMyReviews(req.user.id, req.query.role, {
    limit: Number(req.query.limit) || 20,
  });
  res.json({ success: true, data });
});

/**
 * POST /api/v1/reviews
 * body: { revieweeId, role, rating, text, shipmentId? }
 */
export const createReview = asyncHandler(async (req, res) => {
  const data = await reviewService.createReview(req.user.id, req.body);
  res.status(201).json({ success: true, data });
});
