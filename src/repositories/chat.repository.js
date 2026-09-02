import { pool } from '../db/pool.js';

export async function ensureConversation({
  deliveryId,
  participantAId,
  participantBId,
  threadType = 'sender_receiver',
  unlocked = true,
}) {
  const existing = await pool.query(
    `SELECT * FROM conversations WHERE delivery_id = $1 AND thread_type = $2::chat_thread_type`,
    [deliveryId, threadType]
  );
  if (existing.rows[0]) return existing.rows[0];

  const { rows } = await pool.query(
    `INSERT INTO conversations (delivery_id, participant_a_id, participant_b_id, thread_type, unlocked)
     VALUES ($1, $2, $3, $4::chat_thread_type, $5)
     ON CONFLICT (delivery_id, thread_type) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [deliveryId, participantAId, participantBId, threadType, unlocked]
  );
  return rows[0];
}

export async function listConversationsForUser(userId, { threadType = null } = {}) {
  const params = [userId];
  let threadFilter = '';
  if (threadType) {
    params.push(threadType);
    threadFilter = `AND c.thread_type = $${params.length}::chat_thread_type`;
  }

  const { rows } = await pool.query(
    `SELECT c.*,
            d.public_id AS delivery_public_id,
            d.status AS delivery_status,
            c.thread_type,
            c.unlocked,
            CASE
              WHEN c.participant_a_id = $1 THEN ub.name
              ELSE ua.name
            END AS peer_name,
            (
              SELECT CASE
                       WHEN m.is_image THEN '📷 Photo'
                       WHEN NULLIF(TRIM(m.body), '') IS NULL THEN 'No messages yet'
                       ELSE m.body
                     END
              FROM chat_messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC
              LIMIT 1
            ) AS last_message,
            (
              SELECT m.is_image
              FROM chat_messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC
              LIMIT 1
            ) AS last_message_is_image,
            (
              SELECT created_at FROM chat_messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC
              LIMIT 1
            ) AS last_message_at,
            (
              SELECT COUNT(*)::int FROM chat_messages m
              WHERE m.conversation_id = c.id
                AND m.sender_id <> $1
                AND m.created_at > COALESCE(
                  (SELECT last_read_at FROM conversation_reads r
                   WHERE r.conversation_id = c.id AND r.user_id = $1),
                  '1970-01-01'::timestamptz
                )
            ) AS unread_count
     FROM conversations c
     JOIN deliveries d ON d.id = c.delivery_id
     JOIN users ua ON ua.id = c.participant_a_id
     JOIN users ub ON ub.id = c.participant_b_id
     WHERE (c.participant_a_id = $1 OR c.participant_b_id = $1)
       ${threadFilter}
     ORDER BY COALESCE(
       (SELECT created_at FROM chat_messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC LIMIT 1),
       c.updated_at
     ) DESC`,
    params
  );
  return rows;
}

export async function findConversationForUser(conversationId, userId) {
  const { rows } = await pool.query(
    `SELECT c.*,
            d.public_id AS delivery_public_id,
            d.status AS delivery_status,
            CASE
              WHEN c.participant_a_id = $2 THEN ub.name
              ELSE ua.name
            END AS peer_name
     FROM conversations c
     JOIN deliveries d ON d.id = c.delivery_id
     JOIN users ua ON ua.id = c.participant_a_id
     JOIN users ub ON ub.id = c.participant_b_id
     WHERE c.id = $1
       AND (c.participant_a_id = $2 OR c.participant_b_id = $2)`,
    [conversationId, userId]
  );
  return rows[0] || null;
}

export async function listMessages(conversationId, { limit = 200 } = {}) {
  const { rows } = await pool.query(
    `SELECT * FROM chat_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, limit]
  );
  return rows;
}

export async function insertMessage({
  conversationId,
  senderId,
  body,
  isImage = false,
  imageName = null,
  deliveredAt = null,
  readAt = null,
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO chat_messages
         (conversation_id, sender_id, body, is_image, image_name, delivered_at, read_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [conversationId, senderId, body || '', isImage, imageName, deliveredAt, readAt]
    );
    await client.query(
      `UPDATE conversations SET updated_at = NOW() WHERE id = $1`,
      [conversationId]
    );
    await client.query(
      `INSERT INTO conversation_reads (conversation_id, user_id, last_read_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (conversation_id, user_id)
       DO UPDATE SET last_read_at = NOW()`,
      [conversationId, senderId]
    );
    await client.query('COMMIT');
    return rows[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function markConversationRead(conversationId, userId) {
  await pool.query(
    `INSERT INTO conversation_reads (conversation_id, user_id, last_read_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (conversation_id, user_id)
     DO UPDATE SET last_read_at = NOW()`,
    [conversationId, userId]
  );
}

/**
 * Mark every undelivered message addressed to [userId] as delivered.
 * Returns rows grouped by conversation for socket fan-out.
 */
export async function markDeliveredForRecipient(userId) {
  const { rows } = await pool.query(
    `UPDATE chat_messages m
     SET delivered_at = NOW()
     FROM conversations c
     WHERE m.conversation_id = c.id
       AND (c.participant_a_id = $1 OR c.participant_b_id = $1)
       AND m.sender_id <> $1
       AND m.delivered_at IS NULL
     RETURNING m.id, m.conversation_id, m.sender_id`,
    [userId]
  );
  return rows;
}

/**
 * Mark a single message delivered when the recipient device ACKs it.
 * No-op (empty) if the caller is not the other participant or it was already delivered.
 */
export async function markMessageDelivered(messageId, recipientId) {
  const { rows } = await pool.query(
    `UPDATE chat_messages m
     SET delivered_at = NOW()
     FROM conversations c
     WHERE m.id = $1
       AND m.conversation_id = c.id
       AND m.sender_id <> $2
       AND (c.participant_a_id = $2 OR c.participant_b_id = $2)
       AND m.delivered_at IS NULL
     RETURNING m.id, m.conversation_id, m.sender_id`,
    [messageId, recipientId]
  );
  return rows[0] || null;
}

/**
 * Mark every unread peer message in a thread as read (and delivered if not yet).
 * Returns the updated message ids and the original sender id.
 */
export async function markMessagesRead(conversationId, readerId) {
  const { rows } = await pool.query(
    `UPDATE chat_messages
     SET delivered_at = COALESCE(delivered_at, NOW()),
         read_at = NOW()
     WHERE conversation_id = $1
       AND sender_id <> $2
       AND read_at IS NULL
     RETURNING id, sender_id`,
    [conversationId, readerId]
  );
  return rows;
}

export async function setConversationUnlocked(deliveryId, threadType, unlocked = true) {
  const { rows } = await pool.query(
    `UPDATE conversations
     SET unlocked = $3, updated_at = NOW()
     WHERE delivery_id = $1 AND thread_type = $2::chat_thread_type
     RETURNING *`,
    [deliveryId, threadType, unlocked]
  );
  return rows[0] || null;
}
