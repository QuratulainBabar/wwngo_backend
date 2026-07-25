-- User reviews left after deliveries (shown on profile "Recent reviews").

CREATE TABLE IF NOT EXISTS reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reviewee_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role wallet_role NOT NULL,
  shipment_id VARCHAR(32),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT reviews_no_self_review CHECK (reviewee_id <> reviewer_id),
  CONSTRAINT reviews_body_not_blank CHECK (length(trim(body)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_unique_shipment
  ON reviews (reviewer_id, reviewee_id, shipment_id)
  WHERE shipment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reviews_reviewee_role_created
  ON reviews (reviewee_id, role, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_reviews_reviewer_id ON reviews (reviewer_id);
