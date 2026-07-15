-- Sumsub KYC applicant linkage
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS sumsub_applicant_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS sumsub_review_status VARCHAR(64);

CREATE INDEX IF NOT EXISTS users_sumsub_applicant_id_idx
  ON users (sumsub_applicant_id)
  WHERE sumsub_applicant_id IS NOT NULL;
