import type { ConditionField, RuleV2, RunFinishedEvent } from '@tracearr/shared';
import { db } from '../../../db/client.js';
import {
  appendRunSteps,
  automationCoolingDown,
  noteRunFailure,
  publishRunFinished,
  recordNearMiss,
  recordRun,
  runFinishedOf,
  subjectKeyOf,
  type AutomationRunRow,
  type RunScope,
} from '../../automations/runRecorder.js';
import { rulesLogger } from '../../../utils/logger.js';
import { evaluateRulesAsync, PAUSE_CONDITION_FIELDS } from '../engine.js';
import { executeActions, type ActionResult } from '../executors/index.js';
import { storeActionResults } from '../v2Integration.js';
import { subscribe } from './dispatcher.js';
import {
  triggerCandidates,
  triggerNodeFor,
  type EvaluatingEvent,
  type SessionEvaluatingEvent,
} from './evaluate.js';
import type { EvaluationContext, EvaluationResult } from '../types.js';
import type { DbTx, DispatchOptions, EvaluationInputs, SubscriberResult } from './types.js';
import type { ViolationInsertResult } from '../../../jobs/poller/violations.js';

interface PendingAct {
  context: EvaluationContext;
  result: EvaluationResult;
  rule: RuleV2;
  run: AutomationRunRow;
}

function actionStep(result: ActionResult): Record<string, unknown> {
  return {
    action: result.action.type,
    success: result.success,
    ...(result.skipped ? { skipped: true, skipReason: result.skipReason ?? null } : {}),
    ...(result.success ? {} : { message: result.message ?? null }),
  };
}

/**
 * Acts run once the run rows are committed, so a throw can no longer be a retry
 * signal - it would only mute the siblings that still have work to do.
 */
async function runActs(pending: PendingAct[]): Promise<ActionResult[]> {
  const all: ActionResult[] = [];
  for (const { context, result, rule, run } of pending) {
    try {
      const results = await executeActions(context, result.actions);
      await storeActionResults(run.id, rule.id, results);
      await appendRunSteps(run.id, results.map(actionStep));
      all.push(...results);
    } catch (error) {
      await noteRunFailure({
        run,
        serverId: context.server.id,
        message: error instanceof Error ? error.message : String(error),
      });
      rulesLogger.error('Automation actions failed', {
        automation: rule.id,
        run: run.id,
        error,
      });
    }
  }
  return all;
}

const INACTIVE_CONDITION_FIELDS: ReadonlySet<ConditionField> = new Set(['inactive_days']);

/** What makes this firing a distinct edge for the notification gate. */
function edgeKeyOf(event: EvaluatingEvent, automation: RuleV2): string | null {
  switch (event.type) {
    case 'session.started':
      return null;
    case 'session.transcode_changed':
      return `${event.next.videoDecision ?? 'none'}/${event.next.audioDecision ?? 'none'}`;
    case 'session.paused':
      return event.pauseData.lastPausedAt?.toISOString() ?? null;
    case 'session.held_for':
      return conditionThreshold(automation, PAUSE_CONDITION_FIELDS);
    case 'account.inactive_for':
      return conditionThreshold(automation, INACTIVE_CONDITION_FIELDS);
  }
}

/**
 * Level-triggered edges key on the threshold the automation crossed, never on the
 * elapsed value: a rehydrated wake replays the same crossing with a larger number.
 */
function conditionThreshold(
  automation: RuleV2,
  fields: ReadonlySet<ConditionField>
): string | null {
  for (const group of automation.conditions?.groups ?? []) {
    for (const condition of group.conditions) {
      if (fields.has(condition.field) && typeof condition.value === 'number') {
        return String(condition.value);
      }
    }
  }
  return null;
}

/**
 * evaluate → record → act. Every evaluation records a run; only a matched one
 * that cleared the gate acts. The records share one transaction and the acts
 * follow it, so nothing acts on a run the database has not kept.
 */
