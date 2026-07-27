import crypto from 'crypto';
import { AppError } from '../utils/errors.js';
import * as tripRepository from '../repositories/trip.repository.js';
import { notifyRelevantSendersForNewTrip } from './trip_notification.service.js';

const ALLOWED_TYPES = new Set(['city_to_city', 'country_to_country']);
const TRAVELER_CANCEL_MIN_HOURS_BEFORE_TRAVEL = 24;

function generatePublicId() {
  const n = crypto.randomInt(10000, 99999);
  return `TR-${n}`;
}

function requireString(value, field) {
  const s = String(value ?? '').trim();
  if (!s) {
    throw new AppError(`${field} is required`, 400, 'VALIDATION_ERROR');
  }
  return s;
}

function toNumber(value, field) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new AppError(`${field} must be a valid number`, 400, 'VALIDATION_ERROR');
  }
  return n;
}

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

function buildRouteLabel(row) {
  if (row.trip_type === 'country_to_country') {
    return `${row.origin_country} → ${row.destination_country}`;
  }
  return `${row.from_city} → ${row.to_city}`;
}

export function mapTrip(row) {
  return {
    id: row.id,
    publicId: row.public_id,
    travelerId: row.traveler_id,
    travelerName: row.traveler_name || null,
    travelerRating: row.traveler_rating != null ? Number(row.traveler_rating) : null,
    travelerReviewCount:
      row.traveler_review_count != null ? Number(row.traveler_review_count) : null,
    travelerBio: row.traveler_bio || null,
    tripType: row.trip_type,
    status: row.status,
    fromCity: row.from_city,
    fromCode: row.from_code,
    toCity: row.to_city,
    toCode: row.to_code,
    originCountry: row.origin_country,
    originCountryCode: row.origin_country_code,
    originAirport: row.origin_airport,
    destinationCountry: row.destination_country,
    destinationCountryCode: row.destination_country_code,
    destinationAirport: row.destination_airport,
    travelDate: formatDateOnly(row.travel_date),
    luggageCapacityKg: Number(row.luggage_capacity_kg),
    flightNumber: row.flight_number,
    origin: row.trip_type === 'country_to_country' ? row.origin_country : row.from_city,
    destination:
      row.trip_type === 'country_to_country' ? row.destination_country : row.to_city,
    route: buildRouteLabel(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function validatePayload(body) {
  const tripType = requireString(body.tripType, 'tripType');
  if (!ALLOWED_TYPES.has(tripType)) {
    throw new AppError(
      'tripType must be city_to_city or country_to_country',
      400,
      'VALIDATION_ERROR'
    );
  }

  const travelDate = requireString(body.travelDate, 'travelDate');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(travelDate)) {
    throw new AppError('travelDate must be YYYY-MM-DD', 400, 'VALIDATION_ERROR');
  }

  const luggageCapacityKg = toNumber(body.luggageCapacityKg, 'luggageCapacityKg');
  if (luggageCapacityKg <= 0) {
    throw new AppError('luggageCapacityKg must be greater than 0', 400, 'VALIDATION_ERROR');
  }

  const flightNumber = String(body.flightNumber ?? '').trim() || null;

  const base = {
    tripType,
    travelDate,
    luggageCapacityKg,
    flightNumber,
    fromCity: null,
    fromCode: null,
    toCity: null,
    toCode: null,
    originCountry: null,
    originCountryCode: null,
    originAirport: null,
    destinationCountry: null,
    destinationCountryCode: null,
    destinationAirport: null,
  };

  if (tripType === 'city_to_city') {
    const fromCity = requireString(body.fromCity ?? body.origin, 'fromCity');
    const toCity = requireString(body.toCity ?? body.destination, 'toCity');
    if (fromCity.toLowerCase() === toCity.toLowerCase()) {
      throw new AppError(
        'Origin and destination cities must be different',
        400,
        'VALIDATION_ERROR'
      );
    }
    return {
      ...base,
      fromCity,
      fromCode: String(body.fromCode ?? '').trim().toUpperCase() || null,
      toCity,
      toCode: String(body.toCode ?? '').trim().toUpperCase() || null,
    };
  }

  const originCountry = requireString(
    body.originCountry ?? body.origin,
    'originCountry'
  );
  const destinationCountry = requireString(
    body.destinationCountry ?? body.destination,
    'destinationCountry'
  );
  const originCountryCode = String(body.originCountryCode ?? body.fromCode ?? '')
    .trim()
    .toUpperCase() || null;
  const destinationCountryCode = String(
    body.destinationCountryCode ?? body.toCode ?? ''
  )
    .trim()
    .toUpperCase() || null;

  if (
    originCountryCode &&
    destinationCountryCode &&
    originCountryCode === destinationCountryCode
  ) {
    throw new AppError(
      'Origin and destination countries must be different',
      400,
      'VALIDATION_ERROR'
    );
  }
  if (originCountry.toLowerCase() === destinationCountry.toLowerCase()) {
    throw new AppError(
      'Origin and destination countries must be different',
      400,
      'VALIDATION_ERROR'
    );
  }

  return {
    ...base,
    originCountry,
    originCountryCode,
    originAirport: String(body.originAirport ?? '').trim() || null,
    destinationCountry,
    destinationCountryCode,
    destinationAirport: String(body.destinationAirport ?? '').trim() || null,
  };
}

export async function createTrip(travelerId, body) {
  const payload = validatePayload(body);
  let created = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      created = await tripRepository.createTrip({
        publicId: generatePublicId(),
        travelerId,
        ...payload,
        status: 'open_bid',
      });
      break;
    } catch (err) {
      if (err?.code === '23505') continue;
      throw err;
    }
  }
  if (!created) {
    throw new AppError('Unable to create trip', 500, 'INTERNAL_ERROR');
  }

  try {
    await notifyRelevantSendersForNewTrip(created, travelerId);
  } catch (err) {
    console.error('[trip] sender notification failed:', err?.message || err);
  }

  return mapTrip(created);
}

