import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as stripeService from './stripe.service.js';
import {
  senderPaysReceiverFee,
  senderPlatformFeeCents,
  receiverPlatformFeeCents,
  travelerPlatformFeeCents,
  travelerHandoffFeeCents,
} from '../utils/fees.js';

function dollarsToCents(amount) {
  return Math.round(Number(amount) * 100);
}

/**
 * Charge wallet. When Stripe is configured and balance is short, creates a
 * PaymentIntent and throws PAYMENT_REQUIRED (client completes Payment Sheet).
 * Without Stripe keys, uses mock card ledger credit (dev/E2E).
 */
export async function chargeWalletOrCard({
  userId,
  role,
  amountCents,
  type = 'platform_fee',
  description,
  shipmentId = null,
  paymentIntentId = null,
  allowPaymentRequired = true,
}) {
  const cents = Number(amountCents);
  if (cents <= 0) return { charged: false, amountCents: 0 };

  if (paymentIntentId) {
    const walletService = await import('./wallet.service.js');
    await walletService.confirmTopUp(userId, paymentIntentId);
  }

  const wallet = await walletRepo.getWallet(userId, role);
  const available = Number(wallet.available_cents);
  const shortfall = cents - available;

  if (shortfall > 0) {
    if (stripeService.isConfigured() && allowPaymentRequired) {
      const walletService = await import('./wallet.service.js');
      const payment = await walletService.createTopUpPaymentIntent(
        userId,
        role,
        shortfall
      );
      // Retarget pending metadata purpose for escrow shortfall webhook.
      throw new AppError(
        'Card payment required to cover wallet shortfall',
        402,
        'PAYMENT_REQUIRED',
        {
          paymentIntentId: payment.paymentIntentId,
          clientSecret: payment.clientSecret,
          amountCents: shortfall,
          role,
          purpose: 'escrow_shortfall',
        }
      );
    }

    // Dev / mock mode: invent card funds so E2E still works without Stripe keys.
    await walletRepo.appendLedgerEntry({
      userId,
      role,
      type: 'top_up',
      amountCents: shortfall,
      availableDeltaCents: shortfall,
      description: 'Card fallback for platform fee',
      shipmentId,
      hiddenFromHistory: true,
    });
  }

  await walletRepo.appendLedgerEntry({
    userId,
    role,
    type,
    amountCents: cents,
    availableDeltaCents: -cents,
    description,
    shipmentId,
  });

  return { charged: true, amountCents: cents };
}

async function getDeliveryRow(publicId) {
  const { rows } = await pool.query(`SELECT * FROM deliveries WHERE public_id = $1`, [publicId]);
  return rows[0] || null;
}

async function hasPlatformFeePaid(userId, role, shipmentId, label) {
  const desc = `${label} for ${shipmentId}`;
  return walletRepo.hasLedgerDescription(userId, desc);
}

/**
 * Lock sender funds in escrow when a bid/counter-offer is accepted.
 * With Stripe configured, shortfalls require Payment Sheet (PAYMENT_REQUIRED).
 */
