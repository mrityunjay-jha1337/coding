import { Request, Response, NextFunction } from 'express';
import { logger } from '../config/logger';
import { AppError } from '../utils/errors';

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  const isAppError = err instanceof AppError;
  const statusCode = isAppError ? err.statusCode : 500;
  const message = isAppError ? err.message : 'Internal server error';

  if (!isAppError) {
    logger.error({ err: err.message, stack: err.stack }, 'Unhandled system error');
  } else {
    logger.warn({ err: err.message, status: statusCode }, 'Client request conflict');
  }

  res.status(statusCode).json({ error: message });
}
