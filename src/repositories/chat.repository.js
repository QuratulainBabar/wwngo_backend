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
              SELECT body FROM chat_messages m
              WHERE m.conversation_id = c.id
              ORDER BY m.created_at DESC
              LIMIT 1
            ) AS last_message,
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
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO chat_messages (conversation_id, sender_id, body, is_image, image_name)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [conversationId, senderId, body || '', isImage, imageName]
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
