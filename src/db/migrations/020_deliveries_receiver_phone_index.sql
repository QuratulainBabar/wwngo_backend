-- Speed up receiver-access lookups.
--
-- listDeliveriesForReceiver / findDeliveryFor*Receiver match receivers by phone
-- with regexp_replace(receiver_phone, '\D', ...) evaluated on EVERY row — a
-- sequential scan that runs the regex per row and gets slower as the table
-- grows. Precompute the normalized digits into a STORED generated column
-- (auto-maintained on every write, no app changes) and index it so the common
-- exact / national matches become index lookups instead of full scans.

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS receiver_phone_digits TEXT
  GENERATED ALWAYS AS (regexp_replace(COALESCE(receiver_phone, ''), '\D', '', 'g')) STORED;

-- Exact full-digit match (e.g. +92329… → 92329…).
CREATE INDEX IF NOT EXISTS idx_deliveries_receiver_phone_digits
  ON deliveries (receiver_phone_digits)
  WHERE receiver_phone_digits <> '';

-- National form with leading zeros stripped (legacy 0329… vs E.164 92329…).
CREATE INDEX IF NOT EXISTS idx_deliveries_receiver_phone_national
  ON deliveries (regexp_replace(receiver_phone_digits, '^0+', ''))
  WHERE receiver_phone_digits <> '';
