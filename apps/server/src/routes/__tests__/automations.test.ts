/**
 * Automation route tests
 *
 * The db is mocked, so what this tier proves is the contract: the list envelope
 * and the predicates the handler passed, which writes take a version row, and
 * that every write sits behind the owner decorator. Assertions render the SQL
 * the handler built rather than counting calls.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import type { AuthUser, RuleActions, RuleConditions } from '@tracearr/shared';
import { queryChain, renderCall } from '../../test/helpers.js';

vi.mock('../../db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    transaction: vi.fn(),
  },
}));

vi.mock('../../jobs/poller/database.js', () => ({ invalidateRulesCache: vi.fn() }));
vi.mock('../../jobs/inactivityCheckQueue.js', () => ({ scheduleInactivityChecks: vi.fn() }));
vi.mock('../../services/notifications/destinationRefs.js', () => ({
  unknownDestinationIds: vi.fn(),
}));

import { db } from '../../db/client.js';
import { invalidateRulesCache } from '../../jobs/poller/database.js';
import { unknownDestinationIds } from '../../services/notifications/destinationRefs.js';
import { automationRoutes } from '../automations.js';

const conditions: RuleConditions = {
  groups: [{ conditions: [{ field: 'concurrent_streams', operator: 'gt', value: 2 }] }],
};

const actions: RuleActions = { actions: [{ type: 'kill_stream' }] };

const AUTOMATION_ID = randomUUID();
const OTHER_ID = randomUUID();

function automationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: AUTOMATION_ID,
    name: 'kill long pauses',
    description: null,
    kind: 'policy',
    severity: 'warning',
    triggers: [{ id: randomUUID(), type: 'session.started', enabled: true }],
    conditions,
    actions,
    serverId: null,
    serverUserId: null,
    userId: null,
    enforceAcrossServers: false,
    isActive: true,
    cooldownMinutes: null,
    retentionDays: null,
    createdAt: new Date('2026-08-01T00:00:00.000Z'),
    updatedAt: new Date('2026-08-02T00:00:00.000Z'),
    ...overrides,
  };
}

const ownerUser: AuthUser = {
  userId: randomUUID(),
  username: 'owner',
  role: 'owner',
  serverIds: [],
};

const viewerUser: AuthUser = {
  userId: randomUUID(),
  username: 'viewer',
  role: 'viewer',
  serverIds: ['srv-1'],
};

async function buildTestApp(authUser: AuthUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);

  app.decorate('authenticate', async (request: unknown) => {
    (request as { user: AuthUser }).user = authUser;
  });
  app.decorate('requireOwner', async (request: unknown, reply: FastifyReply) => {
    (request as { user: AuthUser }).user = authUser;
    if (authUser.role !== 'owner') {
      await reply.forbidden('Owner access required');
    }
  });
  const redis = {
    lrange: vi.fn().mockResolvedValue([
      JSON.stringify({
        reason: 'cooldown_active',
        subjectKey: 's1',
        trigger: 'session.paused',
        at: '2026-08-20T10:00:00.000Z',
      }),
      'not json',
      JSON.stringify({
        reason: 'gate_blocked',
        subjectKey: 's2',
        trigger: 'session.started',
        at: '2026-08-20T09:00:00.000Z',
      }),
    ]),
  };
  app.decorate('redis', redis as unknown as FastifyInstance['redis']);

  await app.register(automationRoutes, { prefix: '/automations' });
  return app;
}

/** The page query, then its count. */
function setupListMocks(rows: unknown[], total: number) {
  const pageChain = queryChain(vi.fn, rows);
  const countChain = queryChain(vi.fn, [{ total }]);
  vi.mocked(db.select as unknown as ReturnType<typeof vi.fn>)
    .mockReturnValueOnce(pageChain)
    .mockReturnValueOnce(countChain)
    .mockReturnValue(queryChain(vi.fn, []));
  return { pageChain, countChain };
}

/** One select, for the by-id load a write path does first. */
function setupSelect(...results: unknown[][]) {
  const chains = results.map((rows) => queryChain(vi.fn, rows));
  const select = vi.mocked(db.select as unknown as ReturnType<typeof vi.fn>);
  for (const chain of chains) select.mockReturnValueOnce(chain);
  select.mockReturnValue(queryChain(vi.fn, []));
  return chains;
}

