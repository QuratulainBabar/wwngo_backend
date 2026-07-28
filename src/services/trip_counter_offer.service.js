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
      title: isUpdate
        ? 'Counter offer updated by traveler'
        : 'Counter offer sent by traveler',
      body: isUpdate
        ? `${travelerName} updated their counter offer to ${amountLabel} for ${deliveryPublicId} (${routeLabel}). Review parcel details to accept.`
        : `${travelerName} sent a counter offer of ${amountLabel} for ${deliveryPublicId} (${routeLabel}). Review parcel details to accept.`,
      route: `/shipment/${deliveryPublicId}`,
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
