import { pool } from '../db/pool.js';

export async function createTrip(trip) {
  const { rows } = await pool.query(
    `INSERT INTO trips (
      public_id, traveler_id, trip_type, status,
      from_city, from_code, to_city, to_code,
      origin_country, origin_country_code, origin_airport,
      destination_country, destination_country_code, destination_airport,
      travel_date, luggage_capacity_kg, flight_number
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8,
      $9, $10, $11,
      $12, $13, $14,
      $15, $16, $17
    )
    RETURNING *`,
    [
      trip.publicId,
      trip.travelerId,
      trip.tripType,
      trip.status || 'open_bid',
      trip.fromCity,
      trip.fromCode,
      trip.toCity,
      trip.toCode,
      trip.originCountry,
      trip.originCountryCode,
      trip.originAirport,
      trip.destinationCountry,
      trip.destinationCountryCode,
      trip.destinationAirport,
      trip.travelDate,
      trip.luggageCapacityKg,
      trip.flightNumber,
    ]
  );
  return rows[0];
}

export async function listTripsForTraveler(travelerId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT t.*,
            u.name AS traveler_name,
            u.rating AS traveler_rating,
            u.review_count AS traveler_review_count
     FROM trips t
     LEFT JOIN users u ON u.id = t.traveler_id
     WHERE t.traveler_id = $1
     ORDER BY t.created_at DESC
     LIMIT $2 OFFSET $3`,
    [travelerId, limit, offset]
  );
  return rows;
}

export async function findTripById(tripId) {
  const { rows } = await pool.query(
    `SELECT t.*,
            u.name AS traveler_name,
            u.rating AS traveler_rating,
            u.review_count AS traveler_review_count,
            u.bio AS traveler_bio
     FROM trips t
     LEFT JOIN users u ON u.id = t.traveler_id
     WHERE t.id = $1`,
    [tripId]
  );
  return rows[0] || null;
}

export async function findTripByIdForTraveler(tripId, travelerId) {
  const { rows } = await pool.query(
    `SELECT t.*,
            u.name AS traveler_name,
            u.rating AS traveler_rating,
            u.review_count AS traveler_review_count
     FROM trips t
     LEFT JOIN users u ON u.id = t.traveler_id
     WHERE t.id = $1 AND t.traveler_id = $2`,
    [tripId, travelerId]
  );
  return rows[0] || null;
}

export async function findTripByPublicIdForTraveler(publicId, travelerId) {
  const { rows } = await pool.query(
    `SELECT t.*,
            u.name AS traveler_name,
            u.rating AS traveler_rating,
            u.review_count AS traveler_review_count
     FROM trips t
     LEFT JOIN users u ON u.id = t.traveler_id
     WHERE t.public_id = $1 AND t.traveler_id = $2`,
    [publicId, travelerId]
  );
  return rows[0] || null;
}

export async function updateTripForTraveler(tripId, travelerId, tripType, fields) {
  if (tripType === 'country_to_country') {
    const { rows } = await pool.query(
      `UPDATE trips
       SET travel_date = $3,
           luggage_capacity_kg = $4,
           flight_number = $5,
           origin_country = $6,
           origin_country_code = $7,
           origin_airport = $8,
           destination_country = $9,
           destination_country_code = $10,
           destination_airport = $11,
           updated_at = NOW()
       WHERE id = $1
         AND traveler_id = $2
         AND status = 'open_bid'
       RETURNING *`,
      [
        tripId,
        travelerId,
        fields.travelDate,
        fields.luggageCapacityKg,
        fields.flightNumber,
        fields.originCountry,
        fields.originCountryCode,
        fields.originAirport,
        fields.destinationCountry,
        fields.destinationCountryCode,
        fields.destinationAirport,
      ]
    );
    return rows[0] || null;
  }

  const { rows } = await pool.query(
    `UPDATE trips
     SET travel_date = $3,
         luggage_capacity_kg = $4,
         flight_number = $5,
         from_city = $6,
         from_code = $7,
         to_city = $8,
         to_code = $9,
         updated_at = NOW()
     WHERE id = $1
       AND traveler_id = $2
       AND status = 'open_bid'
     RETURNING *`,
    [
      tripId,
      travelerId,
      fields.travelDate,
      fields.luggageCapacityKg,
      fields.flightNumber,
      fields.fromCity,
      fields.fromCode,
      fields.toCity,
      fields.toCode,
    ]
  );
  return rows[0] || null;
}

export async function cancelTripAsTraveler(tripId, travelerId) {
  const { rows } = await pool.query(
    `UPDATE trips
     SET status = 'cancelled',
         updated_at = NOW()
     WHERE id = $1
       AND traveler_id = $2
       AND status = 'open_bid'
     RETURNING *`,
    [tripId, travelerId]
  );
  return rows[0] || null;
}

/**
 * Advance linked trip status when a delivery moves to in_transit or delivered.
 * Uses the same DB client when called inside an open transaction.
 */
export async function syncTripStatusForDelivery(deliveryId, tripStatus, client = pool) {
  const status = String(tripStatus || '').trim();
  if (!['in_transit', 'delivered'].includes(status)) return null;

  const allowedCurrent =
    status === 'in_transit'
      ? `('open_bid')`
      : `('open_bid', 'in_transit')`;

  const { rows } = await client.query(
    `UPDATE trips t
     SET status = $2::trip_status,
         updated_at = NOW()
     FROM deliveries d
     WHERE d.id = $1
       AND d.trip_id = t.id
       AND t.status IN ${allowedCurrent}
     RETURNING t.*`,
    [deliveryId, status]
  );
  return rows[0] || null;
}

/**
 * Count of pending sender match requests against this trip.
 */
export async function countMatchingRequestsForTrip(tripId) {
  const requestRepo = await import('./trip_sender_request.repository.js');
  return requestRepo.countPendingRequestsForTrip(tripId);
}

/**
 * Open trips that may match a delivery destination (broad SQL prefilter).
 * Final destination equality is enforced in matching.service.js.
 *
 * City-to-city: prefilter by to_city label only (to_code is country ISO, not a city key).
 * Country-to-country: prefilter by destination_country_code (case-insensitive) OR country label.
 */
export async function listOpenTripsForDiscover({ limit = 50, offset = 0, tripType } = {}) {
  const params = [limit, offset];
  let typeClause = '';
  if (tripType) {
    params.push(tripType);
    typeClause = `AND t.trip_type = $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT t.*,
            u.name AS traveler_name,
            u.rating AS traveler_rating,
            u.review_count AS traveler_review_count,
            u.bio AS traveler_bio
     FROM trips t
     INNER JOIN users u ON u.id = t.traveler_id
     WHERE t.status = 'open_bid'
       ${typeClause}
     ORDER BY t.created_at DESC
     LIMIT $1 OFFSET $2`,
    params
  );
  return rows;
}

export async function findOpenTripByPublicId(publicId) {
  const { rows } = await pool.query(
    `SELECT t.*,
            u.name AS traveler_name,
            u.rating AS traveler_rating,
            u.review_count AS traveler_review_count,
            u.bio AS traveler_bio
     FROM trips t
     LEFT JOIN users u ON u.id = t.traveler_id
     WHERE t.public_id = $1
       AND t.status = 'open_bid'`,
    [publicId]
  );
  return rows[0] || null;
}

/** Sender notification / discover detail — any status, by public id. */
export async function findDiscoverableTripByPublicId(publicId) {
  const id = String(publicId ?? '').trim();
  if (!id) return null;

  const { rows } = await pool.query(
    `SELECT t.*,
            u.name AS traveler_name,
            u.rating AS traveler_rating,
            u.review_count AS traveler_review_count,
            u.bio AS traveler_bio
     FROM trips t
     LEFT JOIN users u ON u.id = t.traveler_id
     WHERE t.public_id = $1`,
    [id]
  );
  return rows[0] || null;
}

export async function listOpenTripsForDestinationMatch({
  tripType,
  destinationLabel,
  destinationCode,
  excludeTravelerId,
  limit = 100,
} = {}) {
  const label = String(destinationLabel ?? '').trim().toLowerCase();
  const code = String(destinationCode ?? '').trim().toUpperCase();
  const codeUsable = code && code !== 'XX' ? code : '';

  const { rows } = await pool.query(
    `SELECT t.*,
            u.name AS traveler_name,
            u.rating AS traveler_rating,
            u.review_count AS traveler_review_count,
            u.bio AS traveler_bio
     FROM trips t
     INNER JOIN users u ON u.id = t.traveler_id
     WHERE t.status = 'open_bid'
       AND t.trip_type = $1
       AND ($2::uuid IS NULL OR t.traveler_id <> $2::uuid)
       AND (
         (
           $1 = 'city_to_city'
           AND $4 <> ''
           AND (
             LOWER(COALESCE(t.to_city, '')) = $4
             OR LOWER(COALESCE(t.to_city, '')) LIKE '%' || $4 || '%'
             OR $4 LIKE '%' || LOWER(COALESCE(t.to_city, '')) || '%'
           )
         )
         OR (
           $1 = 'country_to_country'
           AND (
             (
               $3 <> ''
               AND UPPER(COALESCE(t.destination_country_code, '')) = $3
             )
             OR (
               $4 <> ''
               AND (
                 LOWER(COALESCE(t.destination_country, '')) = $4
                 OR LOWER(COALESCE(t.destination_country, '')) LIKE '%' || $4 || '%'
                 OR $4 LIKE '%' || LOWER(COALESCE(t.destination_country, '')) || '%'
               )
             )
           )
         )
       )
     ORDER BY t.travel_date ASC, t.created_at DESC
     LIMIT $5`,
    [tripType, excludeTravelerId || null, codeUsable, label, limit]
  );
  return rows;
}
