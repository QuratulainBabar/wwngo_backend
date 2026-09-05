import { AppError } from '../utils/errors.js';
import * as chatRepository from '../repositories/chat.repository.js';
import { pool } from '../db/pool.js';
import {
  emitToConversation,
  emitToUser,
  isUserInConversation,
  isUserOnline,
} from './socket_hub.js';
import { sendPushToUser } from './fcm.service.js';

const SENDER_TRAVELER_CHAT_STATUSES = new Set([
  'bid_accepted',
  'matched',
  'ready_for_handoff',
  'collected',
  'in_transit',
]);

function toIso(date) {
  if (!date) return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function formatMessageTime(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function formatInboxTime(date) {
  if (!date) return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startMsg = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dayDiff = Math.round((startToday - startMsg) / 86400000);
  if (dayDiff === 0) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  if (dayDiff === 1) return 'Yesterday';
  if (dayDiff < 7) {
    return d.toLocaleDateString(undefined, { weekday: 'short' });
  }
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function mapConversation(row) {
  const peerName = row.peer_name || 'Contact';
  const initial = peerName.trim().charAt(0).toUpperCase() || '?';
  const rawLast = String(row.last_message || '').trim();
  const lastIsImage =
    Boolean(row.last_message_is_image) ||
    rawLast === '[Image]' ||
    rawLast === '📷 Photo' ||
    rawLast.toLowerCase() === 'photo';
  const lastMessage = lastIsImage
      ? '📷 Photo'
      : rawLast || 'No messages yet';
  return {
    id: row.id,
    name: peerName,
    initial,
    lastMessage,
    lastMessageIsImage: lastIsImage,
    time: formatInboxTime(row.last_message_at || row.updated_at),
    lastMessageAt: toIso(row.last_message_at || row.updated_at),
    shipmentId: row.delivery_public_id || '',
    unreadCount: Number(row.unread_count) || 0,
    deliveryId: row.delivery_id,
    deliveryStatus: row.delivery_status,
    threadType: row.thread_type,
    unlocked: Boolean(row.unlocked),
  };
}

function publicImageUrl(imageName) {
  if (!imageName) return null;
  const s = String(imageName).replace(/\\/g, '/');
  if (s.startsWith('http://') || s.startsWith('https://')) return s;
  if (s.startsWith('/uploads/')) return s;
  if (s.startsWith('uploads/')) return `/${s}`;
  if (s.includes('/chat/')) {
    return s.startsWith('/') ? s : `/uploads/${s.replace(/^uploads\//, '')}`;
  }
  return `/uploads/${s.replace(/^uploads\//, '')}`;
}

function messageStatus(row) {
  if (row.read_at) return 'read';
  if (row.delivered_at) return 'delivered';
  return 'sent';
}

function peerId(conversation, userId) {
  if (!conversation) return null;
  const uid = String(userId);
  const a = String(conversation.participant_a_id);
  const b = String(conversation.participant_b_id);
  return a === uid ? b : a;
}

function emitReceipts({ conversationId, peerUserId, status, messageIds }) {
  if (!messageIds?.length) return;
  const payload = {
    conversationId: String(conversationId),
    status,
    messageIds: messageIds.map((id) => String(id)),
    at: new Date().toISOString(),
  };
  emitToConversation(conversationId, 'message_receipts', payload);
  if (peerUserId) emitToUser(peerUserId, 'message_receipts', payload);
}

function mapMessage(row, currentUserId) {
  const isImage = Boolean(row.is_image) || Boolean(row.image_name);
  const imageUrl = isImage ? publicImageUrl(row.image_name) : null;
  return {
    id: String(row.id),
    conversationId: String(row.conversation_id),
    senderId: String(row.sender_id),
    text: row.body,
    isMine: String(row.sender_id) === String(currentUserId),
    time: formatMessageTime(row.created_at),
    isImage,
    imageName: row.image_name,
    imageUrl,
    imagePath: imageUrl,
    createdAt: toIso(row.created_at),
    status: messageStatus(row),
    deliveredAt: toIso(row.delivered_at),
    readAt: toIso(row.read_at),
  };
}

export async function listConversations(userId, { threadType = null } = {}) {
  const rows = await chatRepository.listConversationsForUser(userId, { threadType });
  return rows.map(mapConversation);
}

export async function getConversation(userId, conversationId) {
  let row = await chatRepository.findConversationForUser(conversationId, userId);
  if (!row) throw new AppError('Conversation not found', 404, 'NOT_FOUND');

  if (
    row.unlocked === false &&
    row.thread_type === 'sender_traveler' &&
    SENDER_TRAVELER_CHAT_STATUSES.has(row.delivery_status)
  ) {
    await chatRepository.setConversationUnlocked(row.delivery_id, 'sender_traveler', true);
    await pool.query(
      `UPDATE deliveries SET chat_unlocked = TRUE, updated_at = NOW()
       WHERE id = $1 AND chat_unlocked = FALSE`,
      [row.delivery_id]
    );
    row = await chatRepository.findConversationForUser(conversationId, userId);
    if (!row) throw new AppError('Conversation not found', 404, 'NOT_FOUND');
  }

  await chatRepository.markConversationRead(conversationId, userId);
  const readRows = await chatRepository.markMessagesRead(conversationId, userId);
  if (readRows.length) {
    emitReceipts({
      conversationId,
      peerUserId: peerId(row, userId),
      status: 'read',
      messageIds: readRows.map((m) => m.id),
    });
  }
  const messages = await chatRepository.listMessages(conversationId);
  return {
    conversation: {
      id: row.id,
      name: row.peer_name || 'Contact',
      shipmentId: row.delivery_public_id || '',
      deliveryId: row.delivery_id,
      unlocked: Boolean(row.unlocked),
    },
    messages: messages.map((m) => mapMessage(m, userId)),
  };
}

export async function sendMessage(userId, conversationId, body) {
  const text = String(body?.text ?? body ?? '').trim();
  const imageUrl = body?.imageUrl ? String(body.imageUrl).trim() : null;
  if (!text && !imageUrl) {
    throw new AppError('Message text or image is required', 400, 'VALIDATION_ERROR');
  }
  const row = await chatRepository.findConversationForUser(conversationId, userId);
  if (!row) throw new AppError('Conversation not found', 404, 'NOT_FOUND');
  if (row.unlocked === false) {
    throw new AppError(
      'Chat unlocks after the sender accepts a traveler and payment is complete.',
      403,
      'CHAT_LOCKED'
    );
  }
  const recipientId = peerId(row, userId);
  const inThread = recipientId
    ? await isUserInConversation(recipientId, conversationId)
    : false;
  const online = inThread || (recipientId ? await isUserOnline(recipientId) : false);
  const now = new Date();
  const message = await chatRepository.insertMessage({
    conversationId,
    senderId: userId,
    body: text || (imageUrl ? 'Photo' : ''),
    isImage: Boolean(imageUrl),
    imageName: imageUrl,
    deliveredAt: online ? now : null,
    readAt: inThread ? now : null,
  });
  const mapped = mapMessage(message, userId);
  // Broadcast a viewer-neutral payload. `mapped.isMine` is only correct for the
  // sender, so include the raw senderId and let each client decide `isMine` for
  // itself — otherwise the recipient would render incoming messages as its own.
  const payload = {
    ...mapped,
    id: String(message.id),
    senderId: String(message.sender_id),
    conversationId: String(conversationId),
    isMine: false,
  };
  emitToConversation(conversationId, 'chat_message', payload);
  if (recipientId) emitToUser(recipientId, 'chat_message', payload);

  // Fan out the initial receipt to the sender's user room so ticks update live
  // even if the HTTP response is slow or the open chat missed the status field.
  if (mapped.status === 'delivered' || mapped.status === 'read') {
    emitToUser(userId, 'message_receipts', {
      conversationId: String(conversationId),
      status: mapped.status,
      messageIds: [String(message.id)],
      at: new Date().toISOString(),
    });
  }

  // Push the message to the peer when they aren't already watching the thread.
  // Fire-and-forget: chat delivery must not depend on FCM.
  void notifyChatRecipient({
    conversation: row,
    senderId: userId,
    text: message.body,
    isImage: message.is_image,
  }).catch((err) => {
    console.warn('[chat] recipient push failed:', err?.message || err);
  });

  return mapped;
}

/**
 * Send an FCM push to the other participant of a conversation for a new
 * message. Skipped when the recipient currently has the thread open (they get
 * the message live over the socket) or when no recipient can be resolved.
 */
async function notifyChatRecipient({ conversation, senderId, text, isImage }) {
  const recipientId =
    String(conversation.participant_a_id) === String(senderId)
      ? conversation.participant_b_id
      : conversation.participant_a_id;
  if (!recipientId || String(recipientId) === String(senderId)) return;

  // Don't double-notify someone already reading the thread.
  if (await isUserInConversation(recipientId, conversation.id)) return;

  // Resolve the sender's display name (push title) and the recipient's role in
  // this delivery (for a role-correct deep link).
  const [{ rows: senderRows }, { rows: delRows }] = await Promise.all([
    pool.query(`SELECT name FROM users WHERE id = $1`, [senderId]),
    pool.query(
      `SELECT sender_id, traveler_id, receiver_id FROM deliveries WHERE id = $1`,
      [conversation.delivery_id]
    ),
  ]);

  const senderName = senderRows[0]?.name?.trim() || 'New message';
  const del = delRows[0] || {};
  let rolePath = 'sender-chats';
  if (recipientId === del.traveler_id) rolePath = 'traveler-chats';
  else if (recipientId === del.receiver_id) rolePath = 'receiver-chats';

  const preview = isImage ? '📷 Photo' : String(text || '').trim();
  const body =
    preview.length > 140 ? `${preview.slice(0, 137)}...` : preview || 'New message';

  await sendPushToUser(recipientId, {
    title: senderName,
    body,
    data: {
      type: 'chatMessage',
      route: `/${rolePath}/${conversation.id}`,
      conversationId: conversation.id,
    },
  });
}

export async function sendImageMessage(userId, conversationId, file) {
  if (!file?.buffer?.length) {
    throw new AppError('Image is required', 400, 'VALIDATION_ERROR');
  }
  const crypto = await import('crypto');
  const { storeFile } = await import('./storage.service.js');
  const ext = (file.originalname || '').split('.').pop()?.toLowerCase() || 'jpg';
  const safeExt = ['jpg', 'jpeg', 'png', 'webp'].includes(ext) ? ext : 'jpg';
  const relativePath = `chat/${conversationId}/${crypto.randomUUID()}.${safeExt}`;
  const stored = await storeFile({
    buffer: file.buffer,
    relativePath,
    mimeType: file.mimetype,
    originalName: file.originalname,
  });
  return sendMessage(userId, conversationId, { text: '', imageUrl: stored.publicUrl });
}

/**
 * User just connected — any messages waiting for them are now delivered.
 */
export async function onUserCameOnline(userId) {
  if (!userId) return;
  const rows = await chatRepository.markDeliveredForRecipient(userId);
  if (!rows.length) return;

  const byConversation = new Map();
  for (const row of rows) {
    const key = row.conversation_id;
    let group = byConversation.get(key);
    if (!group) {
      group = { messageIds: [], senderIds: new Set() };
      byConversation.set(key, group);
    }
    group.messageIds.push(row.id);
    if (row.sender_id) group.senderIds.add(row.sender_id);
  }

  for (const [conversationId, group] of byConversation) {
    const messageIds = group.messageIds.map((id) => String(id));
    emitReceipts({
      conversationId: String(conversationId),
      peerUserId: null,
      status: 'delivered',
      messageIds,
    });
    for (const senderId of group.senderIds) {
      emitToUser(senderId, 'message_receipts', {
        conversationId: String(conversationId),
        status: 'delivered',
        messageIds,
        at: new Date().toISOString(),
      });
    }
  }
}

/**
 * User opened a thread — mark the peer's messages read and notify the sender.
 */
export async function onConversationOpened(userId, conversationId) {
  if (!userId || !conversationId) return;
  const row = await chatRepository.findConversationForUser(conversationId, userId);
  if (!row) return;

  await chatRepository.markConversationRead(conversationId, userId);
  const readRows = await chatRepository.markMessagesRead(conversationId, userId);
  if (!readRows.length) return;

  emitReceipts({
    conversationId,
    peerUserId: peerId(row, userId),
    status: 'read',
    messageIds: readRows.map((m) => m.id),
  });
}

/**
 * Recipient device ACKed a specific message (reached the device).
 * Always fan out a receipt so the sender's open chat can catch up even when
 * delivered_at was already set at insert time (peer was online).
 */
export async function onMessageDeliveredAck(userId, messageId) {
  if (!userId || !messageId) return;
  const updated = await chatRepository.markMessageDelivered(messageId, userId);
  if (!updated) return;

  const status = updated.read_at ? 'read' : 'delivered';
  emitReceipts({
    conversationId: updated.conversation_id,
    peerUserId: updated.sender_id,
    status,
    messageIds: [updated.id],
  });
}
