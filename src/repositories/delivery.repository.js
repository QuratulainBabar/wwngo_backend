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
        receiver_email, receiver_phone, receiver_meetup_location
      ) VALUES (
        $1, $2, $3,
        $4, $5, $6, $7,
        $8, $9, $10, $11,
        $12, $13, $14, $15, $16,
        $17, $18::text[], $19,
        $20, $21,
        $22, $23, $24
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
        delivery.receiverMeetupLocation,
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
    `SELECT d.*,
            s.name AS sender_name
     FROM deliveries d
     LEFT JOIN users s ON s.id = d.sender_id
     WHERE d.id = $1 AND d.sender_id = $2`,
    [deliveryId, senderId]
  );
  return rows[0] || null;
}

export async function findDeliveryByPublicIdForSender(publicId, senderId) {
  const { rows } = await pool.query(
    `SELECT d.*,
            s.name AS sender_name
     FROM deliveries d
     LEFT JOIN users s ON s.id = d.sender_id
     WHERE d.public_id = $1 AND d.sender_id = $2`,
    [publicId, senderId]
  );
  return rows[0] || null;
}

export async function listDeliveriesForSender(senderId, { limit = 50, offset = 0 } = {}) {
  const { rows } = await pool.query(
    `SELECT d.*,
            s.name AS sender_name
     FROM deliveries d
     LEFT JOIN users s ON s.id = d.sender_id
     WHERE d.sender_id = $1
     ORDER BY d.created_at DESC
     LIMIT $2 OFFSET $3`,
    [senderId, limit, offset]
  );
  return rows;
}

/** Digits-only + national form (leading zeros stripped) for fuzzy phone match. */
function phoneMatchParts(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  const national = digits.replace(/^0+/, '');
  return { digits, national };
}

/**
 * Phone match: exact digit match, or national-number match (handles legacy
 * local formats like 0329… vs E.164 +92329…).
 */
function receiverPhoneMatchSql(digitsParam, nationalParam) {
  return `
  ${digitsParam} <> ''
  AND d.receiver_phone IS NOT NULL
  AND (
    regexp_replace(d.receiver_phone, '\\D', '', 'g') = ${digitsParam}
    OR (
      length(${nationalParam}) >= 8
      AND (
        regexp_replace(regexp_replace(d.receiver_phone, '\\D', '', 'g'), '^0+', '') = ${nationalParam}
        OR regexp_replace(d.receiver_phone, '\\D', '', 'g') LIKE '%' || ${nationalParam}
        OR ${digitsParam} LIKE '%' || regexp_replace(
          regexp_replace(d.receiver_phone, '\\D', '', 'g'),
          '^0+',
          ''
        )
      )
    )
  )
`;
}

function receiverAccessSql(userIdParam, emailParam, digitsParam, nationalParam) {
  const phoneSql = receiverPhoneMatchSql(digitsParam, nationalParam);
  return `
    d.receiver_id = ${userIdParam}
    OR (
      d.receiver_email IS NOT NULL
      AND LOWER(d.receiver_email) = LOWER(${emailParam})
    )
    OR (${phoneSql})
  `;
}

/**
 * Deliveries addressed to this user (email/phone match) or explicitly linked.
 */
export async function listDeliveriesForReceiver(
  userId,
  email,
  phone,
  { limit = 50, offset = 0 } = {}
) {
  const { digits, national } = phoneMatchParts(phone);
  const access = receiverAccessSql('$1', '$2', '$3', '$4');
  const { rows } = await pool.query(
    `SELECT d.*,
            s.name AS sender_name
     FROM deliveries d
     LEFT JOIN users s ON s.id = d.sender_id
     WHERE ${access}
     ORDER BY d.created_at DESC
     LIMIT $5 OFFSET $6`,
    [userId, email || '', digits, national, limit, offset]
  );
  return rows;
}

export async function findDeliveryByIdForReceiver(deliveryId, userId, email, phone) {
  const { digits, national } = phoneMatchParts(phone);
  const access = receiverAccessSql('$2', '$3', '$4', '$5');
  const { rows } = await pool.query(
    `SELECT d.*,
            s.name AS sender_name
     FROM deliveries d
     LEFT JOIN users s ON s.id = d.sender_id
     WHERE d.id = $1
       AND (${access})`,
    [deliveryId, userId, email || '', digits, national]
  );
  return rows[0] || null;
}

