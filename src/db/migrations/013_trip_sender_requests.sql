-- Sender requests sent to a traveler trip (Matching Travelers → Select)

DO $$ BEGIN
  CREATE TYPE trip_sender_request_status AS ENUM (
    'pending',
    'accepted',
    'declined',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS trip_sender_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  traveler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  match_score INT NOT NULL DEFAULT 0,
  status trip_sender_request_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT trip_sender_requests_delivery_trip_unique UNIQUE (delivery_id, trip_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_sender_requests_traveler
  ON trip_sender_requests(traveler_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_sender_requests_trip
  ON trip_sender_requests(trip_id, status);
CREATE INDEX IF NOT EXISTS idx_trip_sender_requests_delivery
  ON trip_sender_requests(delivery_id);

DROP TRIGGER IF EXISTS trip_sender_requests_updated_at ON trip_sender_requests;
CREATE TRIGGER trip_sender_requests_updated_at
  BEFORE UPDATE ON trip_sender_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
