-- Platform completion: lifecycle, dual chat, NFC, timers, admin, disputes

-- Extend delivery lifecycle states
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'bid_accepted';
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'waiting_receiver';
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'ready_for_handoff';
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'collected';
ALTER TYPE delivery_status ADD VALUE IF NOT EXISTS 'disputed';

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS avatar_url VARCHAR(512);

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS traveler_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS trip_id UUID REFERENCES trips(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS matched_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS bid_amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS receiver_fee_cents INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS receiver_payment_due_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS receiver_paid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS meetup_location TEXT,
  ADD COLUMN IF NOT EXISTS meetup_agreed_by_sender BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS meetup_agreed_by_traveler BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS chat_unlocked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS collected_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS in_transit_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_deliveries_traveler_id ON deliveries(traveler_id);
CREATE INDEX IF NOT EXISTS idx_deliveries_payment_due ON deliveries(receiver_payment_due_at)
  WHERE receiver_payment_due_at IS NOT NULL AND receiver_paid_at IS NULL;

-- Dual-thread chat: allow multiple conversations per delivery
ALTER TABLE conversations DROP CONSTRAINT IF EXISTS conversations_delivery_unique;

DO $$ BEGIN
  CREATE TYPE chat_thread_type AS ENUM (
    'sender_receiver',
    'sender_traveler',
    'traveler_receiver'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS thread_type chat_thread_type NOT NULL DEFAULT 'sender_receiver';

UPDATE conversations SET thread_type = 'sender_receiver' WHERE thread_type IS NULL;

ALTER TABLE conversations
  DROP CONSTRAINT IF EXISTS conversations_delivery_thread_unique;

ALTER TABLE conversations
  ADD CONSTRAINT conversations_delivery_thread_unique
  UNIQUE (delivery_id, thread_type);

ALTER TABLE conversations
  ADD COLUMN IF NOT EXISTS unlocked BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE conversations SET unlocked = TRUE;

-- NFC checkpoints
DO $$ BEGIN
  CREATE TYPE nfc_checkpoint_type AS ENUM ('handoff_sender_traveler', 'delivery_traveler_receiver');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS nfc_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  checkpoint nfc_checkpoint_type NOT NULL,
  initiator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  confirmer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  device_hash VARCHAR(128),
  gps_lat NUMERIC(10, 7),
  gps_lng NUMERIC(10, 7),
  confirmed_at TIMESTAMPTZ,
  fraud_flag BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT nfc_checkpoints_delivery_checkpoint_unique UNIQUE (delivery_id, checkpoint)
);

CREATE INDEX IF NOT EXISTS idx_nfc_checkpoints_delivery ON nfc_checkpoints(delivery_id);

-- Meetup agreements log
CREATE TABLE IF NOT EXISTS meetup_agreements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  location_label TEXT NOT NULL,
  agreed_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('sender', 'traveler')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Delivery status history (immutable audit)
CREATE TABLE IF NOT EXISTS delivery_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  from_status delivery_status,
  to_status delivery_status NOT NULL,
  actor_id UUID REFERENCES users(id) ON DELETE SET NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_delivery_status_history_delivery
  ON delivery_status_history(delivery_id, created_at DESC);

-- Disputes
DO $$ BEGIN
  CREATE TYPE dispute_status AS ENUM ('open', 'under_review', 'resolved', 'dismissed');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id UUID NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  opened_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status dispute_status NOT NULL DEFAULT 'open',
  resolution TEXT,
  resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ban list
CREATE TABLE IF NOT EXISTS ban_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ban_type VARCHAR(32) NOT NULL CHECK (ban_type IN ('email_hash', 'phone_hash', 'identity_hash', 'ip')),
  value_hash VARCHAR(128) NOT NULL,
  reason TEXT,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ban_entries_type_hash_unique UNIQUE (ban_type, value_hash)
);

-- Stripe payment references
ALTER TABLE shipment_escrows
  ADD COLUMN IF NOT EXISTS stripe_payment_intent_id VARCHAR(128),
  ADD COLUMN IF NOT EXISTS stripe_transfer_id VARCHAR(128);

-- Sender request accept/decline timestamps
ALTER TABLE trip_sender_requests
  ADD COLUMN IF NOT EXISTS responded_at TIMESTAMPTZ;
