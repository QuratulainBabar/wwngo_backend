-- Persist the app role chosen after registration / onboarding.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS role VARCHAR(20);

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
  ADD CONSTRAINT users_role_check
  CHECK (role IS NULL OR role IN ('sender', 'traveler', 'receiver'));
