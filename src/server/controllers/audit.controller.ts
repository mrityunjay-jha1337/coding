import { Request, Response, NextFunction } from 'express';
import { AuditService } from '../services/audit.service';
import { prisma } from '../config/database';

const auditService = new AuditService(prisma);

// ─── Helpers ──────────────────────────────────────

function parseOptionalDate(value: unknown): Date | undefined {
  if (typeof value !== 'string' || !value) {
    return undefined;
  }
  const parsed = new Date(value);
  if (isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}

// ─── Handlers ─────────────────────────────────────

export async function queryEvents(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const result = await auditService.queryEvents({
      targetType: req.query.targetType as string | undefined,
      targetId: req.query.targetId as string | undefined,
      eventType: req.query.eventType as string | undefined,
      actorId: req.query.actorId as string | undefined,
      dateFrom: parseOptionalDate(req.query.dateFrom),
      dateTo: parseOptionalDate(req.query.dateTo),
      page: req.query.page ? Number(req.query.page) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}

export async function getEventById(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const { id } = req.params;

    const event = await prisma.auditEvent.findUnique({
      where: { id },
    });

    if (!event) {
      res.status(404).json({ error: 'Audit event not found' });
      return;
    }

    res.status(200).json(event);
  } catch (err) {
    next(err);
  }
}
