import { Router } from 'express';
import * as deliveryController from '../controllers/delivery.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireKycApproved, requireFullyVerified, requireWalletMinimum } from '../middleware/requirements.js';
import { deliveryPhotosUpload, handleMulterError } from '../middleware/upload.js';

const router = Router();

router.post(
  '/',
  authenticate,
  requireKycApproved,
  requireFullyVerified,
  requireWalletMinimum('sender'),
  (req, res, next) => {
    deliveryPhotosUpload(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  deliveryController.createDelivery
);

router.get('/', authenticate, deliveryController.listDeliveries);
router.get(
  '/:id/matching-travelers',
  authenticate,
  deliveryController.listMatchingTravelers
);
router.post(
  '/:id/request-traveler',
  authenticate,
  deliveryController.requestTraveler
);
router.post('/:id/accept', authenticate, requireWalletMinimum('receiver'), deliveryController.acceptDelivery);
router.post('/:id/decline', authenticate, deliveryController.declineDelivery);
router.post('/:id/receiver-payment', authenticate, deliveryController.submitReceiverPayment);
router.post('/:id/dispute', authenticate, deliveryController.openDispute);
router.post('/:id/cancel', authenticate, deliveryController.cancelDelivery);
router.patch(
  '/:id',
  authenticate,
  (req, res, next) => {
    deliveryPhotosUpload(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  deliveryController.updateDelivery
);
router.get('/:id', authenticate, deliveryController.getDelivery);

export default router;
