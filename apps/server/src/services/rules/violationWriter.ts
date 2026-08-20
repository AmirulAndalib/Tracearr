import { and, eq, isNotNull, isNull, or, sql } from 'drizzle-orm';
import type { RuleV2, Session } from '@tracearr/shared';
import { db } from '../../db/client.js';
import { automationRuns } from '../../db/schema.js';
import { recomputeIdentityAggregatesForServerUser } from '../userService.js';
import type { DbTx } from './events/types.js';
import type { EvaluationResult } from './types.js';

export type ViolationRow = typeof automationRuns.$inferSelect;

export type ViolationScope =
  /** fresh: the session id was created in this transaction; nothing can contend it, so no lock and no gate. */
  | { kind: 'session'; sessionId: string; fresh?: boolean }
  | { kind: 'account'; serverUserId: string };

export interface RecordViolationArgs {
  result: EvaluationResult;
  rule: RuleV2;
  serverUserId: string;
  scope: ViolationScope;
  session: Session | null;
  /** Per-trigger marker kept for anything downstream that reads violation data. */
  marker?: Record<string, true>;
  tx?: DbTx;
}

function relatedSessionIdsOf(result: EvaluationResult): string[] {
  const ids = new Set<string>();
  for (const group of result.evidence ?? []) {
    for (const cond of group.conditions) {
      for (const id of cond.relatedSessionIds ?? []) ids.add(id);
    }
  }
  return Array.from(ids);
}

const subjectKeyOf = (scope: ViolationScope): string =>
  scope.kind === 'session' ? scope.sessionId : scope.serverUserId;

export function buildViolationValues(
  args: RecordViolationArgs
): typeof automationRuns.$inferInsert {
  const { result, rule, serverUserId, scope, session, marker } = args;
  const now = new Date();
  return {
    automationId: rule.id,
    serverUserId,
    sessionId: scope.kind === 'session' ? scope.sessionId : null,
    subjectKey: subjectKeyOf(scope),
    startedAt: now,
    finishedAt: now,
    severity: rule.severity ?? 'warning',
    ruleType: null,
    data: {
      evidence: result.evidence,
      relatedSessionIds: relatedSessionIdsOf(result),
      ruleName: rule.name,
      matchedGroups: result.matchedGroups,
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

function gateFor(scope: ViolationScope, ruleId: string) {
  if (scope.kind === 'session') {
    // Acknowledged-and-not-dismissed re-arms; open or dismissed blocks. The index alone
    // cannot express the re-arm case, which is why the pre-check exists at all.
    return and(
      eq(automationRuns.automationId, ruleId),
      eq(automationRuns.sessionId, scope.sessionId),
      or(isNull(automationRuns.acknowledgedAt), isNotNull(automationRuns.dismissedAt))
    );
  }
  // The hourly account path is level-triggered: any row for the pair blocks, forever.
  return and(
    eq(automationRuns.automationId, ruleId),
    eq(automationRuns.serverUserId, scope.serverUserId)
  );
}

/** The single violation insert site. Returns the inserted row or null when the gate or the index said no. */
export async function recordViolation(args: RecordViolationArgs): Promise<ViolationRow | null> {
  const { rule, serverUserId, scope, tx } = args;
  const values = buildViolationValues(args);
  const guarded = !(scope.kind === 'session' && scope.fresh);
  const subjectKey = subjectKeyOf(scope);

  const run = async (executor: DbTx): Promise<ViolationRow | null> => {
    if (guarded) {
      await executor.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${subjectKey} || '::' || ${rule.id}))`
      );
      const existing = await executor
        .select({ id: automationRuns.id })
        .from(automationRuns)
        .where(gateFor(scope, rule.id))
        .limit(1);
      if (existing[0]) return null;
    }
    const rows = await executor
      .insert(automationRuns)
      .values(values)
      .onConflictDoNothing()
      .returning();
    const row = rows[0];
    if (!row) return null;
    await recomputeIdentityAggregatesForServerUser(serverUserId, executor);
    return row;
  };

  return tx ? run(tx) : db.transaction(run);
}
