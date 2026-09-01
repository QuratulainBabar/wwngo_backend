-- Backfill per-message read receipts from the existing conversation-level cursor
-- so threads that were already opened show blue ticks instead of "sent".

UPDATE chat_messages m
SET
  delivered_at = COALESCE(m.delivered_at, r.last_read_at),
  read_at = COALESCE(m.read_at, r.last_read_at)
FROM conversation_reads r
WHERE r.conversation_id = m.conversation_id
  AND r.user_id <> m.sender_id
  AND m.created_at <= r.last_read_at
  AND m.read_at IS NULL;
