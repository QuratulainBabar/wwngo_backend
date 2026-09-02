import { pool } from '../db/pool.js';

function db(client) {
  return client || pool;
}

export async function lockDeliveryForUpdate(deliveryId, client) {
  const { rows } = await client.query(
    `SELECT id FROM deliveries WHERE id = $1 FOR UPDATE`,
    [deliveryId]
  );
  return rows[0] || null;
}

export async function findRequestByDeliveryAndTrip(deliveryId, tripId, client) {
  const { rows } = await db(client).query(
    `SELECT * FROM trip_sender_requests
     WHERE delivery_id = $1 AND trip_id = $2
     LIMIT 1`,
    [deliveryId, tripId]
  );
  return rows[0] || null;
}

export async function createSenderRequest({
  deliveryId,
  tripId,
  senderId,
  travelerId,
  matchScore = 0,
  acceptDueAt = null,
}, client) {
  const { rows } = await db(client).query(
    `INSERT INTO trip_sender_requests (
       delivery_id, trip_id, sender_id, traveler_id, match_score, status, read_at, accept_due_at
     ) VALUES ($1, $2, $3, $4, $5, 'pending', NULL, $6)
     ON CONFLICT (delivery_id, trip_id)
     DO UPDATE SET
       match_score = EXCLUDED.match_score,
       accept_due_at = EXCLUDED.accept_due_at,
       status = CASE
         WHEN trip_sender_requests.status IN ('cancelled', 'declined')
           THEN 'pending'
         ELSE trip_sender_requests.status
       END,
       read_at = CASE
         WHEN trip_sender_requests.status IN ('cancelled', 'declined')
           THEN NULL
         ELSE trip_sender_requests.read_at
       END,
       updated_at = NOW()
     RETURNING *`,
    [deliveryId, tripId, senderId, travelerId, matchScore, acceptDueAt]
  );
  return rows[0];
}

const REQUEST_SELECT = `
  SELECT r.*,
          d.public_id AS delivery_public_id,
          d.delivery_type,
          d.from_city, d.to_city,
          d.origin_country, d.destination_country,
          d.travel_date AS delivery_travel_date,
          d.parcel_category, d.parcel_size, d.weight_kg, d.max_budget,
          d.description AS delivery_description,
          d.preferred_meetup_locations,
          (
            SELECT COUNT(*)::int
            FROM delivery_photos p
            WHERE p.delivery_id = d.id
          ) AS photo_count,
          (
            SELECT COALESCE(
              json_agg(
                json_build_object(
                  'id', p.id,
                  'file_path', p.file_path,
                  'sortOrder', p.sort_order
                )
                ORDER BY p.sort_order ASC, p.created_at ASC
              ),
              '[]'::json
            )
            FROM delivery_photos p
            WHERE p.delivery_id = d.id
          ) AS photos,
          t.public_id AS trip_public_id,
          t.trip_type,
          t.from_city AS trip_from_city, t.to_city AS trip_to_city,
          t.origin_country AS trip_origin_country,
          t.destination_country AS trip_destination_country,
          t.travel_date AS trip_travel_date,
          u.name AS sender_name,
          u.email AS sender_email,
          u.rating AS sender_rating
`;

export async function listPendingRequestsForTraveler(travelerId, { limit = 50 } = {}) {
  const { rows } = await pool.query(
    `${REQUEST_SELECT}
     FROM trip_sender_requests r
     INNER JOIN deliveries d ON d.id = r.delivery_id
     INNER JOIN trips t ON t.id = r.trip_id
     INNER JOIN users u ON u.id = r.sender_id
     WHERE r.traveler_id = $1
       AND r.status = 'pending'
       AND d.status NOT IN ('cancelled', 'delivered')
       AND t.status = 'open_bid'
     ORDER BY r.created_at DESC
     LIMIT $2`,
    [travelerId, limit]
  );
  return rows;
}

export async function countPendingRequestsForTraveler(travelerId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM trip_sender_requests r
     INNER JOIN deliveries d ON d.id = r.delivery_id
     INNER JOIN trips t ON t.id = r.trip_id
     WHERE r.traveler_id = $1
       AND r.status = 'pending'
       AND d.status NOT IN ('cancelled', 'delivered')
       AND t.status = 'open_bid'`,
    [travelerId]
  );
  return Number(rows[0]?.count) || 0;
}

/** Pending sender requests for a delivery (max 2 travelers per delivery). */
export async function countActiveRequestsForDelivery(deliveryId, client) {
  const { rows } = await db(client).query(
    `SELECT COUNT(*)::int AS count
     FROM trip_sender_requests
     WHERE delivery_id = $1
       AND status IN ('pending', 'accepted')`,
    [deliveryId]
  );
  return Number(rows[0]?.count) || 0;
}

/** Active traveler requests for a delivery (sender view). */
export async function listActiveRequestsForDelivery(deliveryId) {
  const { rows } = await pool.query(
    `SELECT r.id,
            r.status,
            r.match_score,
            r.created_at,
            t.id AS trip_id,
            t.public_id AS trip_public_id,
            u.name AS traveler_name
     FROM trip_sender_requests r
     INNER JOIN trips t ON t.id = r.trip_id
     INNER JOIN users u ON u.id = r.traveler_id
     WHERE r.delivery_id = $1
       AND r.status IN ('pending', 'accepted')
     ORDER BY r.created_at DESC`,
    [deliveryId]
  );
  return rows;
}

/** Unread = pending requests the traveler has not opened yet. */
export async function countUnreadRequestsForTraveler(travelerId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM trip_sender_requests r
     INNER JOIN deliveries d ON d.id = r.delivery_id
     INNER JOIN trips t ON t.id = r.trip_id
     WHERE r.traveler_id = $1
       AND r.status = 'pending'
       AND r.read_at IS NULL
       AND d.status NOT IN ('cancelled', 'delivered')
       AND t.status = 'open_bid'`,
    [travelerId]
  );
  return Number(rows[0]?.count) || 0;
}

