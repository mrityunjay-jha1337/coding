import { Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database';
import { BupaAnalyticsService, DateFilter } from '../services/bupaAnalytics.service';

const analyticsService = new BupaAnalyticsService(prisma);

// ─── Helpers ──────────────────────────────────────

function parseDateFilter(req: Request): DateFilter | undefined {
  const from = req.query.dateFrom as string | undefined;
  const to = req.query.dateTo as string | undefined;

  if (!from && !to) {
    return undefined;
  }

  // Validate date strings if provided
  if (from && isNaN(new Date(from).getTime())) {
    return undefined;
  }
  if (to && isNaN(new Date(to).getTime())) {
    return undefined;
  }

  return { from, to };
}

// ─── Handlers ─────────────────────────────────────

export async function getDashboard(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const dateFilter = parseDateFilter(req);
    const dashboard = await analyticsService.getDashboard(
      req.user.orgId,
      dateFilter,
    );

    res.status(200).json(dashboard);
  } catch (err) {
    next(err);
  }
}

export async function getStpMetrics(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const dateFilter = parseDateFilter(req);
    const metrics = await analyticsService.getStpMetrics(
      req.user.orgId,
      dateFilter,
    );

    res.status(200).json(metrics);
  } catch (err) {
    next(err);
  }
}

export async function getPlanUtilisation(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const dateFilter = parseDateFilter(req);
    const plans = await analyticsService.getPlanUtilisation(
      req.user.orgId,
      dateFilter,
    );

    res.status(200).json(plans);
  } catch (err) {
    next(err);
  }
}

export async function getProviderAnalysis(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const dateFilter = parseDateFilter(req);
    const providers = await analyticsService.getProviderAnalysis(
      req.user.orgId,
      dateFilter,
    );

    res.status(200).json(providers);
  } catch (err) {
    next(err);
  }
}

export async function getDenialAnalysis(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const dateFilter = parseDateFilter(req);
    const denials = await analyticsService.getDenialAnalysis(
      req.user.orgId,
      dateFilter,
    );

    res.status(200).json(denials);
  } catch (err) {
    next(err);
  }
}

export async function getMemberMetrics(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const metrics = await analyticsService.getMemberMetrics();

    res.status(200).json(metrics);
  } catch (err) {
    next(err);
  }
}
