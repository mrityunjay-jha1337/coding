import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { startIngestionWorker } from './ingestion.worker';
import { logger } from '../config/logger';
import { env } from '../config/env';
import { Queue, Worker } from 'bullmq';
import { redis } from '../config/redis';
import { renewExpiringWatches } from '../services/gmail/gmailWatcher.service';

async function setupCronJobs() {
  if (!env.GMAIL_PUBSUB_TOPIC) {
    logger.info('GMAIL_PUBSUB_TOPIC not set — Gmail watch renewer disabled');
    return;
  }

  const cronQueue = new Queue('cron-jobs', { connection: redis });
  await cronQueue.add('renew-gmail-watches', {}, {
    repeat: {
      every: env.GMAIL_WATCH_RENEWAL_INTERVAL_MS || 24 * 60 * 60 * 1000,
    }
  });
  
  new Worker('cron-jobs', async (job) => {
    if (job.name === 'renew-gmail-watches') {
      await renewExpiringWatches();
    }
  }, { connection: redis });

  logger.info('Gmail watch renewer repeatable job scheduled');
}

async function start() {
  try {
    startIngestionWorker();
    await setupCronJobs();
    logger.info('Ingestion worker running');
  } catch (error: unknown) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to start ingestion worker');
    process.exit(1);
  }
}

if (require.main === module) {
  void start();
}
