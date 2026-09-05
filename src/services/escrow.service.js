import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import * as walletRepo from '../repositories/wallet.repository.js';
import * as stripeService from './stripe.service.js';
import {
  resolveSenderPlatformFeeCents,
  receiverPlatformFeeCents,
  senderPaysReceiverFee,
  travelerHandoffFeeCents,
  travelerPlatformFeeCents,
  platformFeeDescription,
} from '../utils/fees.js';

function dollarsToCents(amount) {
  return Math.round(Number(amount) * 100);
}

function formatUsdFromCents(cents) {
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

function platformFeeRoute(role, shipmentId) {
  const id = shipmentId ? String(shipmentId) : '';
  if (role === 'traveler') {
    return id ? `/shipment/${id}?traveler=true` : '/traveler-deliveries';
  }
  if (role === 'receiver') {
    return id ? `/receiver-parcel/${id}` : '/receiver-home';
  }
  return id ? `/track/${id}` : '/wallet?role=sender';
}

/**
 * JazzCash-style alert after a platform fee is collected from wallet and/or card.
 */
async function notifyPlatformFeeCharged({
  userId,
  role,
  amountCents,
  walletCents,
  cardCents,
  shipmentId,
}) {
  const total = formatUsdFromCents(amountCents);
  const shipmentLabel = shipmentId ? String(shipmentId) : 'your delivery';
  const fromWallet = Number(walletCents) > 0;
  const fromCard = Number(cardCents) > 0;

  let body;
  if (fromWallet && fromCard) {
    body =
      `${total} platform fee paid for ${shipmentLabel} ` +
      `(${formatUsdFromCents(walletCents)} from wallet + ${formatUsdFromCents(cardCents)} from card).`;
  } else if (fromCard) {
    body = `${total} platform fee deducted from your card for ${shipmentLabel}.`;
  } else {
    body = `${total} platform fee deducted from your wallet for ${shipmentLabel}.`;
  }

  try {
    const notificationCreateService = await import('./notification_create.service.js');
    await notificationCreateService.createNotification({
      userId: String(userId),
      role: String(role || 'sender'),
      type: 'platformFee',
      title: 'Platform fee paid',
      body,
      route: platformFeeRoute(role, shipmentId),
    });
  } catch (err) {
    console.warn('[escrow] platform fee notification failed:', err?.message || err);
  }
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
  /** Force notification wording: 'wallet' | 'card' | 'mixed' | null (detect). */
  paidVia = null,
}) {
  const cents = Number(amountCents);
  if (cents <= 0) return { charged: false, amountCents: 0 };

  const walletBeforeTopUp = await walletRepo.getWallet(userId);
  const availableBeforeTopUp = Number(walletBeforeTopUp.available_cents);
  let cardCents = 0;

  if (paymentIntentId) {
    const walletService = await import('./wallet.service.js');
    await walletService.confirmTopUp(userId, paymentIntentId);
    // Card covered whatever the wallet was short before this top-up.
    cardCents = Math.max(0, cents - availableBeforeTopUp);
  }

  const wallet = await walletRepo.getWallet(userId);
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

    // Dev / mock mode (or booking path with allowPaymentRequired=false):
    // invent card funds so fee collection can finish without Payment Sheet.
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
    cardCents += shortfall;
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

  if (type === 'platform_fee') {
    let notifyWallet = Math.max(0, cents - cardCents);
    let notifyCard = Math.min(cardCents, cents);
    if (paidVia === 'card') {
      notifyWallet = 0;
      notifyCard = cents;
    } else if (paidVia === 'wallet') {
      notifyWallet = cents;
      notifyCard = 0;
    } else if (paidVia === 'mixed' && notifyCard <= 0) {
      notifyCard = Math.max(1, Math.round(cents / 2));
      notifyWallet = cents - notifyCard;
    }
    void notifyPlatformFeeCharged({
      userId,
      role,
      amountCents: cents,
      walletCents: notifyWallet,
      cardCents: notifyCard,
      shipmentId,
    });
  }

  return {
    charged: true,
    amountCents: cents,
    walletCents: Math.max(0, cents - cardCents),
    cardCents: Math.min(cardCents, cents),
  };
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
  paymentMethod = 'stripe',
}) {
  const amountCents = dollarsToCents(amountDollars);
  if (amountCents <= 0) {
    throw new AppError('Invalid escrow amount', 400, 'VALIDATION_ERROR');
  }

  const existing = await walletRepo.getShipmentEscrow(deliveryPublicId);
  const delivery = await getDeliveryRow(deliveryPublicId);
  if (!delivery) {
    throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  }

  if (existing && existing.status === 'held') {
    // Resume path: escrow already held — still collect any missing party fees.
    try {
      const senderFee = resolveSenderPlatformFeeCents(delivery);
      const senderFeeAlreadyPaid = await hasPlatformFeePaid(
        senderId,
        'sender',
        deliveryPublicId,
        'Platform fee'
      );
      if (!senderFeeAlreadyPaid && senderFee > 0) {
        await chargeWalletOrCard({
          userId: senderId,
          role: 'sender',
          amountCents: senderFee,
          description: platformFeeDescription(deliveryPublicId),
          shipmentId: deliveryPublicId,
          allowPaymentRequired: false,
        });
      }
      await chargeBookingPlatformFees({ delivery, deliveryPublicId });
    } catch (err) {
      await refundEscrowForDelivery(deliveryPublicId, 'Booking failed — escrow reversed').catch(() => {});
      await refundPlatformFeesForDelivery(
        deliveryPublicId,
        'Booking failed — platform fee reversed'
      ).catch(() => {});
      throw err;
    }
    return {
      shipmentId: deliveryPublicId,
      amountCents: Number(existing.amount_cents),
      status: 'held',
    };
  }

  const senderFee = resolveSenderPlatformFeeCents(delivery);
  const senderFeeAlreadyPaid = await hasPlatformFeePaid(
    senderId,
    'sender',
    deliveryPublicId,
    'Platform fee'
  );
  const totalNeeded =
    amountCents + (senderFeeAlreadyPaid ? 0 : senderFee);

  let stripePaymentIntentId = paymentIntentId || null;

  if (paymentMethod === 'stripe') {
    // Stripe Pay Now: charge the full escrow + sender fee on card only.
    // The PaymentIntent is confirmed into the wallet, then the same amount is
    // debited for escrow/fees — prior wallet balance is left unchanged.
    stripePaymentIntentId = await requireFullStripePayment({
      senderId,
      paymentIntentId,
      totalNeeded,
      deliveryPublicId,
    });
  } else {
    if (paymentIntentId) {
      const walletService = await import('./wallet.service.js');
      await walletService.confirmTopUp(senderId, paymentIntentId);
    }

    const wallet = await walletRepo.getWallet(senderId);
    const available = Number(wallet.available_cents);
    const shortfall = totalNeeded - available;

    if (shortfall > 0) {
      throw new AppError(
        'Insufficient wallet balance. Add funds or pay with card.',
        403,
        'INSUFFICIENT_WALLET',
        {
          amountCents: totalNeeded,
          availableCents: available,
          shortfallCents: shortfall,
          role: 'sender',
          shipmentId: deliveryPublicId,
        }
      );
    }
  }

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

    if (!senderFeeAlreadyPaid) {
      await chargeWalletOrCard({
        userId: senderId,
        role: 'sender',
        amountCents: senderFee,
        description: platformFeeDescription(deliveryPublicId),
        shipmentId: deliveryPublicId,
        allowPaymentRequired: false,
        // Stripe Pay Now topped up the full amount from card first.
        paidVia: paymentMethod === 'stripe' ? 'card' : null,
      });
    }

    // All three platform fees are collected at Pay Now (wallet first, then card).
    // If traveler or receiver cannot pay, reverse escrow + any fees and abort booking.
    await chargeBookingPlatformFees({
      delivery,
      deliveryPublicId,
    });

    return { shipmentId: deliveryPublicId, amountCents, status: 'held', stripePaymentIntentId };
  } catch (err) {
    await refundEscrowForDelivery(deliveryPublicId, 'Booking failed — escrow reversed').catch(() => {});
    await refundPlatformFeesForDelivery(
      deliveryPublicId,
      'Booking failed — platform fee reversed'
    ).catch(() => {});
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

async function getPaymentIntentAmountCents(paymentIntentId) {
  if (!paymentIntentId) return 0;
  try {
    const intent = await stripeService.retrievePaymentIntent(paymentIntentId);
    if (!intent) return 0;
    if (intent.status !== 'succeeded' && !intent.mock) return 0;
    return Number(intent.amount) || Number(intent.metadata?.amountCents) || 0;
  } catch {
    return 0;
  }
}

/**
 * Stripe Pay Now must cover the full escrow + sender fee amount on card.
 * Confirms the PaymentIntent into the wallet only when it already covers
 * totalNeeded; otherwise opens a Payment Sheet for the full amount.
 */
async function requireFullStripePayment({
  senderId,
  paymentIntentId,
  totalNeeded,
  deliveryPublicId,
}) {
  const walletService = await import('./wallet.service.js');

  if (paymentIntentId) {
    await walletService.confirmTopUp(senderId, paymentIntentId);
    const paidCents = await getPaymentIntentAmountCents(paymentIntentId);
    if (paidCents >= totalNeeded) {
      return paymentIntentId;
    }
  }

  if (stripeService.isConfigured()) {
    const payment = await createEscrowShortfallIntent(
      senderId,
      totalNeeded,
      deliveryPublicId
    );
    throw new AppError(
      'Complete card payment for the full escrow and fee amount.',
      402,
      'PAYMENT_REQUIRED',
      {
        paymentIntentId: payment.paymentIntentId,
        clientSecret: payment.clientSecret,
        amountCents: totalNeeded,
        role: 'sender',
        purpose: 'escrow_shortfall',
        shipmentId: deliveryPublicId,
      }
    );
  }

  // Dev / mock mode: invent card funds for the full amount (no Stripe keys).
  await walletRepo.appendLedgerEntry({
    userId: senderId,
    role: 'sender',
    type: 'top_up',
    amountCents: totalNeeded,
    availableDeltaCents: totalNeeded,
    description: 'Card fallback for escrow',
    shipmentId: deliveryPublicId,
    hiddenFromHistory: true,
  });
  return paymentIntentId || null;
}

/**
 * Charge traveler + receiver platform fees at Pay Now (sender fee already charged above).
 * Wallet first; shortfall is covered from that user's card (same chargeWalletOrCard path).
 */
async function chargeBookingPlatformFees({ delivery, deliveryPublicId }) {
  const travelerId = delivery.traveler_id || null;
  const receiverId = delivery.receiver_id || null;
  const category = delivery.parcel_category || 'documents';
  const paysReceiver = senderPaysReceiverFee(delivery);

  if (!travelerId) {
    throw new AppError(
      'Traveler is not assigned. Platform fees could not be collected; booking was not created.',
      400,
      'TRAVELER_REQUIRED'
    );
  }
  if (!receiverId) {
    throw new AppError(
      'Receiver has not accepted yet. Platform fees could not be collected; booking was not created.',
      400,
      'RECEIVER_REQUIRED'
    );
  }

  const travelerFee = travelerPlatformFeeCents(category);
  const travelerAlreadyPaid = await travelerHandoffAlreadyPaid(travelerId, deliveryPublicId);
  if (!travelerAlreadyPaid && travelerFee > 0) {
    try {
      await chargeWalletOrCard({
        userId: travelerId,
        role: 'traveler',
        amountCents: travelerFee,
        description: platformFeeDescription(deliveryPublicId),
        shipmentId: deliveryPublicId,
        allowPaymentRequired: false,
      });
    } catch (err) {
      throw new AppError(
        'Traveler platform fee could not be collected. Booking was not created.',
        err.statusCode || 403,
        err.code === 'PAYMENT_REQUIRED' ? 'PAYMENT_REQUIRED' : 'INSUFFICIENT_WALLET',
        { ...(err.details || {}), role: 'traveler', shipmentId: deliveryPublicId }
      );
    }
  }

  const receiverFee = receiverPlatformFeeCents(category, paysReceiver);
  const receiverAlreadyPaid = await hasPlatformFeePaid(
    receiverId,
    'receiver',
    deliveryPublicId,
    'Platform fee'
  );
  if (!receiverAlreadyPaid && receiverFee > 0) {
    try {
      await chargeWalletOrCard({
        userId: receiverId,
        role: 'receiver',
        amountCents: receiverFee,
        description: platformFeeDescription(deliveryPublicId),
        shipmentId: deliveryPublicId,
        allowPaymentRequired: false,
      });
    } catch (err) {
      throw new AppError(
        'Receiver platform fee could not be collected. Booking was not created.',
        err.statusCode || 403,
        err.code === 'PAYMENT_REQUIRED' ? 'PAYMENT_REQUIRED' : 'INSUFFICIENT_WALLET',
        { ...(err.details || {}), role: 'receiver', shipmentId: deliveryPublicId }
      );
    }
  }

  await pool.query(
    `UPDATE deliveries
     SET receiver_paid_at = COALESCE(receiver_paid_at, NOW()),
         receiver_fee_cents = $2,
         receiver_payment_due_at = NULL,
         updated_at = NOW()
     WHERE public_id = $1`,
    [deliveryPublicId, receiverFee]
  );
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

/**
 * Refund net platform/handoff fees charged on a shipment (all roles).
 * Used when booking cancel happens ≥24h before travel.
 */
export async function refundPlatformFeesForDelivery(
  deliveryPublicId,
  reason = 'Platform fee refund on cancellation'
) {
  const { rows } = await pool.query(
    `SELECT user_id, role,
       COALESCE(SUM(CASE WHEN type = 'platform_fee' THEN amount_cents ELSE 0 END), 0) AS charged_cents,
       COALESCE(SUM(
         CASE
           WHEN type = 'refund'
             AND (description ILIKE '%platform fee%' OR description ILIKE '%handoff fee%')
           THEN amount_cents
           ELSE 0
         END
       ), 0) AS refunded_cents
     FROM wallet_ledger
     WHERE shipment_id = $1
     GROUP BY user_id, role`,
    [deliveryPublicId]
  );

  const entries = [];
  for (const row of rows) {
    const net = Number(row.charged_cents) - Number(row.refunded_cents);
    if (net <= 0) continue;

    await walletRepo.appendLedgerEntry({
      userId: row.user_id,
      role: row.role,
      type: 'refund',
      amountCents: net,
      availableDeltaCents: net,
      description: `${reason} for ${deliveryPublicId}`,
      shipmentId: deliveryPublicId,
    });
    entries.push({
      userId: row.user_id,
      role: row.role,
      amountCents: net,
    });
  }

  return { refunded: entries.length > 0, entries };
}

/** Hold escrow during an open dispute (no payout until admin resolves). */
export async function freezeEscrowForDelivery(deliveryPublicId) {
  const { rowCount } = await pool.query(
    `UPDATE shipment_escrows
     SET status = 'frozen', updated_at = NOW()
     WHERE shipment_id = $1 AND status = 'held'`,
    [deliveryPublicId]
  );
  return { frozen: rowCount > 0 };
}

async function travelerHandoffAlreadyPaid(travelerId, deliveryPublicId) {
  return (
    (await hasPlatformFeePaid(travelerId, 'traveler', deliveryPublicId, 'Platform fee')) ||
    (await hasPlatformFeePaid(travelerId, 'traveler', deliveryPublicId, 'Handoff fee'))
  );
}

/**
 * Ensures the traveler can cover the CP1 fee on their own device (402 if short)
 * without charging until both parties have matched.
 */
export async function assertTravelerCanPayHandoffFee(
  travelerId,
  deliveryPublicId,
  parcelCategory,
  { paymentIntentId = null } = {}
) {
  if (paymentIntentId) {
    const walletService = await import('./wallet.service.js');
    await walletService.confirmTopUp(travelerId, paymentIntentId);
  }
  if (await travelerHandoffAlreadyPaid(travelerId, deliveryPublicId)) return;

  const feeCents = travelerHandoffFeeCents(parcelCategory);
  const wallet = await walletRepo.getWallet(travelerId);
  const available = Number(wallet.available_cents);
  const shortfall = feeCents - available;
  if (shortfall <= 0) return;

  if (!stripeService.isConfigured()) return;

  const walletService = await import('./wallet.service.js');
  const payment = await walletService.createTopUpPaymentIntent(
    travelerId,
    'traveler',
    shortfall
  );
  throw new AppError(
    'Card payment required to cover wallet shortfall',
    402,
    'PAYMENT_REQUIRED',
    {
      paymentIntentId: payment.paymentIntentId,
      clientSecret: payment.clientSecret,
      amountCents: shortfall,
      role: 'traveler',
      purpose: 'escrow_shortfall',
    }
  );
}

/**
 * Traveler platform fee ($2 documents / $4 objects).
 * Normally collected at Pay Now; kept as an idempotent safety net at NFC CP1.
 * Safe to call again (skips if already paid).
 */
export async function chargeTravelerHandoffFee(
  travelerId,
  deliveryPublicId,
  parcelCategory,
  { paymentIntentId = null, allowPaymentRequired = true } = {}
) {
  const alreadyPaid = await travelerHandoffAlreadyPaid(travelerId, deliveryPublicId);
  if (alreadyPaid) {
    return { charged: false, reason: 'already_paid' };
  }

  if (paymentIntentId) {
    const walletService = await import('./wallet.service.js');
    await walletService.confirmTopUp(travelerId, paymentIntentId);
  }

  const feeCents = travelerHandoffFeeCents(parcelCategory);
  await chargeWalletOrCard({
    userId: travelerId,
    role: 'traveler',
    amountCents: feeCents,
    description: platformFeeDescription(deliveryPublicId),
    shipmentId: deliveryPublicId,
    allowPaymentRequired,
  });
  return { charged: true, feeCents };
}
