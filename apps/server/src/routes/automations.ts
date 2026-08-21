/**
 * Automation routes - the rules engine's definitions. Reads are open to any
 * authenticated caller, scoped to the servers it can reach; writes are owner only.
 */

import type { FastifyPluginAsync } from 'fastify';
import {
  and,
  count,
  eq,
  getTableColumns,
  ilike,
  inArray,
  isNull,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import {
  REDIS_KEYS,
  RULE_CROSS_SERVER_ENFORCEMENT_ERROR_MESSAGE,
  RULE_SCOPE_ERROR_MESSAGE,
  automationListQuerySchema,
  bulkDeleteRulesSchema,
  bulkUpdateRulesSchema,
  createAutomationSchema,
  hasAtMostOneScope,
  nearMissEntrySchema,
  runListQuerySchema,
  scopeAllowsCrossServerEnforcement,
  updateAutomationSchema,
  uuidSchema,
  type Automation,
  type AutomationKind,
  type AuthUser,
  type AutomationRunSummary,
  type AutomationSortField,
  type ListResponse,
  type NearMissEntry,
  type RuleActions,
  type RuleConditions,
  type TriggerNode,
  type UpdateAutomationInput,
  type ViolationSeverity,
} from '@tracearr/shared';
import { db } from '../db/client.js';
import { isUniqueViolation } from '../db/pg.js';
import { automationRuns, automations, serverUsers, servers, users } from '../db/schema.js';
import { scheduleInactivityChecks } from '../jobs/inactivityCheckQueue.js';
import { invalidateRulesCache } from '../jobs/poller/database.js';
import { violationAliasConditions } from '../services/automations/aliasFilter.js';
import { EVAL_RING_SIZE } from '../services/automations/runRecorder.js';
import { stampNodes, synthesizeTriggers } from '../services/automations/triggers.js';
import {
  automationDefinition,
  insertAutomationVersion,
  sameDefinition,
} from '../services/automations/versions.js';
import { unknownDestinationIds } from '../services/notifications/destinationRefs.js';
import { hasInactivityCondition } from '../services/rules/engine.js';
import { recomputeIdentityAggregatesForServerUser } from '../services/userService.js';
import { buildOrderBy, likePattern, type SortKey } from '../utils/listQuery.js';
import { buildMultiServerFragment } from '../utils/serverFiltering.js';
import { firstIssueMessage } from '../utils/zod.js';
import {
  buildRunSummaryQuery,
  countRuns,
  mapRunSummary,
  runAccessCondition,
  runFilterConditions,
} from './runs.js';

const idParamSchema = z.object({ id: uuidSchema });

const AUTOMATION_SORT_KEYS: Record<AutomationSortField, SortKey> = {
  name: { key: sql`${automations.name}`, defaultDir: 'asc' },
  createdAt: { key: sql`${automations.createdAt}`, defaultDir: 'desc' },
  updatedAt: { key: sql`${automations.updatedAt}`, defaultDir: 'desc' },
  kind: { key: sql`${automations.kind}`, defaultDir: 'asc' },
  isActive: { key: sql`${automations.isActive}`, defaultDir: 'desc' },
};

type AutomationRow = typeof automations.$inferSelect;

/** The column has no null state; a notification automation keeps the default it ignores. */
const storedSeverity = (severity: ViolationSeverity | null | undefined): ViolationSeverity =>
  severity ?? 'warning';

/**
 * The version number is `max + 1`, so two concurrent definition writes pick the same one
 * and the loser breaks the unique index; re-running the transaction sees the winner's row.
 */
async function retryOnVersionCollision<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    return await write();
  }
}

