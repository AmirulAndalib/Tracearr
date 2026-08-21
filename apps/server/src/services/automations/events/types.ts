import type {
  EngineAutomation,
  Session,
  TriggerType as CatalogTriggerType,
  ViolationSeverity,
} from '@tracearr/shared';
import type { db } from '../../../db/client.js';
import type { sessions } from '../../../db/schema.js';
import type { ActionResult } from '../executors/index.js';
import type { ViolationInsertResult } from '../../../jobs/poller/violations.js';

export type DbTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type SessionRow = typeof sessions.$inferSelect;

/** The catalog plus the two types that only cancel wakes and are never stored on an automation. */
export type TriggerType = CatalogTriggerType | 'session.resumed' | 'session.media_changed';

/** What every producer already holds about the server; matches SessionCreationInput['server']. */
export interface EvaluationServer {
  id: string;
  name: string;
  type: 'plex' | 'jellyfin' | 'emby';
}

/** What every producer already holds about the account; matches SessionCreationInput['serverUser']. */
export interface EvaluationServerUser {
  id: string;
  userId: string;
  username: string;
  thumbUrl: string | null;
  identityName: string | null;
  trustScore: number;
  lastActivityAt: Date | null;
  createdAt: Date;
  identityServerUserIds: string[];
}

export interface PauseData {
  lastPausedAt: Date | null;
  pausedDurationMs: number;
}

interface BaseEvent {
  at: Date;
}

interface SessionEventBase extends BaseEvent {
  server: EvaluationServer;
  serverUser: EvaluationServerUser;
  session: Session;
}

export interface SessionStartedEvent extends SessionEventBase {
  type: 'session.started';
}

export interface SessionTranscodeChangedEvent extends SessionEventBase {
  type: 'session.transcode_changed';
  previous: { videoDecision: string | null; audioDecision: string | null };
  next: { videoDecision: string | null; audioDecision: string | null };
}

export interface SessionPausedEvent extends SessionEventBase {
  type: 'session.paused';
  pauseData: PauseData;
}

export interface SessionHeldForEvent extends SessionEventBase {
  type: 'session.held_for';
  pauseData: PauseData;
  heldMinutes: number;
}

/** Wake cancellations carry ids and no evaluation inputs. */
interface SessionRefBase extends BaseEvent {
  sessionId: string;
  serverId: string;
}

export interface SessionResumedEvent extends SessionRefBase {
  type: 'session.resumed';
}

export interface SessionMediaChangedEvent extends SessionRefBase {
  type: 'session.media_changed';
}

/** Still ref-shaped: Task 13a gives the two stop producers a context to carry server, user, session and durationMs. */
export interface SessionStoppedEvent extends SessionRefBase {
  type: 'session.stopped';
}

export type SessionRefEvent = SessionResumedEvent | SessionMediaChangedEvent | SessionStoppedEvent;

export interface AccountInactiveForEvent extends BaseEvent {
  type: 'account.inactive_for';
  server: EvaluationServer;
  serverUser: EvaluationServerUser;
  session: null;
}

export interface ServerDownEvent extends BaseEvent {
  type: 'server.down';
  server: EvaluationServer;
}

export interface ServerUpEvent extends BaseEvent {
  type: 'server.up';
  server: EvaluationServer;
}

export interface PluginUpdateEvent extends BaseEvent {
  type: 'plugin.update_available';
  server: EvaluationServer;
  installedVersion: string | null;
  latestVersion: string;
  downloadUrl: string;
}

export interface ServerUpdateEvent extends BaseEvent {
  type: 'server.update_available';
  server: EvaluationServer;
  installedVersion: string;
  latestVersion: string;
  releaseUrl: string;
}

export interface TracearrUpdateEvent extends BaseEvent {
  type: 'tracearr.update_available';
  current: string;
  latest: string;
  releaseUrl: string;
}

export type RuleEvent =
  | SessionStartedEvent
  | SessionTranscodeChangedEvent
  | SessionPausedEvent
  | SessionHeldForEvent
  | SessionRefEvent
  | AccountInactiveForEvent
  | ServerDownEvent
  | ServerUpEvent
  | PluginUpdateEvent
  | ServerUpdateEvent
  | TracearrUpdateEvent;

/** Distributes over the event union by member, which keeps a Subscriber<T> assignable to Subscriber<TriggerType>. */
export type EventOf<T extends TriggerType> = RuleEvent extends infer E
  ? E extends { type: TriggerType }
    ? T extends E['type']
      ? E
      : never
    : never
  : never;

/** Tick-scoped, in-process; passed alongside the event, never part of it. Arrays are by reference. */
export interface EvaluationInputs {
  activeAutomations: EngineAutomation[];
  activeSessions: Session[];
  recentSessions: Session[];
  identityServerUserIds?: string[];
}

export interface DispatchOptions {
  /** Evaluate and record inside the caller's transaction (create path). Errors propagate. */
  tx?: DbTx;
  /** Return the act step as a closure instead of running it (create path). */
  deferActions?: boolean;
}

export interface SubscriberResult {
  violations: ViolationInsertResult[];
  deferredActions?: () => Promise<ActionResult[]>;
}

export type Subscriber<T extends TriggerType> = (
  event: EventOf<T>,
  inputs: EvaluationInputs | undefined,
  opts: DispatchOptions
) => Promise<SubscriberResult | void>;

export interface SubscriberOutcome {
  subscriber: string;
  ok: boolean;
  error?: unknown;
}

export interface DispatchResult {
  violations: ViolationInsertResult[];
  deferredActions?: () => Promise<ActionResult[]>;
  outcomes: SubscriberOutcome[];
}

export type { ViolationSeverity };
