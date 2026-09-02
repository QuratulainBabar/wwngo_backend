-- One wallet per user. Sender / traveler / receiver remain activity tags on ledger rows.

CREATE TABLE IF NOT EXISTS wallets_unified (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  available_cents INTEGER NOT NULL DEFAULT 0 CHECK (available_cents >= 0),
  escrow_cents INTEGER NOT NULL DEFAULT 0 CHECK (escrow_cents >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT wallets_unified_user_unique UNIQUE (user_id)
);

INSERT INTO wallets_unified (user_id, available_cents, escrow_cents, created_at)
SELECT
  user_id,
  COALESCE(SUM(available_cents), 0),
  COALESCE(SUM(escrow_cents), 0),
  MIN(created_at)
FROM wallets
GROUP BY user_id
ON CONFLICT (user_id) DO UPDATE SET
  available_cents = EXCLUDED.available_cents,
  escrow_cents = EXCLUDED.escrow_cents,
  updated_at = NOW();

DROP TABLE IF EXISTS wallets;
ALTER TABLE wallets_unified RENAME TO wallets;

CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);

DROP TRIGGER IF EXISTS wallets_updated_at ON wallets;
CREATE TRIGGER wallets_updated_at
  BEFORE UPDATE ON wallets
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();

DROP INDEX IF EXISTS idx_wallet_ledger_user_role_created;
CREATE INDEX IF NOT EXISTS idx_wallet_ledger_user_created
  ON wallet_ledger(user_id, created_at DESC);

UPDATE users u
SET wallet_balance = COALESCE(
  (SELECT w.available_cents FROM wallets w WHERE w.user_id = u.id),
  0
) / 100.0,
updated_at = NOW();
