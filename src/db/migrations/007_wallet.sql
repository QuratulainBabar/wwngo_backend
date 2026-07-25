-- Wallet balances (per user + role), escrow holds, and append-only ledger.

DO $$ BEGIN
  CREATE TYPE wallet_role AS ENUM ('sender', 'traveler', 'receiver');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE wallet_ledger_type AS ENUM (
    'top_up',
    'withdrawal',
    'escrow_hold',
    'escrow_release',
    'escrow_freeze',
    'delivery_payout',
    'platform_fee',
    'refund'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE shipment_escrow_status AS ENUM (
    'held',
    'frozen',
    'refunded',
    'released'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS wallets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role wallet_role NOT NULL,
  available_cents INTEGER NOT NULL DEFAULT 0 CHECK (available_cents >= 0),
  escrow_cents INTEGER NOT NULL DEFAULT 0 CHECK (escrow_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallets_user_role_unique UNIQUE (user_id, role)
);

CREATE TABLE IF NOT EXISTS wallet_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role wallet_role NOT NULL,
  type wallet_ledger_type NOT NULL,
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  available_delta_cents INTEGER NOT NULL DEFAULT 0,
  escrow_delta_cents INTEGER NOT NULL DEFAULT 0,
  description TEXT NOT NULL,
  shipment_id VARCHAR(64),
  hidden_from_history BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shipment_escrows (
  shipment_id VARCHAR(64) PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role wallet_role NOT NULL DEFAULT 'sender',
  amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
  status shipment_escrow_status NOT NULL DEFAULT 'held',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_role_created
  ON wallet_ledger(user_id, role, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_shipment
  ON wallet_ledger(shipment_id)
  WHERE shipment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shipment_escrows_user_id ON shipment_escrows(user_id);

DROP TRIGGER IF EXISTS wallets_updated_at ON wallets;
CREATE TRIGGER wallets_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS shipment_escrows_updated_at ON shipment_escrows;
CREATE TRIGGER shipment_escrows_updated_at
  BEFORE UPDATE ON shipment_escrows
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
