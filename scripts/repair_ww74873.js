/**
 * One-off repair: WW-74873 stuck at posted after counter-offer accept
 * without escrow / bid_accepted transition.
 *
 * Credits sender wallet for the shortfall (repair top-up), then completes
 * the normal accept side-effects via holdEscrow + transitionDelivery.
 */
import 'dotenv/config';
import { pool } from '../src/db/pool.js';
import * as walletRepo from '../src/repositories/wallet.repository.js';
import * as escrowService from '../src/services/escrow.service.js';
import { transitionDelivery } from '../src/services/delivery_state.service.js';
import * as chatRepository from '../src/repositories/chat.repository.js';
import {
  senderPaysReceiverFee,
  senderPlatformFeeCents,
} from '../src/utils/fees.js';

const PUBLIC_ID = 'WW-74873';

async function main() {
  const { rows } = await pool.query(
    `SELECT * FROM deliveries WHERE public_id = $1`,
    [PUBLIC_ID]
  );
  const delivery = rows[0];
  if (!delivery) throw new Error(`${PUBLIC_ID} not found`);

  console.log('before', {
    status: delivery.status,
    traveler_id: delivery.traveler_id,
    bid_amount: delivery.bid_amount,
  });

  if (delivery.status !== 'posted') {
    console.log(`Skip: status is already ${delivery.status}`);
    await pool.end();
    return;
  }

  if (!delivery.traveler_id || !delivery.trip_id || !delivery.bid_amount) {
    throw new Error('Delivery missing traveler/trip/bid — cannot repair');
  }

  const amountDollars = Number(delivery.bid_amount);
  const amountCents = Math.round(amountDollars * 100);
  const paysReceiver = senderPaysReceiverFee(delivery);
  const senderFee = senderPlatformFeeCents(
    delivery.parcel_category,
    paysReceiver
  );
  const totalNeeded = amountCents + senderFee;

  const wallet = await walletRepo.getWallet(delivery.sender_id, 'sender');
  const available = Number(wallet.available_cents);
  const shortfall = totalNeeded - available;

  if (shortfall > 0) {
    console.log(`Top-up sender wallet by ${shortfall} cents (repair)`);
    await walletRepo.appendLedgerEntry({
      userId: delivery.sender_id,
      role: 'sender',
      type: 'top_up',
      amountCents: shortfall,
      availableDeltaCents: shortfall,
      description: `Repair top-up for ${PUBLIC_ID}`,
      shipmentId: PUBLIC_ID,
      hiddenFromHistory: true,
    });
  }

  await escrowService.holdEscrowForDelivery({
    senderId: delivery.sender_id,
    deliveryPublicId: PUBLIC_ID,
    amountDollars,
  });
  console.log('escrow held');

  const timerService = await import('../src/services/timer.service.js');
  await timerService.scheduleReceiverPayment(delivery.id);

  await transitionDelivery({
    deliveryId: delivery.id,
    toStatus: 'bid_accepted',
    actorId: delivery.sender_id,
    note: 'Repair: complete counter-offer accept after escrow failure',
    extraSets: {
      traveler_id: delivery.traveler_id,
      trip_id: delivery.trip_id,
      bid_amount: amountDollars,
      chat_unlocked: false,
    },
  });
  console.log('status → bid_accepted');

  await chatRepository.ensureConversation({
    deliveryId: delivery.id,
    participantAId: delivery.sender_id,
    participantBId: delivery.traveler_id,
    threadType: 'sender_traveler',
    unlocked: false,
  });
  console.log('sender_traveler chat ensured');

  const after = await pool.query(
    `SELECT public_id, status, matched_at, bid_amount, traveler_id FROM deliveries WHERE public_id = $1`,
    [PUBLIC_ID]
  );
  const escrow = await pool.query(
    `SELECT shipment_id, amount_cents, status FROM shipment_escrows WHERE shipment_id = $1`,
    [PUBLIC_ID]
  );
  console.log('after', after.rows[0]);
  console.log('escrow', escrow.rows[0]);

  await pool.end();
}

main().catch(async (err) => {
  console.error('repair failed:', err?.message || err);
  console.error(err);
  try {
    await pool.end();
  } catch (_) {}
  process.exit(1);
});
