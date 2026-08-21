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
import { alias } from 'drizzle-orm/pg-core';
import { z } from 'zod';
import {
  REDIS_KEYS,
  AUTOMATION_CROSS_SERVER_ENFORCEMENT_ERROR_MESSAGE,
  AUTOMATION_SCOPE_ERROR_MESSAGE,
  TemplateBindingError,
  automationDefinitionSchema,
  automationListQuerySchema,
  bulkDeleteAutomationsSchema,
  bulkUpdateAutomationsSchema,
  createAutomationSchema,
  hasAtMostOneScope,
  materializeTemplate,
  nearMissEntrySchema,
  runListQuerySchema,
  scopeAllowsCrossServerEnforcement,
  updateAutomationSchema,
  uuidSchema,
  type Automation,
  type AutomationKind,
  type AutomationOrigin,
  type AutomationScopeRef,
  type AutomationTemplateRef,
  type AuthUser,
  type AutomationRunSummary,
  type AutomationSortField,
  type CreateAutomationInput,
  type ListResponse,
  type NearMissEntry,
  type AutomationActions,
  type AutomationConditions,
  type TemplateDefinition,
  type TemplateInput,
  type TriggerNode,
  type UpdateAutomationInput,
  type ViolationSeverity,
} from '@tracearr/shared';
import { db } from '../db/client.js';
import { isUniqueViolation } from '../db/pg.js';
import {
  automationRuns,
  automationTemplates,
  automations,
  serverUsers,
  servers,
  users,
} from '../db/schema.js';
import { scheduleInactivityChecks } from '../jobs/inactivityCheckQueue.js';
import { invalidateAutomationsCache } from '../jobs/poller/database.js';
import { violationAliasConditions } from '../services/automations/aliasFilter.js';
import { EVAL_RING_SIZE } from '../services/automations/runRecorder.js';
import { exportEnvelope } from '../services/automations/templates/lift.js';
import {
  getTemplate,
  getTemplateVersion,
  type TemplateSource,
} from '../services/automations/templates/store.js';
import {
  carryTriggerIds,
  resynthesizeTriggers,
  stampNodes,
  synthesizeTriggers,
} from '../services/automations/triggers.js';
import {
  automationDefinition,
  canonicalEqual,
  insertAutomationVersion,
  sameDefinition,
  storedSeverity,
  type AutomationRow,
} from '../services/automations/versions.js';
import { unknownDestinationIds } from '../services/notifications/destinationRefs.js';
import { hasInactivityCondition } from '../services/automations/engine.js';
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

const exportQuerySchema = z.object({ author: z.string().trim().min(1).max(80).optional() });

const templateInputsSchema = z.object({
  templateInputs: z.record(z.string(), z.unknown()).optional(),
});

const upgradeBodySchema = z.object({ inputs: z.record(z.string(), z.unknown()).optional() });

const AUTOMATION_SORT_KEYS: Record<AutomationSortField, SortKey> = {
  name: { key: sql`${automations.name}`, defaultDir: 'asc' },
  createdAt: { key: sql`${automations.createdAt}`, defaultDir: 'desc' },
  updatedAt: { key: sql`${automations.updatedAt}`, defaultDir: 'desc' },
  kind: { key: sql`${automations.kind}`, defaultDir: 'asc' },
  isActive: { key: sql`${automations.isActive}`, defaultDir: 'desc' },
};

// The account scope names a server too, and a detached row names the template it left.
const accountServers = alias(servers, 'account_servers');
const originTemplates = alias(automationTemplates, 'origin_templates');

/** The names a row needs to render; a write path that skips the joins renders nulls. */
interface AutomationJoins {
  serverName: string | null;
  accountName: string | null;
  accountServerName: string | null;
  personName: string | null;
  templateSlug: string | null;
  templateName: string | null;
  templateCurrentVersion: number | null;
  templateSource: TemplateSource | null;
  originName: string | null;
}

export type AutomationDetailRow = AutomationRow & Partial<AutomationJoins>;

const automationColumns = {
  ...getTableColumns(automations),
  serverName: servers.name,
  accountName: serverUsers.username,
  accountServerName: accountServers.name,
  personName: users.name,
  templateSlug: automationTemplates.slug,
  templateName: automationTemplates.name,
  templateCurrentVersion: automationTemplates.currentVersion,
  templateSource: automationTemplates.source,
  originName: originTemplates.name,
};

