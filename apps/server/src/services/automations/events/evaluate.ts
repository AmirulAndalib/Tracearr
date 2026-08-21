import { TRIGGER_TYPES, type EngineAutomation, type TriggerNode } from '@tracearr/shared';
import { buildRuleContextSessions } from '../../../jobs/poller/sessionLifecycle.js';
import { ruleAppliesTo } from '../engine.js';
import { toRuleServer, toRuleServerUser } from './contextAssembly.js';
import type { EvaluationContext } from '../types.js';
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

/** The enabled stored node that makes this rule run for the trigger, if it has one. */
export function triggerNodeFor(
  rule: Pick<EngineAutomation, 'triggers'>,
  trigger: TriggerType
): TriggerNode | null {
  return rule.triggers.find((node) => node.enabled && node.type === trigger) ?? null;
}

/** A rule runs for a trigger when its stored triggers hold an enabled node of that type. */
export function matchesTrigger(
  rule: Pick<EngineAutomation, 'triggers'>,
  trigger: TriggerType
): boolean {
  return triggerNodeFor(rule, trigger) !== null;
}

export function rulesForTrigger(
  trigger: TriggerType,
  rules: EngineAutomation[]
): EngineAutomation[] {
  if (!EVALUATING_TRIGGERS.has(trigger)) return [];
  return rules.filter((rule) => matchesTrigger(rule, trigger));
}

export interface TriggerCandidates {
  rules: EngineAutomation[];
  baseContext: Omit<EvaluationContext, 'rule'>;
}

/** The rules this event can evaluate and the context to evaluate them in. Touches no database. */
export function triggerCandidates(
  event: EvaluatingEvent,
  inputs: EvaluationInputs
): TriggerCandidates {
  const session = event.session;
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
  const rules = rulesForTrigger(event.type, inputs.activeAutomations).filter((rule) =>
    ruleAppliesTo(rule, baseContext)
  );
  return { rules, baseContext };
}
