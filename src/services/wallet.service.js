import { AppError } from '../utils/errors.js';
import * as walletRepo from '../repositories/wallet.repository.js';

export const MINIMUM_WITHDRAWAL_CENTS = 1000;

/** Welcome balance is disabled — new users start at $0. */
export const KYC_WELCOME_CREDIT_CENTS = 0;
export const KYC_WELCOME_DESCRIPTION =
  'Welcome credit after identity verification';

function mapLedgerEntry(row) {
  return {
    id: row.id,
    role: row.role,
    type: toCamelType(row.type),
    amountCents: Number(row.amount_cents),
    availableDeltaCents: Number(row.available_delta_cents),
    escrowDeltaCents: Number(row.escrow_delta_cents),
    description: row.description,
    shipmentId: row.shipment_id || null,
    hiddenFromHistory: Boolean(row.hidden_from_history),
    createdAt: row.created_at?.toISOString?.() ?? row.created_at,
  };
}

function toCamelType(dbType) {
  const map = {
    top_up: 'topUp',
    withdrawal: 'withdrawal',
    escrow_hold: 'escrowHold',
    escrow_release: 'escrowRelease',
    escrow_freeze: 'escrowFreeze',
    delivery_payout: 'deliveryPayout',
    platform_fee: 'platformFee',
    refund: 'refund',
  };
  return map[dbType] || dbType;
}

function mapWallet(row) {
  return {
    availableCents: Number(row.available_cents),
    escrowCents: Number(row.escrow_cents),
    currency: 'USD',
    minimumWithdrawalCents: MINIMUM_WITHDRAWAL_CENTS,
  };
}

function mapShipmentEscrow(row) {
  return {
    shipmentId: row.shipment_id,
    amountCents: Number(row.amount_cents),
    status: row.status,
    role: row.role || null,
  };
}

/**
 * Wallet summary for the authenticated user (single balance across all roles).
 * [activityRole] optionally filters recent transactions by activity tag.
 */
export async function getWalletSummary(userId, { recentLimit = 6, activityRole = null } = {}) {
  const [wallet, recent, relatedEscrows] = await Promise.all([
    walletRepo.getWalletReadOnly(userId),
    walletRepo.listLedgerEntries(userId, {
      limit: recentLimit,
      includeHidden: false,
      activityRole,
    }),
    walletRepo.listRelatedShipmentEscrows(userId),
  ]);

  return {
    ...mapWallet(wallet),
    shipmentEscrows: relatedEscrows.map(mapShipmentEscrow),
    recentTransactions: recent.map(mapLedgerEntry),
  };
}

export async function listTransactions(userId, { limit = 50, activityRole = null } = {}) {
  await walletRepo.ensureWallet(userId);
  const rows = await walletRepo.listLedgerEntries(userId, {
    limit,
    includeHidden: false,
    activityRole,
  });
  return {
    transactions: rows.map(mapLedgerEntry),
  };
}

export async function getShipmentEscrow(userId, shipmentId) {
  const row = await walletRepo.getShipmentEscrow(shipmentId);
  if (!row) {
    return {
      shipmentId,
      amountCents: 0,
      status: 'none',
    };
  }

  const isFunder = row.user_id === userId;
  const isParty =
    isFunder || (await walletRepo.userIsPartyToShipment(userId, shipmentId));
  if (!isParty) {
    return {
      shipmentId,
      amountCents: 0,
      status: 'none',
    };
  }

  return {
    shipmentId: row.shipment_id,
    amountCents: Number(row.amount_cents),
    status: row.status,
    role: row.role,
  };
}

/**
 * No welcome balance is granted on signup or after KYC — every new user starts
 * at $0. This is intentionally a no-op that reports the current wallet state so
 * existing callers (Continue-to-app, KYC sync) keep working without crediting.
 */
export async function grantKycWelcomeCredit(userId) {
  if (!userId) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  const wallet = mapWallet(await walletRepo.getWalletReadOnly(userId));

  return {
    granted: false,
    alreadyGranted: false,
    amountCents: 0,
    wallet,
  };
}

/**
 * Credit available balance (mock Stripe top-up until payments are wired).
 */
export async function topUp(userId, role, amountCents) {
  const cents = Number(amountCents);
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new AppError('Top-up amount must be a positive integer (cents)', 400, 'VALIDATION_ERROR');
  }

  const stripeService = await import('./stripe.service.js');
  if (stripeService.isConfigured()) {
    return createTopUpPaymentIntent(userId, role, cents);
  }

  const { wallet, entry } = await walletRepo.appendLedgerEntry({
    userId,
    role,
    type: 'top_up',
    amountCents: cents,
    availableDeltaCents: cents,
    description: 'Top-up via Stripe',
  });

  return {
    ...mapWallet(wallet),
    entry: mapLedgerEntry(entry),
    mock: true,
  };
}

