import { Queue, QueueEvents } from 'bullmq';
import { redis } from '../config/redis';
import { env } from '../config/env';

const PREFIX = env.NODE_ENV === 'test' ? `test-${Math.random().toString(36).substring(7)}-` : '';

// Hash tags ({...}) force all keys of one queue onto the same Redis Cluster slot.
// Without them BullMQ's multi-key Lua scripts fail with CROSSSLOT in cluster mode.
export const QUEUE_NAMES = {
  INGESTION: `{${PREFIX}email-ingestion}`,
  PROCESSING: `{${PREFIX}claim-processing}`,
  CORRESPONDENCE: `{${PREFIX}correspondence}`,
  NOTIFICATION: `{${PREFIX}notifications}`,
  SLA_MONITOR: `{${PREFIX}sla-monitor}`,
} as const;

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 5000 },
  removeOnComplete: { age: 7 * 24 * 3600 },
  removeOnFail: { age: 30 * 24 * 3600 },
};

export const ingestionQueue = new Queue(QUEUE_NAMES.INGESTION, {
  connection: redis,
  defaultJobOptions,
});

export const processingQueue = new Queue(QUEUE_NAMES.PROCESSING, {
  connection: redis,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 2,
  } as any,
});

export const correspondenceQueue = new Queue(QUEUE_NAMES.CORRESPONDENCE, {
  connection: redis,
  defaultJobOptions,
});

export const notificationQueue = new Queue(QUEUE_NAMES.NOTIFICATION, {
  connection: redis,
  defaultJobOptions: {
    ...defaultJobOptions,
    attempts: 2,
  },
});

export const slaMonitorQueue = new Queue(QUEUE_NAMES.SLA_MONITOR, {
  connection: redis,
  defaultJobOptions,
});

export async function getQueueStats() {
  const [ingestion, processing, correspondence, notification, slaMonitor] = await Promise.all([
    ingestionQueue.getJobCounts(),
    processingQueue.getJobCounts(),
    correspondenceQueue.getJobCounts(),
    notificationQueue.getJobCounts(),
    slaMonitorQueue.getJobCounts(),
  ]);

  return { ingestion, processing, correspondence, notification, slaMonitor };
}

export async function closeAllQueues() {
  await Promise.all([
    ingestionQueue.close(),
    processingQueue.close(),
    correspondenceQueue.close(),
    notificationQueue.close(),
    slaMonitorQueue.close(),
  ]);
}
