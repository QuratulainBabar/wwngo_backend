import { Router } from 'express';
import { body, param, query } from 'express-validator';
import * as walletController from '../controllers/wallet.controller.js';
import { authenticate, validate } from '../middleware/auth.js';
import { SUPPORTED_CURRENCIES } from '../services/stripe.service.js';

const router = Router();

const supportedCurrencyCodes = [...SUPPORTED_CURRENCIES].flatMap((c) => [
  c,
  c.toUpperCase(),
]);

const optionalCurrencyBody = (field) =>
  body(field)
    .optional()
    .isString()
    .trim()
    .isIn(supportedCurrencyCodes)
    .withMessage('currency must be a supported ISO code');

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

router.get('/payments/config', walletController.getPaymentsConfig);

router.post(
  '/fx/quote',
  body('amountCents')
    .isInt({ min: 0 })
    .withMessage('amountCents must be a non-negative integer'),
  body('fromCurrency')
    .optional()
    .isString()
    .trim()
    .isIn(supportedCurrencyCodes),
  body('toCurrency')
    .optional()
    .isString()
    .trim()
    .isIn(supportedCurrencyCodes),
  body('sourceCurrency')
    .optional()
    .isString()
    .trim()
    .isIn(supportedCurrencyCodes),
  body('targetCurrency')
    .optional()
    .isString()
    .trim()
    .isIn(supportedCurrencyCodes),
  body('from')
    .optional()
    .isString()
    .trim()
    .isIn(supportedCurrencyCodes),
  body('to')
    .optional()
    .isString()
    .trim()
    .isIn(supportedCurrencyCodes),
  body('useBaseRate').optional().isBoolean(),
  body().custom((_, { req }) => {
    const from =
      req.body.fromCurrency || req.body.sourceCurrency || req.body.from;
    const to = req.body.toCurrency || req.body.targetCurrency || req.body.to;
    if (!from || !to) {
      throw new Error(
        'fromCurrency and toCurrency are required (aliases: sourceCurrency/targetCurrency)'
      );
    }
    return true;
  }),
  validate,
  walletController.getFxQuote
);

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
  optionalCurrencyBody('currency'),
  validate,
  walletController.topUp
);

router.post(
  '/top-up/confirm',
  body('paymentIntentId').isString().trim().notEmpty(),
  validate,
  walletController.confirmTopUp
);

router.post(
  '/withdraw',
  roleBody,
  amountCentsBody,
  optionalCurrencyBody('currency'),
  validate,
  walletController.withdraw
);

router.get('/connect/status', walletController.getConnectStatus);

router.post(
  '/connect/onboard',
  body('returnPath').optional().isString(),
  body('role').optional().isIn(['sender', 'traveler', 'receiver']),
  validate,
  walletController.startConnectOnboarding
);

export default router;
