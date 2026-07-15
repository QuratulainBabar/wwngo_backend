-- Sender "Create Delivery" / Post Delivery schema

DO $$ BEGIN
  CREATE TYPE delivery_type AS ENUM ('city_to_city', 'country_to_country');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE delivery_status AS ENUM (
    'posted',
    'matched',
    'in_transit',
    'delivered',
    'cancelled'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id VARCHAR(32) NOT NULL,
  sender_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivery_type delivery_type NOT NULL,
  status delivery_status NOT NULL DEFAULT 'posted',

  -- City to city route
  from_city VARCHAR(255),
  from_code VARCHAR(16),
  to_city VARCHAR(255),
  to_code VARCHAR(16),

  -- Country to country route
  origin_country VARCHAR(255),
  origin_airport VARCHAR(255),
  destination_country VARCHAR(255),
  destination_airport VARCHAR(255),

  travel_date DATE NOT NULL,
  parcel_category VARCHAR(50) NOT NULL,
  parcel_size VARCHAR(50) NOT NULL,
  weight_kg NUMERIC(8, 2) NOT NULL,
  max_budget NUMERIC(10, 2) NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  preferred_meetup_locations TEXT[] NOT NULL DEFAULT '{}',
  acknowledged BOOLEAN NOT NULL DEFAULT FALSE,
  platform_fee NUMERIC(10, 2) NOT NULL DEFAULT 5.00,
  platform_fee_share NUMERIC(10, 2) NOT NULL DEFAULT 2.50,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT deliveries_public_id_unique UNIQUE (public_id),
  CONSTRAINT deliveries_weight_positive CHECK (weight_kg > 0),
  CONSTRAINT deliveries_budget_positive CHECK (max_budget > 0),
  CONSTRAINT deliveries_acknowledged_true CHECK (acknowledged = TRUE),
  CONSTRAINT deliveries_city_route_check CHECK (
    delivery_type <> 'city_to_city'
    OR (
      from_city IS NOT NULL AND from_code IS NOT NULL
      AND to_city IS NOT NULL AND to_code IS NOT NULL
    )
  ),
  CONSTRAINT deliveries_country_route_check CHECK (
    delivery_type <> 'country_to_country'
    OR (
      origin_country IS NOT NULL AND origin_airport IS NOT NULL
      AND destination_country IS NOT NULL AND destination_airport IS NOT NULL
    )
  )
);

CREATE TABLE IF NOT EXISTS delivery_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  file_path VARCHAR(512) NOT NULL,
  original_name VARCHAR(255),
  mime_type VARCHAR(100),
  size_bytes INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deliveries_sender_id ON deliveries(sender_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_status ON deliveries(status);
CREATE INDEX IF NOT EXISTS idx_deliveries_type ON deliveries(delivery_type);
CREATE INDEX IF NOT EXISTS idx_deliveries_created_at ON deliveries(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_delivery_photos_delivery_id ON delivery_photos(delivery_id);

DROP TRIGGER IF EXISTS deliveries_updated_at ON deliveries;
CREATE TRIGGER deliveries_updated_at
  BEFORE UPDATE ON deliveries
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
