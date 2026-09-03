import { Router } from 'express';
import * as deliveryController from '../controllers/delivery.controller.js';
import { authenticate } from '../middleware/auth.js';
import { requireKycApproved, requireFullyVerified, requireSenderWalletForDeliveryCreate } from '../middleware/requirements.js';
import { deliveryPhotosUpload, handleMulterError } from '../middleware/upload.js';

const router = Router();

router.post(
  '/',
  authenticate,
  requireKycApproved,
  requireFullyVerified,
  (req, res, next) => {
    deliveryPhotosUpload(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  requireSenderWalletForDeliveryCreate,
  deliveryController.createDelivery
);

router.get('/', authenticate, deliveryController.listDeliveries);
router.get(
  '/:id/matching-travelers',
  authenticate,
  deliveryController.listMatchingTravelers
);
router.get(
  '/:id/traveler-requests',
  authenticate,
  deliveryController.listTravelerRequests
);
router.post(
  '/:id/request-traveler',
  authenticate,
  deliveryController.requestTraveler
);
router.post('/:id/accept', authenticate, deliveryController.acceptDelivery);
router.post('/:id/decline', authenticate, deliveryController.declineDelivery);
router.post('/:id/receiver-payment', authenticate, deliveryController.submitReceiverPayment);
router.post('/:id/dispute', authenticate, deliveryController.openDispute);
router.get('/:id/dispute', authenticate, deliveryController.getOpenDispute);
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
