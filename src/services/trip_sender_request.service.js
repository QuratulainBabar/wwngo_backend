import { AppError } from '../utils/errors.js';
import * as deliveryRepository from '../repositories/delivery.repository.js';
import * as tripRepository from '../repositories/trip.repository.js';
import * as requestRepository from '../repositories/trip_sender_request.repository.js';
import * as notificationRepository from '../repositories/notification.repository.js';
import * as notificationCreateService from './notification_create.service.js';
import { publish } from './notification_hub.js';
import { mapTrip } from './trip.service.js';

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

function deliveryRoute(row) {
  if (row.delivery_type === 'country_to_country') {
    return `${row.origin_country || '—'} → ${row.destination_country || '—'}`;
  }
  return `${row.from_city || '—'} → ${row.to_city || '—'}`;
}

function mapSenderRequest(row) {
  const senderName = String(row.sender_name ?? '').trim() || 'Sender';
  const meetup = Array.isArray(row.preferred_meetup_locations)
    ? row.preferred_meetup_locations.filter(Boolean)
    : [];
  return {
    id: row.id,
    status: row.status,
    matchScore: Number(row.match_score) || 0,
    unread: row.read_at == null,
    deliveryId: row.delivery_id,
    deliveryPublicId: row.delivery_public_id,
    deliveryType: row.delivery_type,
    route: deliveryRoute(row),
    fromCity: row.from_city,
    toCity: row.to_city,
    originCountry: row.origin_country,
    destinationCountry: row.destination_country,
    travelDate: formatDateOnly(row.delivery_travel_date),
    parcelCategory: row.parcel_category,
    parcelSize: row.parcel_size || '',
    weightKg: Number(row.weight_kg) || 0,
    maxBudget: Number(row.max_budget) || 0,
    description: row.delivery_description || '',
    meetupLocations: meetup,
    photoCount: Number(row.photo_count) || 0,
    tripId: row.trip_id,
    tripPublicId: row.trip_public_id,
    senderId: row.sender_id,
    senderName,
    senderInitial: senderName[0].toUpperCase(),
    senderRating: row.sender_rating != null ? Number(row.sender_rating) : null,
    acceptDueAt: row.accept_due_at || null,
    createdAt: row.created_at,
  };
}
  const looksLikeUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      idOrPublicId
    );
  const row = looksLikeUuid
    ? await deliveryRepository.findDeliveryByIdForSender(idOrPublicId, senderId)
    : await deliveryRepository.findDeliveryByPublicIdForSender(
        idOrPublicId,
        senderId
      );
  if (!row) throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  return row;
}

async function loadTripByIdOrPublicId(idOrPublicId) {
  const looksLikeUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      idOrPublicId
    );
  if (looksLikeUuid) {
    return tripRepository.findTripById(idOrPublicId);
  }
  return tripRepository.findDiscoverableTripByPublicId(idOrPublicId);
}

/**
 * Sender selects a matching traveler trip — creates a pending request and notifies traveler.
 */
export async function requestTravelerForDelivery(senderId, deliveryIdOrPublicId, body = {}) {
  const tripIdOrPublic = String(body.tripId ?? body.tripPublicId ?? '').trim();
  if (!tripIdOrPublic) {
    throw new AppError('tripId is required', 400, 'VALIDATION_ERROR');
  }

  const delivery = await loadSenderDelivery(senderId, deliveryIdOrPublicId);
  if (!delivery.receiver_accepted_at) {
    throw new AppError(
      'You can request a traveler only after the receiver accepts this delivery.',
      400,
      'RECEIVER_PENDING'
    );
  }
  if (delivery.status === 'cancelled' || delivery.status === 'delivered') {
    throw new AppError('This delivery can no longer request travelers', 400, 'INVALID_STATUS');
  }

  const trip = await loadTripByIdOrPublicId(tripIdOrPublic);
  if (!trip || trip.status !== 'open_bid') {
    throw new AppError('Trip not found or no longer available', 404, 'TRIP_NOT_FOUND');
  }
  if (trip.traveler_id === senderId) {
    throw new AppError('You cannot request your own trip', 400, 'INVALID_TRAVELER');
  }

  const matchScore = Math.max(0, Math.min(100, Number(body.matchScore) || 0));
  const timerService = await import('./timer.service.js');
  const acceptDueAt = timerService.travelerAcceptDeadline(trip.travel_date || delivery.travel_date);

  const row = await requestRepository.createSenderRequest({
    deliveryId: delivery.id,
    tripId: trip.id,
    senderId,
    travelerId: trip.traveler_id,
    matchScore,
    acceptDueAt,
  });

  const mappedTrip = mapTrip(trip);
  const deliveryPublicId = delivery.public_id;
  const route =
    delivery.delivery_type === 'country_to_country'
      ? `${delivery.origin_country} → ${delivery.destination_country}`
      : `${delivery.from_city} → ${delivery.to_city}`;

  await notificationCreateService
    .createNotification({
      userId: trip.traveler_id,
      role: 'traveler',
      type: 'senderRequest',
      title: 'New Sender Request',
      body: `A sender requested your trip ${mappedTrip.publicId} for parcel ${deliveryPublicId} (${route}).`,
      route: `/matching-requests/${mappedTrip.publicId}`,
    })
    .catch((err) => {
      console.error('[sender-request] notify traveler failed:', err?.message || err);
    });

  return {
    id: row.id,
    status: row.status,
    matchScore: Number(row.match_score) || 0,
    deliveryPublicId,
    tripId: trip.id,
    tripPublicId: mappedTrip.publicId,
    travelerId: trip.traveler_id,
    createdAt: row.created_at,
  };
}

