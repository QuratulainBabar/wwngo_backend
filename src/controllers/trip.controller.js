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
 * GET /api/v1/trips/sender-requests/count
 */
export const countSenderRequests = asyncHandler(async (req, res) => {
  const requestService = await import('../services/trip_sender_request.service.js');
  const count = await requestService.countSenderRequestsForTraveler(req.user.id);
  res.json({ success: true, data: { count } });
});

/**
 * GET /api/v1/trips/sender-requests
 */
export const listSenderRequests = asyncHandler(async (req, res) => {
  const requestService = await import('../services/trip_sender_request.service.js');
  const requests = await requestService.listSenderRequestsForTraveler(req.user.id);
  res.json({ success: true, data: { requests } });
});

/**
 * GET /api/v1/trips/sender-request-trips
 */
export const listSenderRequestTrips = asyncHandler(async (req, res) => {
  const requestService = await import('../services/trip_sender_request.service.js');
  const trips = await requestService.listTripsWithSenderRequests(req.user.id);
  res.json({ success: true, data: { trips } });
});

/**
 * GET /api/v1/trips/sender-requests/:requestId
 */
export const getSenderRequest = asyncHandler(async (req, res) => {
  const requestService = await import('../services/trip_sender_request.service.js');
  const data = await requestService.getSenderRequestForTraveler(
    req.user.id,
    req.params.requestId
  );
  res.json({ success: true, data });
});

/**
 * GET /api/v1/trips/:id/sender-requests
 */
export const listSenderRequestsForTrip = asyncHandler(async (req, res) => {
  const requestService = await import('../services/trip_sender_request.service.js');
  const data = await requestService.listSenderRequestsForTrip(
    req.user.id,
    req.params.id
  );
  res.json({ success: true, data });
});

/**
 * POST /api/v1/trips/:id/sender-requests/read
 * Marks pending sender requests for this trip as read (traveler opened them).
 */
export const markSenderRequestsRead = asyncHandler(async (req, res) => {
  const requestService = await import('../services/trip_sender_request.service.js');
  const data = await requestService.markSenderRequestsReadForTrip(
    req.user.id,
    req.params.id
  );
  res.json({ success: true, data });
});

/**
 * POST /api/v1/trips/sender-requests/:requestId/counter-offers
 * Traveler sends or revises a counter offer for a pending sender request.
 */
export const createCounterOffer = asyncHandler(async (req, res) => {
  const offerService = await import('../services/trip_counter_offer.service.js');
  const data = await offerService.createOrUpdateCounterOffer(
    req.user.id,
    req.params.requestId,
    req.body || {}
  );
  res.status(201).json({ success: true, data });
});

/**
 * GET /api/v1/trips/counter-offers
 */
export const listCounterOffers = asyncHandler(async (req, res) => {
  const offerService = await import('../services/trip_counter_offer.service.js');
  const offers = await offerService.listCounterOffersForTraveler(req.user.id);
  res.json({ success: true, data: { offers } });
});

/**
 * GET /api/v1/trips/counter-offers/:offerId
 */
export const getCounterOffer = asyncHandler(async (req, res) => {
  const offerService = await import('../services/trip_counter_offer.service.js');
  const data = await offerService.getCounterOfferForTraveler(
    req.user.id,
    req.params.offerId
  );
  res.json({ success: true, data });
});

/**
 * GET /api/v1/trips/sender-counter-offers/by-delivery/:deliveryPublicId
 */
export const getSenderCounterOfferByDelivery = asyncHandler(async (req, res) => {
  const offerService = await import('../services/trip_counter_offer.service.js');
  const data = await offerService.getCounterOfferForSenderByDelivery(
    req.user.id,
    req.params.deliveryPublicId
  );
  res.json({ success: true, data });
});

/**
 * GET /api/v1/trips/sender-counter-offers/:offerId
 */
export const getSenderCounterOffer = asyncHandler(async (req, res) => {
  const offerService = await import('../services/trip_counter_offer.service.js');
  const data = await offerService.getCounterOfferForSender(
    req.user.id,
    req.params.offerId
  );
  res.json({ success: true, data });
});

/**
 * POST /api/v1/trips/sender-counter-offers/:offerId/accept
 */
export const acceptSenderCounterOffer = asyncHandler(async (req, res) => {
  const offerService = await import('../services/trip_counter_offer.service.js');
  const data = await offerService.acceptCounterOfferForSender(
    req.user.id,
    req.params.offerId
  );
  res.json({ success: true, data });
});

/**
 * POST /api/v1/trips/sender-counter-offers/:offerId/reject
 */
export const rejectSenderCounterOffer = asyncHandler(async (req, res) => {
  const offerService = await import('../services/trip_counter_offer.service.js');
  const data = await offerService.rejectCounterOfferForSender(
    req.user.id,
    req.params.offerId
  );
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
