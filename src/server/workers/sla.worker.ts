import { Worker, Queue, Job } from 'bullmq';
import { redis } from '../config/redis';
import { prisma } from '../config/database';
import { QUEUE_NAMES } from '../queues';
import { SlaMonitorService } from '../services/slaMonitor.service';
import { logger } from '../config/logger';

const slaService = new SlaMonitorService(prisma);

async function slaCheckJob(_job: Job): Promise<void> {
  await slaService.checkAllSlas();
}

export function startSlaWorker(): void {
  const worker = new Worker(QUEUE_NAMES.SLA_MONITOR, slaCheckJob, {
    connection: redis,
    concurrency: 1,
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, error: err.message }, 'SLA check job failed');
  });

  // Schedule repeatable job every 15 minutes
  const slaQueue = new Queue(QUEUE_NAMES.SLA_MONITOR, { connection: redis });
  slaQueue.add('sla-check', {}, {
    repeat: { every: 15 * 60 * 1000 },
    removeOnComplete: { count: 10 },
  });

  logger.info('SLA monitoring worker started (every 15 minutes)');
}
