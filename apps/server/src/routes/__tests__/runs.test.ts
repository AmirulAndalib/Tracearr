/**
 * Automation run route tests
 *
 * The db is mocked: what this tier proves is the envelope, the predicates each
 * handler built, and the two-tier serialization — summaries never carry the step
 * log, the detail route always does.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import sensible from '@fastify/sensible';
import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@tracearr/shared';
import { queryChain, renderCall, renderedJoins } from '../../test/helpers.js';

vi.mock('../../db/client.js', () => ({
  db: { select: vi.fn() },
}));

import { db } from '../../db/client.js';
import { runRoutes } from '../runs.js';

const RUN_ID = randomUUID();
const AUTOMATION_ID = randomUUID();

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    automationId: AUTOMATION_ID,
    automationName: 'kill long pauses',
    kind: 'policy',
    outcome: 'completed',
    humanSummary: null,
    severity: 'warning',
    serverUserId: 'su-1',
    sessionId: 's-1',
    serverId: 'srv-1',
    subjectKey: 's-1',
    startedAt: new Date('2026-08-20T10:00:00.000Z'),
    createdAt: new Date('2026-08-20T10:00:00.000Z'),
    finishedAt: new Date('2026-08-20T10:00:02.000Z'),
    acknowledgedAt: null,
    dismissedAt: null,
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

const strandedViewer: AuthUser = {
  userId: randomUUID(),
  username: 'stranded',
  role: 'viewer',
  serverIds: [],
};

async function buildTestApp(authUser: AuthUser): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  await app.register(sensible);
  app.decorate('authenticate', async (request: unknown) => {
    (request as { user: AuthUser }).user = authUser;
  });
  await app.register(runRoutes, { prefix: '/runs' });
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

describe('Run routes', () => {
  let app: FastifyInstance;

  beforeEach(() => {
    // Reset, not clear: an unconsumed mockReturnValueOnce would answer the next test's query.
    vi.resetAllMocks();
  });

  afterEach(async () => {
    await app?.close();
  });

  describe('GET /runs', () => {
    it('returns summaries in the list envelope, with no step log', async () => {
      app = await buildTestApp(ownerUser);
      setupListMocks([runRow()], 1);

      const response = await app.inject({ method: 'GET', url: '/runs' });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 1 });
      expect(body.data[0]).toEqual({
        id: RUN_ID,
        automationId: AUTOMATION_ID,
        automationName: 'kill long pauses',
        kind: 'policy',
        outcome: 'completed',
        humanSummary: null,
        severity: 'warning',
        serverUserId: 'su-1',
        sessionId: 's-1',
        serverId: 'srv-1',
        subjectKey: 's-1',
        startedAt: '2026-08-20T10:00:00.000Z',
        finishedAt: '2026-08-20T10:00:02.000Z',
        acknowledgedAt: null,
        dismissedAt: null,
      });
    });

    it('falls back to the row timestamp for a run written before started_at existed', async () => {
      app = await buildTestApp(ownerUser);
      setupListMocks([runRow({ startedAt: null, finishedAt: null })], 1);

      const response = await app.inject({ method: 'GET', url: '/runs' });

      expect(response.json().data[0].startedAt).toBe('2026-08-20T10:00:00.000Z');
      expect(response.json().data[0].finishedAt).toBeNull();
    });

    it('filters on kind, outcome, automation and the date bounds', async () => {
      app = await buildTestApp(ownerUser);
      const { pageChain, countChain } = setupListMocks([], 0);

      const response = await app.inject({
        method: 'GET',
        url: `/runs?kind=notification&outcome=error&automationId=${AUTOMATION_ID}&startDate=2026-08-01&endDate=2026-08-15`,
      });

      expect(response.statusCode).toBe(200);
      const page = renderCall(pageChain);
      expect(page.text).toContain('automation_runs.kind = ');
      expect(page.text).toContain('automation_runs.outcome = ');
      expect(page.text).toContain('automation_runs.rule_id = ');
      expect(page.text).toContain('automation_runs.started_at >= ');
      expect(page.text).toContain('automation_runs.started_at < ');
      expect(page.params).toEqual([
        'notification',
        'error',
        AUTOMATION_ID,
        '2026-08-01T00:00:00.000Z',
        // The end bound is exclusive, so the day the caller named is included.
        '2026-08-16T00:00:00.000Z',
      ]);
      expect(renderCall(countChain).text).toBe(page.text);
    });

    it('counts over the joins the page selects from', async () => {
      app = await buildTestApp(ownerUser);
      const { pageChain, countChain } = setupListMocks([], 0);

      await app.inject({ method: 'GET', url: '/runs' });

      // A filter on an automations column would throw against a FROM that omits the join.
      expect(renderedJoins(pageChain)).toEqual(['automation_runs.rule_id = automations.id']);
      expect(renderedJoins(countChain)).toEqual(renderedJoins(pageChain));
    });

    it('defaults to newest first, tiebroken on the run id', async () => {
      app = await buildTestApp(ownerUser);
      const { pageChain } = setupListMocks([], 0);

      await app.inject({ method: 'GET', url: '/runs' });

      expect(renderCall(pageChain, 'orderBy').text).toBe(
        'automation_runs.started_at DESC NULLS LAST, automation_runs.id ASC'
      );
    });

    it('rejects a sort field that is not whitelisted', async () => {
      app = await buildTestApp(ownerUser);
      setupListMocks([], 0);

      const response = await app.inject({ method: 'GET', url: '/runs?orderBy=humanSummary' });

      expect(response.statusCode).toBe(400);
    });

    it('scopes a viewer to the servers its accounts are on', async () => {
      app = await buildTestApp(viewerUser);
      const { pageChain } = setupListMocks([], 0);

      await app.inject({ method: 'GET', url: '/runs' });

      expect(renderCall(pageChain).params).toContain('srv-1');
    });

    it('answers an empty page for a caller with no servers, without querying', async () => {
      app = await buildTestApp(strandedViewer);

      const response = await app.inject({ method: 'GET', url: '/runs' });

      expect(response.json()).toEqual({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  describe('GET /runs/:id', () => {
    it('carries the step log and the version the run evaluated', async () => {
      app = await buildTestApp(ownerUser);
      const steps = [{ trigger: { type: 'session.started' } }, { action: 'kill_stream' }];
      vi.mocked(db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        queryChain(vi.fn, [{ ...runRow(), steps, definitionVersionId: 'ver-2' }])
      );

      const response = await app.inject({ method: 'GET', url: `/runs/${RUN_ID}` });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.steps).toEqual(steps);
      expect(body.definitionVersionId).toBe('ver-2');
      expect(body.id).toBe(RUN_ID);
    });

    it('reports an empty step log rather than null', async () => {
      app = await buildTestApp(ownerUser);
      vi.mocked(db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        queryChain(vi.fn, [{ ...runRow(), steps: null, definitionVersionId: null }])
      );

      const response = await app.inject({ method: 'GET', url: `/runs/${RUN_ID}` });

      expect(response.json().steps).toEqual([]);
    });

    it('404s when there is no such run', async () => {
      app = await buildTestApp(ownerUser);
      vi.mocked(db.select as unknown as ReturnType<typeof vi.fn>).mockReturnValue(
        queryChain(vi.fn, [])
      );

      const response = await app.inject({ method: 'GET', url: `/runs/${RUN_ID}` });

      expect(response.statusCode).toBe(404);
    });

    it('400s on an id that is not a uuid', async () => {
      app = await buildTestApp(ownerUser);

      const response = await app.inject({ method: 'GET', url: '/runs/not-a-uuid' });

      expect(response.statusCode).toBe(400);
    });
  });
});
