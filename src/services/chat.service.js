import { AppError } from '../utils/errors.js';
import * as chatRepository from '../repositories/chat.repository.js';
import { pool } from '../db/pool.js';
import { emitToConversation, isUserInConversation } from './socket_hub.js';
import { sendPushToUser } from './fcm.service.js';

const SENDER_TRAVELER_CHAT_STATUSES = new Set([
  'bid_accepted',
  'matched',
  'ready_for_handoff',
  'collected',
  'in_transit',
]);

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
  return {
    id: row.id,
    name: peerName,
    initial,
    lastMessage: row.last_message || 'No messages yet',
    time: formatInboxTime(row.last_message_at || row.updated_at),
    shipmentId: row.delivery_public_id || '',
    unreadCount: Number(row.unread_count) || 0,
    deliveryId: row.delivery_id,
    deliveryStatus: row.delivery_status,
    threadType: row.thread_type,
    unlocked: Boolean(row.unlocked),
  };
}

function mapMessage(row, currentUserId) {
  return {
    id: row.id,
    text: row.body,
    isMine: row.sender_id === currentUserId,
    time: formatMessageTime(row.created_at),
    isImage: row.is_image,
    imageName: row.image_name,
    createdAt: row.created_at,
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
  const message = await chatRepository.insertMessage({
    conversationId,
    senderId: userId,
    body: text || (imageUrl ? '[Image]' : ''),
    isImage: Boolean(imageUrl),
    imageName: imageUrl,
  });
  const mapped = mapMessage(message, userId);
  // Broadcast a viewer-neutral payload. `mapped.isMine` is only correct for the
  // sender, so include the raw senderId and let each client decide `isMine` for
  // itself — otherwise the recipient would render incoming messages as its own.
  emitToConversation(conversationId, 'chat_message', {
    ...mapped,
    senderId: message.sender_id,
  });

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
    conversation.participant_a_id === senderId
      ? conversation.participant_b_id
      : conversation.participant_a_id;
  if (!recipientId || recipientId === senderId) return;

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