/** One row per automation: every scope is at most one join deep and each name is unique. */
const automationSelect = () =>
  db
    .select(automationColumns)
    .from(automations)
    .leftJoin(servers, eq(servers.id, automations.serverId))
    .leftJoin(serverUsers, eq(serverUsers.id, automations.serverUserId))
    .leftJoin(accountServers, eq(accountServers.id, serverUsers.serverId))
    .leftJoin(users, eq(users.id, automations.userId))
    .leftJoin(automationTemplates, eq(automationTemplates.id, automations.templateId))
    .leftJoin(originTemplates, eq(originTemplates.id, automations.originTemplateId));

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

function scopeRefOf(row: AutomationDetailRow): AutomationScopeRef | null {
  if (row.serverId && row.serverName) {
    return { kind: 'server', id: row.serverId, name: row.serverName };
  }
  if (row.serverUserId && row.accountName) {
    return {
      kind: 'account',
      id: row.serverUserId,
      name: row.accountName,
      serverName: row.accountServerName ?? undefined,
    };
  }
  if (row.userId && row.personName) {
    return { kind: 'person', id: row.userId, name: row.personName };
  }
  return null;
}

function templateRefOf(row: AutomationDetailRow): AutomationTemplateRef | null {
  if (!row.templateId || !row.templateSlug || !row.templateName || !row.templateSource) return null;
  return {
    id: row.templateId,
    slug: row.templateSlug,
    name: row.templateName,
    version: row.templateVersion ?? row.templateCurrentVersion ?? 1,
    currentVersion: row.templateCurrentVersion ?? row.templateVersion ?? 1,
    source: row.templateSource,
  };
}

/** A detached row keeps its provenance even after the template it came from is deleted. */
function originOf(row: AutomationDetailRow): AutomationOrigin | null {
  if (!row.originTemplateId || row.originTemplateVersion === null) return null;
  return {
    templateId: row.originTemplateId,
    version: row.originTemplateVersion,
    name: row.originName ?? null,
  };
}

