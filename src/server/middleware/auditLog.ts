import { Request, Response, NextFunction } from 'express';
import { AuditService } from '../services/audit.service';
import { prisma } from '../config/database';

// ─── Constants ─────────────────────────────────────

const PATH_RESOURCE_REGEX = /\/api\/v1\/(\w+)/;

const RESOURCE_MAP: Readonly<Record<string, string>> = {
  claims: 'claim',
  users: 'user',
  teams: 'team',
  clients: 'client',
  connectors: 'connector',
  process: 'processing',
  analytics: 'analytics',
  auth: 'auth',
  notifications: 'notification',
  audit: 'audit',
};

// ─── Helpers ───────────────────────────────────────

function inferTargetType(path: string): string {
  const match = path.match(PATH_RESOURCE_REGEX);
  if (!match) {
    return 'unknown';
  }

  const segment = match[1];
  return RESOURCE_MAP[segment] ?? segment;
}

// ─── Middleware ─────────────────────────────────────

const auditService = new AuditService(prisma);

/**
 * Auto-audit middleware for mutation endpoints.
 * Captures the response and logs an audit event on success (fire-and-forget).
 *
 * Usage: router.put('/claims/:id/status', auditLog('claim.status_changed'), handler)
 */
export function auditLog(eventType: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const originalJson = res.json.bind(res);

    res.json = function auditWrappedJson(data: unknown) {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        auditService
          .logEvent({
            eventType,
            actorType: req.user ? 'user' : 'system',
            actorId: req.user?.sub,
            targetType: inferTargetType(req.path),
            targetId: req.params?.id,
            action: `${req.method} ${req.originalUrl}`,
            details: { body: req.body },
            ipAddress: req.ip,
            sessionId: req.headers['x-session-id'] as string,
          })
          .catch(() => {
            // Fire and forget: swallow errors
          });
      }

      return originalJson(data);
    } as Response['json'];

    next();
  };
}
