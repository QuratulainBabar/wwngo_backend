import { resolveDeliveryId } from '../utils/delivery_resolve.js';
import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import * as chatRepository from '../repositories/chat.repository.js';

export async function proposeMeetup(deliveryIdOrPublic, userId, { location }) {
  const deliveryId = await resolveDeliveryId(deliveryIdOrPublic);
  const label = String(location || '').trim();
  if (!label) throw new AppError('Meetup location is required', 400, 'VALIDATION_ERROR');

  const delivery = await getDeliveryAndAssertParticipant(deliveryId, userId);

  await pool.query(
    `UPDATE deliveries SET meetup_location = $2, updated_at = NOW() WHERE id = $1`,
    [deliveryId, label]
  );

  await pool.query(
    `INSERT INTO meetup_agreements (delivery_id, location_label, agreed_by, role)
     VALUES ($1, $2, $3, $4)`,
    [deliveryId, label, userId, delivery.participantRole]
  );

  return getMeetupStatus(deliveryId, userId);
}

export async function agreeMeetup(deliveryIdOrPublic, userId) {
  const deliveryId = await resolveDeliveryId(deliveryIdOrPublic);
  const delivery = await getDeliveryAndAssertParticipant(deliveryId, userId);
  const col =
    delivery.participantRole === 'sender'
      ? 'meetup_agreed_by_sender'
      : 'meetup_agreed_by_traveler';

  await pool.query(
    `UPDATE deliveries SET ${col} = TRUE, updated_at = NOW() WHERE id = $1`,
    [deliveryId]
  );

  const status = await getMeetupStatus(deliveryId, userId);

  if (status.fullyAgreed) {
    await pool.query(
      `UPDATE deliveries SET chat_unlocked = TRUE, status = 'ready_for_handoff'::delivery_status, updated_at = NOW()
       WHERE id = $1 AND status IN ('bid_accepted', 'matched')`,
      [deliveryId]
    );

    if (delivery.sender_id && delivery.traveler_id) {
      await chatRepository.ensureConversation({
        deliveryId,
        participantAId: delivery.sender_id,
        participantBId: delivery.traveler_id,
        threadType: 'sender_traveler',
        unlocked: true,
      });
      await chatRepository.setConversationUnlocked(deliveryId, 'sender_traveler', true);
    }
  }

  return getMeetupStatus(deliveryId, userId);
}

export async function getMeetupStatus(deliveryIdOrPublic, userId) {
  const deliveryId = await resolveDeliveryId(deliveryIdOrPublic);
  const { rows } = await pool.query(`SELECT * FROM deliveries WHERE id = $1`, [deliveryId]);
  const d = rows[0];
  if (!d) throw new AppError('Delivery not found', 404, 'NOT_FOUND');

  return {
    deliveryId,
    location: d.meetup_location,
    agreedBySender: Boolean(d.meetup_agreed_by_sender),
    agreedByTraveler: Boolean(d.meetup_agreed_by_traveler),
    fullyAgreed: Boolean(d.meetup_agreed_by_sender && d.meetup_agreed_by_traveler),
    chatUnlocked: Boolean(d.chat_unlocked),
  };
}

async function getDeliveryAndAssertParticipant(deliveryId, userId) {
  const { rows } = await pool.query(`SELECT * FROM deliveries WHERE id = $1`, [deliveryId]);
  const d = rows[0];
  if (!d) throw new AppError('Delivery not found', 404, 'NOT_FOUND');

  if (d.sender_id === userId) {
    return { ...d, participantRole: 'sender' };
  }
  if (d.traveler_id === userId) {
    return { ...d, participantRole: 'traveler' };
  }
  throw new AppError('Only sender or traveler can manage meetup', 403, 'FORBIDDEN');
}
