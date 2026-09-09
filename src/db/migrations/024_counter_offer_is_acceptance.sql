-- Distinguish "Accept Offer" (sender's original budget) from real traveler counter-offers.
-- Acceptances still live in trip_counter_offers for payment / sender review, but must
-- not appear on the traveler "Counter Offers Sent" screen.

ALTER TABLE trip_counter_offers
  ADD COLUMN IF NOT EXISTS message TEXT;

ALTER TABLE trip_counter_offers
  ADD COLUMN IF NOT EXISTS is_acceptance BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill: Accept Offer marks the sender request accepted and stores amount = max budget.
UPDATE trip_counter_offers o
SET is_acceptance = TRUE
FROM deliveries d, trip_sender_requests r
WHERE o.delivery_id = d.id
  AND o.sender_request_id = r.id
  AND r.status = 'accepted'
  AND o.status <> 'updated'
  AND ABS(o.amount - d.max_budget) < 0.005;

CREATE INDEX IF NOT EXISTS idx_trip_counter_offers_traveler_counter
  ON trip_counter_offers(traveler_id, updated_at DESC)
  WHERE is_acceptance = FALSE;