/**
 * Create Stripe PaymentIntent for wallet top-up; credits on webhook success.
 */
export async function createTopUpPaymentIntent(userId, role, amountCents) {
  const stripeService = await import('./stripe.service.js');
  const { pool } = await import('../db/pool.js');

  let intent;
  try {
    intent = await stripeService.createPaymentIntent({
      amountCents,
      customerId: userId,
      metadata: {
        purpose: 'wallet_top_up',
        userId,
        role,
        amountCents: String(amountCents),
      },
    });
  } catch (err) {
    throw new AppError(
      err.message || 'Could not start Stripe payment',
      502,
      'STRIPE_ERROR'
    );
  }

  await pool.query(
    `INSERT INTO pending_topups (user_id, role, amount_cents, stripe_payment_intent_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (stripe_payment_intent_id) DO NOTHING`,
    [userId, role, amountCents, intent.id]
  );

  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    amountCents,
    role,
    requiresPayment: true,
    mock: Boolean(intent.mock),
  };
}

export async function completeTopUpFromPaymentIntent(paymentIntentId) {
  const { pool } = await import('../db/pool.js');
  const { rows } = await pool.query(
    `SELECT * FROM pending_topups
     WHERE stripe_payment_intent_id = $1 AND status = 'pending'
     FOR UPDATE`,
    [paymentIntentId]
  );
  const pending = rows[0];
  if (!pending) return { credited: false };

  const { wallet, entry } = await walletRepo.appendLedgerEntry({
    userId: pending.user_id,
    role: pending.role,
    type: 'top_up',
    amountCents: Number(pending.amount_cents),
    availableDeltaCents: Number(pending.amount_cents),
    description: 'Top-up via Stripe',
  });

  await pool.query(
    `UPDATE pending_topups SET status = 'completed', completed_at = NOW() WHERE id = $1`,
    [pending.id]
  );

  return { credited: true, wallet: mapWallet(wallet), entry: mapLedgerEntry(entry) };
}

/**
 * Client-side confirm after Payment Sheet (covers local/dev without webhook).
 */
export async function confirmTopUp(userId, paymentIntentId) {
  const intentId = String(paymentIntentId || '').trim();
  if (!intentId) {
    throw new AppError('paymentIntentId is required', 400, 'VALIDATION_ERROR');
  }

  const stripeService = await import('./stripe.service.js');
  const intent = await stripeService.retrievePaymentIntent(intentId);
  if (!intent) {
    throw new AppError('Payment intent not found', 404, 'NOT_FOUND');
  }

  const metaUser = intent.metadata?.userId;
  if (metaUser && metaUser !== userId) {
    throw new AppError('Payment does not belong to this user', 403, 'FORBIDDEN');
  }

  if (intent.status !== 'succeeded' && !intent.mock) {
    throw new AppError(
      `Payment is ${intent.status}. Complete card payment first.`,
      402,
      'PAYMENT_INCOMPLETE'
    );
  }

  const result = await completeTopUpFromPaymentIntent(intentId);
  if (!result.credited) {
    // Already credited via webhook — return current wallet.
    const wallet = await walletRepo.getWallet(userId);
    return {
      credited: false,
      alreadyCredited: true,
      ...mapWallet(wallet),
    };
  }

  return {
    credited: true,
    ...result.wallet,
    entry: result.entry,
  };
}

export function getPaymentsConfig() {
  // sync wrapper unused — prefer getPaymentsConfigAsync
  return {
    stripeEnabled: false,
    publishableKey: null,
    currency: 'USD',
    minimumWithdrawalCents: MINIMUM_WITHDRAWAL_CENTS,
  };
}

export async function getPaymentsConfigAsync() {
  const stripeService = await import('./stripe.service.js');
  const enabled = stripeService.isConfigured();
  return {
    stripeEnabled: enabled,
    publishableKey: enabled ? stripeService.publishableKey() : null,
    currency: 'USD',
    minimumWithdrawalCents: MINIMUM_WITHDRAWAL_CENTS,
  };
}

/**
 * Debit available balance; uses Stripe Connect transfer when account is linked.
 */
