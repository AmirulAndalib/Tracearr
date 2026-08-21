import { TIME_MS, TRIGGER_TYPES, type EngineAutomation, type TriggerNode } from '@tracearr/shared';
import { buildRuleContextSessions } from '../../../jobs/poller/sessionLifecycle.js';
import { ruleAppliesTo } from '../engine.js';
import { pauseMinutes } from '../wakes/crossings.js';
import { toRuleServer, toRuleServerUser } from './contextAssembly.js';
import type { EvaluationContext } from '../types.js';
import type {
  AccountInactiveForEvent,
  EvaluationInputs,
  PluginUpdateEvent,
  ServerDownEvent,
  ServerUpdateEvent,
  ServerUpEvent,
  SessionHeldForEvent,
  SessionPausedEvent,
  SessionStartedEvent,
  SessionStoppedEvent,
  SessionTranscodeChangedEvent,
  TracearrUpdateEvent,
  TriggerType,
} from './types.js';

export type SessionEvaluatingEvent =
  SessionStartedEvent | SessionTranscodeChangedEvent | SessionPausedEvent | SessionHeldForEvent;

/** The events that carry the account a run is about. */
export type UserEvaluatingEvent = SessionEvaluatingEvent | AccountInactiveForEvent;

/** One per catalog trigger. Stopped, server and install events reach the seam; Task 12 gives them contexts. */
export type EvaluatingEvent =
  | UserEvaluatingEvent
  | SessionStoppedEvent
  | ServerDownEvent
  | ServerUpEvent
  | PluginUpdateEvent
  | ServerUpdateEvent
  | TracearrUpdateEvent;

// The seam declares two trigger types the catalog does not: resumed and media_changed
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

/** Whole days since the account last did anything; null when it never has, which outlasts any threshold. */
function inactiveDays(lastActivityAt: Date | null, at: Date): number | null {
  if (!lastActivityAt) return null;
  return Math.floor((at.getTime() - lastActivityAt.getTime()) / TIME_MS.DAY);
}

/** Params are the trigger's own test: held_for and inactive_for fire only once the event clears the node. */
export function paramsPass(node: TriggerNode, event: UserEvaluatingEvent): boolean {
  if (node.type === 'session.held_for') {
    if (event.type !== 'session.held_for' || !event.pauseData.lastPausedAt) return false;
    const minutes = pauseMinutes(node.params.measure, {
      lastPausedAt: event.pauseData.lastPausedAt.getTime(),
      pausedDurationMs: event.pauseData.pausedDurationMs,
      now: event.at.getTime(),
    });
    return minutes >= node.params.minutes;
  }
  if (node.type === 'account.inactive_for') {
    if (event.type !== 'account.inactive_for') return false;
    const days = inactiveDays(event.serverUser.lastActivityAt, event.at);
    return days === null || days >= node.params.days;
  }
  return true;
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
  event: UserEvaluatingEvent,
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
