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
 * GET /api/v1/trips/discover
 */
export const discoverTrips = asyncHandler(async (req, res) => {
  const data = await tripService.discoverTrips(req.query);
  res.json({ success: true, data: { trips: data } });
});

/**
 * GET /api/v1/trips/discover/:id
 */
export const getDiscoverableTrip = asyncHandler(async (req, res) => {
  const data = await tripService.getDiscoverableTrip(req.params.id);
  res.json({ success: true, data });
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

/**
 * PATCH /api/v1/trips/:id
 * Traveler updates travel date or luggage capacity on an open trip.
 */
export const updateTrip = asyncHandler(async (req, res) => {
  const data = await tripService.updateTripForTraveler(
    req.user.id,
    req.params.id,
    req.body || {}
  );
  res.json({ success: true, data });
});

/**
 * POST /api/v1/trips/:id/cancel
 * Traveler cancels an open trip.
 */
export const cancelTrip = asyncHandler(async (req, res) => {
  const data = await tripService.cancelTripForTraveler(
    req.user.id,
    req.params.id
  );
  res.json({ success: true, data });
});
