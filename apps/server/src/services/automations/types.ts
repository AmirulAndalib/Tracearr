import type {
  Condition,
  EngineAutomation,
  Action,
  Session,
  ServerUser,
  Server,
  GroupEvidence,
} from '@tracearr/shared';
import type { ContextEvaluatingEvent } from './events/evaluate.js';

export interface EvaluationContext {
  /** null outside a playback session: account, server and install triggers. */
  session: Session | null;
  /** null for server and install triggers, which are about no one. */
  serverUser: ServerUser | null;
  /** null for install triggers, the only context with no server behind it. */
  server: Server | null;
  /** What the run is about, as the recorder keys it: session id, server user id, `server:<id>` or `install`. */
  subjectKey: string;
  /** The event being evaluated; absent for kill re-verification, which runs no send. */
  trigger?: ContextEvaluatingEvent;
  activeSessions: Session[];
  recentSessions: Session[];
  rule: EngineAutomation;
  /** All server_user ids belonging to the same identity as serverUser.
   *  Optional so contexts built before a lookup (or in old tests) fall back
   *  to single server_user behavior. */
  identityServerUserIds?: string[];
  /** Violation this match created, if any. Populated by callers that insert
   *  the violation before executing actions; kill_stream needs it to attribute
   *  the eventual queue outcome (killed/skipped/failed) back to the record. */
  violationId?: string | null;
}

export interface EvaluatorResult {
  matched: boolean;
  actual: unknown;
  relatedSessionIds?: string[];
  details?: Record<string, unknown>;
}

/** The contexts by rank: each one supplies everything the narrower ones do and more. */
export type ServerEvaluationContext = EvaluationContext & { server: Server };
export type AccountEvaluationContext = ServerEvaluationContext & { serverUser: ServerUser };
export type SessionEvaluationContext = AccountEvaluationContext & { session: Session };

/** The engine compares the field's `requires` against the context before calling any of these. */
export type ConditionEvaluator = (
  context: SessionEvaluationContext,
  condition: Condition
) => EvaluatorResult | Promise<EvaluatorResult>;

export type AccountConditionEvaluator = (
  context: AccountEvaluationContext,
  condition: Condition
) => EvaluatorResult | Promise<EvaluatorResult>;

export type ServerConditionEvaluator = (
  context: ServerEvaluationContext,
  condition: Condition
) => EvaluatorResult | Promise<EvaluatorResult>;

/** Non-void executors return which target session ids they successfully
 *  handed to a downstream queue (currently kill_stream only). queueFailure is
 *  set when there were targets to kill but none reached the queue (queue down),
 *  so the caller records the action as failed rather than queued. skipReason
 *  says the context held nothing to act on, and records the action as skipped. */
export type ActionExecutorResult = {
  enqueuedSessionIds?: string[];
  queueFailure?: boolean;
  skipReason?: string;
} | void;

export type ActionExecutor = (
  context: EvaluationContext,
  action: Action
) => ActionExecutorResult | Promise<ActionExecutorResult>;

export interface EvaluationResult {
  ruleId: string;
  ruleName: string;
  matched: boolean;
  matchedGroups: number[];
  actions: Action[];
  evidence?: GroupEvidence[];
  /** The group that ended the walk, for the run record's summary. Set only when unmatched. */
  stoppedBy?: GroupEvidence;
}