function toAutomation(row: AutomationRow & { identityName?: string | null }): Automation {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    kind: row.kind,
    severity: row.severity,
    triggers: row.triggers ?? [],
    conditions: row.conditions ?? { groups: [] },
    actions: row.actions ?? { actions: [] },
    serverId: row.serverId,
    serverUserId: row.serverUserId,
    userId: row.userId,
    enforceAcrossServers: row.enforceAcrossServers,
    isActive: row.isActive,
    cooldownMinutes: row.cooldownMinutes,
    retentionDays: row.retentionDays,
    identityName: row.identityName ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** A global automation belongs to everyone; a scoped one needs the server it names. */
function visibleAutomations(authUser: AuthUser): SQL | undefined {
  if (authUser.role === 'owner') return undefined;

  const global = and(
    isNull(automations.serverId),
    isNull(automations.serverUserId),
    isNull(automations.userId)
  );
  if (authUser.serverIds.length === 0) return global;

  const reachable = buildMultiServerFragment(authUser.serverIds, 'su.server_id');
  return or(
    global,
    inArray(automations.serverId, authUser.serverIds),
    sql`EXISTS (SELECT 1 FROM server_users su WHERE su.id = ${automations.serverUserId} ${reachable})`,
    sql`EXISTS (SELECT 1 FROM server_users su WHERE su.user_id = ${automations.userId} ${reachable})`
  );
}

/** The single read joins the person scope's name; the list stays a plain select. */
async function loadAutomation(id: string, authUser: AuthUser) {
  const rows = await db
    .select({ ...getTableColumns(automations), identityName: users.name })
    .from(automations)
    .leftJoin(users, eq(users.id, automations.userId))
    .where(and(eq(automations.id, id), visibleAutomations(authUser)))
    .limit(1);
  return rows[0];
}

/**
 * Deleting an automation cascades its runs, and completed policy runs are what
 * `users.total_violations` counts, so the identities behind them are restated
 * afterward. The ids have to be read before the delete takes the rows away.
 */
async function countedIdentitiesOf(automationIds: string[]): Promise<string[]> {
  const rows = await db
    .selectDistinct({ serverUserId: automationRuns.serverUserId })
    .from(automationRuns)
    .where(
      and(
        inArray(automationRuns.automationId, automationIds),
        ...violationAliasConditions({ requireUser: true })
      )
    );
  return rows.map((row) => row.serverUserId).filter((id): id is string => id !== null);
}

async function restateIdentities(serverUserIds: string[]): Promise<void> {
  for (const serverUserId of serverUserIds) {
    await recomputeIdentityAggregatesForServerUser(serverUserId);
  }
}

/** The scope trio and enforcement flag as they will read after the patch lands. */
function mergedScope(row: AutomationRow, patch: UpdateAutomationInput) {
  return {
    serverId: patch.serverId !== undefined ? patch.serverId : row.serverId,
    serverUserId: patch.serverUserId !== undefined ? patch.serverUserId : row.serverUserId,
    userId: patch.userId !== undefined ? patch.userId : row.userId,
    enforceAcrossServers:
      patch.enforceAcrossServers !== undefined
        ? patch.enforceAcrossServers
        : row.enforceAcrossServers,
  };
}

type ScopeRefs = Pick<UpdateAutomationInput, 'serverId' | 'serverUserId' | 'userId'>;

/** The first scope reference the payload names that no row backs. */
async function missingScopeRef(scope: ScopeRefs): Promise<string | null> {
  if (scope.serverId) {
    const rows = await db
      .select({ id: servers.id })
      .from(servers)
      .where(eq(servers.id, scope.serverId))
      .limit(1);
    if (!rows[0]) return 'Server not found';
  }
  if (scope.serverUserId) {
    const rows = await db
      .select({ id: serverUsers.id })
      .from(serverUsers)
      .where(eq(serverUsers.id, scope.serverUserId))
      .limit(1);
    if (!rows[0]) return 'Server user not found';
  }
  if (scope.userId) {
    const rows = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, scope.userId))
      .limit(1);
    if (!rows[0]) return 'User not found';
  }
  return null;
}

