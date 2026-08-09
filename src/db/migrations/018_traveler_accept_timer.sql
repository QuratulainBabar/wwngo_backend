-- Traveler must accept/decline sender request within 2h (departure ≤24h) or 12h (else)

ALTER TABLE trip_sender_requests
  ADD COLUMN IF NOT EXISTS accept_due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_trip_sender_requests_accept_due
  ON trip_sender_requests(accept_due_at)
  WHERE status = 'pending' AND accept_due_at IS NOT NULL;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id VARCHAR(128);
