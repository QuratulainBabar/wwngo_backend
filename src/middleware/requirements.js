import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import {
  minWalletCentsForRole,
  minWalletCentsForSenderCreate,
} from '../utils/fees.js';

export const MIN_WALLET_RESERVE_CENTS = 200; // $2.00 default (sender/receiver)

export async function requireKycApproved(req, _res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT kyc_status, account_status FROM users WHERE id = $1`,
      [req.user.id]
    );
    const user = rows[0];
    if (!user) return next(new AppError('User not found', 404, 'USER_NOT_FOUND'));
    if (user.account_status === 'suspended') {
      return next(new AppError('Your account has been suspended', 403, 'ACCOUNT_SUSPENDED'));
    }
    if (user.kyc_status !== 'approved') {
      return next(
        new AppError(
          'Identity verification must be approved before this action',
          403,
          'KYC_REQUIRED'
        )
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}

export function requireWalletMinimum(role = 'traveler') {
  return async (req, _res, next) => {
    try {
      const minCents = minWalletCentsForRole(role);
      const wallet = await walletRepo.getWallet(req.user.id, role);
      if (Number(wallet.available_cents) < minCents) {
        return next(
          new AppError(
            `Wallet must have at least $${(minCents / 100).toFixed(2)} available`,
            403,
            'INSUFFICIENT_WALLET'
          )
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Sender create-time wallet check only — never debit platform fees here.
 * Document/object fees ($2/$4, or $3/$6 when paying 100%) are collected at Pay Now.
 */
export function requireSenderWalletForDeliveryCreate(req, _res, next) {
  (async () => {
    try {
      const minCents = minWalletCentsForSenderCreate();
      const wallet = await walletRepo.getWallet(req.user.id, 'sender');
      if (Number(wallet.available_cents) < minCents) {
        return next(
          new AppError(
            `Wallet must have at least $${(minCents / 100).toFixed(2)} available to post this delivery`,
            403,
            'INSUFFICIENT_WALLET'
          )
        );
      }
      next();
    } catch (err) {
      next(err);
    }
  })();
}

export async function requireFullyVerified(req, _res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT email_verified, phone_verified FROM users WHERE id = $1`,
      [req.user.id]
    );
    const user = rows[0];
    if (!user?.email_verified || !user?.phone_verified) {
      return next(
        new AppError(
          'Both email and phone must be verified before transactions',
          403,
          'VERIFICATION_REQUIRED'
        )
      );
    }
    next();
  } catch (err) {
    next(err);
  }
}

export async function requireAdmin(req, _res, next) {
  try {
    const { rows } = await pool.query(
      `SELECT is_admin FROM users WHERE id = $1`,
      [req.user.id]
    );
    if (!rows[0]?.is_admin) {
      return next(new AppError('Admin access required', 403, 'FORBIDDEN'));
    }
    next();
  } catch (err) {
    next(err);
  }
}
