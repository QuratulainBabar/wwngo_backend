import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as deliveryState from '../services/delivery_state.service.js';
import * as deliveryRepository from '../repositories/delivery.repository.js';
import * as notificationCreateService from '../services/notification_create.service.js';
import { asyncHandler, AppError } from '../utils/errors.js';

const router = Router();

router.post(
  '/deliveries/:id/in-transit',
  authenticate,
  asyncHandler(async (req, res) => {
    const delivery = await deliveryRepository.findDeliveryByPublicIdForUser(
      req.params.id,
      req.user.id
    );
    if (!delivery) throw new AppError('Delivery not found', 404, 'NOT_FOUND');
    if (delivery.traveler_id !== req.user.id) {
      throw new AppError('Only the assigned traveler can mark in transit', 403, 'FORBIDDEN');
    }
    if (delivery.status === 'in_transit') {
      return res.json({
        success: true,
        data: { status: 'in_transit', publicId: delivery.public_id },
      });
    }
    if (!['collected', 'ready_for_handoff'].includes(delivery.status)) {
      throw new AppError('Delivery cannot be marked in transit in its current state', 400, 'INVALID_STATUS');
    }

    const updated = await deliveryState.transitionDelivery({
      deliveryId: delivery.id,
      toStatus: 'in_transit',
      actorId: req.user.id,
      note: 'Traveler marked parcel in transit',
    });

    const publicId = delivery.public_id;
    for (const [uid, role, route] of [
      [delivery.sender_id, 'sender', `/shipment/${publicId}`],
      [delivery.receiver_id, 'receiver', `/receiver-tracking`],
    ]) {
      if (!uid) continue;
      await notificationCreateService
        .createNotification({
          userId: uid,
          role,
          type: 'deliveryStatus',
          title: 'Parcel in transit',
          body: `Parcel ${publicId} is now in transit.`,
          route,
        })
        .catch(() => {});
    }

    res.json({ success: true, data: { status: updated?.status || 'in_transit', publicId } });
  })
);

router.get(
  '/deliveries/:id/timeline',
  authenticate,
  asyncHandler(async (req, res) => {
    const delivery = await deliveryRepository.findDeliveryByPublicIdForUser(
      req.params.id,
      req.user.id
    );
    if (!delivery) throw new AppError('Delivery not found', 404, 'NOT_FOUND');

    const history = await deliveryState.getStatusHistory(delivery.id);
    const steps = deliveryState.trackingStepsForStatus(delivery.status);

    res.json({
      success: true,
      data: {
        deliveryId: delivery.id,
        publicId: delivery.public_id,
        status: delivery.status,
        steps,
        history,
      },
    });
  })
);

export default router;
