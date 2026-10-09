import path from 'path';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { fetchICD10FromS3 } from './services/s3DataLoader';
import { env } from './config/env';
import { logger, logPaths } from './config/logger';
import { errorHandler } from './middleware/errorHandler';
import { apiLimiter } from './middleware/rateLimiter';
import authRoutes from './routes/auth.routes';
import usersRoutes from './routes/users.routes';
import teamsRoutes from './routes/teams.routes';
import clientsRoutes from './routes/clients.routes';
import connectorsRoutes from './routes/connectors.routes';
import processingRoutes from './routes/processing.routes';
import claimsRoutes from './routes/claims.routes';
import analyticsRoutes from './routes/analytics.routes';
import notificationsRoutes from './routes/notifications.routes';
import auditRoutes from './routes/audit.routes';
import bupaRoutes from './routes/bupa.routes';
import legacyApiRoutes from './routes/api';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export function createApp() {
  const app = express();

  // Security
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: env.CORS_ORIGIN, credentials: true }));

  // Parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Rate limiting
  app.use('/api/v1', apiLimiter);

  // Health check (no auth)
  app.get('/api/v1/health', (_req, res) => {
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      environment: env.NODE_ENV,
    });
  });

  // Routes
  app.use('/api', legacyApiRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/users', usersRoutes);
  app.use('/api/v1/teams', teamsRoutes);
  app.use('/api/v1/clients', clientsRoutes);
  app.use('/api/v1/connectors', connectorsRoutes);
  app.use('/api/v1/process', processingRoutes);
  app.use('/api/v1/claims', claimsRoutes);
  app.use('/api/v1/analytics', analyticsRoutes);
  app.use('/api/v1/notifications', notificationsRoutes);
  app.use('/api/v1/audit', auditRoutes);
  app.use('/api/v1/bupa', bupaRoutes);

  // Error handler (must be last)
  app.use(errorHandler);

  if (env.NODE_ENV === 'production') {
    const clientPath = path.resolve(__dirname, '../client');
    app.use(express.static(clientPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(clientPath, 'index.html'));
    });
  }

  return app;
}

export async function startServer() {
  try {
    const dataPath = await fetchICD10FromS3();
    logger.info({ dataPath }, 'ICD-10 data ready');
  } catch (error: unknown) {
    logger.fatal(
      { error: error instanceof Error ? error.message : String(error) },
      'ICD-10 data fetch failed. Critical dependency missing. Exiting.'
    );
    process.exit(1);
  }

  const app = createApp();
  const port = env.PORT || 3001;
  const server = app.listen(port, () => {
    logger.info(
      {
        port,
        url: `http://localhost:${port}`,
        logPaths,
      },
      'ClaimsIntell API running'
    );
  });

  server.timeout = 30_000;
  server.keepAliveTimeout = 32_000;
}

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ err: error, stack: error.stack }, 'Uncaught exception');
});

if (require.main === module) {
  void startServer();
}
