-- Traveler counter offers sent in response to a sender trip request.

DO $$ BEGIN
  CREATE TYPE trip_counter_offer_status AS ENUM (
    'pending',
    'updated',
    'accepted',
    'rejected'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS trip_counter_offers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_request_id UUID NOT NULL REFERENCES trip_sender_requests(id) ON DELETE CASCADE,
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  trip_id UUID NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  traveler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL CHECK (amount > 0),
  status trip_counter_offer_status NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT trip_counter_offers_request_unique UNIQUE (sender_request_id)
);

CREATE INDEX IF NOT EXISTS idx_trip_counter_offers_traveler
  ON trip_counter_offers(traveler_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_counter_offers_sender
  ON trip_counter_offers(sender_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trip_counter_offers_delivery
  ON trip_counter_offers(delivery_id);

DROP TRIGGER IF EXISTS trip_counter_offers_updated_at ON trip_counter_offers;
CREATE TRIGGER trip_counter_offers_updated_at
  BEFORE UPDATE ON trip_counter_offers
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
