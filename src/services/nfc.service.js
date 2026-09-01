import crypto from 'crypto';
import { pool } from '../db/pool.js';
import { AppError } from '../utils/errors.js';
import { resolveDeliveryId } from '../utils/delivery_resolve.js';
import * as deliveryState from './delivery_state.service.js';
import * as escrowService from './escrow.service.js';
import * as chatRepository from '../repositories/chat.repository.js';
import * as notificationCreateService from './notification_create.service.js';

function hashDevice(deviceId) {
  return crypto.createHash('sha256').update(String(deviceId || 'unknown')).digest('hex');
}

function sameUserId(a, b) {
  return String(a || '').toLowerCase() === String(b || '').toLowerCase();
}

export async function recordCheckpoint({
  deliveryId: deliveryIdOrPublic,
  userId,
  checkpoint,
  deviceId = null,
  gpsLat = null,
  gpsLng = null,
  confirm = false,
  paymentIntentId = null,
}) {
  const deliveryId = await resolveDeliveryId(deliveryIdOrPublic);
  const delivery = await getDeliveryForCheckpoint(deliveryId, userId, checkpoint);
  const deviceHash = deviceId ? hashDevice(deviceId) : null;

  const { rows: existingRows } = await pool.query(
    `SELECT * FROM nfc_checkpoints WHERE delivery_id = $1 AND checkpoint = $2::nfc_checkpoint_type`,
    [deliveryId, checkpoint]
  );
  const existing = existingRows[0];

  if (existing?.confirmed_at) {
    return mapCheckpoint(existing);
  }

  let record;
  if (!existing) {
    const { rows } = await pool.query(
      `INSERT INTO nfc_checkpoints (delivery_id, checkpoint, initiator_id, device_hash, gps_lat, gps_lng, confirmed_at)
       VALUES ($1, $2::nfc_checkpoint_type, $3, $4, $5, $6, NULL)
       RETURNING *`,
      [deliveryId, checkpoint, userId, deviceHash, gpsLat, gpsLng]
    );
    record = rows[0];
  } else {
    const isSecondParty =
      confirm &&
      !sameUserId(existing.initiator_id, userId) &&
      !existing.confirmer_id;
    const { rows } = await pool.query(
      `UPDATE nfc_checkpoints SET
         confirmer_id = CASE WHEN $2::boolean THEN $3 ELSE confirmer_id END,
         device_hash = COALESCE($4, device_hash),
         gps_lat = COALESCE($5, gps_lat),
         gps_lng = COALESCE($6, gps_lng),
         confirmed_at = CASE WHEN $2::boolean THEN NOW() ELSE confirmed_at END
       WHERE delivery_id = $1 AND checkpoint = $7::nfc_checkpoint_type
       RETURNING *`,
      [
        deliveryId,
        isSecondParty,
        userId,
        deviceHash,
        gpsLat,
        gpsLng,
        checkpoint,
      ]
    );
    record = rows[0];
  }

  if (
    confirm &&
    existing &&
    sameUserId(existing.initiator_id, userId) &&
    !existing.confirmer_id
  ) {
    throw new AppError(
      checkpoint === 'delivery_traveler_receiver'
        ? 'Waiting for the receiver to confirm NFC Checkpoint 2 on their device'
        : 'Waiting for the other party to confirm NFC on their device',
      400,
      'NFC_PENDING_PEER'
    );
  }

  if (record.confirmed_at) {
    try {
      await applyCheckpointEffects(delivery, checkpoint, userId, { paymentIntentId });
    } catch (err) {
      console.error(
        `[nfc] checkpoint ${checkpoint} confirmed but effects failed for ${delivery.public_id}:`,
        err?.message || err
      );
      throw err;
    }
  }

  const { rows: freshDelivery } = await pool.query(
    `SELECT status FROM deliveries WHERE id = $1`,
    [delivery.id]
  );
  const mapped = mapCheckpoint(record);
  return {
    ...mapped,
    deliveryStatus: freshDelivery[0]?.status || delivery.status,
  };
}

