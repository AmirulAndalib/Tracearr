/**
 * Automation run routes - the log every automation writes, of every evaluation
 * that reached a run. Summaries never carry the step log; only GET /runs/:id does.
 */

import type { FastifyPluginAsync } from 'fastify';
import { and, count, eq, gte, lt, sql, type SQL } from 'drizzle-orm';
import {
  runListQuerySchema,
  uuidSchema,
  type AuthUser,
  type AutomationRun,
  type AutomationRunSummary,
  type ListResponse,
  type RunListQuery,
  type RunSortField,
} from '@tracearr/shared';
import { z } from 'zod';
import { db } from '../db/client.js';
import { automationRuns, automations, serverUsers } from '../db/schema.js';
import { toRunSummary } from '../services/automations/runRecorder.js';
import {
  buildOrderBy,
  utcDayEnd,
  utcDayStart,
  type SortDirection,
  type SortKey,
} from '../utils/listQuery.js';
import { buildMultiServerCondition, resolveServerIds } from '../utils/serverFiltering.js';

const runIdParamSchema = z.object({ id: uuidSchema });

const RUN_SORT_KEYS: Record<RunSortField, SortKey> = {
  startedAt: { key: sql`${automationRuns.startedAt}`, defaultDir: 'desc', nulls: 'last' },
  finishedAt: { key: sql`${automationRuns.finishedAt}`, defaultDir: 'desc', nulls: 'last' },
  outcome: { key: sql`${automationRuns.outcome}`, defaultDir: 'asc' },
};

/** Everything the summary shape needs; the step log stays out by construction. */
const runSummaryColumns = {
  id: automationRuns.id,
  automationId: automationRuns.automationId,
  automationName: automations.name,
  kind: automationRuns.kind,
  status: automationRuns.status,
  outcome: automationRuns.outcome,
  humanSummary: automationRuns.humanSummary,
  severity: automationRuns.severity,
  serverUserId: automationRuns.serverUserId,
  sessionId: automationRuns.sessionId,
  serverId: serverUsers.serverId,
  subjectKey: automationRuns.subjectKey,
  startedAt: automationRuns.startedAt,
  createdAt: automationRuns.createdAt,
  finishedAt: automationRuns.finishedAt,
  acknowledgedAt: automationRuns.acknowledgedAt,
  dismissedAt: automationRuns.dismissedAt,
};

export interface RunPageParams {
  where: SQL | undefined;
  orderBy: RunSortField;
  orderDir: SortDirection | undefined;
  pageSize: number;
  offset: number;
}

/**
 * The one run-summary query. GET /runs and GET /automations/:id/runs differ only
 * in what they put in `where`, so neither can drift into a different row shape.
 */
export function buildRunSummaryQuery(params: RunPageParams) {
  return db
    .select(runSummaryColumns)
    .from(automationRuns)
    .innerJoin(automations, eq(automationRuns.automationId, automations.id))
    .leftJoin(serverUsers, eq(automationRuns.serverUserId, serverUsers.id))
    .where(params.where)
    .orderBy(
      buildOrderBy(RUN_SORT_KEYS, params.orderBy, params.orderDir, sql`${automationRuns.id}`)
    )
    .limit(params.pageSize)
    .offset(params.offset);
}

/** Counted off the same joins the page uses, so the pager cannot disagree with it. */
export async function countRuns(where: SQL | undefined): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(automationRuns)
    .leftJoin(serverUsers, eq(automationRuns.serverUserId, serverUsers.id))
    .where(where);
  return rows[0]?.total ?? 0;
}

export type RunSummaryRow = Awaited<ReturnType<typeof buildRunSummaryQuery>>[number];

export const mapRunSummary = (row: RunSummaryRow): AutomationRunSummary =>
  toRunSummary(row, row.automationName, row.serverId);

/** Runs are attributed through their server account; a caller sees the servers it can reach. */
export function runAccessCondition(authUser: AuthUser): {
  empty: boolean;
  condition: SQL | undefined;
} {
  const resolvedIds = resolveServerIds(authUser, undefined, undefined, { strict: false });
  if (resolvedIds?.length === 0) return { empty: true, condition: undefined };
  return { empty: false, condition: buildMultiServerCondition(resolvedIds, serverUsers.serverId) };
}

export type RunFilters = Omit<RunListQuery, 'page' | 'pageSize' | 'orderBy' | 'orderDir'>;

export function runFilterConditions(filters: RunFilters): SQL[] {
  const conditions: SQL[] = [];
  if (filters.kind) conditions.push(eq(automationRuns.kind, filters.kind));
  if (filters.outcome) conditions.push(eq(automationRuns.outcome, filters.outcome));
  if (filters.automationId) {
    conditions.push(eq(automationRuns.automationId, filters.automationId));
  }
  const startDate = utcDayStart(filters.startDate);
  if (startDate) conditions.push(gte(automationRuns.startedAt, startDate));
  const endDate = utcDayEnd(filters.endDate);
  if (endDate) conditions.push(lt(automationRuns.startedAt, endDate));
  return conditions;
}

export const runRoutes: FastifyPluginAsync = async (app) => {
  /**
   * GET /runs - Every automation's runs, newest first
   */
  app.get('/', { preHandler: [app.authenticate] }, async (request, reply) => {
    const query = runListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.badRequest('Invalid query parameters');
    }

    const { page, pageSize, orderBy, orderDir, ...filters } = query.data;
    const access = runAccessCondition(request.user);
    if (access.empty) {
      return { data: [], meta: { page, pageSize, total: 0 } } satisfies ListResponse<never>;
    }

    const conditions = runFilterConditions(filters);
    if (access.condition) conditions.push(access.condition);
    const where = and(...conditions);

    const rows = await buildRunSummaryQuery({
      where,
      orderBy,
      orderDir,
      pageSize,
      offset: (page - 1) * pageSize,
    });

    return {
      data: rows.map(mapRunSummary),
      meta: { page, pageSize, total: await countRuns(where) },
    } satisfies ListResponse<AutomationRunSummary>;
  });

  /**
   * GET /runs/:id - One run with its step log
   */
  app.get('/:id', { preHandler: [app.authenticate] }, async (request, reply) => {
    const params = runIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid run ID');
    }

    const access = runAccessCondition(request.user);
    if (access.empty) return reply.notFound('Run not found');

    const rows = await db
      .select({
        ...runSummaryColumns,
        steps: automationRuns.steps,
        definitionVersionId: automationRuns.definitionVersionId,
      })
      .from(automationRuns)
      .innerJoin(automations, eq(automationRuns.automationId, automations.id))
      .leftJoin(serverUsers, eq(automationRuns.serverUserId, serverUsers.id))
      .where(and(eq(automationRuns.id, params.data.id), access.condition))
      .limit(1);

    const row = rows[0];
    if (!row) return reply.notFound('Run not found');

    return {
      ...mapRunSummary(row),
      steps: row.steps ?? [],
      definitionVersionId: row.definitionVersionId,
    } satisfies AutomationRun;
  });
};
