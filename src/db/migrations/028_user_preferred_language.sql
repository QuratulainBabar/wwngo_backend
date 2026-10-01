ALTER TABLE users
  ADD COLUMN IF NOT EXISTS preferred_language VARCHAR(8) NOT NULL DEFAULT 'en';

COMMENT ON COLUMN users.preferred_language IS
  'BCP-47 language code for FCM/system push localization (en, fr, es, …).';
