/**
 * Run retention integration tests
 *
 * The purge windows are per-row SQL — COALESCE over the joined automation's
 * retention_days — so only a real database can answer which rows survive.
 *
 * Run with: pnpm --filter @tracearr/server test:integration -- runRetention
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  createTestUser,
  createTestServer,
  createTestServerUser,
  createTestSession,
} from '@tracearr/test-utils/factories';
import type { AutomationKind, RunOutcome, RunStatus } from '@tracearr/shared';
import { db } from '../../src/db/client.js';
import { automations, automationRuns } from '../../src/db/schema.js';
import { processRunRetention } from '../../src/jobs/runRetentionQueue.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (days: number): Date => new Date(Date.now() - days * DAY_MS);

async function seedAutomation(
  kind: AutomationKind,
  retentionDays: number | null = null
): Promise<string> {
  const [row] = await db
    .insert(automations)
    .values({
      name: `${kind}-${randomUUID().slice(0, 8)}`,
      kind,
      retentionDays,
      conditions: { groups: [] },
      actions: { actions: [] },
    })
    .returning({ id: automations.id });
  if (!row) throw new Error('failed to insert the automation');
  return row.id;
}

interface RunSeed {
  automationId: string;
  serverUserId: string;
  sessionId: string | null;
  kind: AutomationKind;
  finishedAt: Date;
  status?: RunStatus;
  outcome?: RunOutcome;
  acknowledgedAt?: Date | null;
  dismissedAt?: Date | null;
}

async function seedRun(seed: RunSeed): Promise<string> {
  const [row] = await db
    .insert(automationRuns)
    .values({
      automationId: seed.automationId,
      serverUserId: seed.serverUserId,
      sessionId: seed.sessionId,
      kind: seed.kind,
      status: seed.status ?? 'finished',
      outcome: seed.outcome ?? 'completed',
      finishedAt: seed.finishedAt,
      acknowledgedAt: seed.acknowledgedAt ?? null,
      dismissedAt: seed.dismissedAt ?? null,
      data: {},
    })
    .returning({ id: automationRuns.id });
  if (!row) throw new Error('failed to insert the run');
  return row.id;
}

async function survivors(): Promise<Set<string>> {
  const rows = await db.select({ id: automationRuns.id }).from(automationRuns);
  return new Set(rows.map((row) => row.id));
}

async function seedSubject(): Promise<{ serverUserId: string; sessionId: string }> {
  const owner = await createTestUser({ role: 'owner' });
  const server = await createTestServer({ type: 'plex' });
  const serverUser = await createTestServerUser({ userId: owner.id, serverId: server.id });
  const session = await createTestSession({ serverId: server.id, serverUserId: serverUser.id });
  return { serverUserId: serverUser.id, sessionId: session.id };
}

describe('processRunRetention', () => {
  it('ages completed runs on the default window for their kind', async () => {
    const { serverUserId, sessionId } = await seedSubject();
    const notify = await seedAutomation('notification');
    const policy = await seedAutomation('policy');

    const staleNotification = await seedRun({
      automationId: notify,
      serverUserId,
      sessionId,
      kind: 'notification',
      finishedAt: daysAgo(31),
    });
    const freshNotification = await seedRun({
      automationId: notify,
      serverUserId,
      sessionId,
      kind: 'notification',
      finishedAt: daysAgo(29),
    });
    const stalePolicy = await seedRun({
      automationId: policy,
      serverUserId,
      sessionId,
      kind: 'policy',
      finishedAt: daysAgo(400),
    });
    const freshPolicy = await seedRun({
      automationId: policy,
      serverUserId,
      sessionId,
      kind: 'policy',
      finishedAt: daysAgo(100),
    });

    const result = await processRunRetention();
    const left = await survivors();

    expect(result.notificationPurged).toBe(1);
    expect(result.policyPurged).toBe(1);
    expect(left.has(staleNotification)).toBe(false);
    expect(left.has(stalePolicy)).toBe(false);
    expect(left.has(freshNotification)).toBe(true);
    expect(left.has(freshPolicy)).toBe(true);
  });

  it('lets a per-automation override shorten or lengthen the window', async () => {
    const { serverUserId, sessionId } = await seedSubject();
    const shortPolicy = await seedAutomation('policy', 5);
    const longNotification = await seedAutomation('notification', 400);

    const purgedEarly = await seedRun({
      automationId: shortPolicy,
      serverUserId,
      sessionId,
      kind: 'policy',
      finishedAt: daysAgo(10),
    });
    const keptLonger = await seedRun({
      automationId: longNotification,
      serverUserId,
      sessionId,
      kind: 'notification',
      finishedAt: daysAgo(100),
    });

    await processRunRetention();
    const left = await survivors();

    expect(left.has(purgedEarly)).toBe(false);
    expect(left.has(keptLonger)).toBe(true);
  });

  it('purges non-completed runs at 30 days whatever the kind or override says', async () => {
    const { serverUserId, sessionId } = await seedSubject();
    const policy = await seedAutomation('policy', 400);
    const notify = await seedAutomation('notification', 400);

    const stoppedPolicy = await seedRun({
      automationId: policy,
      serverUserId,
      sessionId,
      kind: 'policy',
      outcome: 'stopped_by_condition',
      finishedAt: daysAgo(31),
    });
    const erroredNotification = await seedRun({
      automationId: notify,
      serverUserId,
      sessionId,
      kind: 'notification',
      outcome: 'error',
      finishedAt: daysAgo(31),
    });
    const recentError = await seedRun({
      automationId: policy,
      serverUserId,
      sessionId,
      kind: 'policy',
      outcome: 'error',
      finishedAt: daysAgo(29),
    });

    const result = await processRunRetention();
    const left = await survivors();

    expect(result.diagnosticPurged).toBe(2);
    expect(left.has(stoppedPolicy)).toBe(false);
    expect(left.has(erroredNotification)).toBe(false);
    expect(left.has(recentError)).toBe(true);
  });

  it('never touches running or account-keyed rows and ignores ack or dismiss state', async () => {
    const { serverUserId, sessionId } = await seedSubject();
    const policy = await seedAutomation('policy');
    const notify = await seedAutomation('notification');

    const running = await seedRun({
      automationId: policy,
      serverUserId,
      sessionId,
      kind: 'policy',
      status: 'running',
      finishedAt: daysAgo(400),
    });
    const accountPolicy = await seedRun({
      automationId: policy,
      serverUserId,
      sessionId: null,
      kind: 'policy',
      finishedAt: daysAgo(400),
    });
    const accountNotification = await seedRun({
      automationId: notify,
      serverUserId,
      sessionId: null,
      kind: 'notification',
      finishedAt: daysAgo(400),
    });
    const accountDiagnostic = await seedRun({
      automationId: notify,
      serverUserId,
      sessionId: null,
      kind: 'notification',
      outcome: 'stopped_by_condition',
      finishedAt: daysAgo(400),
    });
    const acknowledged = await seedRun({
      automationId: policy,
      serverUserId,
      sessionId,
      kind: 'policy',
      finishedAt: daysAgo(400),
      acknowledgedAt: daysAgo(399),
    });
    const dismissed = await seedRun({
      automationId: policy,
      serverUserId,
      sessionId,
      kind: 'policy',
      finishedAt: daysAgo(400),
      dismissedAt: daysAgo(399),
    });

    await processRunRetention();
    const left = await survivors();

    expect(left.has(running)).toBe(true);
    expect(left.has(accountPolicy)).toBe(true);
    expect(left.has(accountNotification)).toBe(true);
    expect(left.has(accountDiagnostic)).toBe(true);
    expect(left.has(acknowledged)).toBe(false);
    expect(left.has(dismissed)).toBe(false);
  });
});
