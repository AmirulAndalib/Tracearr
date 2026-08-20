import { and, eq, isNotNull, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  CONDITION_FIELD_LABELS,
  OPERATOR_LABELS,
  REDIS_KEYS,
  WS_EVENTS,
  type AutomationRunSummary,
  type GroupEvidence,
  type RuleV2,
  type Session,
} from '@tracearr/shared';
import { db } from '../../db/client.js';
import { automationRuns } from '../../db/schema.js';
import { getRedis } from '../../lib/redisShared.js';
import { getPubSubService, type PubSubService } from '../cache.js';
import { armCooldown, isCoolingDown } from '../rules/v2Integration.js';
import { recomputeIdentityAggregatesForServerUser } from '../userService.js';
import type { DbTx, TriggerType } from '../rules/events/types.js';
import type { EvaluationResult } from '../rules/types.js';

export type AutomationRunRow = typeof automationRuns.$inferSelect;

export type RunScope =
  /** fresh: the session id was created in this transaction; nothing can contend it, so no lock and no gate. */
  | { kind: 'session'; sessionId: string; fresh?: boolean }
  | { kind: 'account'; serverUserId: string };

export interface RunTrigger {
  type: TriggerType;
  /** The stored trigger node that matched, when the automation has one. */
  nodeId: string | null;
  /** What makes this firing distinct from the last; null when the subject alone is the edge. */
  edgeKey: string | null;
  /** The event's own timestamp, so the run's duration covers the evaluation. */
  at: Date;
}

export interface RecordRunArgs {
  automation: RuleV2;
  result: EvaluationResult;
  serverUserId: string;
  serverId: string;
  scope: RunScope;
  session: Session | null;
  trigger: RunTrigger;
  /** Per-trigger marker kept for anything downstream that reads run data. */
  marker?: Record<string, true>;
  tx?: DbTx;
  /**
   * Collects the violation recount, the cooldown arm and the run:finished publish so
   * they land after the caller commits. Without it, a rolled-back tx leaves them behind.
   */
  defer?: (effect: () => Promise<void>) => void;
}

export type NearMissReason = 'cooldown_active' | 'edge_replayed' | 'gate_blocked';

export interface NearMiss {
  reason: NearMissReason;
  subjectKey: string;
  trigger: string;
}

const EVAL_RING_SIZE = 50;
const EVAL_RING_TTL_SECONDS = 30 * 24 * 60 * 60;

export const subjectKeyOf = (scope: RunScope): string =>
  scope.kind === 'session' ? scope.sessionId : scope.serverUserId;

function relatedSessionIdsOf(result: EvaluationResult): string[] {
  const ids = new Set<string>();
  for (const group of result.evidence ?? []) {
    for (const cond of group.conditions) {
      for (const id of cond.relatedSessionIds ?? []) ids.add(id);
    }
  }
  return Array.from(ids);
}

/** Conditions inside a group are OR'd, so the group that ended the walk failed all of them. */
function stoppedSummary(stoppedBy: GroupEvidence | undefined): string {
  if (!stoppedBy || stoppedBy.conditions.length === 0) return 'No conditions matched';
  const parts = stoppedBy.conditions.map(
    (cond) =>
      `${CONDITION_FIELD_LABELS[cond.field] ?? cond.field} ${
        OPERATOR_LABELS[cond.operator] ?? cond.operator
      } ${String(cond.threshold)}`
  );
  return `No condition matched in group ${stoppedBy.groupIndex + 1}: ${parts.join(', ')}`;
}

/** The failing values, without the evidence bulk: a stopped row is a diagnostic, not history. */
function stoppedDetail(stoppedBy: GroupEvidence): Record<string, unknown> {
  return {
    groupIndex: stoppedBy.groupIndex,
    conditions: stoppedBy.conditions.map((cond) => ({
      field: cond.field,
      operator: cond.operator,
      threshold: cond.threshold,
      actual: cond.actual,
    })),
  };
}

function triggerStep(args: RecordRunArgs): Record<string, unknown> {
  const { trigger, scope, serverId, serverUserId, result } = args;
  return {
    trigger: { id: trigger.nodeId, type: trigger.type, edgeKey: trigger.edgeKey },
    sessionId: scope.kind === 'session' ? scope.sessionId : null,
    serverId,
    serverUserId,
    ...(result.stoppedBy ? { stoppedBy: stoppedDetail(result.stoppedBy) } : {}),
  };
}