export async function findDeliveryByPublicIdForReceiver(publicId, userId, email, phone) {
  const { digits, national } = phoneMatchParts(phone);
  const access = receiverAccessSql('$2', '$3', '$4', '$5');
  const { rows } = await pool.query(
    `SELECT d.*,
            s.name AS sender_name
     FROM deliveries d
     LEFT JOIN users s ON s.id = d.sender_id
     WHERE d.public_id = $1
       AND (${access})`,
    [publicId, userId, email || '', digits, national]
  );
  return rows[0] || null;
}

export async function findUserIdByEmail(email) {
  if (!email) return null;
  const { rows } = await pool.query(
    `SELECT id FROM users WHERE LOWER(email) = LOWER($1) LIMIT 1`,
    [email]
  );
  return rows[0]?.id || null;
}

export async function findUserIdByPhone(phone) {
  const { digits, national } = phoneMatchParts(phone);
  if (!digits) return null;
  const { rows } = await pool.query(
    `SELECT id FROM users
     WHERE phone IS NOT NULL
       AND (
         regexp_replace(phone, '\\D', '', 'g') = $1
         OR (
           length($2) >= 8
           AND (
             regexp_replace(regexp_replace(phone, '\\D', '', 'g'), '^0+', '') = $2
             OR regexp_replace(phone, '\\D', '', 'g') LIKE '%' || $2
             OR $1 LIKE '%' || regexp_replace(
               regexp_replace(phone, '\\D', '', 'g'),
               '^0+',
               ''
             )
           )
         )
       )
     LIMIT 1`,
    [digits, national]
  );
  return rows[0]?.id || null;
}

/** Link a registered receiver to a delivery without marking acceptance. */
export async function linkReceiverUser(deliveryId, receiverId) {
  const { rows } = await pool.query(
    `UPDATE deliveries
     SET receiver_id = $2,
         updated_at = NOW()
     WHERE id = $1
       AND receiver_id IS NULL
     RETURNING *`,
    [deliveryId, receiverId]
  );
  return rows[0] || null;
}

export async function acceptDeliveryAsReceiver(deliveryId, receiverId) {
  const { rows } = await pool.query(
    `UPDATE deliveries
     SET receiver_id = $2,
         receiver_accepted_at = COALESCE(receiver_accepted_at, NOW()),
         updated_at = NOW()
     WHERE id = $1
       AND status NOT IN ('cancelled', 'delivered')
     RETURNING *`,
    [deliveryId, receiverId]
  );
  return rows[0] || null;
}

export async function declineDeliveryAsReceiver(deliveryId) {
  const { rows } = await pool.query(
    `UPDATE deliveries
     SET status = 'cancelled',
         updated_at = NOW()
     WHERE id = $1
       AND status = 'posted'
       AND receiver_accepted_at IS NULL
     RETURNING *`,
    [deliveryId]
  );
  return rows[0] || null;
}

export async function updateDeliveryForSender(deliveryId, senderId, deliveryType, fields) {
  if (deliveryType === 'country_to_country') {
    const { rows } = await pool.query(
      `UPDATE deliveries
       SET travel_date = $3,
           parcel_category = $4,
           parcel_size = $5,
           weight_kg = $6,
           max_budget = $7,
           description = $8,
           preferred_meetup_locations = $9::text[],
           platform_fee = $10,
           platform_fee_share = $11,
           receiver_email = $12,
           receiver_phone = $13,
           receiver_meetup_location = $14,
           origin_country = $15,
           origin_airport = $16,
           destination_country = $17,
           destination_airport = $18,
           updated_at = NOW()
       WHERE id = $1
         AND sender_id = $2
         AND status = 'posted'
       RETURNING *`,
      [
        deliveryId,
        senderId,
        fields.travelDate,
        fields.parcelCategory,
        fields.parcelSize,
        fields.weightKg,
        fields.maxBudget,
        fields.description,
        fields.preferredMeetupLocations,
        fields.platformFee,
        fields.platformFeeShare,
        fields.receiverEmail,
        fields.receiverPhone,
        fields.receiverMeetupLocation,
        fields.originCountry,
        fields.originAirport,
        fields.destinationCountry,
        fields.destinationAirport,
      ]
    );
    return rows[0] || null;
  }

  const { rows } = await pool.query(
    `UPDATE deliveries
     SET travel_date = $3,
         parcel_category = $4,
         parcel_size = $5,
         weight_kg = $6,
         max_budget = $7,
         description = $8,
         preferred_meetup_locations = $9::text[],
         platform_fee = $10,
         platform_fee_share = $11,
         receiver_email = $12,
         receiver_phone = $13,
         receiver_meetup_location = $14,
         from_city = $15,
         from_code = $16,
         to_city = $17,
         to_code = $18,
         updated_at = NOW()
     WHERE id = $1
       AND sender_id = $2
       AND status = 'posted'
     RETURNING *`,
    [
      deliveryId,
      senderId,
      fields.travelDate,
      fields.parcelCategory,
      fields.parcelSize,
      fields.weightKg,
      fields.maxBudget,
      fields.description,
      fields.preferredMeetupLocations,
      fields.platformFee,
      fields.platformFeeShare,
      fields.receiverEmail,
      fields.receiverPhone,
      fields.receiverMeetupLocation,
      fields.fromCity,
      fields.fromCode,
      fields.toCity,
      fields.toCode,
    ]
  );
  return rows[0] || null;
}

