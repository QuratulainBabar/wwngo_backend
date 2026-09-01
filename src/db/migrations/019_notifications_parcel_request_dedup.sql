-- Make "Incoming Parcel Request" alerts exactly-once per (receiver, parcel).
--
-- The notification/push for a parcel request is created from two places
-- (delivery creation and the receiver list-fetch backfill). Dedup was a
-- read-then-write check with no DB guard, so two concurrent list fetches
-- could both insert and fire two FCM pushes. A partial unique index scoped
-- to parcelRequest closes that race; other notification types legitimately
-- reuse routes and are left untouched.

-- 1) Collapse any pre-existing duplicates, keeping the earliest per route.
DELETE FROM notifications n
USING (
  SELECT id,
         ROW_NUMBER() OVER (
           PARTITION BY user_id, role, route
           ORDER BY created_at ASC, id ASC
         ) AS rn
  FROM notifications
  WHERE type = 'parcelRequest' AND route IS NOT NULL
) dup
WHERE n.id = dup.id
  AND dup.rn > 1;

-- 2) Enforce one parcelRequest notification per (user_id, role, route).
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_parcel_request_unique
  ON notifications (user_id, role, route)
  WHERE type = 'parcelRequest' AND route IS NOT NULL;
