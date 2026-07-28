-- Track when a traveler has viewed a sender request (unread badge).

ALTER TABLE trip_sender_requests
  ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_trip_sender_requests_traveler_unread
  ON trip_sender_requests(traveler_id, status, read_at)
  WHERE read_at IS NULL AND status = 'pending';
