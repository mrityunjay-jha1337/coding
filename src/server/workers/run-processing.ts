import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

import { startProcessingWorker } from './processing.worker';
import { startSlaWorker } from './sla.worker';
import { logger } from '../config/logger';

async function start() {
  try {
    startProcessingWorker();
    startSlaWorker();
    logger.info('Processing & SLA workers running');
  } catch (error: unknown) {
    logger.error({ error: error instanceof Error ? error.message : String(error) }, 'Failed to start processing worker');
    process.exit(1);
  }
}

if (require.main === module) {
  void start();
}
