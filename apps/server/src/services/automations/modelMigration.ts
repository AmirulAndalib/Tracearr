import { and, eq, isNotNull, isNull, notExists, sql } from 'drizzle-orm';
import type {
  Action,
  AutomationKind,
  RuleActions,
  RuleConditions,
  TriggerNode,
  ViolationSeverity,
} from '@tracearr/shared';
import { db, type Executor } from '../../db/client.js';
import { automations, automationVersions } from '../../db/schema.js';
import { invalidateRulesCache } from '../../jobs/poller/database.js';
import { createLogger } from '../../utils/logger.js';
import { convertV1Rule } from '../rules/v2Integration.js';
import { stampNodes, synthesizeTriggers } from './triggers.js';

const logger = createLogger('automation-migration');

/** Distinct from timescale's 875_100_001, the schema runner's 875_100_002 and destinations' 875_100_003. */
const LOCK_KEY = 875_100_004;

/** The snapshot an automation_versions row stores; scope and definition, no runtime settings. */
interface AutomationDefinition {
  name: string;
  kind: AutomationKind;
  severity: ViolationSeverity | null;
  triggers: TriggerNode[];
  conditions: RuleConditions | null;
  actions: RuleActions;
  serverId: string | null;
  serverUserId: string | null;
  userId: string | null;
  enforceAcrossServers: boolean;
}

interface PendingWork {
  legacy: number;
  missingTriggers: number;
  missingVersion: number;
  staleRuns: number;
}

interface MigrationSummary extends PendingWork {
  duplicateSubjects: number;
  subjectKeys: number;
  versionLinks: number;
  timestamps: number;
  stepLogs: number;
}

const hasWork = (pending: PendingWork): boolean =>
  pending.legacy > 0 ||
  pending.missingTriggers > 0 ||
  pending.missingVersion > 0 ||
  pending.staleRuns > 0;

/** Run rows still missing the subject key the writer stamps. */
const STALE_RUNS = sql`subject_key IS NULL AND (session_id IS NOT NULL OR server_user_id IS NOT NULL)`;

async function countPendingWork(executor: Executor): Promise<PendingWork> {
  const result = await executor.execute(sql`
    SELECT
      count(*) FILTER (WHERE a.type IS NOT NULL AND a.conditions IS NULL)::int AS legacy,
      count(*) FILTER (WHERE a.triggers IS NULL)::int AS missing_triggers,
      count(*) FILTER (WHERE v.id IS NULL)::int AS missing_version,
      (EXISTS (SELECT 1 FROM automation_runs WHERE ${STALE_RUNS}))::int AS stale_runs
    FROM automations a
    LEFT JOIN LATERAL (
      SELECT id FROM automation_versions WHERE automation_id = a.id LIMIT 1
    ) v ON true
  `);
  const row = result.rows[0];
  const count = (value: unknown): number => (typeof value === 'number' ? value : 0);
  return {
    legacy: count(row?.legacy),
    missingTriggers: count(row?.missing_triggers),
    missingVersion: count(row?.missing_version),
    staleRuns: count(row?.stale_runs),
  };
}

/** Legacy trust rows can carry a cooldown the typed trio never declared. */
function cooldownOf(action: Action): { cooldown_minutes?: number } {
  const minutes = 'cooldown_minutes' in action ? action.cooldown_minutes : undefined;
  return typeof minutes === 'number' ? { cooldown_minutes: minutes } : {};
}

/** The trust trio collapses into one action with a mode; log_only becomes nothing at all. */
function rewriteAction(action: Action): Action | null {
  switch (action.type) {
    case 'log_only':
      return null;
    case 'adjust_trust':
      return { type: 'trust', mode: 'adjust', amount: action.amount, ...cooldownOf(action) };
    case 'set_trust':
      return { type: 'trust', mode: 'set', value: action.value, ...cooldownOf(action) };
    case 'reset_trust':
      return { type: 'trust', mode: 'reset', ...cooldownOf(action) };
    case 'kill_stream': {
      const { require_confirmation: _confirmation, ...rest } = action;
      return rest;
    }
    default:
      return action;
  }
}

function rewriteActions(actions: RuleActions | null): RuleActions {
  const nodes: Action[] = [];
  for (const action of actions?.actions ?? []) {
    const rewritten = rewriteAction(action);
    if (rewritten) nodes.push(rewritten);
  }
  return { actions: nodes };
}

/**
 * Historical rows predate the writer that stamps these columns, so every backfill is
 * a single UPDATE narrowed to the rows still missing the value.
 */
async function backfillRuns(
  executor: Executor
): Promise<
  Pick<
    MigrationSummary,
    'duplicateSubjects' | 'subjectKeys' | 'versionLinks' | 'timestamps' | 'stepLogs'
  >
