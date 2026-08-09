-- Traveler trips + destination matching support

DO $$ BEGIN
  CREATE TYPE trip_type AS ENUM ('city_to_city', 'country_to_country');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE trip_status AS ENUM ('open_bid', 'in_transit', 'delivered', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS trips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id VARCHAR(32) NOT NULL,
  traveler_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trip_type trip_type NOT NULL,
  status trip_status NOT NULL DEFAULT 'open_bid',

  -- City to city
  from_city VARCHAR(255),
  from_code VARCHAR(16),
  to_city VARCHAR(255),
  to_code VARCHAR(16),

  -- Country to country
  origin_country VARCHAR(255),
  origin_country_code CHAR(2),
  origin_airport VARCHAR(255),
  destination_country VARCHAR(255),
  destination_country_code CHAR(2),
  destination_airport VARCHAR(255),

  travel_date DATE NOT NULL,
  luggage_capacity_kg NUMERIC(8, 2) NOT NULL,
  flight_number VARCHAR(32),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT trips_public_id_unique UNIQUE (public_id),
  CONSTRAINT trips_capacity_positive CHECK (luggage_capacity_kg > 0),
  CONSTRAINT trips_city_route_check CHECK (
    trip_type <> 'city_to_city'
    OR (
      from_city IS NOT NULL AND to_city IS NOT NULL
    )
  ),
  CONSTRAINT trips_country_route_check CHECK (
    trip_type <> 'country_to_country'
    OR (
      origin_country IS NOT NULL AND destination_country IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_trips_traveler_id ON trips(traveler_id);
CREATE INDEX IF NOT EXISTS idx_trips_status ON trips(status);
CREATE INDEX IF NOT EXISTS idx_trips_type ON trips(trip_type);
CREATE INDEX IF NOT EXISTS idx_trips_travel_date ON trips(travel_date);
CREATE INDEX IF NOT EXISTS idx_trips_to_city_lower ON trips (LOWER(to_city));
CREATE INDEX IF NOT EXISTS idx_trips_destination_country_lower ON trips (LOWER(destination_country));
CREATE INDEX IF NOT EXISTS idx_trips_created_at ON trips(created_at DESC);

DROP TRIGGER IF EXISTS trips_updated_at ON trips;
CREATE TRIGGER trips_updated_at
  BEFORE UPDATE ON trips
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
