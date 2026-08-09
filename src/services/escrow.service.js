import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as stripeService from './stripe.service.js';

const PLATFORM_FEE_CENTS = 200; // $2 platform fee

function dollarsToCents(amount) {
  return Math.round(Number(amount) * 100);
}

/**
 * Lock sender funds in escrow when a bid/counter-offer is accepted.
 */
export async function holdEscrowForDelivery({
  senderId,
  deliveryPublicId,
  amountDollars,
  stripePaymentMethodId = null,
}) {
  const amountCents = dollarsToCents(amountDollars);
  if (amountCents <= 0) {
    throw new AppError('Invalid escrow amount', 400, 'VALIDATION_ERROR');
  }

  const existing = await walletRepo.getShipmentEscrow(deliveryPublicId);
  if (existing && existing.status === 'held') {
    return {
      shipmentId: deliveryPublicId,
      amountCents: Number(existing.amount_cents),
      status: 'held',
    };
  }

  let stripePaymentIntentId = null;
  if (stripeService.isConfigured() && stripePaymentMethodId) {
    const intent = await stripeService.createPaymentIntent({
      amountCents,
      customerId: senderId,
      metadata: { shipmentId: deliveryPublicId },
    });
    stripePaymentIntentId = intent.id;
  }

  if (!stripePaymentIntentId) {
    await walletRepo.appendLedgerEntry({
      userId: senderId,
      role: 'sender',
      type: 'escrow_hold',
      amountCents,
      availableDeltaCents: -amountCents,
      escrowDeltaCents: amountCents,
      description: `Escrow hold for ${deliveryPublicId}`,
      shipmentId: deliveryPublicId,
    });
  }

  await pool.query(
    `INSERT INTO shipment_escrows (shipment_id, user_id, role, amount_cents, status, stripe_payment_intent_id)
     VALUES ($1, $2, 'sender', $3, 'held', $4)
     ON CONFLICT (shipment_id) DO UPDATE SET
       amount_cents = EXCLUDED.amount_cents,
       status = 'held',
       stripe_payment_intent_id = COALESCE(EXCLUDED.stripe_payment_intent_id, shipment_escrows.stripe_payment_intent_id),
       updated_at = NOW()`,
    [deliveryPublicId, senderId, amountCents, stripePaymentIntentId]
  );

  try {
    await walletRepo.appendLedgerEntry({
      userId: senderId,
      role: 'sender',
      type: 'platform_fee',
      amountCents: PLATFORM_FEE_CENTS,
      availableDeltaCents: -PLATFORM_FEE_CENTS,
      description: `Platform fee for ${deliveryPublicId}`,
      shipmentId: deliveryPublicId,
    });
  } catch (err) {
    if (err.code !== 'INSUFFICIENT_BALANCE') throw err;
  }

  return { shipmentId: deliveryPublicId, amountCents, status: 'held', stripePaymentIntentId };
}

/**
 * Release escrow to traveler on NFC checkpoint 2 / delivery confirmation.
 */
export async function releaseEscrowForDelivery(deliveryPublicId, travelerId) {
  const escrow = await walletRepo.getShipmentEscrow(deliveryPublicId);
  if (!escrow || escrow.status !== 'held') {
    throw new AppError('No active escrow for this delivery', 400, 'NO_ESCROW');
  }

  const amountCents = Number(escrow.amount_cents);
  const senderId = escrow.user_id;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    await walletRepo.appendLedgerEntry({
      userId: senderId,
      role: 'sender',
      type: 'escrow_release',
      amountCents,
      escrowDeltaCents: -amountCents,
      description: `Escrow released for ${deliveryPublicId}`,
      shipmentId: deliveryPublicId,
    });

    await walletRepo.appendLedgerEntry({
      userId: travelerId,
      role: 'traveler',
      type: 'delivery_payout',
      amountCents,
      availableDeltaCents: amountCents,
      description: `Delivery payout for ${deliveryPublicId}`,
      shipmentId: deliveryPublicId,
    });

    await client.query(
      `UPDATE shipment_escrows SET status = 'released', updated_at = NOW() WHERE shipment_id = $1`,
      [deliveryPublicId]
    );

    await client.query('COMMIT');
    return { shipmentId: deliveryPublicId, amountCents, status: 'released' };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Refund escrow to sender on cancellation.
 */
export async function refundEscrowForDelivery(deliveryPublicId, reason = 'Cancellation refund') {
  const escrow = await walletRepo.getShipmentEscrow(deliveryPublicId);
  if (!escrow || !['held', 'frozen'].includes(escrow.status)) {
    return { refunded: false, reason: 'no_escrow' };
  }

  const amountCents = Number(escrow.amount_cents);
  const senderId = escrow.user_id;

  await walletRepo.appendLedgerEntry({
    userId: senderId,
    role: 'sender',
    type: 'refund',
    amountCents,
    availableDeltaCents: amountCents,
    escrowDeltaCents: -amountCents,
    description: reason,
    shipmentId: deliveryPublicId,
  });

  await pool.query(
    `UPDATE shipment_escrows SET status = 'refunded', updated_at = NOW() WHERE shipment_id = $1`,
    [deliveryPublicId]
  );

  return { refunded: true, amountCents };
}

/** Charge traveler $2 fee on NFC checkpoint 1. */
export async function chargeTravelerHandoffFee(travelerId, deliveryPublicId) {
  const feeCents = 200;
  try {
    await walletRepo.appendLedgerEntry({
      userId: travelerId,
      role: 'traveler',
      type: 'platform_fee',
      amountCents: feeCents,
      availableDeltaCents: -feeCents,
      description: `Handoff fee for ${deliveryPublicId}`,
      shipmentId: deliveryPublicId,
    });
    return { charged: true, feeCents };
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE') {
      throw new AppError('Traveler wallet needs at least $2 for handoff fee', 403, 'INSUFFICIENT_WALLET');
    }
    throw err;
  }
}
