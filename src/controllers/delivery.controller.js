import * as deliveryService from '../services/delivery.service.js';
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
 * Lists deliveries for the authenticated sender.
 */
export const listDeliveries = asyncHandler(async (req, res) => {
  const data = await deliveryService.listSenderDeliveries(req.user.id, req.query);
  res.json({ success: true, data: { deliveries: data } });
});

/**
 * GET /api/v1/deliveries/:id
 * Fetch a single delivery by UUID or publicId.
 */
export const getDelivery = asyncHandler(async (req, res) => {
  const data = await deliveryService.getDeliveryForSender(req.user.id, req.params.id);
  res.json({ success: true, data });
});
