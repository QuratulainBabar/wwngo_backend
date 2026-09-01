import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as nfcService from '../services/nfc.service.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.post(
  '/deliveries/:deliveryId/checkpoints/:checkpoint',
  authenticate,
  asyncHandler(async (req, res) => {
    const checkpoint =
      req.params.checkpoint === '1'
        ? 'handoff_sender_traveler'
        : req.params.checkpoint === '2'
          ? 'delivery_traveler_receiver'
          : req.params.checkpoint;

    const record = await nfcService.recordCheckpoint({
      deliveryId: req.params.deliveryId,
      userId: req.user.id,
      checkpoint,
      deviceId: req.body.deviceId,
      gpsLat: req.body.gpsLat,
      gpsLng: req.body.gpsLng,
      confirm: req.body.confirm !== false,
      paymentIntentId: req.body.paymentIntentId || null,
    });
    res.json({ success: true, data: { checkpoint: record } });
  })
);

router.get(
  '/deliveries/:deliveryId/checkpoints',
  authenticate,
  asyncHandler(async (req, res) => {
    const checkpoints = await nfcService.listCheckpoints(
      req.params.deliveryId,
      req.user.id
    );
    res.json({ success: true, data: { checkpoints } });
  })
);

export default router;
