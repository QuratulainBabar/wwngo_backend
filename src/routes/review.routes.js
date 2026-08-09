import { Router } from 'express';
import { body, query } from 'express-validator';
import * as reviewController from '../controllers/review.controller.js';
import { authenticate, validate } from '../middleware/auth.js';

const router = Router();

const roleQuery = query('role')
  .optional()
  .isIn(['sender', 'traveler', 'receiver'])
  .withMessage('role must be sender, traveler, or receiver');

const roleBody = body('role')
  .optional()
  .isIn(['sender', 'traveler', 'receiver'])
  .withMessage('role must be sender, traveler, or receiver');

router.use(authenticate);

router.get(
  '/',
  roleQuery,
  query('limit').optional().isInt({ min: 1, max: 50 }),
  validate,
  reviewController.listMyReviews
);

router.post(
  '/',
  roleBody,
  body('revieweeId').isUUID().withMessage('revieweeId must be a valid user id'),
  body('rating').isInt({ min: 1, max: 5 }).withMessage('rating must be 1–5'),
  body('text').isString().trim().notEmpty().withMessage('text is required'),
  body('shipmentId').optional({ nullable: true }).isString().trim(),
  validate,
  reviewController.createReview
);

export default router;
