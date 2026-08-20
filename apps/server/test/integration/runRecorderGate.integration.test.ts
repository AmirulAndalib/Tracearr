/**
 * Notification edge gate integration test
 *
 * The gate compares `data->>'edgeKey'` with IS NOT DISTINCT FROM, so a null edge has to
 * match a null bind against a real jsonb column — the one part of the gate a mocked
 * driver cannot answer.
 *
 * Run with: pnpm --filter @tracearr/server test:integration -- runRecorderGate
 */

import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  createTestUser,
  createTestServer,
  createTestServerUser,
  createTestSession,
} from '@tracearr/test-utils/factories';
import type { RuleV2 } from '@tracearr/shared';
import { db } from '../../src/db/client.js';
import { automations, automationRuns } from '../../src/db/schema.js';
import { recordRun, type RunTrigger } from '../../src/services/automations/runRecorder.js';
import type { EvaluationResult } from '../../src/services/rules/types.js';

const matched: EvaluationResult = {
  ruleId: 'unused',
  ruleName: 'notify on start',
  matched: true,
  matchedGroups: [0],
  actions: [],
  evidence: [],
};

describe('recordRun notification gate', () => {
  it('blocks a replayed null edge and lets a different edge through', async () => {
    const owner = await createTestUser({ role: 'owner' });
    const server = await createTestServer({ type: 'plex' });
    const serverUser = await createTestServerUser({ userId: owner.id, serverId: server.id });
    const session = await createTestSession({ serverId: server.id, serverUserId: serverUser.id });

    const nodeId = randomUUID();
    const [row] = await db
      .insert(automations)
      .values({
        name: 'notify on start',
        kind: 'notification',
        severity: 'warning',
        isActive: true,
        conditions: { groups: [] },
        actions: { actions: [] },
        triggers: [{ id: nodeId, type: 'session.started', enabled: true }],
      })
      .returning();
    if (!row) throw new Error('failed to insert the automation');

    const automation: RuleV2 = {
      id: row.id,
      name: row.name,
      description: null,
      serverId: null,
      serverUserId: null,
      userId: null,
      enforceAcrossServers: false,
      isActive: true,
      severity: 'warning',
      kind: 'notification',
      conditions: { groups: [] },
      actions: { actions: [] },
      triggers: [{ id: nodeId, type: 'session.started', enabled: true }],
      cooldownMinutes: null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
    const record = (trigger: RunTrigger) =>
      recordRun({
        automation,
        result: matched,
        serverUserId: serverUser.id,
        serverId: server.id,
        scope: { kind: 'session', sessionId: session.id },
        session: null,
        trigger,
      });
    const nullEdge: RunTrigger = {
      type: 'session.started',
      nodeId,
      edgeKey: null,
      at: new Date(),
    };

    const first = await record(nullEdge);
    const replay = await record(nullEdge);
    const other = await record({ ...nullEdge, edgeKey: 'transcode/none' });

    expect(first).not.toBeNull();
    expect(replay).toBeNull();
    expect(other).not.toBeNull();

    const stored = await db
      .select({ id: automationRuns.id })
      .from(automationRuns)
      .where(eq(automationRuns.automationId, row.id));
    expect(stored).toHaveLength(2);
  });
});
