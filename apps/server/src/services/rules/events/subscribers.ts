import type { RuleV2 } from '@tracearr/shared';
import {
  appendRunSteps,
  automationCoolingDown,
  markRunFailed,
  recordNearMiss,
  recordRun,
  subjectKeyOf,
  type AutomationRunRow,
  type RunScope,
} from '../../automations/runRecorder.js';
import { evaluateRulesAsync } from '../engine.js';
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
import type { DispatchOptions, EvaluationInputs, SubscriberResult } from './types.js';
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

async function runActs(pending: PendingAct[]): Promise<ActionResult[]> {
  const all: ActionResult[] = [];
  for (const { context, result, rule, run } of pending) {
    try {
      const results = await executeActions(context, result.actions);
      await storeActionResults(run.id, rule.id, results);
      await appendRunSteps(run.id, results.map(actionStep));
      all.push(...results);
    } catch (error) {
      await markRunFailed({
        run,
        automationName: rule.name,
        serverId: context.server.id,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
  return all;
}

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
      return String(Math.floor(event.heldMinutes));
    case 'account.inactive_for':
      return inactiveDaysThreshold(automation);
  }
}

function inactiveDaysThreshold(automation: RuleV2): string | null {
  for (const group of automation.conditions?.groups ?? []) {
    for (const condition of group.conditions) {
      if (condition.field === 'inactive_days') return String(condition.value);
    }
  }
  return null;
}

/**
 * evaluate → record → act, per rule in that order. Every evaluation records a
 * run; only a matched one that cleared the gate acts. Under deferActions the act
 * step is returned as a closure for the caller to run after its commit.
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

  const evaluable: RuleV2[] = [];
  for (const rule of rules) {
    if (await automationCoolingDown(rule, subjectKey)) {
      await recordNearMiss(rule.id, {
        reason: 'cooldown_active',
        subjectKey,
        trigger: event.type,
      });
      continue;
    }
    evaluable.push(rule);
  }
  if (evaluable.length === 0) return { violations };

  const results = await evaluateRulesAsync(baseContext, evaluable, { includeUnmatched: true });

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
      },
      marker,
      tx: opts.tx,
    });
    if (!run || !result.matched) continue;

    if (rule.kind === 'policy') {
      violations.push({ violation: run, rule: { id: rule.id, name: rule.name, type: null } });
    }
    if (result.actions.length === 0) continue;

    const act: PendingAct = {
      context: { ...baseContext, rule, violationId: run.id },
      result,
      rule,
      run,
    };
    if (opts.deferActions) pending.push(act);
    else await runActs([act]);
  }

  if (opts.deferActions && pending.length > 0) {
    return { violations, deferredActions: () => runActs(pending) };
  }
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
