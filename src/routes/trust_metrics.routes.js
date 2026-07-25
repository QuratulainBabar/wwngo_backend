import { Router } from 'express';
import { query } from 'express-validator';
import * as trustMetricsController from '../controllers/trust_metrics.controller.js';
import { authenticate, validate } from '../middleware/auth.js';

const router = Router();

router.use(authenticate);

router.get(
  '/',
  query('role')
    .optional()
    .isIn(['sender', 'traveler', 'receiver'])
    .withMessage('role must be sender, traveler, or receiver'),
  validate,
  trustMetricsController.getTrustMetrics
);

export default router;