export async function replaceDeliveryPhotos(deliveryId, photoRecords, retainedPhotoIds = []) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (retainedPhotoIds.length) {
      await client.query(
        `DELETE FROM delivery_photos
         WHERE delivery_id = $1
           AND id <> ALL($2::uuid[])`,
        [deliveryId, retainedPhotoIds]
      );
    } else {
      await client.query(`DELETE FROM delivery_photos WHERE delivery_id = $1`, [deliveryId]);
    }

    const existingCount = retainedPhotoIds.length
      ? (
          await client.query(
            `SELECT COUNT(*)::int AS count
             FROM delivery_photos
             WHERE delivery_id = $1`,
            [deliveryId]
          )
        ).rows[0]?.count ?? 0
      : 0;

    const photoRows = [];
    for (let i = 0; i < photoRecords.length; i += 1) {
      const photo = photoRecords[i];
      const result = await client.query(
        `INSERT INTO delivery_photos (
          delivery_id, file_path, original_name, mime_type, size_bytes, sort_order
        ) VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
        [
          deliveryId,
          photo.filePath,
          photo.originalName,
          photo.mimeType,
          photo.sizeBytes,
          existingCount + i,
        ]
      );
      photoRows.push(result.rows[0]);
    }

    await client.query('COMMIT');
    return photoRows;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function cancelDeliveryAsSender(deliveryId, senderId) {
  const { rows } = await pool.query(
    `UPDATE deliveries
     SET status = 'cancelled',
         updated_at = NOW()
     WHERE id = $1
       AND sender_id = $2
       AND status = 'posted'
     RETURNING *`,
    [deliveryId, senderId]
  );
  return rows[0] || null;
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

/**
 * Deliveries eligible for sender alerts when a matching traveler trip is posted.
 * SQL prefilter by destination; final match is enforced in trip notification service.
 */
export async function listDeliveriesForTripSenderNotification({
  tripType,
  destinationLabel,
  destinationCode,
  excludeSenderId,
  limit = 200,
} = {}) {
  const label = String(destinationLabel ?? '').trim().toLowerCase();
  const code = String(destinationCode ?? '').trim().toUpperCase();
  const codeUsable = code && code !== 'XX' ? code : '';

  const { rows } = await pool.query(
    `SELECT d.*
     FROM deliveries d
     WHERE d.status = 'posted'
       AND d.receiver_accepted_at IS NOT NULL
       AND d.delivery_type = $1
       AND d.sender_id <> $2::uuid
       AND (
         (
           $1 = 'city_to_city'
           AND $4 <> ''
           AND (
             LOWER(COALESCE(d.to_city, '')) = $4
             OR LOWER(COALESCE(d.to_city, '')) LIKE '%' || $4 || '%'
             OR $4 LIKE '%' || LOWER(COALESCE(d.to_city, '')) || '%'
           )
         )
         OR (
           $1 = 'country_to_country'
           AND (
             (
               $3 <> ''
               AND UPPER(COALESCE(d.to_code, '')) = $3
             )
             OR (
               $4 <> ''
               AND (
                 LOWER(COALESCE(d.destination_country, '')) = $4
                 OR LOWER(COALESCE(d.destination_country, '')) LIKE '%' || $4 || '%'
                 OR $4 LIKE '%' || LOWER(COALESCE(d.destination_country, '')) || '%'
               )
             )
           )
         )
       )
     ORDER BY d.created_at DESC
     LIMIT $5`,
    [tripType, excludeSenderId, codeUsable, label, limit]
  );
  return rows;
}