export function buildRunValues(args: RecordRunArgs): typeof automationRuns.$inferInsert {
  const { automation, result, serverUserId, scope, session, trigger, marker } = args;
  const now = new Date();
  return {
    automationId: automation.id,
    serverUserId,
    sessionId: scope.kind === 'session' ? scope.sessionId : null,
    subjectKey: subjectKeyOf(scope),
    kind: automation.kind,
    status: 'finished',
    outcome: result.matched ? 'completed' : 'stopped_by_condition',
    humanSummary: result.matched ? null : stoppedSummary(result.stoppedBy),
    startedAt: trigger.at,
    finishedAt: now,
    // Severity is a violation triage field; notification runs have none to triage.
    severity: automation.kind === 'notification' ? null : (automation.severity ?? 'warning'),
    ruleType: null,
    steps: [triggerStep(args)],
    data: {
      evidence: result.evidence,
      relatedSessionIds: relatedSessionIdsOf(result),
      ruleName: automation.name,
      matchedGroups: result.matchedGroups,
      // The notification gate reads these back: the table has no edge columns and
      // notification volume does not justify one yet.
      triggerId: trigger.nodeId,
      edgeKey: trigger.edgeKey,
      ...(session
        ? {
            sessionKey: session.sessionKey,
            mediaTitle: session.mediaTitle,
            ipAddress: session.ipAddress,
          }
        : {}),
      ...marker,
    },
  };
}

/**
 * Only completed runs gate; stopped and error rows never block a later match.
 * Each branch reads its own kind, so flipping an automation's kind re-arms it
 * instead of inheriting the other kind's history.
 */
function gateFor(args: RecordRunArgs): SQL | undefined {
  const { automation, scope, trigger } = args;
  const completed = eq(automationRuns.outcome, 'completed');

  if (automation.kind === 'notification') {
    return and(
      eq(automationRuns.automationId, automation.id),
      eq(automationRuns.subjectKey, subjectKeyOf(scope)),
      eq(automationRuns.kind, 'notification'),
      completed,
      sql`${automationRuns.data}->>'triggerId' IS NOT DISTINCT FROM ${trigger.nodeId}`,
      sql`${automationRuns.data}->>'edgeKey' IS NOT DISTINCT FROM ${trigger.edgeKey}`
    );
  }

  if (scope.kind === 'session') {
    // Acknowledged-and-not-dismissed re-arms; open or dismissed blocks. The index alone
    // cannot express the re-arm case, which is why the pre-check exists at all.
    return and(
      eq(automationRuns.automationId, automation.id),
      eq(automationRuns.sessionId, scope.sessionId),
      eq(automationRuns.kind, 'policy'),
      or(isNull(automationRuns.acknowledgedAt), isNotNull(automationRuns.dismissedAt)),
      completed
    );
  }
  // The hourly account path is level-triggered: any completed row for the pair blocks, forever.
  return and(
    eq(automationRuns.automationId, automation.id),
    eq(automationRuns.serverUserId, scope.serverUserId),
    eq(automationRuns.kind, 'policy'),
    completed
  );
}

type WriteOutcome = AutomationRunRow | 'blocked' | null;

/**
 * The single run insert site. Returns the row, or null when the gate, the index
 * or a cooled-down subject said no.
 */
