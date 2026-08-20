/**
 * Run Retention Queue - BullMQ-based daily purge of aged automation runs
 *
 * Completed runs age out on their kind's window (notification 30 days, policy
 * 365) unless the automation overrides it with retention_days. Non-completed
 * runs gate nothing and are written per candidate automation per event, so they
 * go at 30 days flat whatever the kind or the override says.
 *
 * Only session-bound rows are purged. Account-keyed runs (session_id NULL) are
 * excluded for both kinds: inactivity dedup blocks on any row for user +
 * automation, and account.inactive_for notifications carry a constant edgeKey,
 * so deleting the row re-fires the automation every cycle. A session-bound row
 * is safe to delete - the session ended months ago and can never re-evaluate.
 */

import { Queue, Worker, type Job, type ConnectionOptions } from 'bullmq';
import { sql, type SQL } from 'drizzle-orm';
import {
  AUTOMATION_KINDS,
  RETENTION_DEFAULTS,
  TIME_MS,
  type AutomationKind,
} from '@tracearr/shared';
import { getBullPrefix, queueConnectionOptions } from './queueConnection.js';
import { isMaintenance } from '../serverState.js';
import { db } from '../db/client.js';

const QUEUE_NAME = 'run-retention';
// Pre-rename queue; its repeatable survives the upgrade with nothing to consume it.
const LEGACY_QUEUE_NAME = 'violation-retention';

const PURGE_INTERVAL_MS = TIME_MS.DAY;
// Server policy, not a user-facing default: non-completed runs age out on this window whatever the kind.
const DIAGNOSTIC_RETENTION_DAYS = 30;
// Delete in batches so the first run after upgrade cannot hold a long lock
const DELETE_BATCH_SIZE = 5000;

interface RunRetentionJobData {
  type: 'purge';
}

let connectionOptions: ConnectionOptions | null = null;
let retentionQueue: Queue<RunRetentionJobData> | null = null;
let retentionWorker: Worker<RunRetentionJobData> | null = null;

/**
 * Initialize the run retention queue with Redis connection
 */
export function initRunRetentionQueue(redisUrl: string): void {
  if (retentionQueue) {
    console.log('[RunRetention] Queue already initialized');
    return;
  }

  connectionOptions = queueConnectionOptions(redisUrl);
  const bullPrefix = getBullPrefix();

  retentionQueue = new Queue<RunRetentionJobData>(QUEUE_NAME, {
    connection: connectionOptions,
    prefix: bullPrefix,
    defaultJobOptions: {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 30000,
      },
      removeOnComplete: {
        count: 20,
        age: 7 * 24 * 60 * 60,
      },
      removeOnFail: {
        count: 50,
        age: 30 * 24 * 60 * 60,
      },
    },
  });
  retentionQueue.on('error', (err) => {
    if (!isMaintenance()) console.error('[RunRetention] Queue error:', err);
  });

  console.log('[RunRetention] Queue initialized');
}

/**
 * Start the run retention worker
 */
export function startRunRetentionWorker(): void {
  if (!connectionOptions) {
    throw new Error('Run retention queue not initialized. Call initRunRetentionQueue first.');
  }

  if (retentionWorker) {
    console.log('[RunRetention] Worker already running');
    return;
  }

  const bullPrefix = getBullPrefix();

  retentionWorker = new Worker<RunRetentionJobData>(
    QUEUE_NAME,
    async (job: Job<RunRetentionJobData>) => {
      const startTime = Date.now();
      try {
        const result = await processRunRetention();
        console.log(
          `[RunRetention] Job ${job.id} completed in ${Date.now() - startTime}ms ` +
            `(notification=${result.notificationPurged} policy=${result.policyPurged} ` +
            `diagnostic=${result.diagnosticPurged})`
        );
      } catch (error) {
        console.error(
          `[RunRetention] Job ${job.id} failed after ${Date.now() - startTime}ms:`,
          error
        );
        throw error;
      }
    },
    {
      connection: connectionOptions,
      prefix: bullPrefix,
      concurrency: 1,
    }
  );

  retentionWorker.on('error', (error) => {
    if (!isMaintenance()) console.error('[RunRetention] Worker error:', error);
  });

  console.log('[RunRetention] Worker started');
}

