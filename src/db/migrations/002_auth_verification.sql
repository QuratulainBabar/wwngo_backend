-- Auth verification + lockout columns (Section I)

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;

UPDATE users
SET email_verified = is_verified,
    phone_verified = is_verified
WHERE email_verified = FALSE AND phone_verified = FALSE;

ALTER TABLE otp_codes
  DROP CONSTRAINT IF EXISTS otp_codes_contact_type_check;

ALTER TABLE otp_codes
  ADD CONSTRAINT otp_codes_contact_type_check
  CHECK (contact_type IN ('email', 'phone', 'whatsapp'));

ALTER TABLE otp_codes
  ALTER COLUMN user_id DROP NOT NULL;
