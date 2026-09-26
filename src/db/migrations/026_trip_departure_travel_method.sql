-- Departure time + travel method for country-to-country (and general) trips.
ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS departure_time TIME NULL,
  ADD COLUMN IF NOT EXISTS travel_method VARCHAR(16) NULL;

COMMENT ON COLUMN trips.departure_time IS 'Traveler departure / leaving time (local), HH:MM';
COMMENT ON COLUMN trips.travel_method IS 'air | land — required when city endpoints are used';