export async function discoverTrips(query = {}) {
  const limit = Math.min(Number(query.limit) || 50, 100);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const tripType = String(query.tripType || '').trim();
  const allowedType =
    tripType === 'city_to_city' || tripType === 'country_to_country' ? tripType : null;

  const rows = await tripRepository.listOpenTripsForDiscover({
    limit,
    offset,
    tripType: allowedType,
  });
  return rows.map(mapTrip);
}

export async function getDiscoverableTrip(publicId) {
  const row = await tripRepository.findOpenTripByPublicId(publicId);
  if (!row) {
    throw new AppError('Trip not found', 404, 'NOT_FOUND');
  }
  return mapTrip(row);
}

export async function listMyTrips(travelerId, query = {}) {
  const limit = Math.min(Number(query.limit) || 50, 100);
  const offset = Math.max(Number(query.offset) || 0, 0);
  const rows = await tripRepository.listTripsForTraveler(travelerId, {
    limit,
    offset,
  });
  return rows.map(mapTrip);
}

export async function getMyTrip(travelerId, idOrPublicId) {
  const looksLikeUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      idOrPublicId
    );
  const row = looksLikeUuid
    ? await tripRepository.findTripByIdForTraveler(idOrPublicId, travelerId)
    : await tripRepository.findTripByPublicIdForTraveler(idOrPublicId, travelerId);
  if (!row) {
    throw new AppError('Trip not found', 404, 'NOT_FOUND');
  }
  return mapTrip(row);
}

function assertTravelerCanModifyOpenTrip(trip) {
  if (trip.status !== 'open_bid') {
    throw new AppError(
      'Only open trips can be edited or cancelled',
      400,
      'INVALID_STATUS'
    );
  }
}

function parseTravelDateForCancelCheck(travelDateStr) {
  if (!travelDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(travelDateStr)) {
    return null;
  }
  const [y, m, d] = travelDateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function hoursUntilTravel(travelDateStr) {
  const travelDate = parseTravelDateForCancelCheck(travelDateStr);
  if (!travelDate) return null;
  return (travelDate.getTime() - Date.now()) / (1000 * 60 * 60);
}

async function assertTravelerCanCancelTrip(trip) {
  const requestCount = await tripRepository.countMatchingRequestsForTrip(trip.id);
  if (requestCount === 0) return;

  const hours = hoursUntilTravel(trip.travelDate);
  if (hours == null) {
    throw new AppError('Invalid travel date on trip', 400, 'VALIDATION_ERROR');
  }
  if (hours < TRAVELER_CANCEL_MIN_HOURS_BEFORE_TRAVEL) {
    throw new AppError(
      `Cancellations must be made at least ${TRAVELER_CANCEL_MIN_HOURS_BEFORE_TRAVEL} hours before travel`,
      400,
      'CANCEL_TOO_LATE'
    );
  }
}

/**
 * PATCH traveler trip — all fields from trip creation (route, date, capacity, flight).
 */
export async function updateTripForTraveler(travelerId, idOrPublicId, body) {
  const trip = await getMyTrip(travelerId, idOrPublicId);
  assertTravelerCanModifyOpenTrip(trip);

  const { tripType: _ignored, ...updates } = validatePayload({
    ...body,
    tripType: trip.tripType,
  });

  const updated = await tripRepository.updateTripForTraveler(
    trip.id,
    travelerId,
    trip.tripType,
    updates
  );
  if (!updated) {
    throw new AppError('Unable to update this trip', 400, 'UPDATE_FAILED');
  }

  return mapTrip({
    ...updated,
    traveler_name: trip.travelerName,
    traveler_rating: trip.travelerRating,
    traveler_review_count: trip.travelerReviewCount,
  });
}

/**
 * POST traveler cancel — soft-cancels an open trip.
 */
export async function cancelTripForTraveler(travelerId, idOrPublicId) {
  const trip = await getMyTrip(travelerId, idOrPublicId);
  assertTravelerCanModifyOpenTrip(trip);
  await assertTravelerCanCancelTrip(trip);

  const updated = await tripRepository.cancelTripAsTraveler(trip.id, travelerId);
  if (!updated) {
    throw new AppError('Unable to cancel this trip', 400, 'CANCEL_FAILED');
  }

  return mapTrip({
    ...updated,
    traveler_name: trip.travelerName,
    traveler_rating: trip.travelerRating,
    traveler_review_count: trip.travelerReviewCount,
  });
}
