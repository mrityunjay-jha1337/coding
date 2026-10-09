import { Request, Response, NextFunction } from 'express';
import { AnalyticsService } from '../services/analytics.service';
import { prisma } from '../config/database';

const analyticsService = new AnalyticsService(prisma);

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

export async function getOverview(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const dateFrom = parseOptionalDate(req.query.dateFrom);
    const dateTo = parseOptionalDate(req.query.dateTo);

    const overview = await analyticsService.getOperationsOverview(
      req.user.orgId,
      dateFrom,
      dateTo,
    );
    res.status(200).json(overview);
  } catch (err) {
    next(err);
  }
}

export async function getPipelineStatus(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const pipeline = await analyticsService.getPipelineStatus(req.user.orgId);
    res.status(200).json(pipeline);
  } catch (err) {
    next(err);
  }
}

export async function getTeamPerformance(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const teams = await analyticsService.getTeamPerformance(req.user.orgId);
    res.status(200).json(teams);
  } catch (err) {
    next(err);
  }
}

export async function getCodingAnalytics(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const dateFrom = parseOptionalDate(req.query.dateFrom);
    const dateTo = parseOptionalDate(req.query.dateTo);

    const coding = await analyticsService.getCodingAnalytics(
      req.user.orgId,
      dateFrom,
      dateTo,
    );
    res.status(200).json(coding);
  } catch (err) {
    next(err);
  }
}

export async function getSlaStatus(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const sla = await analyticsService.getClientSlaStatus(req.user.orgId);
    res.status(200).json(sla);
  } catch (err) {
    next(err);
  }
}

export async function getVolumeAnalysis(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const dateFrom = parseOptionalDate(req.query.dateFrom);
    const dateTo = parseOptionalDate(req.query.dateTo);
    const groupBy = (req.query.groupBy as string) || 'day';

    if (!dateFrom || !dateTo) {
      res.status(400).json({ error: 'dateFrom and dateTo are required for volume analysis' });
      return;
    }

    if (!['day', 'week', 'month'].includes(groupBy)) {
      res.status(400).json({ error: 'groupBy must be day, week, or month' });
      return;
    }

    const volume = await analyticsService.getVolumeAnalysis(
      req.user.orgId,
      dateFrom,
      dateTo,
      groupBy as 'day' | 'week' | 'month',
    );
    res.status(200).json(volume);
  } catch (err) {
    next(err);
  }
}

export async function getHandlerMetrics(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const teamId = req.query.teamId as string | undefined;

    const handlers = await analyticsService.getHandlerMetrics(
      req.user.orgId,
      teamId,
    );
    res.status(200).json(handlers);
  } catch (err) {
    next(err);
  }
}