/**
 * Schedule the daily run retention purge
 */
export async function scheduleRunRetention(): Promise<void> {
  if (!retentionQueue || !connectionOptions) {
    console.error('[RunRetention] Queue not initialized');
    return;
  }

  // Droppable once no install can predate 2.2.0-beta, the release that renamed the queue.
  const legacyQueue = new Queue(LEGACY_QUEUE_NAME, {
    connection: connectionOptions,
    prefix: getBullPrefix(),
  });
  try {
    await legacyQueue.obliterate({ force: true });
  } catch (error) {
    console.warn('[RunRetention] Could not sweep the legacy queue:', error);
  } finally {
    await legacyQueue.close();
  }

  // getJobSchedulers returns {key, name, next, every} - there is no id to remove by.
  const schedulers = await retentionQueue.getJobSchedulers();
  for (const scheduler of schedulers) {
    await retentionQueue.removeJobScheduler(scheduler.key);
  }

  await retentionQueue.add(
    'scheduled-purge',
    { type: 'purge' },
    {
      repeat: {
        every: PURGE_INTERVAL_MS,
      },
      jobId: 'run-retention-repeatable',
    }
  );

  console.log('[RunRetention] Scheduled daily run purge');
}

export interface RunRetentionResult {
  notificationPurged: number;
  policyPurged: number;
  diagnosticPurged: number;
}

async function deleteBatched(where: SQL): Promise<number> {
  let total = 0;
  for (;;) {
    const result = await db.execute(sql`
      DELETE FROM automation_runs
      WHERE id IN (
        SELECT ar.id FROM automation_runs ar
        JOIN automations a ON a.id = ar.rule_id
        WHERE ar.status = 'finished' AND ar.session_id IS NOT NULL AND (${where})
        LIMIT ${DELETE_BATCH_SIZE}
      )
    `);
    const deleted = result.rowCount ?? 0;
    total += deleted;
    if (deleted < DELETE_BATCH_SIZE) break;
  }
  return total;
}

function completedOfKind(kind: AutomationKind, defaultDays: number): SQL {
  return sql`ar.kind = ${kind} AND ar.outcome = 'completed'
    AND ar.finished_at < now() - make_interval(days => COALESCE(a.retention_days, ${defaultDays}))`;
}

// Kind-scoped so the (kind, finished_at) index serves the scan; every kind is swept.
function diagnosticsOfKind(kind: AutomationKind): SQL {
  return sql`ar.kind = ${kind} AND ar.outcome <> 'completed'
    AND ar.finished_at < now() - make_interval(days => ${DIAGNOSTIC_RETENTION_DAYS})`;
}

/**
 * Hard-delete session-bound runs past their retention window.
 */
export async function processRunRetention(): Promise<RunRetentionResult> {
  const notificationPurged = await deleteBatched(
    completedOfKind('notification', RETENTION_DEFAULTS.notification)
  );
  const policyPurged = await deleteBatched(completedOfKind('policy', RETENTION_DEFAULTS.policy));

  let diagnosticPurged = 0;
  for (const kind of AUTOMATION_KINDS) {
    const purged = await deleteBatched(diagnosticsOfKind(kind));
    diagnosticPurged += purged;
  }

  return { notificationPurged, policyPurged, diagnosticPurged };
}

/**
 * Gracefully shutdown the run retention queue and worker
 */
export async function shutdownRunRetentionQueue(): Promise<void> {
  console.log('[RunRetention] Shutting down queue...');

  if (retentionWorker) {
    await retentionWorker.close();
    retentionWorker = null;
  }

  if (retentionQueue) {
    await retentionQueue.close();
    retentionQueue = null;
  }

  console.log('[RunRetention] Queue shutdown complete');
}
