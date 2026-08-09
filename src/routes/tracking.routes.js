import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as deliveryState from '../services/delivery_state.service.js';
import * as deliveryRepository from '../repositories/delivery.repository.js';
import { asyncHandler, AppError } from '../utils/errors.js';

const router = Router();

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
