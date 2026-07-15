import { pool } from '../db/pool.js';

/**
 * Persist a new delivery and its photo rows in a single transaction.
 */
export async function createDeliveryWithPhotos({ delivery, photos }) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO deliveries (
        public_id, sender_id, delivery_type,
        from_city, from_code, to_city, to_code,
        origin_country, origin_airport, destination_country, destination_airport,
        travel_date, parcel_category, parcel_size, weight_kg, max_budget,
        description, preferred_meetup_locations, acknowledged,
        platform_fee, platform_fee_share,
        receiver_email, receiver_phone
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, $18::text[], $19,
        $20, $21,
        $22, $23
      )
      RETURNING *`,
      [
        delivery.publicId,
        delivery.senderId,
        delivery.deliveryType,
        delivery.fromCity,
        delivery.fromCode,
        delivery.toCity,
        delivery.toCode,
        delivery.originCountry,
        delivery.originAirport,
        delivery.destinationCountry,
        delivery.destinationAirport,
        delivery.travelDate,
        delivery.parcelCategory,
        delivery.parcelSize,
        delivery.weightKg,
        delivery.maxBudget,
        delivery.description,
        delivery.preferredMeetupLocations,
        delivery.acknowledged,
        delivery.platformFee,
        delivery.platformFeeShare,
        delivery.receiverEmail,
        delivery.receiverPhone,
      ]
    );

    const created = rows[0];
    const photoRows = [];

    for (let i = 0; i < photos.length; i += 1) {
      const photo = photos[i];
      const result = await client.query(
        `INSERT INTO delivery_photos (
          delivery_id, file_path, original_name, mime_type, size_bytes, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [
          created.id,
          photo.filePath,
          photo.originalName,
          photo.mimeType,
          photo.sizeBytes,
          i,
        ]
      );
      photoRows.push(result.rows[0]);
    }

    await client.query('COMMIT');
    return { delivery: created, photos: photoRows };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function findDeliveryByIdForSender(deliveryId, senderId) {
  const { rows } = await pool.query(
    `SELECT * FROM deliveries
     WHERE id = $1 AND sender_id = $2`,
    [deliveryId, senderId]
  );
  return rows[0] || null;
}

export async function findDeliveryByPublicIdForSender(publicId, senderId) {
  const { rows } = await pool.query(
    `SELECT * FROM deliveries
     WHERE public_id = $1 AND sender_id = $2`,
    [publicId, senderId]
  );
  return rows[0] || null;
}

export async function listDeliveriesForSender(senderId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM deliveries
     WHERE sender_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [senderId, limit, offset]
  );
  return rows;
}

export async function listPhotosForDelivery(deliveryId) {
  const { rows } = await pool.query(
    `SELECT * FROM delivery_photos
     WHERE delivery_id = $1
     ORDER BY sort_order ASC, created_at ASC`,
    [deliveryId]
  );
  return rows;
}

export async function listPhotosForDeliveries(deliveryIds) {
  if (!deliveryIds.length) return [];
  const { rows } = await pool.query(
    `SELECT * FROM delivery_photos
     WHERE delivery_id = ANY($1::uuid[])
     ORDER BY sort_order ASC, created_at ASC`,
    [deliveryIds]
  );
  return rows;
}