> {
  const affected = async (query: Parameters<Executor['execute']>[0]): Promise<number> =>
    (await executor.execute(query)).rowCount ?? 0;

  const versionLinks = await affected(sql`
    UPDATE automation_runs AS r
    SET definition_version_id = v.id
    FROM automation_versions v
    WHERE v.automation_id = r.rule_id AND v.version = 1 AND r.definition_version_id IS NULL
  `);
  // A hand-touched database can hold two unacked rows per (rule, session); the key they are
  // about to share is unique, so the older ones are acknowledged rather than deleted.
  const duplicateSubjects = await affected(sql`
    UPDATE automation_runs SET acknowledged_at = now()
    WHERE id IN (
      SELECT id FROM (
        SELECT
          id,
          row_number() OVER (PARTITION BY rule_id, session_id ORDER BY created_at DESC, id) AS rn
        FROM automation_runs
        WHERE kind = 'policy'
          AND outcome = 'completed'
          AND acknowledged_at IS NULL
          AND session_id IS NOT NULL
          AND subject_key IS NULL
      ) ranked
      WHERE rn > 1
    )
  `);
  const subjectKeys = await affected(sql`
    UPDATE automation_runs
    SET subject_key = COALESCE(session_id::text, server_user_id::text)
    WHERE ${STALE_RUNS}
  `);
  const started = await affected(sql`
    UPDATE automation_runs SET started_at = created_at WHERE started_at IS NULL
  `);
  const finished = await affected(sql`
    UPDATE automation_runs
    SET finished_at = created_at
    WHERE finished_at IS NULL AND status = 'finished'
  `);
  const stepLogs = await affected(sql`
    UPDATE automation_runs
    SET steps = jsonb_build_array(jsonb_build_object('step', 'evidence', 'data', data->'evidence'))
    WHERE steps IS NULL AND data ? 'evidence'
  `);

  return { versionLinks, duplicateSubjects, subjectKeys, timestamps: started + finished, stepLogs };
}

/**
 * One transaction under an advisory lock; throws into boot recovery on failure.
 * Re-runs write nothing and log nothing.
 */
export async function runAutomationModelMigration(): Promise<void> {
  if (!hasWork(await countPendingWork(db))) return;

  const summary = await db.transaction(async (tx): Promise<MigrationSummary | null> => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${LOCK_KEY})`);
    const pending = await countPendingWork(tx);
    if (!hasWork(pending)) return null;

    const legacyRows = await tx
      .select({
        id: automations.id,
        name: automations.name,
        type: automations.type,
        params: automations.params,
        serverUserId: automations.serverUserId,
        serverId: automations.serverId,
        isActive: automations.isActive,
      })
      .from(automations)
      .where(and(isNotNull(automations.type), isNull(automations.conditions)));
    for (const row of legacyRows) {
      const { type } = row;
      if (type === null) continue;
      await convertV1Rule(tx, { ...row, type });
    }

    const untriggered = await tx
      .select({
        id: automations.id,
        conditions: automations.conditions,
        actions: automations.actions,
      })
      .from(automations)
      .where(isNull(automations.triggers));
    for (const row of untriggered) {
      const stamped = stampNodes({
        conditions: row.conditions,
        actions: rewriteActions(row.actions),
      });
      await tx
        .update(automations)
        .set({
          triggers: synthesizeTriggers(row.conditions),
          conditions: stamped.conditions,
          actions: stamped.actions,
          updatedAt: new Date(),
        })
        .where(eq(automations.id, row.id));
    }

    const versionless = await tx
      .select({
        id: automations.id,
        name: automations.name,
        kind: automations.kind,
        severity: automations.severity,
        triggers: automations.triggers,
        conditions: automations.conditions,
        actions: automations.actions,
        serverId: automations.serverId,
        serverUserId: automations.serverUserId,
        userId: automations.userId,
        enforceAcrossServers: automations.enforceAcrossServers,
      })
      .from(automations)
      .where(
        notExists(
          tx
            .select({ id: automationVersions.id })
            .from(automationVersions)
            .where(eq(automationVersions.automationId, automations.id))
        )
      );
    if (versionless.length > 0) {
      await tx.insert(automationVersions).values(
        versionless.map((row) => {
          const definition = {
            name: row.name,
            kind: row.kind,
            severity: row.severity,
            triggers: row.triggers ?? [],
            conditions: row.conditions,
            actions: row.actions ?? { actions: [] },
            serverId: row.serverId,
            serverUserId: row.serverUserId,
            userId: row.userId,
            enforceAcrossServers: row.enforceAcrossServers,
          } satisfies AutomationDefinition;
          return { automationId: row.id, version: 1, definition };
        })
      );
    }

    return {
      legacy: legacyRows.length,
      missingTriggers: untriggered.length,
      missingVersion: versionless.length,
      staleRuns: pending.staleRuns,
      ...(await backfillRuns(tx)),
    };
  });

  if (!summary) return;
  invalidateRulesCache();
  if (summary.duplicateSubjects > 0) {
    logger.info(
      `Acknowledged ${summary.duplicateSubjects} duplicate active run(s) sharing a subject key`
    );
  }
  logger.info(
    `Migrated ${summary.missingTriggers} automation(s) (${summary.legacy} from V1) and seeded ` +
      `${summary.missingVersion} version(s); runs backfilled: ${summary.subjectKeys} subject key(s), ` +
      `${summary.versionLinks} version link(s), ${summary.timestamps} timestamp(s), ${summary.stepLogs} step log(s)`
  );
}