interface TxHarness {
  inserts: unknown[];
  insertedValues: unknown[];
  updateSets: unknown[];
}

/** Records which tables the transaction wrote, so a version row is visible to assertions. */
function setupTransaction(rows: unknown[][]): TxHarness {
  const harness: TxHarness = { inserts: [], insertedValues: [], updateSets: [] };
  let call = 0;
  const next = () => rows[call++] ?? [];
  const tx = {
    insert: (table: unknown) => {
      harness.inserts.push(table);
      return {
        values: (values: unknown) => {
          harness.insertedValues.push(values);
          return { returning: () => Promise.resolve(next()) };
        },
      };
    },
    update: () => ({
      set: (values: unknown) => {
        harness.updateSets.push(values);
        return { where: () => ({ returning: () => Promise.resolve(next()) }) };
      },
    }),
  };
  vi.mocked(db.transaction as unknown as ReturnType<typeof vi.fn>).mockImplementation((async (
    fn: (executor: unknown) => Promise<unknown>
  ) => fn(tx)) as never);
  return harness;
}

/** The driver's error when the version number this save computed is already taken. */
function versionCollision(): Error {
  return Object.assign(
    new Error('duplicate key value violates unique constraint "automation_versions_unique"'),
    { code: '23505' }
  );
}

/** Collides the next `times` transactions; the harness implementation answers the rest. */
function failTransactions(times: number): void {
  const transaction = vi.mocked(db.transaction as unknown as ReturnType<typeof vi.fn>);
  for (let i = 0; i < times; i++) {
    transaction.mockImplementationOnce((() => Promise.reject(versionCollision())) as never);
  }
}

