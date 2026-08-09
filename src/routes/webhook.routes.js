import { Router } from 'express';
import * as kycController from '../controllers/kyc.controller.js';
import * as stripeService from '../services/stripe.service.js';
import { asyncHandler } from '../utils/errors.js';

const router = Router();

router.post('/sumsub', kycController.sumsubWebhook);

router.post(
  '/stripe',
  asyncHandler(async (req, res) => {
    const signature = req.headers['stripe-signature'];
    const result = await stripeService.handleWebhook(req.body, signature);
    res.json({ received: true, ...result });
  })
);

export default router;
