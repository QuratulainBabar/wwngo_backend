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

export function getIo() {
  return io;
}