export const automationRoutes: FastifyPluginAsync = async (app) => {
  const owner = { preHandler: [app.requireOwner] };
  const authed = { preHandler: [app.authenticate] };

  /**
   * GET /automations - List automations with pagination, filters and sorting
   */
  app.get('/', authed, async (request, reply) => {
    const query = automationListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.badRequest('Invalid query parameters');
    }

    const { page, pageSize, orderBy, orderDir, kind, enabled, search } = query.data;
    const conditions: SQL[] = [];
    const visible = visibleAutomations(request.user);
    if (visible) conditions.push(visible);
    if (kind) conditions.push(eq(automations.kind, kind));
    if (enabled !== undefined) conditions.push(eq(automations.isActive, enabled));
    if (search) conditions.push(ilike(automations.name, likePattern(search)));

    const where = and(...conditions);
    const rows = await db
      .select()
      .from(automations)
      .where(where)
      .orderBy(buildOrderBy(AUTOMATION_SORT_KEYS, orderBy, orderDir, sql`${automations.id}`))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const countRows = await db.select({ total: count() }).from(automations).where(where);

    return {
      data: rows.map(toAutomation),
      meta: { page, pageSize, total: countRows[0]?.total ?? 0 },
    } satisfies ListResponse<Automation>;
  });

  /**
   * GET /automations/:id - One automation
   */
  app.get('/:id', authed, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid automation ID');
    }

    const row = await loadAutomation(params.data.id, request.user);
    if (!row) return reply.notFound('Automation not found');
    return toAutomation(row);
  });

  /**
   * POST /automations - Create an automation and its first version
   */
  app.post('/', owner, async (request, reply) => {
    const body = createAutomationSchema.safeParse(request.body);
    if (!body.success) {
      return reply.badRequest(`Invalid request body: ${firstIssueMessage(body.error)}`);
    }

    const input = body.data;
    const missingScope = await missingScopeRef(input);
    if (missingScope) return reply.notFound(missingScope);

    const missingDestinations = await unknownDestinationIds(input.actions);
    if (missingDestinations.length > 0) {
      return reply.badRequest(`Unknown destination id(s): ${missingDestinations.join(', ')}`);
    }

    const stamped = stampNodes({ conditions: input.conditions, actions: input.actions });
    const created = await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(automations)
        .values({
          name: input.name,
          description: input.description,
          kind: input.kind,
          severity: storedSeverity(input.severity),
          conditions: stamped.conditions,
          actions: stamped.actions,
          triggers: synthesizeTriggers(stamped.conditions),
          serverId: input.serverId,
          serverUserId: input.serverUserId,
          userId: input.userId,
          enforceAcrossServers: input.enforceAcrossServers,
          cooldownMinutes: input.cooldownMinutes,
          retentionDays: input.retentionDays,
          isActive: input.isActive,
        })
        .returning();
      const row = inserted[0];
      if (!row) return null;
      await insertAutomationVersion(tx, row.id, automationDefinition(row));
      return row;
    });

    if (!created) return reply.internalServerError('Failed to create automation');

    invalidateRulesCache();
    if (hasInactivityCondition(created)) void scheduleInactivityChecks();

    return reply.code(201).send(toAutomation(created));
  });

  /**
   * PATCH /automations/:id - Update an automation; a definition change takes a new version
   */
  app.patch('/:id', owner, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid automation ID');
    }

    const body = updateAutomationSchema.safeParse(request.body);
    if (!body.success) {
      return reply.badRequest(`Invalid request body: ${firstIssueMessage(body.error)}`);
    }

    const existing = await loadAutomation(params.data.id, request.user);
    if (!existing) return reply.notFound('Automation not found');

    const patch = body.data;
    // A partial payload cannot see the fields it leaves alone, so the invariants
    // are checked against the row the write would leave behind.
    const scope = mergedScope(existing, patch);
    if (!hasAtMostOneScope(scope)) return reply.badRequest(RULE_SCOPE_ERROR_MESSAGE);
    if (!scopeAllowsCrossServerEnforcement(scope)) {
      return reply.badRequest(RULE_CROSS_SERVER_ENFORCEMENT_ERROR_MESSAGE);
    }

    const missingScope = await missingScopeRef(patch);
    if (missingScope) return reply.notFound(missingScope);

    const missingDestinations = await unknownDestinationIds(patch.actions);
    if (missingDestinations.length > 0) {
      return reply.badRequest(`Unknown destination id(s): ${missingDestinations.join(', ')}`);
    }

    const stamped = stampNodes({
      conditions: patch.conditions ?? null,
      actions: patch.actions ?? null,
    });
    const updateData: Partial<{
      name: string;
      description: string | null;
      kind: AutomationKind;
      severity: ViolationSeverity;
      conditions: RuleConditions;
      actions: RuleActions;
      triggers: TriggerNode[];
      serverId: string | null;
      serverUserId: string | null;
      userId: string | null;
      enforceAcrossServers: boolean;
      cooldownMinutes: number | null;
      retentionDays: number | null;
      isActive: boolean;
      updatedAt: Date;
    }> = { updatedAt: new Date() };

    if (patch.name !== undefined) updateData.name = patch.name;
    if (patch.description !== undefined) updateData.description = patch.description;
    if (patch.kind !== undefined) updateData.kind = patch.kind;
    if (patch.severity !== undefined) updateData.severity = storedSeverity(patch.severity);
    if (patch.conditions !== undefined && stamped.conditions) {
      updateData.conditions = stamped.conditions;
      // Synthesis mints fresh trigger ids, which would version a restated definition.
      if (JSON.stringify(stamped.conditions) !== JSON.stringify(existing.conditions)) {
        updateData.triggers = synthesizeTriggers(stamped.conditions);
      }
    }
    if (patch.actions !== undefined) updateData.actions = stamped.actions;
    if (patch.serverId !== undefined) updateData.serverId = patch.serverId;
    if (patch.serverUserId !== undefined) updateData.serverUserId = patch.serverUserId;
    if (patch.userId !== undefined) updateData.userId = patch.userId;
    if (patch.enforceAcrossServers !== undefined) {
      updateData.enforceAcrossServers = patch.enforceAcrossServers;
    }
    if (patch.cooldownMinutes !== undefined) updateData.cooldownMinutes = patch.cooldownMinutes;
    if (patch.retentionDays !== undefined) updateData.retentionDays = patch.retentionDays;
    if (patch.isActive !== undefined) updateData.isActive = patch.isActive;

    const save = () =>
      db.transaction(async (tx) => {
        const rows = await tx
          .update(automations)
          .set(updateData)
          .where(eq(automations.id, existing.id))
          .returning();
        const row = rows[0];
        if (!row) return null;
        // Runtime settings are not part of the definition, so toggling one takes no version.
        const definition = automationDefinition(row);
        if (!sameDefinition(definition, automationDefinition(existing))) {
          await insertAutomationVersion(tx, row.id, definition);
        }
        return row;
      });

    let updated: AutomationRow | null;
    try {
      updated = await retryOnVersionCollision(save);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return reply.conflict('the automation changed while saving; try again');
    }

    if (!updated) return reply.internalServerError('Failed to update automation');

    invalidateRulesCache();
    if (hasInactivityCondition(existing) || hasInactivityCondition(updated)) {
      void scheduleInactivityChecks();
    }

    return toAutomation(updated);
  });

  /**
   * DELETE /automations/:id - Remove an automation; its versions and runs cascade
   */
  app.delete('/:id', owner, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid automation ID');
    }

    const existing = await loadAutomation(params.data.id, request.user);
    if (!existing) return reply.notFound('Automation not found');

    const counted = await countedIdentitiesOf([existing.id]);
    await db.delete(automations).where(eq(automations.id, existing.id));
    await restateIdentities(counted);

    invalidateRulesCache();
    if (hasInactivityCondition(existing)) void scheduleInactivityChecks();

    return reply.code(204).send();
  });

  /**
   * PATCH /automations/bulk - Enable or disable several automations
   */
  app.patch('/bulk', owner, async (request, reply) => {
    const parsed = bulkUpdateRulesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest('Invalid request body');
    }

    const updated = await db
      .update(automations)
      .set({ isActive: parsed.data.isActive, updatedAt: new Date() })
      .where(inArray(automations.id, parsed.data.ids))
      .returning({ id: automations.id });

    if (updated.length > 0) invalidateRulesCache();
    return { success: true, updated: updated.length };
  });

  /**
   * DELETE /automations/bulk - Remove several automations
   */
  app.delete('/bulk', owner, async (request, reply) => {
    const parsed = bulkDeleteRulesSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest('Invalid request body');
    }

    const counted = await countedIdentitiesOf(parsed.data.ids);
    const deleted = await db
      .delete(automations)
      .where(inArray(automations.id, parsed.data.ids))
      .returning({ id: automations.id });
    await restateIdentities(counted);

    if (deleted.length > 0) invalidateRulesCache();
    return { success: true, deleted: deleted.length };
  });

  /**
   * GET /automations/:id/runs - This automation's runs, without their step logs
   */
  app.get('/:id/runs', authed, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid automation ID');
    }
    const query = runListQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.badRequest('Invalid query parameters');
    }

    const automation = await loadAutomation(params.data.id, request.user);
    if (!automation) return reply.notFound('Automation not found');

    const { page, pageSize, orderBy, orderDir, ...filters } = query.data;
    const access = runAccessCondition(request.user);
    if (access.empty) {
      return { data: [], meta: { page, pageSize, total: 0 } } satisfies ListResponse<never>;
    }

    const conditions = runFilterConditions({ ...filters, automationId: automation.id });
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
   * GET /automations/:id/evaluations - The capped ring of matches that recorded no run
   */
  app.get('/:id/evaluations', authed, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid automation ID');
    }

    const automation = await loadAutomation(params.data.id, request.user);
    if (!automation) return reply.notFound('Automation not found');

    const entries = await app.redis.lrange(
      REDIS_KEYS.AUTOMATION_EVALS(automation.id),
      0,
      EVAL_RING_SIZE - 1
    );

    const data = entries.flatMap((entry) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(entry);
      } catch {
        return [];
      }
      const result = nearMissEntrySchema.safeParse(parsed);
      return result.success ? [result.data] : [];
    });

    if (data.length < entries.length) {
      request.log.debug(
        { automationId: automation.id, dropped: entries.length - data.length },
        'Dropped near-miss ring entries the current shape no longer reads'
      );
    }
    return { data } satisfies { data: NearMissEntry[] };
  });
};