export async function recordRun(args: RecordRunArgs): Promise<AutomationRunRow | null> {
  const { automation, result, serverUserId, scope, trigger, serverId, tx, defer } = args;
  const values = buildRunValues(args);
  const subjectKey = subjectKeyOf(scope);
  const guarded = result.matched && !(scope.kind === 'session' && scope.fresh);
  const counted = result.matched && automation.kind === 'policy';
  // The recount takes a predicate lock on automation_runs, which pivots against
  // every concurrent insert; inside a serializable caller both transactions abort.
  const recountAfterCommit = tx !== undefined && defer !== undefined;

  const write = async (executor: DbTx): Promise<WriteOutcome> => {
    if (guarded) {
      await executor.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${subjectKey} || '::' || ${automation.id}))`
      );
      const existing = await executor
        .select({ id: automationRuns.id })
        .from(automationRuns)
        .where(gateFor(args))
        .limit(1);
      if (existing[0]) return 'blocked';
    }
    const rows = await executor
      .insert(automationRuns)
      .values(values)
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (!row) return null;
    if (counted && !recountAfterCommit) {
      await recomputeIdentityAggregatesForServerUser(serverUserId, executor);
    }
    return row;
  };

  const outcome = tx ? await write(tx) : await db.transaction(write);

  // Not awaited: the ring is best-effort and a caller transaction still holds its locks here.
  if (outcome === 'blocked') {
    void recordNearMiss(automation.id, {
      reason: automation.kind === 'notification' ? 'edge_replayed' : 'gate_blocked',
      subjectKey,
      trigger: trigger.type,
    });
    return null;
  }
  // The partial unique index caught a concurrent duplicate: same near miss, one layer down.
  if (!outcome) {
    void recordNearMiss(automation.id, {
      reason: 'gate_blocked',
      subjectKey,
      trigger: trigger.type,
    });
    return null;
  }

  const announce = async (): Promise<void> => {
    if (counted && recountAfterCommit) {
      await recomputeIdentityAggregatesForServerUser(serverUserId);
    }
    if (result.matched && automation.cooldownMinutes) {
      await armCooldown(
        getRedis(),
        REDIS_KEYS.AUTOMATION_COOLDOWN(automation.id, subjectKey),
        automation.cooldownMinutes
      );
    }
    // Completed policy runs are violations; the violation broadcaster announces those
    // after its transaction commits, with the user and server details it already loads.
    if (!(result.matched && automation.kind === 'policy')) {
      await publishRunFinished(toRunSummary(outcome, automation.name, serverId));
    }
  };

  if (tx && defer) defer(announce);
  else await announce();
  return outcome;
}

/** Post-commit finalization: steps and summary only, never the columns the gate reads. */
export async function appendRunSteps(runId: string, entries: unknown[]): Promise<void> {
  if (entries.length === 0) return;
  await db
    .update(automationRuns)
    .set({
      steps: sql`coalesce(${automationRuns.steps}, '[]'::jsonb) || ${JSON.stringify(entries)}::jsonb`,
    })
    .where(eq(automationRuns.id, runId));
}

const FAILURE_DETAIL_LIMIT = 200;

/**
 * The run already happened and its outcome is written; a failure to record the
 * action results is evidence on the row, never a demotion that would re-open the gate.
 */
export async function noteRunFailure(args: {
  run: AutomationRunRow;
  serverId: string;
  message: string;
}): Promise<void> {
  // Driver errors can carry the statement's parameter values, so only the head is stored.
  const message = args.message.slice(0, FAILURE_DETAIL_LIMIT);
  const entry = {
    failure: 'action_bookkeeping',
    runId: args.run.id,
    serverId: args.serverId,
    message,
  };
  await db
    .update(automationRuns)
    .set({
      humanSummary: `Action bookkeeping failed: ${message}`,
      steps: sql`coalesce(${automationRuns.steps}, '[]'::jsonb) || ${JSON.stringify([entry])}::jsonb`,
    })
    .where(eq(automationRuns.id, args.run.id));
}

export async function automationCoolingDown(
  automation: RuleV2,
  subjectKey: string
): Promise<boolean> {
  if (!automation.cooldownMinutes) return false;
  return isCoolingDown(getRedis(), REDIS_KEYS.AUTOMATION_COOLDOWN(automation.id, subjectKey));
}

/**
 * Capped Redis ring of evaluations that matched a trigger but recorded no run.
 * Trigger-filter misses stay out: they are every automation on every event.
 */
export async function recordNearMiss(automationId: string, entry: NearMiss): Promise<void> {
  const key = REDIS_KEYS.AUTOMATION_EVALS(automationId);
  try {
    await getRedis()
      .multi()
      .lpush(key, JSON.stringify({ ...entry, at: new Date().toISOString() }))
      .ltrim(key, 0, EVAL_RING_SIZE - 1)
      .expire(key, EVAL_RING_TTL_SECONDS)
      .exec();
  } catch {
    // Best-effort: a lost near miss costs one line in a diagnostic list
  }
}

export function toRunSummary(
  row: AutomationRunRow,
  automationName: string,
  serverId: string
): AutomationRunSummary {
  return {
    id: row.id,
    automationId: row.automationId,
    automationName,
    kind: row.kind,
    status: row.status,
    outcome: row.outcome,
    humanSummary: row.humanSummary,
    severity: row.severity ?? null,
    serverUserId: row.serverUserId,
    sessionId: row.sessionId,
    serverId,
    subjectKey: row.subjectKey,
    startedAt: (row.startedAt ?? row.createdAt).toISOString(),
    finishedAt: row.finishedAt?.toISOString() ?? null,
    acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
    dismissedAt: row.dismissedAt?.toISOString() ?? null,
  };
}

export async function publishRunFinished(
  summary: AutomationRunSummary,
  pubSubService: Pick<PubSubService, 'publish'> | null = getPubSubService()
): Promise<void> {
  if (!pubSubService) return;
  try {
    await pubSubService.publish(WS_EVENTS.RUN_FINISHED, summary);
  } catch {
    // Best-effort: the run row is the record, the event is only a nudge to refetch
  }
}