export function toAutomation(row: AutomationDetailRow): Automation {
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
    scopeRef: scopeRefOf(row),
    template: templateRefOf(row),
    origin: originOf(row),
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

export async function loadAutomation(
  id: string,
  authUser: AuthUser
): Promise<AutomationDetailRow | undefined> {
  const rows = await automationSelect()
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

/** The sweep runs for anything that can fire on inactivity, by trigger or by condition. */
export function needsInactivitySweep(row: {
  triggers: TriggerNode[] | null;
  conditions: AutomationConditions | null;
}): boolean {
  return (
    (row.triggers ?? []).some(
      (trigger) => trigger.type === 'account.inactive_for' && trigger.enabled
    ) || hasInactivityCondition(row)
  );
}

export type MaterializeResult =
  { ok: true; definition: CreateAutomationInput } | { ok: false; reason: string };

/**
 * Binding fails two ways: a required input nothing named, or bound values the
 * automation schema rejects. Both are the caller's payload, never a server fault.
 */
export function materializeInstance(
  version: { inputs: TemplateInput[]; definition: TemplateDefinition },
  inputs: Record<string, unknown>,
  name: string
): MaterializeResult {
  try {
    return { ok: true, definition: materializeTemplate(version, inputs, { name }) };
  } catch (error) {
    if (error instanceof TemplateBindingError) {
      return { ok: false, reason: `Unbound required input(s): ${error.missing.join(', ')}` };
    }
    if (error instanceof z.ZodError) return { ok: false, reason: firstIssueMessage(error) };
    throw error;
  }
}

/** The scope a materialized definition carries, in the column shape the row stores. */
function definitionScope(definition: CreateAutomationInput) {
  return {
    serverId: definition.serverId ?? null,
    serverUserId: definition.serverUserId ?? null,
    userId: definition.userId ?? null,
    enforceAcrossServers: definition.enforceAcrossServers ?? false,
  };
}

type ScopeRefs = Pick<UpdateAutomationInput, 'serverId' | 'serverUserId' | 'userId'>;

/** The first scope reference the payload names that no row backs. */
export async function missingScopeRef(scope: ScopeRefs): Promise<string | null> {
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

/** Every column a definition write touches, so a template rebind and a builder save agree. */
type AutomationUpdate = Partial<{
  name: string;
  description: string | null;
  kind: AutomationKind;
  severity: ViolationSeverity;
  conditions: AutomationConditions;
  actions: AutomationActions;
  triggers: TriggerNode[];
  serverId: string | null;
  serverUserId: string | null;
  userId: string | null;
  enforceAcrossServers: boolean;
  cooldownMinutes: number | null;
  retentionDays: number | null;
  isActive: boolean;
  templateId: string | null;
  templateVersion: number | null;
  templateInputs: Record<string, unknown> | null;
  originTemplateId: string | null;
  originTemplateVersion: number | null;
  updatedAt: Date;
}>;

export const automationRoutes: FastifyPluginAsync = async (app) => {
  const owner = { preHandler: [app.requireOwner] };
  const authed = { preHandler: [app.authenticate] };

  /** The write, its version row when the definition moved, and the reply's own read. */
  const saveDefinition = async (
    existing: AutomationRow,
    updateData: AutomationUpdate,
    authUser: AuthUser
  ): Promise<AutomationDetailRow | null> => {
    const write = () =>
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

    const updated = await retryOnVersionCollision(write);
    if (!updated) return null;

    invalidateAutomationsCache();
    if (needsInactivitySweep(existing) || needsInactivitySweep(updated)) {
      void scheduleInactivityChecks();
    }
    return (await loadAutomation(updated.id, authUser)) ?? updated;
  };

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
    const rows = await automationSelect()
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
          // Until the builder sends its own, the trigger set is read off the conditions.
          triggers: input.triggers ?? synthesizeTriggers(stamped.conditions),
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

    invalidateAutomationsCache();
    if (needsInactivitySweep(created)) void scheduleInactivityChecks();

    const detail = await loadAutomation(created.id, request.user);
    return reply.code(201).send(toAutomation(detail ?? created));
  });

  /**
   * PATCH /automations/:id - Update an automation; a definition change takes a new version
   */
  app.patch('/:id', owner, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid automation ID');
    }

    // `templateInputs` rides along with the definition fields but belongs to neither
    // schema, so it is lifted off before the rest is validated as an update.
    if (typeof request.body !== 'object' || request.body === null || Array.isArray(request.body)) {
      return reply.badRequest('Invalid request body');
    }
    const raw = { ...(request.body as Record<string, unknown>) };
    const envelope = templateInputsSchema.safeParse(raw);
    if (!envelope.success) {
      return reply.badRequest(`Invalid request body: ${firstIssueMessage(envelope.error)}`);
    }
    const { templateInputs } = envelope.data;
    delete raw.templateInputs;

    const body = updateAutomationSchema.safeParse(raw);
    if (!body.success) {
      return reply.badRequest(`Invalid request body: ${firstIssueMessage(body.error)}`);
    }

    const existing = await loadAutomation(params.data.id, request.user);
    if (!existing) return reply.notFound('Automation not found');

    const patch = body.data;
    const boundTo = existing.templateId;
    if (boundTo) {
      if (
        patch.conditions !== undefined ||
        patch.actions !== undefined ||
        patch.triggers !== undefined
      ) {
        return reply.conflict('Customize this automation before editing what it does');
      }
    } else if (templateInputs !== undefined) {
      return reply.badRequest('templateInputs needs an automation bound to a template');
    }

    // A rebind re-runs the pinned version against the new bindings; the fields the
    // instance owns are never taken back from it.
    let rebound: { definition: CreateAutomationInput; inputs: Record<string, unknown> } | null =
      null;
    if (boundTo && templateInputs !== undefined) {
      const pinned =
        existing.templateVersion === null
          ? null
          : await getTemplateVersion(boundTo, existing.templateVersion);
      if (!pinned) return reply.conflict('The template version this automation uses is gone');
      const materialized = materializeInstance(pinned, templateInputs, patch.name ?? existing.name);
      if (!materialized.ok) return reply.badRequest(materialized.reason);
      rebound = { definition: materialized.definition, inputs: templateInputs };
    }

    const stamped = stampNodes({
      conditions: patch.conditions ?? null,
      actions: patch.actions ?? null,
    });
    const updateData: AutomationUpdate = { updatedAt: new Date() };

    if (rebound) {
      updateData.conditions = rebound.definition.conditions;
      updateData.actions = rebound.definition.actions;
      updateData.triggers = carryTriggerIds(rebound.definition.triggers ?? [], existing.triggers);
      Object.assign(updateData, definitionScope(rebound.definition));
      updateData.templateInputs = rebound.inputs;
    } else {
      if (patch.conditions !== undefined && stamped.conditions) {
        updateData.conditions = stamped.conditions;
        // The payload comes back from zod in its own key order and the stored row in
        // jsonb's, so only a canonical compare can tell a restatement from an edit.
        if (!canonicalEqual(stamped.conditions, existing.conditions)) {
          updateData.triggers = resynthesizeTriggers(stamped.conditions, existing.triggers);
        }
      }
      if (patch.actions !== undefined) updateData.actions = stamped.actions;
      if (patch.triggers !== undefined) updateData.triggers = patch.triggers;
      if (patch.serverId !== undefined) updateData.serverId = patch.serverId;
      if (patch.serverUserId !== undefined) updateData.serverUserId = patch.serverUserId;
      if (patch.userId !== undefined) updateData.userId = patch.userId;
      if (patch.enforceAcrossServers !== undefined) {
        updateData.enforceAcrossServers = patch.enforceAcrossServers;
      }
    }

    if (patch.name !== undefined) updateData.name = patch.name;
    if (patch.description !== undefined) updateData.description = patch.description;
    if (patch.kind !== undefined) updateData.kind = patch.kind;
    if (patch.severity !== undefined) updateData.severity = storedSeverity(patch.severity);
    if (patch.cooldownMinutes !== undefined) updateData.cooldownMinutes = patch.cooldownMinutes;
    if (patch.retentionDays !== undefined) updateData.retentionDays = patch.retentionDays;
    if (patch.isActive !== undefined) updateData.isActive = patch.isActive;

    // A partial payload cannot see the fields it leaves alone, so the invariants
    // are checked against the row the write would leave behind.
    const next = { ...existing, ...updateData };
    const scope = {
      serverId: next.serverId,
      serverUserId: next.serverUserId,
      userId: next.userId,
      enforceAcrossServers: next.enforceAcrossServers,
    };
    if (!hasAtMostOneScope(scope)) return reply.badRequest(AUTOMATION_SCOPE_ERROR_MESSAGE);
    if (!scopeAllowsCrossServerEnforcement(scope)) {
      return reply.badRequest(AUTOMATION_CROSS_SERVER_ENFORCEMENT_ERROR_MESSAGE);
    }

    // Only an edit to the definition has to answer for it: disabling an automation
    // an older schema allowed has to stay possible.
    if (!sameDefinition(automationDefinition(next), automationDefinition(existing))) {
      const merged = automationDefinitionSchema.safeParse({
        name: next.name,
        description: next.description,
        kind: next.kind,
        severity: next.severity,
        triggers: next.triggers ?? [],
        conditions: next.conditions ?? { groups: [] },
        actions: next.actions ?? { actions: [] },
        ...scope,
        cooldownMinutes: next.cooldownMinutes,
        retentionDays: next.retentionDays,
        isActive: next.isActive,
      });
      if (!merged.success) {
        return reply.badRequest(`Invalid request body: ${firstIssueMessage(merged.error)}`);
      }
    }

    const missingScope = await missingScopeRef(rebound ? scope : patch);
    if (missingScope) return reply.notFound(missingScope);

    const missingDestinations = await unknownDestinationIds(updateData.actions);
    if (missingDestinations.length > 0) {
      return reply.badRequest(`Unknown destination id(s): ${missingDestinations.join(', ')}`);
    }

    let updated: AutomationDetailRow | null;
    try {
      updated = await saveDefinition(existing, updateData, request.user);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return reply.conflict('the automation changed while saving; try again');
    }

    if (!updated) return reply.internalServerError('Failed to update automation');
    return toAutomation(updated);
  });

  /**
   * POST /automations/:id/detach - Cut an instance loose from its template, one way
   */
  app.post('/:id/detach', owner, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid automation ID');
    }

    const existing = await loadAutomation(params.data.id, request.user);
    if (!existing) return reply.notFound('Automation not found');
    if (!existing.templateId) return reply.conflict('This automation has no template to leave');

    const rows = await db
      .update(automations)
      .set({
        templateId: null,
        templateVersion: null,
        templateInputs: null,
        originTemplateId: existing.templateId,
        originTemplateVersion: existing.templateVersion,
        updatedAt: new Date(),
      })
      .where(eq(automations.id, existing.id))
      .returning();
    const updated = rows[0];
    if (!updated) return reply.internalServerError('Failed to detach automation');

    invalidateAutomationsCache();
    if (needsInactivitySweep(updated)) void scheduleInactivityChecks();

    const detail = await loadAutomation(updated.id, request.user);
    return toAutomation(detail ?? updated);
  });

  /**
   * POST /automations/:id/upgrade - Rebind an instance onto its template's current version
   */
  app.post('/:id/upgrade', owner, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid automation ID');
    }
    const body = upgradeBodySchema.safeParse(request.body ?? {});
    if (!body.success) {
      return reply.badRequest(`Invalid request body: ${firstIssueMessage(body.error)}`);
    }

    const existing = await loadAutomation(params.data.id, request.user);
    if (!existing) return reply.notFound('Automation not found');
    if (!existing.templateId) return reply.conflict('This automation has no template to upgrade');

    const template = await getTemplate(existing.templateId);
    if (!template) return reply.notFound('Template not found');

    const inputs = body.data.inputs ?? existing.templateInputs ?? {};
    const materialized = materializeInstance(template.version, inputs, existing.name);
    if (!materialized.ok) return reply.badRequest(materialized.reason);
    const definition = materialized.definition;

    const scope = definitionScope(definition);
    const missingScope = await missingScopeRef(scope);
    if (missingScope) return reply.notFound(missingScope);

    const missingDestinations = await unknownDestinationIds(definition.actions);
    if (missingDestinations.length > 0) {
      return reply.badRequest(`Unknown destination id(s): ${missingDestinations.join(', ')}`);
    }

    const updateData: AutomationUpdate = {
      conditions: definition.conditions,
      actions: definition.actions,
      // A trigger type that survives the new version keeps the node id the gate reads.
      triggers: carryTriggerIds(definition.triggers ?? [], existing.triggers),
      ...scope,
      templateVersion: template.version.version,
      templateInputs: inputs,
      updatedAt: new Date(),
    };

    let updated: AutomationDetailRow | null;
    try {
      updated = await saveDefinition(existing, updateData, request.user);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      return reply.conflict('the automation changed while saving; try again');
    }

    if (!updated) return reply.internalServerError('Failed to upgrade automation');
    return toAutomation(updated);
  });

  /**
   * GET /automations/:id/export - The automation as a shareable envelope and code
   */
  app.get('/:id/export', authed, async (request, reply) => {
    const params = idParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.badRequest('Invalid automation ID');
    }
    const query = exportQuerySchema.safeParse(request.query);
    if (!query.success) {
      return reply.badRequest(`Invalid query parameters: ${firstIssueMessage(query.error)}`);
    }

    const existing = await loadAutomation(params.data.id, request.user);
    if (!existing) return reply.notFound('Automation not found');

    const exported = exportEnvelope(existing, {
      ...(query.data.author === undefined ? {} : { author: query.data.author }),
      serverName: existing.serverName,
    });
    if (!exported.ok) {
      return reply.badRequest(`This automation cannot be exported: ${exported.reason}`);
    }
    return { envelope: exported.envelope, code: exported.code };
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

    invalidateAutomationsCache();
    if (needsInactivitySweep(existing)) void scheduleInactivityChecks();

    return reply.code(204).send();
  });

  /**
   * PATCH /automations/bulk - Enable or disable several automations
   */
  app.patch('/bulk', owner, async (request, reply) => {
    const parsed = bulkUpdateAutomationsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest('Invalid request body');
    }

    const updated = await db
      .update(automations)
      .set({ isActive: parsed.data.isActive, updatedAt: new Date() })
      .where(inArray(automations.id, parsed.data.ids))
      .returning({ id: automations.id });

    if (updated.length > 0) invalidateAutomationsCache();
    return { success: true, updated: updated.length };
  });

  /**
   * DELETE /automations/bulk - Remove several automations
   */
  app.delete('/bulk', owner, async (request, reply) => {
    const parsed = bulkDeleteAutomationsSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.badRequest('Invalid request body');
    }

    const counted = await countedIdentitiesOf(parsed.data.ids);
    const deleted = await db
      .delete(automations)
      .where(inArray(automations.id, parsed.data.ids))
      .returning({ id: automations.id });
    await restateIdentities(counted);

    if (deleted.length > 0) invalidateAutomationsCache();
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