describe('Automation routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    // Reset, not clear: an unconsumed mockReturnValueOnce would answer the next test's query.
    vi.resetAllMocks();
    vi.mocked(unknownDestinationIds).mockResolvedValue([]);
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('GET /automations', () => {
    it('returns the list envelope with the wire shape', async () => {
      app = await buildTestApp(ownerUser);
      setupListMocks([automationRow()], 1);

      const response = await app.inject({ method: 'GET', url: '/automations' });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
      expect(body.data[0]).toMatchObject({
        id: AUTOMATION_ID,
        name: 'kill long pauses',
        kind: 'policy',
        severity: 'warning',
        isActive: true,
        cooldownMinutes: null,
        retentionDays: null,
        createdAt: '2026-08-01T00:00:00.000Z',
        updatedAt: '2026-08-02T00:00:00.000Z',
      });
      expect(body.data[0].triggers).toHaveLength(1);
      expect(body.data[0].conditions).toEqual(conditions);
    });

    it('filters on kind, enabled and a name search', async () => {
      app = await buildTestApp(ownerUser);
      const { pageChain, countChain } = setupListMocks([], 0);

      const response = await app.inject({
        method: 'GET',
        url: '/automations?kind=notification&enabled=false&search=pause%25',
      });

      expect(response.statusCode).toBe(200);
      const page = renderCall(pageChain);
      expect(page.text).toContain('automations.kind = ');
      expect(page.text).toContain('automations.is_active = ');
      expect(page.text).toContain('automations.name ilike ');
      // The literal % the caller typed is escaped, never a wildcard.
      expect(page.params).toEqual(['notification', false, '%pause\\%%']);
      // The count counts exactly the page's rows.
      expect(renderCall(countChain).text).toBe(page.text);
    });

    it('sorts on a whitelisted field, tiebroken on the id', async () => {
      app = await buildTestApp(ownerUser);
      const { pageChain } = setupListMocks([], 0);

      await app.inject({ method: 'GET', url: '/automations?orderBy=updatedAt&orderDir=asc' });

      expect(renderCall(pageChain, 'orderBy').text).toBe(
        'automations.updated_at ASC, automations.id ASC'
      );
    });

    it('rejects a sort field that is not whitelisted', async () => {
      app = await buildTestApp(ownerUser);
      setupListMocks([], 0);

      const response = await app.inject({ method: 'GET', url: '/automations?orderBy=severity' });

      expect(response.statusCode).toBe(400);
    });

    it('shows a viewer global automations and the ones scoped to servers it can reach', async () => {
      app = await buildTestApp(viewerUser);
      const { pageChain } = setupListMocks([], 0);

      await app.inject({ method: 'GET', url: '/automations' });

      const page = renderCall(pageChain);
      expect(page.text).toContain('automations.server_id is null');
      expect(page.text).toContain('EXISTS (SELECT 1 FROM server_users su');
      expect(page.params).toContain('srv-1');
    });
  });

  describe('GET /automations/:id', () => {
    it('returns the automation', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([automationRow()]);

      const response = await app.inject({ method: 'GET', url: `/automations/${AUTOMATION_ID}` });

      expect(response.statusCode).toBe(200);
      expect(response.json().id).toBe(AUTOMATION_ID);
    });

    it('404s when there is no such automation', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([]);

      const response = await app.inject({ method: 'GET', url: `/automations/${AUTOMATION_ID}` });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('POST /automations', () => {
    const body = {
      name: 'pause watch',
      kind: 'policy' as const,
      severity: 'warning' as const,
      conditions: {
        groups: [{ conditions: [{ field: 'total_pause_minutes', operator: 'gt', value: 30 }] }],
      },
      actions: { actions: [{ type: 'kill_stream' as const }] },
    };

    it('stamps nodes, synthesizes triggers and writes version 1 in the same transaction', async () => {
      app = await buildTestApp(ownerUser);
      const created = automationRow({ id: OTHER_ID, name: 'pause watch' });
      const harness = setupTransaction([[created], [{ id: 'ver-1' }]]);

      const response = await app.inject({ method: 'POST', url: '/automations', payload: body });

      expect(response.statusCode).toBe(201);
      expect(response.json().id).toBe(OTHER_ID);

      const values = harness.insertedValues[0] as {
        conditions: RuleConditions;
        actions: RuleActions;
        triggers: Array<{ type: string }>;
      };
      const condition = values.conditions.groups[0]?.conditions[0];
      expect(condition).toMatchObject({ id: expect.any(String), enabled: true });
      expect(values.actions.actions[0]).toMatchObject({ id: expect.any(String), enabled: true });
      expect(values.triggers.map((trigger) => trigger.type)).toEqual([
        'session.started',
        'session.paused',
        'session.held_for',
      ]);

      const version = harness.insertedValues[1] as { version: unknown; definition: unknown };
      expect(harness.inserts).toHaveLength(2);
      expect(version.definition).toMatchObject({ name: 'pause watch', kind: 'policy' });
      expect(invalidateRulesCache).toHaveBeenCalledTimes(1);
    });

    it('preserves ids the builder already assigned', async () => {
      app = await buildTestApp(ownerUser);
      const harness = setupTransaction([[automationRow()], [{ id: 'ver-1' }]]);
      const id = randomUUID();

      await app.inject({
        method: 'POST',
        url: '/automations',
        payload: {
          ...body,
          actions: { actions: [{ type: 'kill_stream', id, enabled: false }] },
        },
      });

      const values = harness.insertedValues[0] as { actions: RuleActions };
      expect(values.actions.actions[0]).toMatchObject({ id, enabled: false });
    });

    it('names the destinations no row backs', async () => {
      app = await buildTestApp(ownerUser);
      const gone = randomUUID();
      vi.mocked(unknownDestinationIds).mockResolvedValue([gone]);
      setupTransaction([[automationRow()]]);

      const response = await app.inject({
        method: 'POST',
        url: '/automations',
        payload: {
          ...body,
          actions: { actions: [{ type: 'send', to: [gone] }] },
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain(gone);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('rejects two scopes at once', async () => {
      app = await buildTestApp(ownerUser);

      const response = await app.inject({
        method: 'POST',
        url: '/automations',
        payload: { ...body, serverId: randomUUID(), userId: randomUUID() },
      });

      expect(response.statusCode).toBe(400);
    });

    it('404s on a scope the database does not have', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([]);

      const response = await app.inject({
        method: 'POST',
        url: '/automations',
        payload: { ...body, serverId: randomUUID() },
      });

      expect(response.statusCode).toBe(404);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('is owner only', async () => {
      app = await buildTestApp(viewerUser);

      const response = await app.inject({ method: 'POST', url: '/automations', payload: body });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('PATCH /automations/:id', () => {
    it('versions a definition change and re-synthesizes triggers', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([automationRow()]);
      const nextConditions = {
        groups: [{ conditions: [{ field: 'inactive_days', operator: 'gte', value: 30 }] }],
      };
      const harness = setupTransaction([
        [automationRow({ conditions: nextConditions, triggers: [] })],
        [{ id: 'ver-2' }],
      ]);

      const response = await app.inject({
        method: 'PATCH',
        url: `/automations/${AUTOMATION_ID}`,
        payload: { conditions: nextConditions },
      });

      expect(response.statusCode).toBe(200);
      const update = harness.updateSets[0] as { triggers: Array<{ type: string }> };
      expect(update.triggers.map((trigger) => trigger.type)).toEqual(['account.inactive_for']);
      expect(harness.inserts).toHaveLength(1);
      expect(invalidateRulesCache).toHaveBeenCalledTimes(1);
    });

    it('writes no version for a bare active toggle', async () => {
      app = await buildTestApp(ownerUser);
      const stored = automationRow();
      setupSelect([stored]);
      const harness = setupTransaction([[{ ...stored, isActive: false }]]);

      const response = await app.inject({
        method: 'PATCH',
        url: `/automations/${AUTOMATION_ID}`,
        payload: { isActive: false },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().isActive).toBe(false);
      expect(harness.inserts).toEqual([]);
      expect(harness.updateSets[0]).not.toHaveProperty('triggers');
    });

    it('writes no version for a retention or cooldown change', async () => {
      app = await buildTestApp(ownerUser);
      const stored = automationRow();
      setupSelect([stored]);
      const harness = setupTransaction([[{ ...stored, retentionDays: 14, cooldownMinutes: 5 }]]);

      const response = await app.inject({
        method: 'PATCH',
        url: `/automations/${AUTOMATION_ID}`,
        payload: { retentionDays: 14, cooldownMinutes: 5 },
      });

      expect(response.statusCode).toBe(200);
      expect(harness.inserts).toEqual([]);
    });

    it('writes no version when the payload restates the stored definition', async () => {
      app = await buildTestApp(ownerUser);
      // A round-trip from the builder resends the stored nodes, ids and all, so stamping is a no-op.
      const stored = automationRow({
        conditions: {
          groups: [
            {
              conditions: [
                {
                  id: randomUUID(),
                  enabled: true,
                  field: 'concurrent_streams',
                  operator: 'gt',
                  value: 2,
                },
              ],
            },
          ],
        },
        actions: { actions: [{ id: randomUUID(), enabled: true, type: 'kill_stream' }] },
      });
      setupSelect([stored]);
      const harness = setupTransaction([[stored]]);

      const response = await app.inject({
        method: 'PATCH',
        url: `/automations/${AUTOMATION_ID}`,
        payload: {
          name: stored.name,
          conditions: stored.conditions,
          actions: stored.actions,
        },
      });

      expect(response.statusCode).toBe(200);
      // Fresh trigger ids on an unchanged definition would version the automation on every save.
      expect(harness.updateSets[0]).not.toHaveProperty('triggers');
      expect(harness.inserts).toEqual([]);
    });

    it('stamps the action nodes a payload changes', async () => {
      app = await buildTestApp(ownerUser);
      const stored = automationRow();
      setupSelect([stored]);
      const nextActions = { actions: [{ type: 'message_client', message: 'wrap it up' }] };
      const harness = setupTransaction([[{ ...stored, actions: nextActions }], [{ id: 'ver-2' }]]);

      const response = await app.inject({
        method: 'PATCH',
        url: `/automations/${AUTOMATION_ID}`,
        payload: { actions: nextActions },
      });

      expect(response.statusCode).toBe(200);
      const update = harness.updateSets[0] as { actions: RuleActions };
      expect(update.actions.actions[0]).toMatchObject({
        type: 'message_client',
        id: expect.any(String),
        enabled: true,
      });
      expect(harness.inserts).toHaveLength(1);
    });

    it('names the destinations no row backs', async () => {
      app = await buildTestApp(ownerUser);
      const gone = randomUUID();
      setupSelect([automationRow()]);
      vi.mocked(unknownDestinationIds).mockResolvedValue([gone]);

      const response = await app.inject({
        method: 'PATCH',
        url: `/automations/${AUTOMATION_ID}`,
        payload: { actions: { actions: [{ type: 'send', to: [gone] }] } },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().message).toContain(gone);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('retries once when a concurrent save took the version number', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([automationRow()]);
      const harness = setupTransaction([[automationRow({ name: 'renamed' })], [{ id: 'ver-3' }]]);
      failTransactions(1);

      const response = await app.inject({
        method: 'PATCH',
        url: `/automations/${AUTOMATION_ID}`,
        payload: { name: 'renamed' },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().name).toBe('renamed');
      expect(db.transaction).toHaveBeenCalledTimes(2);
      expect(harness.inserts).toHaveLength(1);
    });

    it('409s when the retry collides too', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([automationRow()]);
      setupTransaction([[automationRow({ name: 'renamed' })], [{ id: 'ver-3' }]]);
      failTransactions(2);

      const response = await app.inject({
        method: 'PATCH',
        url: `/automations/${AUTOMATION_ID}`,
        payload: { name: 'renamed' },
      });

      expect(response.statusCode).toBe(409);
      expect(db.transaction).toHaveBeenCalledTimes(2);
      expect(invalidateRulesCache).not.toHaveBeenCalled();
    });

    it('rejects a scope that only conflicts once merged with the stored row', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([automationRow({ serverId: 'srv-1' })]);
      setupTransaction([[automationRow()]]);

      const response = await app.inject({
        method: 'PATCH',
        url: `/automations/${AUTOMATION_ID}`,
        payload: { userId: randomUUID() },
      });

      expect(response.statusCode).toBe(400);
      expect(db.transaction).not.toHaveBeenCalled();
    });

    it('rejects cross-server enforcement that the merged scope forbids', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([automationRow({ serverId: 'srv-1' })]);

      const response = await app.inject({
        method: 'PATCH',
        url: `/automations/${AUTOMATION_ID}`,
        payload: { enforceAcrossServers: true },
      });

      expect(response.statusCode).toBe(400);
    });

    it('404s on an automation that is not there', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([]);

      const response = await app.inject({
        method: 'PATCH',
        url: `/automations/${AUTOMATION_ID}`,
        payload: { isActive: false },
      });

      expect(response.statusCode).toBe(404);
    });

    it('is owner only', async () => {
      app = await buildTestApp(viewerUser);

      const response = await app.inject({
        method: 'PATCH',
        url: `/automations/${AUTOMATION_ID}`,
        payload: { isActive: false },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('DELETE /automations/:id', () => {
    it('deletes the automation and invalidates the cache', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([automationRow()]);
      const deleteChain = queryChain(vi.fn, []);
      vi.mocked(db.delete as unknown as ReturnType<typeof vi.fn>).mockReturnValue(deleteChain);

      const response = await app.inject({ method: 'DELETE', url: `/automations/${AUTOMATION_ID}` });

      expect(response.statusCode).toBe(204);
      expect(renderCall(deleteChain).params).toEqual([AUTOMATION_ID]);
      expect(invalidateRulesCache).toHaveBeenCalledTimes(1);
    });

    it('404s on an automation that is not there', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([]);

      const response = await app.inject({ method: 'DELETE', url: `/automations/${AUTOMATION_ID}` });

      expect(response.statusCode).toBe(404);
    });

    it('is owner only', async () => {
      app = await buildTestApp(viewerUser);

      const response = await app.inject({ method: 'DELETE', url: `/automations/${AUTOMATION_ID}` });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('bulk', () => {
    it('toggles every requested automation and reports the count', async () => {
      app = await buildTestApp(ownerUser);
      const updateChain = queryChain(vi.fn, [{ id: AUTOMATION_ID }, { id: OTHER_ID }]);
      vi.mocked(db.update as unknown as ReturnType<typeof vi.fn>).mockReturnValue(updateChain);

      const response = await app.inject({
        method: 'PATCH',
        url: '/automations/bulk',
        payload: { ids: [AUTOMATION_ID, OTHER_ID], isActive: false },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true, updated: 2 });
      expect(renderCall(updateChain).params).toEqual([AUTOMATION_ID, OTHER_ID]);
      expect(invalidateRulesCache).toHaveBeenCalledTimes(1);
    });

    it('deletes every requested automation and reports the count', async () => {
      app = await buildTestApp(ownerUser);
      const deleteChain = queryChain(vi.fn, [{ id: AUTOMATION_ID }]);
      vi.mocked(db.delete as unknown as ReturnType<typeof vi.fn>).mockReturnValue(deleteChain);

      const response = await app.inject({
        method: 'DELETE',
        url: '/automations/bulk',
        payload: { ids: [AUTOMATION_ID] },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ success: true, deleted: 1 });
      expect(invalidateRulesCache).toHaveBeenCalledTimes(1);
    });

    it('leaves the cache alone when nothing matched', async () => {
      app = await buildTestApp(ownerUser);
      vi.mocked(db.delete as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        queryChain(vi.fn, [])
      );

      const response = await app.inject({
        method: 'DELETE',
        url: '/automations/bulk',
        payload: { ids: [AUTOMATION_ID] },
      });

      expect(response.json()).toEqual({ success: true, deleted: 0 });
      expect(invalidateRulesCache).not.toHaveBeenCalled();
    });

    it('is owner only', async () => {
      app = await buildTestApp(viewerUser);

      const response = await app.inject({
        method: 'PATCH',
        url: '/automations/bulk',
        payload: { ids: [AUTOMATION_ID], isActive: true },
      });

      expect(response.statusCode).toBe(403);
    });
  });

  describe('GET /automations/:id/runs', () => {
    it('pages the runs of one automation without their steps', async () => {
      app = await buildTestApp(ownerUser);
      const runRow = {
        id: 'run-1',
        automationId: AUTOMATION_ID,
        automationName: 'kill long pauses',
        kind: 'policy',
        status: 'finished',
        outcome: 'completed',
        humanSummary: null,
        severity: 'warning',
        serverUserId: 'su1',
        sessionId: 's1',
        serverId: 'srv-1',
        subjectKey: 's1',
        startedAt: new Date('2026-08-20T10:00:00.000Z'),
        createdAt: new Date('2026-08-20T10:00:00.000Z'),
        finishedAt: new Date('2026-08-20T10:00:01.000Z'),
        acknowledgedAt: null,
        dismissedAt: null,
      };
      const [, pageChain] = setupSelect([automationRow()], [runRow], [{ total: 1 }]);

      const response = await app.inject({
        method: 'GET',
        url: `/automations/${AUTOMATION_ID}/runs`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
      expect(body.data[0]).not.toHaveProperty('steps');
      expect(body.data[0].startedAt).toBe('2026-08-20T10:00:00.000Z');
      expect(renderCall(pageChain).params).toContain(AUTOMATION_ID);
    });

    it('404s when the automation is gone', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([]);

      const response = await app.inject({
        method: 'GET',
        url: `/automations/${AUTOMATION_ID}/runs`,
      });

      expect(response.statusCode).toBe(404);
    });
  });

  describe('GET /automations/:id/evaluations', () => {
    it('returns the near-miss ring newest first and skips unreadable entries', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([automationRow()]);

      const response = await app.inject({
        method: 'GET',
        url: `/automations/${AUTOMATION_ID}/evaluations`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.data).toHaveLength(2);
      expect(body.data[0]).toEqual({
        reason: 'cooldown_active',
        subjectKey: 's1',
        trigger: 'session.paused',
        at: '2026-08-20T10:00:00.000Z',
      });
      expect(body.data[1].reason).toBe('gate_blocked');
    });

    it('404s when the automation is gone', async () => {
      app = await buildTestApp(ownerUser);
      setupSelect([]);

      const response = await app.inject({
        method: 'GET',
        url: `/automations/${AUTOMATION_ID}/evaluations`,
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
