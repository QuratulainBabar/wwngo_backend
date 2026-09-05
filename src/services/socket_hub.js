import { Server } from 'socket.io';
import { verifyAccessToken } from '../services/token.service.js';

let io = null;

function loadChatService() {
  // Dynamic import avoids a circular dependency with chat.service.js.
  return import('./chat.service.js');
}

export function initSocketServer(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: true, credentials: true },
    path: '/socket.io',
  });

  io.use((socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      if (!token) return next(new Error('Authentication required'));
      const payload = verifyAccessToken(String(token));
      const userId = String(payload.sub);
      socket.userId = userId;
      // Mirror onto socket.data so presence checks work via fetchSockets(),
      // which only exposes the serialized `data` bag (not ad-hoc props).
      socket.data.userId = userId;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const userId = String(socket.userId);
    socket.userId = userId;
    socket.data.userId = userId;
    socket.join(`user:${userId}`);

    // Coming online delivers any messages that arrived while this user was away.
    void loadChatService()
      .then((chat) => chat.onUserCameOnline(userId))
      .catch((err) => {
        console.warn('[chat] onUserCameOnline failed:', err?.message || err);
      });

    socket.on('join_conversation', (conversationId) => {
      if (!conversationId) return;
      const id = String(conversationId);
      socket.join(`conversation:${id}`);
      // Opening a thread marks the peer's messages as read (blue ticks).
      void loadChatService()
        .then((chat) => chat.onConversationOpened(userId, id))
        .catch((err) => {
          console.warn('[chat] onConversationOpened failed:', err?.message || err);
        });
    });

    socket.on('leave_conversation', (conversationId) => {
      if (conversationId) socket.leave(`conversation:${String(conversationId)}`);
    });

    socket.on('ack_delivered', (payload) => {
      const messageId = payload?.messageId;
      if (!messageId) return;
      void loadChatService()
        .then((chat) => chat.onMessageDeliveredAck(userId, String(messageId)))
        .catch((err) => {
          console.warn('[chat] ack_delivered failed:', err?.message || err);
        });
    });

    socket.on('ack_read', (payload) => {
      const conversationId = payload?.conversationId;
      if (!conversationId) return;
      void loadChatService()
        .then((chat) => chat.onConversationOpened(userId, String(conversationId)))
        .catch((err) => {
          console.warn('[chat] ack_read failed:', err?.message || err);
        });
    });
  });

  return io;
}

export function emitToUser(userId, event, payload) {
  if (userId == null || userId === '') return;
  io?.to(`user:${String(userId)}`).emit(event, payload);
}

export function emitToConversation(conversationId, event, payload) {
  if (conversationId == null || conversationId === '') return;
  io?.to(`conversation:${String(conversationId)}`).emit(event, payload);
}

/**
 * True if the user currently has the given conversation open (joined its room).
 * Used to skip a redundant push when the recipient is already viewing the chat.
 */
export async function isUserInConversation(userId, conversationId) {
  if (!io || userId == null || conversationId == null) return false;
  const uid = String(userId);
  const cid = String(conversationId);
  try {
    const sockets = await io.in(`conversation:${cid}`).fetchSockets();
    return sockets.some((s) => String(s.data?.userId || '') === uid);
  } catch {
    return false;
  }
}

/**
 * True if the user has any authenticated socket connected (app is online).
 * Used to mark messages delivered as soon as they reach a live device.
 */
export async function isUserOnline(userId) {
  if (!io || userId == null) return false;
  try {
    const sockets = await io.in(`user:${String(userId)}`).fetchSockets();
    return sockets.length > 0;
  } catch {
    return false;
  }
}

export function getIo() {
  return io;
}
