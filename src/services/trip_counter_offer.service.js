import { AppError } from '../utils/errors.js';
import { pool } from '../db/pool.js';
import * as requestRepository from '../repositories/trip_sender_request.repository.js';
import * as offerRepository from '../repositories/trip_counter_offer.repository.js';
import * as notificationCreateService from './notification_create.service.js';

function formatDateOnly(value) {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function travelerDisplayName(travelerId) {
  const { rows } = await pool.query(`SELECT name FROM users WHERE id = $1`, [
    travelerId,
  ]);
  const name = String(rows[0]?.name ?? '').trim();
  return name || 'A traveler';
}

function deliveryRoute(row) {
  if (row.delivery_type === 'country_to_country') {
    return `${row.origin_country || '—'} → ${row.destination_country || '—'}`;
  }
  return `${row.from_city || '—'} → ${row.to_city || '—'}`;
}

export function mapCounterOffer(row) {
  const senderName = String(row.sender_name ?? '').trim() || 'Sender';
  return {
    id: row.id,
    requestId: row.sender_request_id,
    status: row.status,
    amount: Number(row.amount) || 0,
    deliveryId: row.delivery_id,
    deliveryPublicId: row.delivery_public_id,
    deliveryType: row.delivery_type,
    route: deliveryRoute(row),
    fromCity: row.from_city || '',
    toCity: row.to_city || '',
    originCountry: row.origin_country,
    destinationCountry: row.destination_country,
    travelDate: formatDateOnly(row.delivery_travel_date),
    maxBudget: Number(row.max_budget) || 0,
    photoCount: Number(row.photo_count) || 0,
    tripId: row.trip_id,
    tripPublicId: row.trip_public_id,
    senderId: row.sender_id,
    senderName,
    senderInitial: senderName[0].toUpperCase(),
    senderRating: row.sender_rating != null ? Number(row.sender_rating) : null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.updated_at || row.created_at,
  };
}

/** Sender-facing counter offer payload (includes traveler profile fields). */
export function mapCounterOfferForSender(row) {
  const travelerName = String(row.traveler_name ?? '').trim() || 'Traveler';
  return {
    id: row.id,
    requestId: row.sender_request_id,
    status: row.status,
    amount: Number(row.amount) || 0,
    deliveryId: row.delivery_id,
    deliveryPublicId: row.delivery_public_id,
    deliveryType: row.delivery_type,
    route: deliveryRoute(row),
    fromCity: row.from_city || '',
    toCity: row.to_city || '',
    originCountry: row.origin_country,
    destinationCountry: row.destination_country,
    travelDate: formatDateOnly(row.delivery_travel_date),
    maxBudget: Number(row.max_budget) || 0,
    photoCount: Number(row.photo_count) || 0,
    tripId: row.trip_id,
    tripPublicId: row.trip_public_id,
    travelerId: row.traveler_id,
    travelerName,
    travelerInitial: travelerName[0].toUpperCase(),
    travelerRating:
      row.traveler_rating != null ? Number(row.traveler_rating) : null,
    travelerReviewCount: Number(row.traveler_review_count) || 0,
    travelerBio: row.traveler_bio || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    sentAt: row.updated_at || row.created_at,
  };
}

/**
 * Traveler sends (or revises) a counter offer against a pending sender request.
 */
export async function createOrUpdateCounterOffer(travelerId, requestId, body = {}) {
  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new AppError('Enter a valid offer amount.', 400, 'VALIDATION_ERROR');
  }

  const request = await requestRepository.findPendingRequestForTraveler(
    requestId,
    travelerId
  );
  if (!request) {
    throw new AppError('Sender request not found', 404, 'NOT_FOUND');
  }

  const existing = await offerRepository.findOfferByRequestId(requestId, travelerId);
  if (existing && !['pending', 'updated'].includes(existing.status)) {
    throw new AppError(
      `This offer is already ${existing.status} and cannot be changed.`,
      400,
      'INVALID_STATUS'
    );
  }

  const row = await offerRepository.upsertCounterOffer({
    senderRequestId: request.id,
    deliveryId: request.delivery_id,
    tripId: request.trip_id,
    senderId: request.sender_id,
    travelerId,
    amount,
  });

  if (!row) {
    throw new AppError(
      'Unable to update this counter offer.',
      400,
      'INVALID_STATUS'
    );
  }

  // Re-load with joined delivery/sender fields for a full response.
  const full = await offerRepository.findOfferForTraveler(row.id, travelerId);
  const mapped = mapCounterOffer(full || { ...row, ...request, sender_name: request.sender_name });

  const isUpdate = existing != null;
  const deliveryPublicId = mapped.deliveryPublicId || request.delivery_public_id;
  const travelerName = await travelerDisplayName(travelerId).catch(() => 'A traveler');
  const amountLabel = `$${amount.toFixed(2)}`;
  const routeLabel = mapped.route || 'your parcel';

  await notificationCreateService
    .createNotification({
      userId: String(request.sender_id),
      role: 'sender',
      type: 'counterOffer',
      title: isUpdate ? 'Counter offer updated' : 'New counter offer',
      body: isUpdate
        ? `${travelerName} updated their counter offer to ${amountLabel} for ${deliveryPublicId} (${routeLabel}).`
        : `${travelerName} sent a counter offer of ${amountLabel} for ${deliveryPublicId} (${routeLabel}).`,
      route: `/sender-counter-offer/${row.id}`,
    })
    .then(() => {
      console.log(
        `[counter-offer] sender alert created for ${deliveryPublicId} → ${request.sender_id}`
      );
    })
    .catch((err) => {
      console.error('[counter-offer] notify sender failed:', err?.message || err);
    });

  return mapped;
}

