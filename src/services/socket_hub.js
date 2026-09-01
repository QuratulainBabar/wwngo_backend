import { Server } from 'socket.io';
import { verifyAccessToken } from '../services/token.service.js';

let io = null;

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
      socket.userId = payload.sub;
      // Mirror onto socket.data so presence checks work via fetchSockets(),
      // which only exposes the serialized `data` bag (not ad-hoc props).
      socket.data.userId = payload.sub;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    socket.join(`user:${socket.userId}`);

    socket.on('join_conversation', (conversationId) => {
      if (conversationId) socket.join(`conversation:${conversationId}`);
    });

    socket.on('leave_conversation', (conversationId) => {
      if (conversationId) socket.leave(`conversation:${conversationId}`);
    });
  });

  return io;
}

export function emitToUser(userId, event, payload) {
  io?.to(`user:${userId}`).emit(event, payload);
}

export function emitToConversation(conversationId, event, payload) {
  io?.to(`conversation:${conversationId}`).emit(event, payload);
}

/**
 * True if the user currently has the given conversation open (joined its room).
 * Used to skip a redundant push when the recipient is already viewing the chat.
 */
export async function isUserInConversation(userId, conversationId) {
  if (!io) return false;
  try {
    const sockets = await io.in(`conversation:${conversationId}`).fetchSockets();
    return sockets.some((s) => s.data?.userId === userId);
  } catch {
    return false;
  }
}

export function getIo() {
  return io;
}
