import { Router } from 'express';
import * as kycController from '../controllers/kyc.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

router.post('/access-token', authenticate, kycController.createAccessToken);
router.get('/status', authenticate, kycController.getStatus);

export default router;
