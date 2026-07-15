import { Router } from 'express';
import * as kycController from '../controllers/kyc.controller.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();

// TEMPORARILY DISABLED - SUMSUB KYC
// Paths remain mounted for client compatibility, but controllers are inert.
// Shared JWT authentication remains because it protects the placeholder API.
router.post('/access-token', authenticate, kycController.createAccessToken);
router.get('/status', authenticate, kycController.getStatus);

export default router;
