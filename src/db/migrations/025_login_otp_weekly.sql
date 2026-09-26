-- Weekly email OTP gate for login (password and biometric).
-- NULL means the user has never completed a login email OTP → required on next login.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS login_otp_verified_at TIMESTAMPTZ NULL;

COMMENT ON COLUMN users.login_otp_verified_at IS
  'When the user last completed the weekly login email OTP. Next login requires OTP after 7 days.';
