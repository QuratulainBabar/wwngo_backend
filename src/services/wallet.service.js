import { AppError } from '../utils/errors.js';
import * as walletRepo from '../repositories/wallet.repository.js';

export const MINIMUM_WITHDRAWAL_CENTS = 1000;

/** One-time credit after identity verification — $10 per role. */
export const KYC_WELCOME_CREDIT_CENTS = 1000;
export const KYC_WELCOME_DESCRIPTION =
  'Welcome credit after identity verification';
const KYC_WELCOME_ROLES = ['sender', 'traveler', 'receiver'];

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
    role: row.role,
    availableCents: Number(row.available_cents),
    escrowCents: Number(row.escrow_cents),
    currency: 'USD',
    minimumWithdrawalCents: MINIMUM_WITHDRAWAL_CENTS,
  };
}

/**
 * Wallet summary for the authenticated user + role.
 * Always returns zeros when no activity exists (new user).
 */
export async function getWalletSummary(userId, role, { recentLimit = 6 } = {}) {
  const wallet = await walletRepo.getWallet(userId, role);
  const recent = await walletRepo.listLedgerEntries(userId, role, {
    limit: recentLimit,
    includeHidden: false,
  });

  return {
    ...mapWallet(wallet),
    recentTransactions: recent.map(mapLedgerEntry),
  };
}

export async function listTransactions(userId, role, { limit = 50 } = {}) {
  await walletRepo.ensureWallet(userId, role);
  const rows = await walletRepo.listLedgerEntries(userId, role, {
    limit,
    includeHidden: false,
  });
  return {
    transactions: rows.map(mapLedgerEntry),
  };
}

export async function getShipmentEscrow(userId, shipmentId) {
  const row = await walletRepo.getShipmentEscrow(shipmentId);
  if (!row || row.user_id !== userId) {
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
 * Idempotent: credit $10 available to sender, traveler, and receiver wallets
 * after KYC approval. Safe to call from Continue-to-app and KYC sync/webhook.
 */
export async function grantKycWelcomeCredit(userId) {
  if (!userId) {
    throw new AppError('User not found', 404, 'USER_NOT_FOUND');
  }

  const alreadyGranted = await walletRepo.hasLedgerDescription(
    userId,
    KYC_WELCOME_DESCRIPTION
  );

  if (!alreadyGranted) {
    for (const role of KYC_WELCOME_ROLES) {
      await walletRepo.appendLedgerEntry({
        userId,
        role,
        type: 'top_up',
        amountCents: KYC_WELCOME_CREDIT_CENTS,
        availableDeltaCents: KYC_WELCOME_CREDIT_CENTS,
        description: KYC_WELCOME_DESCRIPTION,
      });
    }
  }

  const wallets = {};
  for (const role of KYC_WELCOME_ROLES) {
    wallets[role] = mapWallet(await walletRepo.getWallet(userId, role));
  }

  return {
    granted: !alreadyGranted,
    alreadyGranted,
    amountCents: KYC_WELCOME_CREDIT_CENTS,
    roles: KYC_WELCOME_ROLES,
    wallets,
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
  };
}

/**
 * Debit available balance (mock Stripe Connect withdrawal).
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

  try {
    const { wallet, entry } = await walletRepo.appendLedgerEntry({
      userId,
      role,
      type: 'withdrawal',
      amountCents: cents,
      availableDeltaCents: -cents,
      description: 'Withdrawal via Stripe Connect',
    });
    return {
      ...mapWallet(wallet),
      entry: mapLedgerEntry(entry),
    };
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') {
      throw new AppError('Amount exceeds available balance', 400, 'INSUFFICIENT_BALANCE');
    }
    throw err;
  }
}
