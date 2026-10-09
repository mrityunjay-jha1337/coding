import { Request, Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { prisma } from '../config/database';
import type { JwtPayload } from '../../shared/authTypes';

const authService = new AuthService(prisma);

declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
      tenancy?: { orgId: string; clientId?: string };
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required' });
    return;
  }

  const token = header.slice(7);

  try {
    const payload = authService.verifyAccessToken(token);
    req.user = payload;
    req.tenancy = { orgId: payload.orgId };
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
}