export async function listCounterOffersForTraveler(travelerId) {
  const rows = await offerRepository.listOffersForTraveler(travelerId);
  return rows.map(mapCounterOffer);
}

export async function getCounterOfferForTraveler(travelerId, offerId) {
  const row = await offerRepository.findOfferForTraveler(offerId, travelerId);
  if (!row) throw new AppError('Counter offer not found', 404, 'NOT_FOUND');
  return mapCounterOffer(row);
}

export async function getCounterOfferForSender(senderId, offerId) {
  const row = await offerRepository.findOfferForSender(offerId, senderId);
  if (!row) throw new AppError('Counter offer not found', 404, 'NOT_FOUND');
  return mapCounterOfferForSender(row);
}

export async function getCounterOfferForSenderByDelivery(
  senderId,
  deliveryPublicId
) {
  const row = await offerRepository.findOfferForSenderByDeliveryPublicId(
    deliveryPublicId,
    senderId
  );
  if (!row) throw new AppError('Counter offer not found', 404, 'NOT_FOUND');
  return mapCounterOfferForSender(row);
}

async function respondToCounterOffer(senderId, offerId, status) {
  const existing = await offerRepository.findOfferForSender(offerId, senderId);
  if (!existing) {
    throw new AppError('Counter offer not found', 404, 'NOT_FOUND');
  }
  if (!['pending', 'updated'].includes(existing.status)) {
    throw new AppError(
      `This offer is already ${existing.status}.`,
      400,
      'INVALID_STATUS'
    );
  }

  const updated = await offerRepository.updateOfferStatusForSender({
    offerId,
    senderId,
    status,
  });
  if (!updated) {
    throw new AppError(
      `Unable to ${status === 'accepted' ? 'accept' : 'reject'} this counter offer.`,
      400,
      'INVALID_STATUS'
    );
  }

  const full = await offerRepository.findOfferForSender(offerId, senderId);
  const mapped = mapCounterOfferForSender(full || { ...existing, ...updated });

  if (status === 'accepted') {
    await onCounterOfferAccepted(mapped, existing).catch((err) => {
      console.error('[counter-offer] accept side-effects failed:', err?.message || err);
    });
    await notifyTravelerCounterOfferAccepted(mapped, existing).catch((err) => {
      console.error(
        '[counter-offer] notify traveler of accept failed:',
        err?.message || err
      );
    });
  }

  return mapped;
}

async function onCounterOfferAccepted(mapped, rawRow) {
  const { transitionDelivery } = await import('./delivery_state.service.js');
  const escrowService = await import('./escrow.service.js');
  const chatRepository = await import('../repositories/chat.repository.js');

  const deliveryId = mapped.deliveryId || rawRow.delivery_id;
  const deliveryPublicId = mapped.deliveryPublicId || rawRow.delivery_public_id;
  const senderId = mapped.senderId || rawRow.sender_id;
  const travelerId = mapped.travelerId || rawRow.traveler_id;
  const tripId = mapped.tripId || rawRow.trip_id;
  const amount = Number(mapped.amount) || Number(rawRow.amount) || 0;

  await pool.query(
    `UPDATE deliveries
     SET traveler_id = $2, trip_id = $3, bid_amount = $4, updated_at = NOW()
     WHERE id = $1`,
    [deliveryId, travelerId, tripId, amount]
  );

  await escrowService.holdEscrowForDelivery({
    senderId,
    deliveryPublicId,
    amountDollars: amount,
    stripePaymentMethodId: null,
  });

  const timerService = await import('./timer.service.js');
  await timerService.scheduleReceiverPayment(deliveryId);

  await transitionDelivery({
    deliveryId,
    toStatus: 'bid_accepted',
    actorId: senderId,
    note: 'Counter offer accepted',
    extraSets: {
      traveler_id: travelerId,
      trip_id: tripId,
      bid_amount: amount,
      chat_unlocked: false,
    },
  });

  if (senderId && travelerId) {
    await chatRepository.ensureConversation({
      deliveryId,
      participantAId: senderId,
      participantBId: travelerId,
      threadType: 'sender_traveler',
      unlocked: false,
    });
  }
}

async function notifyTravelerCounterOfferAccepted(mapped, rawRow) {
  const travelerId = mapped.travelerId || rawRow.traveler_id;
  if (!travelerId) return;

  const amount = Number(mapped.amount) || Number(rawRow.amount) || 0;
  const amountLabel = `$${amount.toFixed(2)}`;
  const deliveryPublicId =
    mapped.deliveryPublicId || rawRow.delivery_public_id || 'your parcel';
  const routeLabel = mapped.route || deliveryRoute(rawRow) || 'your route';
  const offerId = mapped.id || rawRow.id;

  await notificationCreateService.createNotification({
    userId: String(travelerId),
    role: 'traveler',
    type: 'bidAccepted',
    title: 'Counter offer accepted',
    body:
      `A sender accepted your counter offer of ${amountLabel} for ` +
      `${deliveryPublicId} (${routeLabel}).`,
    route: `/traveler-bid-detail/${offerId}`,
  });

  console.log(
    `[counter-offer] traveler accept alert created for ${deliveryPublicId} → ${travelerId}`
  );
}

export async function acceptCounterOfferForSender(senderId, offerId) {
  return respondToCounterOffer(senderId, offerId, 'accepted');
}

export async function rejectCounterOfferForSender(senderId, offerId) {
  return respondToCounterOffer(senderId, offerId, 'rejected');
}
