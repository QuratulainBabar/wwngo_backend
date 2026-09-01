import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';

/** Valid delivery status transitions per proposal lifecycle. */
const TRANSITIONS = {
  posted: ['bid_accepted', 'waiting_receiver', 'cancelled'],
  waiting_receiver: ['bid_accepted', 'cancelled'],
  bid_accepted: ['ready_for_handoff', 'matched', 'collected', 'cancelled', 'disputed'],
  matched: ['ready_for_handoff', 'collected', 'cancelled', 'disputed'],
  ready_for_handoff: ['collected', 'cancelled', 'disputed'],
  collected: ['in_transit', 'cancelled', 'disputed'],
  in_transit: ['delivered', 'disputed'],
  delivered: ['disputed'],
  cancelled: [],
  disputed: ['delivered', 'cancelled'],
};

export function canTransition(from, to) {
  const allowed = TRANSITIONS[from] || [];
  return allowed.includes(to);
}

export async function transitionDelivery({
  deliveryId,
  toStatus,
  actorId = null,
  note = null,
  extraSets = {},
}) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `SELECT id, status, public_id FROM deliveries WHERE id = $1 FOR UPDATE`,
      [deliveryId]
    );
    const delivery = rows[0];
    if (!delivery) {
      throw new AppError('Delivery not found', 404, 'NOT_FOUND');
    }

    const fromStatus = delivery.status;
    if (fromStatus === toStatus) {
      await client.query('COMMIT');
      return delivery;
    }

    if (!canTransition(fromStatus, toStatus)) {
      throw new AppError(
        `Cannot transition delivery from ${fromStatus} to ${toStatus}`,
        400,
        'INVALID_STATUS_TRANSITION'
      );
    }

    const setClauses = ['status = $2::delivery_status', 'updated_at = NOW()'];
    const params = [deliveryId, toStatus];
    let idx = 3;

    const timestampFields = {
      bid_accepted: 'matched_at',
      collected: 'collected_at',
      in_transit: 'in_transit_at',
      delivered: 'delivered_at',
    };
    const tsField = timestampFields[toStatus];
    if (tsField) {
      setClauses.push(`${tsField} = NOW()`);
    }

    for (const [col, val] of Object.entries(extraSets)) {
      setClauses.push(`${col} = $${idx}`);
      params.push(val);
      idx += 1;
    }

    const { rows: updated } = await client.query(
      `UPDATE deliveries SET ${setClauses.join(', ')} WHERE id = $1 RETURNING *`,
      params
    );

    await client.query(
      `INSERT INTO delivery_status_history (delivery_id, from_status, to_status, actor_id, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [deliveryId, fromStatus, toStatus, actorId, note]
    );

    await client.query('COMMIT');
    return updated[0];
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function getStatusHistory(deliveryId) {
  const { rows } = await pool.query(
    `SELECT h.*, u.name AS actor_name
     FROM delivery_status_history h
     LEFT JOIN users u ON u.id = h.actor_id
     WHERE h.delivery_id = $1
     ORDER BY h.created_at ASC`,
    [deliveryId]
  );
  return rows;
}

export function trackingStepsForStatus(status) {
  const order = [
    'bid_accepted',
    'photos_uploaded',
    'collected',
    'in_transit',
    'delivered',
  ];
  const statusIndex = {
    posted: -1,
    waiting_receiver: 0,
    bid_accepted: 0,
    matched: 0,
    ready_for_handoff: 1,
    collected: 2,
    in_transit: 3,
    delivered: 4,
    cancelled: -1,
    disputed: -1,
  };
  const current = statusIndex[status] ?? -1;
  return order.map((step, i) => ({
    step,
    completed: current >= i,
    active: current === i,
  }));
}
