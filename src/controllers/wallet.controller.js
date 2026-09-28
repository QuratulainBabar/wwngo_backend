import * as walletService from '../services/wallet.service.js';
import * as fxService from '../services/fx.service.js';
import { asyncHandler } from '../utils/errors.js';

/**
 * GET /api/v1/wallet?role=sender
 * Returns available + escrow balances and a short transaction summary.
 */
export const getWallet = asyncHandler(async (req, res) => {
  const data = await walletService.getWalletSummary(req.user.id, {
    recentLimit: Number(req.query.recentLimit) || 6,
    activityRole: req.query.role || null,
  });
  res.json({ success: true, data });
});

/**
 * GET /api/v1/wallet/transactions
 * Optional ?role= filters by activity tag on each ledger row.
 */
export const listTransactions = asyncHandler(async (req, res) => {
  const data = await walletService.listTransactions(req.user.id, {
    limit: Number(req.query.limit) || 50,
    activityRole: req.query.role || null,
  });
  res.json({ success: true, data });
});

/**
 * GET /api/v1/wallet/escrow/:shipmentId
 */
export const getShipmentEscrow = asyncHandler(async (req, res) => {
  const data = await walletService.getShipmentEscrow(req.user.id, req.params.shipmentId);
  res.json({ success: true, data });
});

/**
 * POST /api/v1/wallet/kyc-welcome-credit
 * Credits $10 to sender, traveler, and receiver after identity verification.
 */
export const grantKycWelcomeCredit = asyncHandler(async (req, res) => {
  const data = await walletService.grantKycWelcomeCredit(req.user.id);
  res.json({ success: true, data });
});

/**
 * POST /api/v1/wallet/top-up
 * body: { role, amountCents, currency? }
 */
export const topUp = asyncHandler(async (req, res) => {
  const data = await walletService.topUp(
    req.user.id,
    req.body.role,
    req.body.amountCents,
    req.body.currency
  );
  res.status(201).json({ success: true, data });
});

export const confirmTopUp = asyncHandler(async (req, res) => {
  const data = await walletService.confirmTopUp(
    req.user.id,
    req.body.paymentIntentId
  );
  res.json({ success: true, data });
});

export const getPaymentsConfig = asyncHandler(async (_req, res) => {
  const data = await walletService.getPaymentsConfigAsync();
  res.json({ success: true, data });
});

/**
 * POST /api/v1/wallet/withdraw
 * body: { role, amountCents, currency? }
 */
export const withdraw = asyncHandler(async (req, res) => {
  const data = await walletService.withdraw(
    req.user.id,
    req.body.role,
    req.body.amountCents,
    req.body.currency
  );
  res.json({ success: true, data });
});

export const getConnectStatus = asyncHandler(async (req, res) => {
  const data = await walletService.getConnectStatus(req.user.id);
  res.json({ success: true, data });
});

export const startConnectOnboarding = asyncHandler(async (req, res) => {
  const data = await walletService.startConnectOnboarding(req.user.id, {
    returnPath: req.body.returnPath,
    role: req.body.role,
  });
  res.json({ success: true, data });
});

/**
 * POST /api/v1/wallet/fx/quote
 * body: { fromCurrency|sourceCurrency, toCurrency|targetCurrency, amountCents, useBaseRate? }
 * Live Stripe FX Quote (lock_duration=none) → converted amount for any supported pair.
 */
export const getFxQuote = asyncHandler(async (req, res) => {
  const fromCurrency =
    req.body.fromCurrency || req.body.sourceCurrency || req.body.from;
  const toCurrency =
    req.body.toCurrency || req.body.targetCurrency || req.body.to;
  const data = await fxService.convertAmount({
    fromCurrency,
    toCurrency,
    amountCents: req.body.amountCents,
    useBaseRate: Boolean(req.body.useBaseRate),
  });
  res.json({ success: true, data });
});
