import { Router } from 'express';
import { body, param, query } from 'express-validator';
import * as walletController from '../controllers/wallet.controller.js';
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

const amountCentsBody = body('amountCents')
  .isInt({ gt: 0 })
  .withMessage('amountCents must be a positive integer');

router.use(authenticate);

router.get('/', roleQuery, validate, walletController.getWallet);

router.post(
  '/kyc-welcome-credit',
  walletController.grantKycWelcomeCredit
);

router.get(
  '/transactions',
  roleQuery,
  query('limit').optional().isInt({ min: 1, max: 200 }),
  validate,
  walletController.listTransactions
);

router.get(
  '/escrow/:shipmentId',
  param('shipmentId').isString().trim().notEmpty(),
  validate,
  walletController.getShipmentEscrow
);

router.post(
  '/top-up',
  roleBody,
  amountCentsBody,
  validate,
  walletController.topUp
);

router.post(
  '/withdraw',
  roleBody,
  amountCentsBody,
  validate,
  walletController.withdraw
);

router.get('/connect/status', walletController.getConnectStatus);

router.post(
  '/connect/onboard',
  body('returnPath').optional().isString(),
  validate,
  walletController.startConnectOnboarding
);

export default router;
