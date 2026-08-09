import { AppError } from '../utils/errors.js';
import * as chatRepository from '../repositories/chat.repository.js';

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
  const row = await chatRepository.findConversationForUser(conversationId, userId);
  if (!row) throw new AppError('Conversation not found', 404, 'NOT_FOUND');
  await chatRepository.markConversationRead(conversationId, userId);
  const messages = await chatRepository.listMessages(conversationId);
  return {
    conversation: {
      id: row.id,
      name: row.peer_name || 'Contact',
      shipmentId: row.delivery_public_id || '',
      deliveryId: row.delivery_id,
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
    throw new AppError('Chat is locked until meetup is agreed and bid accepted', 403, 'CHAT_LOCKED');
  }
  const message = await chatRepository.insertMessage({
    conversationId,
    senderId: userId,
    body: text || (imageUrl ? '[Image]' : ''),
    isImage: Boolean(imageUrl),
    imageName: imageUrl,
  });
  const mapped = mapMessage(message, userId);
  const { emitToConversation } = await import('./socket_hub.js');
  emitToConversation(conversationId, 'chat_message', mapped);
  return mapped;
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