export async function markRequestsReadForTrip(tripId, travelerId) {
  const { rows } = await pool.query(
    `UPDATE trip_sender_requests r
     SET read_at = NOW(),
         updated_at = NOW()
     FROM deliveries d
     WHERE r.trip_id = $1
       AND r.traveler_id = $2
       AND r.status = 'pending'
       AND r.read_at IS NULL
       AND d.id = r.delivery_id
       AND d.status NOT IN ('cancelled', 'delivered')
     RETURNING r.id`,
    [tripId, travelerId]
  );
  return rows.length;
}

export async function listPendingRequestsForTrip(tripId, travelerId) {
  const { rows } = await pool.query(
    `${REQUEST_SELECT}
     FROM trip_sender_requests r
     INNER JOIN deliveries d ON d.id = r.delivery_id
     INNER JOIN trips t ON t.id = r.trip_id
     INNER JOIN users u ON u.id = r.sender_id
     WHERE r.trip_id = $1
       AND r.traveler_id = $2
       AND r.status = 'pending'
       AND d.status NOT IN ('cancelled', 'delivered')
     ORDER BY r.created_at DESC`,
    [tripId, travelerId]
  );
  return rows;
}

export async function findPendingRequestForTraveler(requestId, travelerId) {
  const { rows } = await pool.query(
    `${REQUEST_SELECT}
     FROM trip_sender_requests r
     INNER JOIN deliveries d ON d.id = r.delivery_id
     INNER JOIN trips t ON t.id = r.trip_id
     INNER JOIN users u ON u.id = r.sender_id
     WHERE r.id = $1
       AND r.traveler_id = $2
       AND r.status = 'pending'
       AND d.status NOT IN ('cancelled', 'delivered')
     LIMIT 1`,
    [requestId, travelerId]
  );
  return rows[0] || null;
}

export async function findRequestForTraveler(requestId, travelerId) {
  const { rows } = await pool.query(
    `${REQUEST_SELECT}
     FROM trip_sender_requests r
     INNER JOIN deliveries d ON d.id = r.delivery_id
     INNER JOIN trips t ON t.id = r.trip_id
     INNER JOIN users u ON u.id = r.sender_id
     WHERE r.id = $1 AND r.traveler_id = $2
     LIMIT 1`,
    [requestId, travelerId]
  );
  return rows[0] || null;
}

export async function countPendingRequestsForTrip(tripId) {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS count
     FROM trip_sender_requests r
     INNER JOIN deliveries d ON d.id = r.delivery_id
     WHERE r.trip_id = $1
       AND r.status = 'pending'
       AND d.status NOT IN ('cancelled', 'delivered')`,
    [tripId]
  );
  return Number(rows[0]?.count) || 0;
}

export async function respondToSenderRequest(requestId, travelerId, status) {
  const { rows } = await pool.query(
    `UPDATE trip_sender_requests r
     SET status = $3,
         responded_at = NOW(),
         updated_at = NOW()
     FROM deliveries d
     WHERE r.id = $1
       AND r.traveler_id = $2
       AND r.status = 'pending'
       AND d.id = r.delivery_id
       AND d.status NOT IN ('cancelled', 'delivered')
     RETURNING r.*`,
    [requestId, travelerId, status]
  );
  return rows[0] || null;
}

export async function listTripsWithPendingRequestsForTraveler(travelerId) {
  const { rows } = await pool.query(
    `SELECT t.*,
            COUNT(r.id)::int AS request_count
     FROM trips t
     INNER JOIN trip_sender_requests r
       ON r.trip_id = t.id
      AND r.status = 'pending'
      AND r.traveler_id = $1
     INNER JOIN deliveries d ON d.id = r.delivery_id
     WHERE t.traveler_id = $1
       AND t.status = 'open_bid'
       AND d.status NOT IN ('cancelled', 'delivered')
     GROUP BY t.id
     ORDER BY MAX(r.created_at) DESC`,
    [travelerId]
  );
  return rows;
}
