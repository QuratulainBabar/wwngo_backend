import { resolveDeliveryId } from '../utils/delivery_resolve.js';
import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import * as chatRepository from '../repositories/chat.repository.js';

async function finalizeMeetupIfFullyAgreed(deliveryId) {
  const { rows } = await pool.query(`SELECT * FROM deliveries WHERE id = $1`, [deliveryId]);
  const d = rows[0];
  if (!d) return null;

  const fullyAgreed =
    Boolean(d.meetup_agreed_by_sender) && Boolean(d.meetup_agreed_by_traveler);
  if (!fullyAgreed) {
    return getMeetupStatusRow(d);
  }

  await pool.query(
    `UPDATE deliveries
     SET status = 'ready_for_handoff'::delivery_status,
         updated_at = NOW()
     WHERE id = $1
       AND status IN ('bid_accepted', 'matched')`,
    [deliveryId]
  );

  if (d.sender_id && d.traveler_id) {
    await chatRepository.ensureConversation({
      deliveryId,
      participantAId: d.sender_id,
      participantBId: d.traveler_id,
      threadType: 'sender_traveler',
      unlocked: true,
    });
    await chatRepository.setConversationUnlocked(deliveryId, 'sender_traveler', true);
  }

  const { rows: updated } = await pool.query(`SELECT * FROM deliveries WHERE id = $1`, [
    deliveryId,
  ]);
  return getMeetupStatusRow(updated[0] || d);
}

function getMeetupStatusRow(d) {
  return {
    deliveryId: d.id,
    location: d.meetup_location,
    agreedBySender: Boolean(d.meetup_agreed_by_sender),
    agreedByTraveler: Boolean(d.meetup_agreed_by_traveler),
    fullyAgreed: Boolean(d.meetup_agreed_by_sender && d.meetup_agreed_by_traveler),
    chatUnlocked: Boolean(d.chat_unlocked),
    deliveryStatus: d.status,
  };
}

export async function proposeMeetup(deliveryIdOrPublic, userId, { location }) {
  const deliveryId = await resolveDeliveryId(deliveryIdOrPublic);
  const label = String(location || '').trim();
  if (!label) throw new AppError('Meetup location is required', 400, 'VALIDATION_ERROR');

  const delivery = await getDeliveryAndAssertParticipant(deliveryId, userId);

  // Once the traveler has accepted the proposed meetup, lock further changes.
  if (Boolean(delivery.meetup_agreed_by_traveler)) {
    throw new AppError(
      'Meetup location already accepted by traveler and can no longer be changed',
      400,
      'MEETUP_ALREADY_ACCEPTED'
    );
  }

  const isSender = delivery.participantRole === 'sender';

  await pool.query(
    `UPDATE deliveries
     SET meetup_location = $2,
         meetup_agreed_by_sender = $3,
         meetup_agreed_by_traveler = $4,
         updated_at = NOW()
     WHERE id = $1`,
    [deliveryId, label, isSender, isSender ? false : true]
  );

  await pool.query(
    `INSERT INTO meetup_agreements (delivery_id, location_label, agreed_by, role)
     VALUES ($1, $2, $3, $4)`,
    [deliveryId, label, userId, delivery.participantRole]
  );

  return finalizeMeetupIfFullyAgreed(deliveryId);
}

export async function agreeMeetup(deliveryIdOrPublic, userId) {
  const deliveryId = await resolveDeliveryId(deliveryIdOrPublic);
  const delivery = await getDeliveryAndAssertParticipant(deliveryId, userId);
  const col =
    delivery.participantRole === 'sender'
      ? 'meetup_agreed_by_sender'
      : 'meetup_agreed_by_traveler';

  if (!delivery.meetup_location) {
    throw new AppError(
      'Propose a meetup location before confirming agreement',
      400,
      'MEETUP_LOCATION_REQUIRED'
    );
  }

  await pool.query(
    `UPDATE deliveries SET ${col} = TRUE, updated_at = NOW() WHERE id = $1`,
    [deliveryId]
  );

  return finalizeMeetupIfFullyAgreed(deliveryId);
}

export async function getMeetupStatus(deliveryIdOrPublic, userId) {
  const deliveryId = await resolveDeliveryId(deliveryIdOrPublic);
  await getDeliveryAndAssertParticipant(deliveryId, userId);
  const { rows } = await pool.query(`SELECT * FROM deliveries WHERE id = $1`, [deliveryId]);
  const d = rows[0];
  if (!d) throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  return getMeetupStatusRow(d);
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
