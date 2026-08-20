import { TRIGGER_TYPES, type RuleV2 } from '@tracearr/shared';
import { buildRuleContextSessions } from '../../../jobs/poller/sessionLifecycle.js';
import { evaluateRulesAsync } from '../engine.js';
import { toRuleServer, toRuleServerUser } from './contextAssembly.js';
import type { EvaluationContext, EvaluationResult } from '../types.js';
import type {
  AccountInactiveForEvent,
  EvaluationInputs,
  SessionHeldForEvent,
  SessionPausedEvent,
  SessionStartedEvent,
  SessionTranscodeChangedEvent,
  TriggerType,
} from './types.js';

export type SessionEvaluatingEvent =
  SessionStartedEvent | SessionTranscodeChangedEvent | SessionPausedEvent | SessionHeldForEvent;

export type EvaluatingEvent = SessionEvaluatingEvent | AccountInactiveForEvent;

// The seam declares more trigger types than automations can subscribe to; the extras
// only cancel wakes and must never reach evaluation even if a stored node names one.
const EVALUATING_TRIGGERS: ReadonlySet<string> = new Set(TRIGGER_TYPES);

/** A rule runs for a trigger when its stored triggers hold an enabled node of that type. */
export function matchesTrigger(rule: Pick<RuleV2, 'triggers'>, trigger: TriggerType): boolean {
  return rule.triggers.some((node) => node.enabled && node.type === trigger);
}

export function rulesForTrigger(trigger: TriggerType, rules: RuleV2[]): RuleV2[] {
  if (!EVALUATING_TRIGGERS.has(trigger)) return [];
  return rules.filter((rule) => matchesTrigger(rule, trigger));
}

export interface TriggerEvaluation {
  rules: RuleV2[];
  baseContext: Omit<EvaluationContext, 'rule'>;
  results: EvaluationResult[];
}

/** Rule subset for the trigger, the evaluator context, and the matched results. Touches no database. */
export async function evaluateTrigger(
  event: EvaluatingEvent,
  inputs: EvaluationInputs
): Promise<TriggerEvaluation> {
  const session = event.session;
  const rules = rulesForTrigger(event.type, inputs.activeRulesV2);
  const baseContext: Omit<EvaluationContext, 'rule'> = {
    session,
    serverUser: toRuleServerUser(event.serverUser, event.server.id),
    server: toRuleServer(event.server),
    activeSessions: session
      ? buildRuleContextSessions(inputs.activeSessions, session, null)
      : inputs.activeSessions,
    recentSessions: inputs.recentSessions,
    identityServerUserIds: inputs.identityServerUserIds ?? event.serverUser.identityServerUserIds,
  };
  if (rules.length === 0) return { rules, baseContext, results: [] };
  const results = await evaluateRulesAsync(baseContext, rules);
  return { rules, baseContext, results };
}
