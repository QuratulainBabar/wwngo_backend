import { pool } from '../db/pool.js';
import { normalizeRole } from './wallet.repository.js';

/**
 * List reviews received by a user (newest first).
 */
export async function listForReviewee(revieweeId, role, { limit = 20 } = {}) {
  const normalized = normalizeRole(role);
  const capped = Math.min(Math.max(Number(limit) || 20, 1), 50);

  const { rows } = await pool.query(
    `SELECT
       r.id,
       r.rating,
       r.body,
       r.shipment_id,
       r.role,
       r.created_at,
       u.name AS reviewer_name
     FROM reviews r
     INNER JOIN users u ON u.id = r.reviewer_id
     WHERE r.reviewee_id = $1
       AND r.role = $2::wallet_role
     ORDER BY r.created_at DESC
     LIMIT $3`,
    [revieweeId, normalized, capped]
  );
  return rows;
}

/**
 * Create a review and refresh aggregate rating / review_count on the reviewee.
 */
export async function createReview({
  revieweeId,
  reviewerId,
  role,
  rating,
  body,
  shipmentId = null,
}) {
  const normalized = normalizeRole(role);
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `INSERT INTO reviews (reviewee_id, reviewer_id, role, shipment_id, rating, body)
       VALUES ($1, $2, $3::wallet_role, $4, $5, $6)
       RETURNING id, rating, body, shipment_id, role, created_at`,
      [revieweeId, reviewerId, normalized, shipmentId || null, rating, body]
    );

    const { rows: agg } = await client.query(
      `SELECT
         COALESCE(ROUND(AVG(rating)::numeric, 1), 0) AS avg_rating,
         COUNT(*)::int AS review_count
       FROM reviews
       WHERE reviewee_id = $1`,
      [revieweeId]
    );

    await client.query(
      `UPDATE users
       SET rating = $2,
           review_count = $3,
           updated_at = NOW()
       WHERE id = $1`,
      [revieweeId, Number(agg[0].avg_rating), agg[0].review_count]
    );

    const { rows: reviewerRows } = await client.query(
      `SELECT name FROM users WHERE id = $1`,
      [reviewerId]
    );

    await client.query('COMMIT');

    return {
      ...rows[0],
      reviewer_name: reviewerRows[0]?.name ?? 'User',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