export async function withdraw(userId, role, amountCents) {
  const cents = Number(amountCents);
  if (!Number.isInteger(cents) || cents <= 0) {
    throw new AppError('Withdrawal amount must be a positive integer (cents)', 400, 'VALIDATION_ERROR');
  }
  if (cents < MINIMUM_WITHDRAWAL_CENTS) {
    throw new AppError(
      `Minimum withdrawal is $${(MINIMUM_WITHDRAWAL_CENTS / 100).toFixed(2)}`,
      400,
      'VALIDATION_ERROR'
    );
  }

  const stripeService = await import('./stripe.service.js');
  const { pool } = await import('../db/pool.js');
  const { rows } = await pool.query(
    `SELECT stripe_connect_account_id FROM users WHERE id = $1`,
    [userId]
  );
  const connectAccountId = rows[0]?.stripe_connect_account_id;

  // A linked payout account is mandatory. Without one there is no destination
  // for the funds, so we must never debit the wallet — block the withdrawal.
  if (!connectAccountId) {
    throw new AppError(
      'Link a payout account before withdrawing',
      403,
      'CONNECT_REQUIRED'
    );
  }

  // When Stripe is live, the linked account must have finished onboarding
  // (transfers/payouts enabled) before any money can move.
  const stripeLive = stripeService.isConfigured();
  if (stripeLive) {
    const account = await stripeService.getConnectAccount(connectAccountId);
    const ready = Boolean(account.charges_enabled || account.payouts_enabled);
    if (!ready) {
      throw new AppError(
        'Complete Stripe Connect onboarding before withdrawing',
        403,
        'CONNECT_NOT_READY'
      );
    }
  }

  // Debit first — appendLedgerEntry enforces the balance atomically, so we can
  // never transfer more than the user actually holds.
  let wallet;
  let entry;
  try {
    ({ wallet, entry } = await walletRepo.appendLedgerEntry({
      userId,
      role,
      type: 'withdrawal',
      amountCents: cents,
      availableDeltaCents: -cents,
      description: 'Withdrawal via Stripe Connect',
    }));
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') {
      throw new AppError('Amount exceeds available balance', 400, 'INSUFFICIENT_BALANCE');
    }
    throw err;
  }

  // Move the money. If the transfer fails, reverse the debit so the balance is
  // restored — the user is never charged for a payout that did not happen.
  if (stripeLive) {
    try {
      await stripeService.createConnectTransfer({
        amountCents: cents,
        destinationAccount: connectAccountId,
        metadata: { userId, role },
      });
    } catch (err) {
      await walletRepo.appendLedgerEntry({
        userId,
        role,
        type: 'refund',
        amountCents: cents,
        availableDeltaCents: cents,
        description: 'Withdrawal reversed — payout failed',
      }).catch(() => {});
      throw new AppError(
        err.message || 'Payout failed — your balance was not charged',
        502,
        'PAYOUT_FAILED'
      );
    }
  }

  return {
    ...mapWallet(wallet),
    entry: mapLedgerEntry(entry),
    connectAccountId,
  };
}

export async function getConnectStatus(userId) {
  const { pool } = await import('../db/pool.js');
  const stripeService = await import('./stripe.service.js');
  const { rows } = await pool.query(
    `SELECT stripe_connect_account_id FROM users WHERE id = $1`,
    [userId]
  );
  const accountId = rows[0]?.stripe_connect_account_id;
  if (!accountId) {
    return { linked: false, ready: false, accountId: null };
  }
  if (!stripeService.isConfigured()) {
    return { linked: true, ready: false, accountId, mock: true };
  }
  const account = await stripeService.getConnectAccount(accountId);
  return {
    linked: true,
    ready: Boolean(account.charges_enabled || account.payouts_enabled || account.mock),
    accountId,
    mock: Boolean(account.mock),
  };
}

export async function startConnectOnboarding(userId, { returnPath = '/wallet' } = {}) {
  const { pool } = await import('../db/pool.js');
  const stripeService = await import('./stripe.service.js');
  const { env } = await import('../config/env.js');

  const { rows } = await pool.query(`SELECT email, stripe_connect_account_id FROM users WHERE id = $1`, [
    userId,
  ]);
  const user = rows[0];
  if (!user) throw new AppError('User not found', 404, 'USER_NOT_FOUND');

  let accountId = user.stripe_connect_account_id;
  if (!accountId) {
    const account = await stripeService.createConnectAccount({
      email: user.email,
      userId,
    });
    accountId = account.id;
    await pool.query(
      `UPDATE users SET stripe_connect_account_id = $2, updated_at = NOW() WHERE id = $1`,
      [userId, accountId]
    );
  }

  const path = returnPath?.startsWith('/') ? returnPath : `/${returnPath || 'wallet'}`;
  const configured = String(env.appPublicUrl || '').replace(/\/$/, '');
  // Account Links require HTTPS except localhost; LAN HTTP IPs are rejected by Stripe.
  const base = /^https:\/\//i.test(configured) ||
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured)
    ? configured
    : 'http://172.31.234.196:3000';
  const returnUrl = `${base}${path}`;
  let link;
  try {
    link = await stripeService.createConnectAccountLink(accountId, {
      refreshUrl: `${returnUrl}?connect=refresh`,
      returnUrl: `${returnUrl}?connect=done`,
    });
  } catch (err) {
    throw new AppError(
      err.message || 'Could not start Stripe Connect onboarding',
      502,
      'STRIPE_ERROR'
    );
  }

  return {
    accountId,
    onboardingUrl: link.url,
    mock: Boolean(link.mock),
  };
}
