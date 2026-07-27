-- Receiver meetup location on deliveries (sender post / edit flow)

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS receiver_meetup_location VARCHAR(240);
