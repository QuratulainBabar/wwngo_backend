-- WhatsApp-style per-message delivery and read receipts.
-- delivered_at = peer device received the message (2 grey ticks)
-- read_at     = peer opened the conversation (2 blue ticks)
-- NULL / NULL = sent to server only (1 grey tick)

ALTER TABLE chat_messages
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_chat_messages_undelivered
  ON chat_messages (conversation_id)
  WHERE delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_unread
  ON chat_messages (conversation_id)
  WHERE read_at IS NULL;
