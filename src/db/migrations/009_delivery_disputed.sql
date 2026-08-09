-- Track disputes on deliveries for profile trust indicators.

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS disputed BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_deliveries_sender_status
  ON deliveries (sender_id, status);

CREATE INDEX IF NOT EXISTS idx_deliveries_sender_disputed
  ON deliveries (sender_id)
  WHERE disputed = TRUE;
