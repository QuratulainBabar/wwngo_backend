-- Receiver contact details on deliveries (sender post flow)

ALTER TABLE deliveries
  ADD COLUMN IF NOT EXISTS receiver_email VARCHAR(255),
  ADD COLUMN IF NOT EXISTS receiver_phone VARCHAR(32);
