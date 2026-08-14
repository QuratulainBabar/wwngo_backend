import { pool } from '../db/pool.js';

const OFFER_SELECT = `
  SELECT o.*,
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
         u.name AS sender_name,
         u.rating AS sender_rating
`;

const SENDER_OFFER_SELECT = `
  SELECT o.*,
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
         traveler.name AS traveler_name,
         traveler.rating AS traveler_rating,
         traveler.review_count AS traveler_review_count,
         traveler.bio AS traveler_bio
`;

/**
 * Insert a new offer, or revise amount on an existing open offer.
 * First create → pending; later amount changes while pending/updated → updated.
 */
export async function upsertCounterOffer({
  senderRequestId,
  deliveryId,
  tripId,
  senderId,
  travelerId,
  amount,
}) {
  const { rows } = await pool.query(
    `INSERT INTO trip_counter_offers (
       sender_request_id, delivery_id, trip_id, sender_id, traveler_id, amount, status
     ) VALUES ($1, $2, $3, $4, $5, $6, 'pending')
     ON CONFLICT (sender_request_id)
     DO UPDATE SET
       amount = EXCLUDED.amount,
       status = CASE
         WHEN trip_counter_offers.status IN ('pending', 'updated')
           THEN 'updated'::trip_counter_offer_status
         ELSE trip_counter_offers.status
       END,
       updated_at = NOW()
     WHERE trip_counter_offers.status IN ('pending', 'updated')
     RETURNING *`,
    [senderRequestId, deliveryId, tripId, senderId, travelerId, amount]
  );
  return rows[0] || null;
}

export async function findOfferByRequestId(senderRequestId, travelerId) {
  const { rows } = await pool.query(
    `SELECT * FROM trip_counter_offers
     WHERE sender_request_id = $1 AND traveler_id = $2
     LIMIT 1`,
    [senderRequestId, travelerId]
  );
  return rows[0] || null;
}

export async function listOffersForTraveler(travelerId, { limit = 50 } = {}) {
  const { rows } = await pool.query(
    `${OFFER_SELECT}
     FROM trip_counter_offers o
     INNER JOIN deliveries d ON d.id = o.delivery_id
     INNER JOIN trips t ON t.id = o.trip_id
     INNER JOIN users u ON u.id = o.sender_id
     WHERE o.traveler_id = $1
     ORDER BY o.updated_at DESC, o.created_at DESC
     LIMIT $2`,
    [travelerId, limit]
  );
  return rows;
}

export async function findOfferForTraveler(offerId, travelerId) {
  const { rows } = await pool.query(
    `${OFFER_SELECT}
     FROM trip_counter_offers o
     INNER JOIN deliveries d ON d.id = o.delivery_id
     INNER JOIN trips t ON t.id = o.trip_id
     INNER JOIN users u ON u.id = o.sender_id
     WHERE o.id = $1
       AND o.traveler_id = $2
     LIMIT 1`,
    [offerId, travelerId]
  );
  return rows[0] || null;
}

export async function findOfferForSender(offerId, senderId) {
  const { rows } = await pool.query(
    `${SENDER_OFFER_SELECT}
     FROM trip_counter_offers o
     INNER JOIN deliveries d ON d.id = o.delivery_id
     INNER JOIN trips t ON t.id = o.trip_id
     INNER JOIN users traveler ON traveler.id = o.traveler_id
     WHERE o.id = $1
       AND o.sender_id = $2
     LIMIT 1`,
    [offerId, senderId]
  );
  return rows[0] || null;
}

export async function findOfferForSenderByDeliveryPublicId(
  deliveryPublicId,
  senderId
) {
  const { rows } = await pool.query(
    `${SENDER_OFFER_SELECT}
     FROM trip_counter_offers o
     INNER JOIN deliveries d ON d.id = o.delivery_id
     INNER JOIN trips t ON t.id = o.trip_id
     INNER JOIN users traveler ON traveler.id = o.traveler_id
     WHERE d.public_id = $1
       AND o.sender_id = $2
     ORDER BY o.updated_at DESC, o.created_at DESC
     LIMIT 1`,
    [deliveryPublicId, senderId]
  );
  return rows[0] || null;
}

/**
 * Sender accepts or rejects an open counter offer.
 * Only pending/updated offers can change status.
 */
export async function updateOfferStatusForSender({
  offerId,
  senderId,
  status,
}) {
  const { rows } = await pool.query(
    `UPDATE trip_counter_offers
     SET status = $3::trip_counter_offer_status,
         updated_at = NOW()
     WHERE id = $1
       AND sender_id = $2
       AND status IN ('pending', 'updated')
     RETURNING *`,
    [offerId, senderId, status]
  );
  return rows[0] || null;
}
