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

export async function recordCheckpoint({
  deliveryId: deliveryIdOrPublic,
  userId,
  checkpoint,
  deviceId = null,
  gpsLat = null,
  gpsLng = null,
  confirm = false,
}) {
  const deliveryId = await resolveDeliveryId(deliveryIdOrPublic);
  const delivery = await getDeliveryForCheckpoint(deliveryId, userId, checkpoint);
  const deviceHash = deviceId ? hashDevice(deviceId) : null;

  const { rows } = await pool.query(
    `INSERT INTO nfc_checkpoints (delivery_id, checkpoint, initiator_id, device_hash, gps_lat, gps_lng, confirmed_at)
     VALUES ($1, $2::nfc_checkpoint_type, $3, $4, $5, $6, CASE WHEN $7 THEN NOW() ELSE NULL END)
     ON CONFLICT (delivery_id, checkpoint) DO UPDATE SET
       device_hash = COALESCE(EXCLUDED.device_hash, nfc_checkpoints.device_hash),
       gps_lat = COALESCE(EXCLUDED.gps_lat, nfc_checkpoints.gps_lat),
       gps_lng = COALESCE(EXCLUDED.gps_lng, nfc_checkpoints.gps_lng),
       confirmed_at = CASE WHEN $7 THEN NOW() ELSE nfc_checkpoints.confirmed_at END
     RETURNING *`,
    [deliveryId, checkpoint, userId, deviceHash, gpsLat, gpsLng, confirm]
  );

  const record = rows[0];

  if (confirm) {
    await applyCheckpointEffects(delivery, checkpoint, userId);
  }

  return mapCheckpoint(record);
}

async function getDeliveryForCheckpoint(deliveryId, userId, checkpoint) {
  const { rows } = await pool.query(`SELECT * FROM deliveries WHERE id = $1`, [deliveryId]);
  const d = rows[0];
  if (!d) throw new AppError('Delivery not found', 404, 'NOT_FOUND');

  if (checkpoint === 'handoff_sender_traveler') {
    const allowed = [d.sender_id, d.traveler_id].filter(Boolean);
    if (!allowed.includes(userId)) {
      throw new AppError('Not authorized for this checkpoint', 403, 'FORBIDDEN');
    }
  } else if (checkpoint === 'delivery_traveler_receiver') {
    const allowed = [d.traveler_id, d.receiver_id].filter(Boolean);
    if (!allowed.includes(userId)) {
      throw new AppError('Not authorized for this checkpoint', 403, 'FORBIDDEN');
    }
  }

  return d;
}

async function applyCheckpointEffects(delivery, checkpoint, userId) {
  const publicId = delivery.public_id;

  if (checkpoint === 'handoff_sender_traveler') {
    if (delivery.traveler_id) {
      await escrowService.chargeTravelerHandoffFee(delivery.traveler_id, publicId);
    }
    await deliveryState.transitionDelivery({
      deliveryId: delivery.id,
      toStatus: 'collected',
      actorId: userId,
      note: 'NFC checkpoint 1 — sender/traveler handoff',
    });

    await deliveryState.transitionDelivery({
      deliveryId: delivery.id,
      toStatus: 'in_transit',
      actorId: userId,
      note: 'Parcel in transit after handoff',
    });

    // Unlock traveler-receiver thread
    if (delivery.traveler_id && delivery.receiver_id) {
      await chatRepository.ensureConversation({
        deliveryId: delivery.id,
        participantAId: delivery.traveler_id,
        participantBId: delivery.receiver_id,
        threadType: 'traveler_receiver',
        unlocked: true,
      });
    }

    await notificationCreateService.createNotification({
      userId: delivery.receiver_id,
      role: 'receiver',
      type: 'deliveryStatus',
      title: 'Parcel collected',
      body: `Your parcel ${publicId} has been collected by the traveler.`,
      route: `/receiver-tracking`,
    }).catch(() => {});
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

    await notificationCreateService.createNotification({
      userId: delivery.sender_id,
      role: 'sender',
      type: 'deliveryStatus',
      title: 'Delivery complete',
      body: `Parcel ${publicId} was delivered successfully.`,
      route: `/shipment/${publicId}`,
    }).catch(() => {});
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
    fraudFlag: row.fraud_flag,
    createdAt: row.created_at,
  };
}
