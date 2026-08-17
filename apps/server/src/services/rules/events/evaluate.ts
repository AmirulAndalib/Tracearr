import type { RuleV2 } from '@tracearr/shared';
import { buildRuleContextSessions } from '../../../jobs/poller/sessionLifecycle.js';
import { evaluateRulesAsync, hasPauseConditions, hasTranscodeConditions } from '../engine.js';
import { toRuleServer, toRuleServerUser } from './contextAssembly.js';
import type { EvaluationContext, EvaluationResult } from '../types.js';
import type {
  EvaluationInputs,
  SessionHeldForEvent,
  SessionPausedEvent,
  SessionStartedEvent,
  SessionTranscodeChangedEvent,
  TriggerType,
} from './types.js';

export type EvaluatingEvent =
  SessionStartedEvent | SessionTranscodeChangedEvent | SessionPausedEvent | SessionHeldForEvent;

export function rulesForTrigger(trigger: TriggerType, rules: RuleV2[]): RuleV2[] {
  switch (trigger) {
    case 'session.started':
      return rules;
    case 'session.transcode_changed':
      return rules.filter(hasTranscodeConditions);
    case 'session.paused':
    case 'session.held_for':
      return rules.filter(hasPauseConditions);
    default:
      return [];
  }
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
    activeSessions: buildRuleContextSessions(inputs.activeSessions, session, null),
    recentSessions: inputs.recentSessions,
    identityServerUserIds: inputs.identityServerUserIds ?? event.serverUser.identityServerUserIds,
  };
  if (rules.length === 0) return { rules, baseContext, results: [] };
  const results = await evaluateRulesAsync(baseContext, rules);
  return { rules, baseContext, results };
}
