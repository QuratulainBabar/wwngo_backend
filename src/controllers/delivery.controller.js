import * as deliveryService from '../services/delivery.service.js';
import * as matchingService from '../services/matching.service.js';
import { asyncHandler } from '../utils/errors.js';

/**
 * POST /api/v1/deliveries
 * multipart/form-data — creates a delivery with parcel photos.
 */
export const createDelivery = asyncHandler(async (req, res) => {
  const data = await deliveryService.createDelivery(req.user.id, req.body, req.files || []);
  res.status(201).json({ success: true, data });
});

/**
 * GET /api/v1/deliveries
 * Lists deliveries for the authenticated user.
 * Query: role=sender|receiver (default sender).
 */
export const listDeliveries = asyncHandler(async (req, res) => {
  const data = await deliveryService.listDeliveriesForUser(req.user, req.query);
  res.json({ success: true, data: { deliveries: data } });
});

/**
 * GET /api/v1/deliveries/:id
 * Fetch a single delivery by UUID or publicId.
 * Query: role=receiver to force receiver access.
 */
export const getDelivery = asyncHandler(async (req, res) => {
  const data = await deliveryService.getDeliveryForUser(
    req.user,
    req.params.id,
    req.query
  );
  res.json({ success: true, data });
});

/**
 * POST /api/v1/deliveries/:id/accept
 * Receiver accepts an incoming parcel request.
 */
export const acceptDelivery = asyncHandler(async (req, res) => {
  const data = await deliveryService.acceptDeliveryAsReceiver(req.user, req.params.id);
  res.json({ success: true, data });
});

/**
 * POST /api/v1/deliveries/:id/decline
 * Receiver declines an incoming parcel request.
 */
export const declineDelivery = asyncHandler(async (req, res) => {
  const data = await deliveryService.declineDeliveryAsReceiver(req.user, req.params.id);
  res.json({ success: true, data });
});

/**
 * GET /api/v1/deliveries/:id/matching-travelers
 * Returns travelers whose trip To matches this delivery's To destination.
 */
export const listMatchingTravelers = asyncHandler(async (req, res) => {
  const travelers = await matchingService.listMatchingTravelersForDelivery(
    req.user.id,
    req.params.id
  );
  res.json({ success: true, data: { travelers } });
});

/**
 * POST /api/v1/deliveries/:id/request-traveler
 * Sender sends a parcel request to a matching traveler trip.
 */
export const requestTraveler = asyncHandler(async (req, res) => {
  const requestService = await import('../services/trip_sender_request.service.js');
  const data = await requestService.requestTravelerForDelivery(
    req.user.id,
    req.params.id,
    req.body || {}
  );
  res.status(201).json({ success: true, data });
});

/**
 * PATCH /api/v1/deliveries/:id
 * Sender updates all delivery fields (multipart when photos change).
 */
export const updateDelivery = asyncHandler(async (req, res) => {
  const data = await deliveryService.updateDeliveryForSender(
    req.user.id,
    req.params.id,
    req.body,
    req.files || []
  );
  res.json({ success: true, data });
});

/**
 * POST /api/v1/deliveries/:id/cancel
 * Sender cancels a posted delivery.
 */
export const cancelDelivery = asyncHandler(async (req, res) => {
  const data = await deliveryService.cancelDeliveryForSender(
    req.user.id,
    req.params.id
  );
  res.json({ success: true, data });
});

export const submitReceiverPayment = asyncHandler(async (req, res) => {
  const data = await deliveryService.submitReceiverPayment(
    req.user,
    req.params.id,
    { feeCents: req.body?.feeCents }
  );
  res.json({ success: true, data });
});

export const openDispute = asyncHandler(async (req, res) => {
  const data = await deliveryService.openDispute(req.user, req.params.id, req.body || {});
  res.status(201).json({ success: true, data });
});
