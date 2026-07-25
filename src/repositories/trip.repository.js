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
       AND t.status <> 'cancelled'
     ORDER BY t.created_at DESC
     LIMIT $2 OFFSET $3`,
    [travelerId, limit, offset]
  );
  return rows;
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

/**
 * Open trips that may match a delivery destination (broad SQL prefilter).
 * Final destination equality is enforced in matching.service.js.
 *
 * City-to-city: prefilter by to_city label only (to_code is country ISO, not a city key).
 * Country-to-country: prefilter by destination_country_code (case-insensitive) OR country label.
 */
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
