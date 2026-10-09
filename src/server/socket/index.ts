import { Server as HttpServer } from 'http';
import { Server as SocketServer } from 'socket.io';
import { env } from '../config/env';
import { logger } from '../config/logger';
import jwt from 'jsonwebtoken';
import type { JwtPayload } from '../../shared/authTypes';

let io: SocketServer | null = null;

export function initSocket(httpServer: HttpServer): SocketServer {
  io = new SocketServer(httpServer, {
    cors: {
      origin: env.CORS_ORIGIN,
      credentials: true,
    },
  });

  // Auth middleware
  io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
      next(new Error('Authentication required'));
      return;
    }
    try {
      const payload = jwt.verify(token, env.JWT_ACCESS_SECRET) as JwtPayload;
      socket.data.user = payload;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.data.user as JwtPayload;
    // Join org room for claim updates
    socket.join(`org:${user.orgId}`);
    // Join personal room for notifications
    socket.join(`user:${user.sub}`);

    logger.debug({ userId: user.sub, orgId: user.orgId }, 'Socket connected');

    socket.on('disconnect', () => {
      logger.debug({ userId: user.sub }, 'Socket disconnected');
    });
  });

  logger.info('Socket.io initialized');
  return io;
}

export function getIO(): SocketServer | null {
  return io;
}

export function emitClaimProgress(orgId: string, data: {
  claimId: string;
  step: string;
  progress: number;
  message: string;
}) {
  if (io) {
    io.to(`org:${orgId}`).emit('claim:progress', data);
  }
}

export function emitClaimComplete(orgId: string, data: {
  claimId: string;
  status: string;
  overallConfidence?: number;
}) {
  if (io) {
    io.to(`org:${orgId}`).emit('claim:complete', data);
  }
}

export function emitNotification(userId: string, data: {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
}) {
  if (io) {
    io.to(`user:${userId}`).emit('notification', data);
  }
}
