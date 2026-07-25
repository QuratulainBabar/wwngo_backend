import { AppError } from '../utils/errors.js';
import * as deliveryRepository from '../repositories/delivery.repository.js';
import * as tripRepository from '../repositories/trip.repository.js';
import {
  deliveryDestination,
  destinationsMatch,
  placesMatch,
} from '../utils/destination_match.js';
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

function dateProximityBonus(tripDate, deliveryDate) {
  if (!tripDate || !deliveryDate) return 0;
  const a = new Date(tripDate);
  const b = new Date(deliveryDate);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 0;
  const days = Math.abs(Math.round((a - b) / (24 * 60 * 60 * 1000)));
  if (days === 0) return 20;
  if (days <= 2) return 15;
  if (days <= 5) return 10;
  if (days <= 10) return 5;
  return 0;
}

function originLabel(delivery) {
  if (delivery.delivery_type === 'country_to_country') {
    return delivery.origin_country || '';
  }
  return delivery.from_city || '';
}

function tripOriginLabel(trip) {
  if (trip.trip_type === 'country_to_country') {
    return trip.origin_country || '';
  }
  return trip.from_city || '';
}

/**
 * Score after destination hard-filter. Destination mismatch → never scored.
 */
function matchScore(delivery, trip) {
  if (!destinationsMatch(delivery, trip)) return 0;

  const originScore = placesMatch(originLabel(delivery), tripOriginLabel(trip))
    ? 1
    : 0.35;
  const base = Math.round(((originScore + 1) / 2) * 80);
  const bonus = dateProximityBonus(
    formatDateOnly(trip.travel_date),
    formatDateOnly(delivery.travel_date)
  );
  return Math.max(0, Math.min(100, base + bonus));
}

function initialFromName(name) {
  const trimmed = String(name ?? '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

async function loadSenderDelivery(senderId, idOrPublicId) {
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
  if (!row) {
    throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  }
  return row;
}

/**
 * Returns travelers whose trip To matches the delivery To.
 * City-to-city compares to_city labels; country-to-country compares country codes/names.
 *
 * Own trips are included so dual-role (sender + traveler) accounts still surface
 * destination matches; the sender can choose not to request themselves.
 */
export async function listMatchingTravelersForDelivery(senderId, idOrPublicId) {
  const delivery = await loadSenderDelivery(senderId, idOrPublicId);
  if (!delivery.receiver_accepted_at) {
    throw new AppError(
      'Matching travelers are available only after the receiver accepts this delivery.',
      400,
      'RECEIVER_PENDING'
    );
  }
  const dest = deliveryDestination(delivery);
  const candidates = await tripRepository.listOpenTripsForDestinationMatch({
    tripType: delivery.delivery_type,
    destinationLabel: dest.label,
    destinationCode: dest.code,
    excludeTravelerId: null,
    limit: 100,
  });

  const matched = [];
  for (const trip of candidates) {
    if (!destinationsMatch(delivery, trip)) continue;
    const score = matchScore(delivery, trip);
    if (score <= 0) continue;

    const mapped = mapTrip(trip);
    matched.push({
      tripId: mapped.id,
      tripPublicId: mapped.publicId,
      travelerId: mapped.travelerId,
      travelerName: mapped.travelerName || 'Traveler',
      initial: initialFromName(mapped.travelerName),
      rating: mapped.travelerRating ?? 0,
      reviewCount: mapped.travelerReviewCount ?? 0,
      bio: mapped.travelerBio || null,
      travelDate: mapped.travelDate,
      origin: mapped.origin,
      destination: mapped.destination,
      route: mapped.route,
      luggageCapacityKg: mapped.luggageCapacityKg,
      flightNumber: mapped.flightNumber,
      tripType: mapped.tripType,
      matchScore: score,
      routeMatchConfidence: score,
      // Suggested offer placeholder until bids API exists — UI expects a price.
      price: Number(delivery.max_budget) || 0,
      message: `I travel ${mapped.route} and can carry your parcel.`,
    });
  }

  matched.sort((a, b) => b.matchScore - a.matchScore);
  return matched;
}