async function getDeliveryForCheckpoint(deliveryId, userId, checkpoint) {
  const { rows } = await pool.query(`SELECT * FROM deliveries WHERE id = $1`, [deliveryId]);
  const d = rows[0];
  if (!d) throw new AppError('Delivery not found', 404, 'NOT_FOUND');

  if (checkpoint === 'handoff_sender_traveler') {
    const allowed = [d.sender_id, d.traveler_id].filter(Boolean);
    if (!allowed.some((id) => sameUserId(id, userId))) {
      throw new AppError('Not authorized for this checkpoint', 403, 'FORBIDDEN');
    }
  } else if (checkpoint === 'delivery_traveler_receiver') {
    const allowed = [d.traveler_id, d.receiver_id].filter(Boolean);
    if (!allowed.some((id) => sameUserId(id, userId))) {
      throw new AppError('Not authorized for this checkpoint', 403, 'FORBIDDEN');
    }
  }

  return d;
}

async function applyCheckpointEffects(delivery, checkpoint, userId, options = {}) {
  const publicId = delivery.public_id;

  if (checkpoint === 'handoff_sender_traveler') {
    // Traveler handoff fee is charged at bid accept — NFC CP1 only confirms handoff.
    await deliveryState.transitionDelivery({
      deliveryId: delivery.id,
      toStatus: 'collected',
      actorId: userId,
      note: 'NFC checkpoint 1 — sender/traveler handoff',
    });

    if (delivery.traveler_id && delivery.receiver_id) {
      await chatRepository.ensureConversation({
        deliveryId: delivery.id,
        participantAId: delivery.traveler_id,
        participantBId: delivery.receiver_id,
        threadType: 'traveler_receiver',
        unlocked: true,
      });
    }

    for (const [uid, role, title, body, route] of [
      [
        delivery.sender_id,
        'sender',
        'Parcel collected',
        `Your parcel ${publicId} was handed to the traveler.`,
        `/shipment/${publicId}`,
      ],
      [
        delivery.traveler_id,
        'traveler',
        'Parcel collected',
        `You received parcel ${publicId}. Mark in transit when you begin travel.`,
        `/shipment/${publicId}?traveler=true`,
      ],
      [
        delivery.receiver_id,
        'receiver',
        'Parcel collected',
        `Your parcel ${publicId} has been collected by the traveler.`,
        `/receiver-tracking`,
      ],
    ]) {
      if (!uid) continue;
      await notificationCreateService
        .createNotification({
          userId: uid,
          role,
          type: 'deliveryStatus',
          title,
          body,
          route,
        })
        .catch(() => {});
    }
  }

  if (checkpoint === 'delivery_traveler_receiver') {
    await deliveryState.transitionDelivery({
      deliveryId: delivery.id,
      toStatus: 'delivered',
      actorId: userId,
      note: 'NFC checkpoint 2 — delivery to receiver',
    });

    if (delivery.traveler_id) {
      await escrowService.releaseEscrowForDelivery(publicId, delivery.traveler_id);
    }

    await notificationCreateService
      .createNotification({
        userId: delivery.sender_id,
        role: 'sender',
        type: 'deliveryStatus',
        title: 'Delivery complete',
        body: `Parcel ${publicId} was delivered successfully.`,
        route: `/shipment/${publicId}`,
      })
      .catch(() => {});
  }
}

export async function listCheckpoints(deliveryIdOrPublic, userId) {
  const deliveryId = await resolveDeliveryId(deliveryIdOrPublic);
  const { rows: dRows } = await pool.query(
    `SELECT sender_id, traveler_id, receiver_id FROM deliveries WHERE id = $1`,
    [deliveryId]
  );
  const d = dRows[0];
  if (!d) throw new AppError('Delivery not found', 404, 'NOT_FOUND');
  const allowed = [d.sender_id, d.traveler_id, d.receiver_id].filter(Boolean);
  if (!allowed.includes(userId)) {
    throw new AppError('Not authorized', 403, 'FORBIDDEN');
  }

  const { rows } = await pool.query(
    `SELECT * FROM nfc_checkpoints WHERE delivery_id = $1 ORDER BY created_at ASC`,
    [deliveryId]
  );
  return rows.map(mapCheckpoint);
}

function mapCheckpoint(row) {
  return {
    id: row.id,
    deliveryId: row.delivery_id,
    checkpoint: row.checkpoint,
    initiatorId: row.initiator_id,
    confirmerId: row.confirmer_id,
    deviceHash: row.device_hash,
    gpsLat: row.gps_lat != null ? Number(row.gps_lat) : null,
    gpsLng: row.gps_lng != null ? Number(row.gps_lng) : null,
    confirmedAt: row.confirmed_at,
    pendingPeer: Boolean(row.initiator_id && !row.confirmer_id && !row.confirmed_at),
    fraudFlag: row.fraud_flag,
    createdAt: row.created_at,
  };
}