export async function listSenderRequestsForTraveler(travelerId) {
  const rows = await requestRepository.listPendingRequestsForTraveler(travelerId);
  return rows.map(mapSenderRequest);
}

export async function countSenderRequestsForTraveler(travelerId) {
  return requestRepository.countUnreadRequestsForTraveler(travelerId);
}

export async function listTripsWithSenderRequests(travelerId) {
  const rows = await requestRepository.listTripsWithPendingRequestsForTraveler(travelerId);
  return rows.map((row) => ({
    ...mapTrip(row),
    requestCount: Number(row.request_count) || 0,
  }));
}

export async function listSenderRequestsForTrip(travelerId, tripIdOrPublicId) {
  const looksLikeUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      tripIdOrPublicId
    );
  const trip = looksLikeUuid
    ? await tripRepository.findTripByIdForTraveler(tripIdOrPublicId, travelerId)
    : await tripRepository.findTripByPublicIdForTraveler(tripIdOrPublicId, travelerId);
  if (!trip) throw new AppError('Trip not found', 404, 'NOT_FOUND');

  const rows = await requestRepository.listPendingRequestsForTrip(trip.id, travelerId);
  return {
    trip: mapTrip(trip),
    requests: rows.map(mapSenderRequest),
  };
}

export async function getSenderRequestForTraveler(travelerId, requestId) {
  const row = await requestRepository.findPendingRequestForTraveler(requestId, travelerId);
  if (!row) throw new AppError('Sender request not found', 404, 'NOT_FOUND');
  return mapSenderRequest(row);
}

/**
 * Traveler opened sender requests for a trip — mark them (and related alerts) read.
 */
export async function markSenderRequestsReadForTrip(travelerId, tripIdOrPublicId) {
  const looksLikeUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      tripIdOrPublicId
    );
  const trip = looksLikeUuid
    ? await tripRepository.findTripByIdForTraveler(tripIdOrPublicId, travelerId)
    : await tripRepository.findTripByPublicIdForTraveler(tripIdOrPublicId, travelerId);
  if (!trip) throw new AppError('Trip not found', 404, 'NOT_FOUND');

  const markedCount = await requestRepository.markRequestsReadForTrip(trip.id, travelerId);
  const mappedTrip = mapTrip(trip);
  const route = `/matching-requests/${mappedTrip.publicId}`;

  await notificationRepository.markUnreadByRoute(travelerId, 'traveler', route);
  const notificationsUnread = await notificationRepository.countUnread(
    travelerId,
    'traveler'
  );
  publish(travelerId, 'traveler', {
    event: 'unreadCount',
    unreadCount: notificationsUnread,
  });

  const unreadCount = await requestRepository.countUnreadRequestsForTraveler(travelerId);
  return { markedCount, unreadCount, notificationsUnread };
}

export async function acceptSenderRequest(travelerId, requestId) {
  const row = await requestRepository.respondToSenderRequest(requestId, travelerId, 'accepted');
  if (!row) throw new AppError('Sender request not found', 404, 'NOT_FOUND');
  const full = await requestRepository.findRequestForTraveler(requestId, travelerId);
  return mapSenderRequest(full || row);
}

export async function declineSenderRequest(travelerId, requestId) {
  const row = await requestRepository.respondToSenderRequest(requestId, travelerId, 'declined');
  if (!row) throw new AppError('Sender request not found', 404, 'NOT_FOUND');
  const full = await requestRepository.findRequestForTraveler(requestId, travelerId);
  return mapSenderRequest(full || row);
}
