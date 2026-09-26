-- Country-to-country deliveries: allow city endpoints; store departure/method/flight.
ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS departure_time TIME NULL,
  ADD COLUMN IF NOT EXISTS travel_method VARCHAR(16) NULL,
  ADD COLUMN IF NOT EXISTS flight_number VARCHAR(32) NULL;

ALTER TABLE deliveries DROP CONSTRAINT IF EXISTS deliveries_country_route_check;

ALTER TABLE deliveries
  ADD CONSTRAINT deliveries_country_route_check CHECK (
    delivery_type <> 'country_to_country'
    OR (
      origin_country IS NOT NULL
      AND destination_country IS NOT NULL
      AND (
        (origin_airport IS NOT NULL AND btrim(origin_airport) <> '')
        OR (from_city IS NOT NULL AND btrim(from_city) <> '')
      )
      AND (
        (destination_airport IS NOT NULL AND btrim(destination_airport) <> '')
        OR (to_city IS NOT NULL AND btrim(to_city) <> '')
      )
    )
  );

COMMENT ON COLUMN deliveries.departure_time IS 'Preferred departure / leaving time (local), HH:MM';
COMMENT ON COLUMN deliveries.travel_method IS 'air | land — required when city endpoints are used';
COMMENT ON COLUMN deliveries.flight_number IS 'Optional flight number for air travel';
