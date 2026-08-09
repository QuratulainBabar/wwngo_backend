import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import * as meetupService from '../services/meetup.service.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.get(
  '/deliveries/:deliveryId/meetup',
  authenticate,
  asyncHandler(async (req, res) => {
    const status = await meetupService.getMeetupStatus(req.params.deliveryId, req.user.id);
    res.json({ success: true, data: status });
  })
);

router.post(
  '/deliveries/:deliveryId/meetup/propose',
  authenticate,
  asyncHandler(async (req, res) => {
    const status = await meetupService.proposeMeetup(req.params.deliveryId, req.user.id, {
      location: req.body.location,
    });
    res.json({ success: true, data: status });
  })
);

router.post(
  '/deliveries/:deliveryId/meetup/agree',
  authenticate,
  asyncHandler(async (req, res) => {
    const status = await meetupService.agreeMeetup(req.params.deliveryId, req.user.id);
    res.json({ success: true, data: status });
  })
);

export default router;
