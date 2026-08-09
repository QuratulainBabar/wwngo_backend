import { pool } from '../db/pool.js';
import * as escrowService from './escrow.service.js';
import * as deliveryState from './delivery_state.service.js';
import * as notificationCreateService from './notification_create.service.js';

const RECEIVER_PAYMENT_HOURS = 2;

/** Set receiver payment deadline when parcel is posted / receiver linked. */
export async function scheduleReceiverPayment(deliveryId) {
  const dueAt = new Date(Date.now() + RECEIVER_PAYMENT_HOURS * 60 * 60 * 1000);
  await pool.query(
    `UPDATE deliveries
     SET receiver_payment_due_at = $2,
         status = CASE WHEN status = 'posted' THEN 'waiting_receiver'::delivery_status ELSE status END,
         updated_at = NOW()
     WHERE id = $1`,
    [deliveryId, dueAt]
  );
}

/** Traveler accept timer: 2h if departure within 24h, else 12h. */
export function travelerAcceptDeadline(travelDate) {
  const departure = new Date(travelDate);
  const now = new Date();
  const hoursUntil = (departure - now) / (60 * 60 * 1000);
  const acceptHours = hoursUntil <= 24 ? 2 : 12;
  return new Date(now.getTime() + acceptHours * 60 * 60 * 1000);
}

export async function scheduleTravelerAcceptDeadline(requestId, travelDate) {
  const dueAt = travelerAcceptDeadline(travelDate);
  await pool.query(
    `UPDATE trip_sender_requests SET accept_due_at = $2, updated_at = NOW() WHERE id = $1`,
    [requestId, dueAt]
  );
  return dueAt;
}

export async function processExpiredTimers() {
  const results = { receiverPayments: 0, travelerAccepts: 0, refunds: 0 };

  const { rows: overdueReceiver } = await pool.query(
    `SELECT id, public_id, sender_id
     FROM deliveries
     WHERE receiver_payment_due_at IS NOT NULL
       AND receiver_paid_at IS NULL
       AND receiver_payment_due_at < NOW()
       AND status IN ('posted', 'waiting_receiver')`
  );

  for (const d of overdueReceiver) {
    await deliveryState.transitionDelivery({
      deliveryId: d.id,
      toStatus: 'cancelled',
      note: 'Receiver payment timer expired',
    });
    const refund = await escrowService.refundEscrowForDelivery(
      d.public_id,
      'Auto-cancel: receiver payment not received in time'
    );
    if (refund.refunded) results.refunds += 1;

    await notificationCreateService.createNotification({
      userId: d.sender_id,
      role: 'sender',
      type: 'cancellation',
      title: 'Delivery auto-cancelled',
      body: `Parcel ${d.public_id} was cancelled — receiver did not pay within 2 hours.`,
      route: `/my-posted-parcels`,
    }).catch(() => {});

    results.receiverPayments += 1;
  }

  const { rows: overdueTraveler } = await pool.query(
    `SELECT r.id, r.sender_id, r.traveler_id, d.public_id, d.id AS delivery_id
     FROM trip_sender_requests r
     INNER JOIN deliveries d ON d.id = r.delivery_id
     WHERE r.status = 'pending'
       AND r.accept_due_at IS NOT NULL
       AND r.accept_due_at < NOW()
       AND d.status NOT IN ('cancelled', 'delivered')`
  );

  for (const r of overdueTraveler) {
    await pool.query(
      `UPDATE trip_sender_requests SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [r.id]
    );

    await notificationCreateService.createNotification({
      userId: r.sender_id,
      role: 'sender',
      type: 'cancellation',
      title: 'Traveler did not respond in time',
      body: `Your request for parcel ${r.public_id} expired — the traveler did not respond before the deadline.`,
      route: `/my-posted-parcels`,
    }).catch(() => {});

    await notificationCreateService.createNotification({
      userId: r.traveler_id,
      role: 'traveler',
      type: 'cancellation',
      title: 'Sender request expired',
      body: `A sender request for ${r.public_id} expired because it was not accepted in time.`,
      route: `/matching-requests`,
    }).catch(() => {});

    results.travelerAccepts += 1;
  }

  return results;
}

export function startTimerWorker(intervalMs = 60_000) {
  const tick = () => {
    processExpiredTimers().catch((err) => {
      console.error('[timers] worker error:', err?.message || err);
    });
  };
  tick();
  return setInterval(tick, intervalMs);
}