export async function runRulePipeline(
  event: EvaluatingEvent,
  inputs: EvaluationInputs,
  opts: DispatchOptions,
  scope: RunScope,
  marker?: Record<string, true>
): Promise<SubscriberResult> {
  const { rules, baseContext } = triggerCandidates(event, inputs);
  const subjectKey = subjectKeyOf(scope);
  const violations: ViolationInsertResult[] = [];
  const pending: PendingAct[] = [];
  const effects: Array<() => Promise<void>> = [];
  const finished: RunFinishedEvent[] = [];

  const cooling = await Promise.all(rules.map((rule) => automationCoolingDown(rule, subjectKey)));
  const evaluable = rules.filter((rule, index) => {
    if (!cooling[index]) return true;
    void recordNearMiss(rule.id, { reason: 'cooldown_active', subjectKey, trigger: event.type });
    return false;
  });
  if (evaluable.length === 0) return { violations };

  const results = await evaluateRulesAsync(baseContext, evaluable, { includeUnmatched: true });

  const record = async (executor: DbTx): Promise<void> => {
    for (const result of results) {
      const rule = evaluable.find((r) => r.id === result.ruleId);
      if (!rule) continue;

      const run = await recordRun({
        automation: rule,
        result,
        serverUserId: event.serverUser.id,
        serverId: event.server.id,
        scope,
        session: event.session,
        trigger: {
          type: event.type,
          nodeId: triggerNodeFor(rule, event.type)?.id ?? null,
          edgeKey: edgeKeyOf(event, rule),
          at: event.at,
        },
        marker,
        tx: executor,
        defer: (effect) => effects.push(effect),
      });
      if (!run) continue;
      // Completed policy runs are violations; the violation broadcaster announces
      // those, with the user and server details it already loads.
      if (!(result.matched && rule.kind === 'policy')) finished.push(runFinishedOf(run));
      if (!result.matched) continue;

      if (rule.kind === 'policy') {
        violations.push({ violation: run, rule: { id: rule.id, name: rule.name, type: null } });
      }
      if (result.actions.length === 0) continue;

      pending.push({ context: { ...baseContext, rule, violationId: run.id }, result, rule, run });
    }
  };

  // One transaction per dispatch. Each run still takes its own advisory lock and
  // gate inside it, in order; the batch just stops paying BEGIN/COMMIT per row.
  if (opts.tx) await record(opts.tx);
  else await db.transaction(record);

  /** Best-effort, like the publish inside them: a redis blip cannot cost the acts. */
  const drainEffects = async (): Promise<void> => {
    for (const effect of effects) {
      try {
        await effect();
      } catch (error) {
        rulesLogger.warn('Post-commit run effect failed', {
          trigger: event.type,
          subject: subjectKey,
          error,
        });
      }
    }
  };

  const postCommit = async (): Promise<void> => {
    await drainEffects();
    await publishRunFinished(finished);
  };

  if (opts.tx) {
    // The caller can still roll its transaction back, so its post-commit phase owns these.
    if (finished.length > 0 || effects.length > 0 || pending.length > 0) {
      return {
        violations,
        deferredActions: async () => {
          await postCommit();
          return runActs(pending);
        },
      };
    }
    return { violations };
  }

  await postCommit();
  if (opts.deferActions && pending.length > 0) {
    return { violations, deferredActions: () => runActs(pending) };
  }
  await runActs(pending);
  return { violations };
}

function sessionRules(marker?: Record<string, true>, fresh?: boolean) {
  return async (
    event: SessionEvaluatingEvent,
    inputs: EvaluationInputs | undefined,
    opts: DispatchOptions
  ) => {
    if (!inputs) return;
    return runRulePipeline(
      event,
      inputs,
      opts,
      { kind: 'session', sessionId: event.session.id, ...(fresh ? { fresh } : {}) },
      marker
    );
  };
}

let registered = false;

export function registerRuleSubscribers(): void {
  if (registered) return;
  registered = true;

  subscribe('session.started', 'session-rules', sessionRules(undefined, true));
  subscribe('session.transcode_changed', 'session-rules', sessionRules({ transcodeReEval: true }));
  subscribe('session.paused', 'session-rules', sessionRules({ pauseReEval: true }));
  subscribe('session.held_for', 'session-rules', sessionRules({ heldFor: true }));
  subscribe('account.inactive_for', 'account-rules', async (event, inputs, opts) => {
    if (!inputs) return;
    return runRulePipeline(event, inputs, opts, {
      kind: 'account',
      serverUserId: event.serverUser.id,
    });
  });
}

export function resetRuleSubscribersForTests(): void {
  registered = false;
}
