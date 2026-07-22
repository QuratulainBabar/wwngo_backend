import { Router } from 'express';
import * as kycController from '../controllers/kyc.controller.js';

const router = Router();

router.post('/sumsub', kycController.sumsubWebhook);

export default router;
