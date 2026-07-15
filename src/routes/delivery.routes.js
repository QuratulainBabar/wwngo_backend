import { Router } from 'express';
import * as deliveryController from '../controllers/delivery.controller.js';
import { authenticate } from '../middleware/auth.js';
import { deliveryPhotosUpload, handleMulterError } from '../middleware/upload.js';

const router = Router();

router.post(
  '/',
  authenticate,
  (req, res, next) => {
    deliveryPhotosUpload(req, res, (err) => {
      if (err) return handleMulterError(err, req, res, next);
      next();
    });
  },
  deliveryController.createDelivery
);

router.get('/', authenticate, deliveryController.listDeliveries);
router.get('/:id', authenticate, deliveryController.getDelivery);

export default router;
