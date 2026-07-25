import * as tripService from '../services/trip.service.js';
import { asyncHandler } from '../utils/errors.js';

/**
 * POST /api/v1/trips
 */
export const createTrip = asyncHandler(async (req, res) => {
  const data = await tripService.createTrip(req.user.id, req.body || {});
  res.status(201).json({ success: true, data });
});

/**
 * GET /api/v1/trips
 */
export const listTrips = asyncHandler(async (req, res) => {
  const data = await tripService.listMyTrips(req.user.id, req.query);
  res.json({ success: true, data: { trips: data } });
});

/**
 * GET /api/v1/trips/:id
 */
export const getTrip = asyncHandler(async (req, res) => {
  const data = await tripService.getMyTrip(req.user.id, req.params.id);
  res.json({ success: true, data });
});