export async function holdEscrowForDelivery({
  senderId,
  deliveryPublicId,
  amountDollars,
  paymentIntentId = null,
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

  const delivery = await getDeliveryRow(deliveryPublicId);
  if (!delivery) {
    throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  }

  const paysReceiver = senderPaysReceiverFee(delivery);
  const category = delivery.parcel_category;
  const senderFee = senderPlatformFeeCents(category, paysReceiver);
  const totalNeeded = amountCents + senderFee;

  if (paymentIntentId) {
    const walletService = await import('./wallet.service.js');
    await walletService.confirmTopUp(senderId, paymentIntentId);
  }

  const wallet = await walletRepo.getWallet(senderId, 'sender');
  const available = Number(wallet.available_cents);
  const shortfall = totalNeeded - available;

  if (shortfall > 0) {
    if (stripeService.isConfigured()) {
      const walletService = await import('./wallet.service.js');
      // Patch purpose in createTopUpPaymentIntent metadata via dedicated helper
      const payment = await createEscrowShortfallIntent(
        senderId,
        shortfall,
        deliveryPublicId
      );
      throw new AppError(
        'Insufficient wallet balance. Complete card payment to fund escrow and fees.',
        402,
        'PAYMENT_REQUIRED',
        {
          paymentIntentId: payment.paymentIntentId,
          clientSecret: payment.clientSecret,
          amountCents: shortfall,
          role: 'sender',
          purpose: 'escrow_shortfall',
          shipmentId: deliveryPublicId,
        }
      );
    }

    await walletRepo.appendLedgerEntry({
      userId: senderId,
      role: 'sender',
      type: 'top_up',
      amountCents: shortfall,
      availableDeltaCents: shortfall,
      description: 'Card fallback for escrow',
      shipmentId: deliveryPublicId,
      hiddenFromHistory: true,
    });
  }

  let stripePaymentIntentId = paymentIntentId || null;
  try {
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

    const receiverFee = receiverPlatformFeeCents(category, paysReceiver);
    const travelerId = delivery.traveler_id;
    const receiverId = delivery.receiver_id;
    const travelerFee = travelerId ? travelerPlatformFeeCents(category) : 0;

    await chargeWalletOrCard({
      userId: senderId,
      role: 'sender',
      amountCents: senderFee,
      description: `Platform fee for ${deliveryPublicId}`,
      shipmentId: deliveryPublicId,
      allowPaymentRequired: false,
    });

    if (receiverId && receiverFee > 0) {
      await chargeWalletOrCard({
        userId: receiverId,
        role: 'receiver',
        amountCents: receiverFee,
        description: `Platform fee for ${deliveryPublicId}`,
        shipmentId: deliveryPublicId,
        allowPaymentRequired: false,
      });
    }

    if (travelerId && travelerFee > 0) {
      await chargeWalletOrCard({
        userId: travelerId,
        role: 'traveler',
        amountCents: travelerFee,
        description: `Platform fee for ${deliveryPublicId}`,
        shipmentId: deliveryPublicId,
        allowPaymentRequired: false,
      });
    }

    return { shipmentId: deliveryPublicId, amountCents, status: 'held', stripePaymentIntentId };
  } catch (err) {
    await refundEscrowForDelivery(deliveryPublicId, 'Booking failed — escrow reversed').catch(() => {});
    if (err.code === 'INSUFFICIENT_BALANCE') {
      throw new AppError(
        'Insufficient wallet balance. Platform fees could not be collected; booking was not created.',
        403,
        'INSUFFICIENT_WALLET'
      );
    }
    throw err;
  }
}

async function createEscrowShortfallIntent(userId, amountCents, shipmentId) {
  const { pool } = await import('../db/pool.js');
  const intent = await stripeService.createPaymentIntent({
    amountCents,
    customerId: userId,
    metadata: {
      purpose: 'escrow_shortfall',
      userId,
      role: 'sender',
      amountCents: String(amountCents),
      shipmentId: shipmentId || '',
    },
  });

  await pool.query(
    `INSERT INTO pending_topups (user_id, role, amount_cents, stripe_payment_intent_id)
     VALUES ($1, 'sender', $2, $3)
     ON CONFLICT (stripe_payment_intent_id) DO NOTHING`,
    [userId, amountCents, intent.id]
  );

  return {
    paymentIntentId: intent.id,
    clientSecret: intent.client_secret,
    amountCents,
    role: 'sender',
    requiresPayment: true,
    mock: Boolean(intent.mock),
  };
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

/** Traveler handoff fee at NFC checkpoint 1 (skip if already paid at booking). */
export async function chargeTravelerHandoffFee(travelerId, deliveryPublicId, parcelCategory) {
  const alreadyPaid = await hasPlatformFeePaid(
    travelerId,
    'traveler',
    deliveryPublicId,
    'Platform fee'
  );
  if (alreadyPaid) {
    return { charged: false, reason: 'already_paid' };
  }

  const feeCents = travelerHandoffFeeCents(parcelCategory);
  try {
    await chargeWalletOrCard({
      userId: travelerId,
      role: 'traveler',
      amountCents: feeCents,
      description: `Handoff fee for ${deliveryPublicId}`,
      shipmentId: deliveryPublicId,
    });
    return { charged: true, feeCents };
  } catch (err) {
    if (err.code === 'INSUFFICIENT_BALANCE' || err.code === 'INSUFFICIENT_WALLET') {
      throw new AppError('Traveler wallet needs sufficient balance for handoff fee', 403, 'INSUFFICIENT_WALLET');
    }
    throw err;
  }
}
