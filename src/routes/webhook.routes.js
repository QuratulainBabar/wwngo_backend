import { Router } from 'express';
import * as kycController from '../controllers/kyc.controller.js';

const router = Router();

// TEMPORARILY DISABLED - SUMSUB KYC
// Retained only to acknowledge stale provider retries with HTTP 204.
router.post('/sumsub', kycController.sumsubWebhook);

export default router;
