import type { EngineAutomation, Session } from '@tracearr/shared';
import { getActiveAutomations } from '../../../jobs/poller/database.js';
import { automationsLogger } from '../../../utils/logger.js';
import {
  installInputs,
  loadEvaluationContext,
  loadServerContext,
  serverContextFor,
} from './contextAssembly.js';
import { dispatch } from './dispatcher.js';
import { matchesTrigger } from './evaluate.js';
import type { EvaluationServer, SessionStopReason, TriggerType } from './types.js';

/** The active automations when one of them listens for the trigger, else null: no listener, no context read. */
async function listeningRules(trigger: TriggerType): Promise<EngineAutomation[] | null> {
  const rules = await getActiveAutomations();
  return rules.some((rule) => matchesTrigger(rule, trigger)) ? rules : null;
}

/**
 * The same, narrowed to what a user-less event on this server can run: an automation
 * scoped to another server, to an account or to a person never applies to it.
 */
async function serverListeningRules(
  trigger: TriggerType,
  serverId: string
): Promise<EngineAutomation[] | null> {
  const rules = await getActiveAutomations();
  const scoped = rules.filter(
    (rule) =>
      matchesTrigger(rule, trigger) &&
      !rule.serverUserId &&
      !rule.userId &&
      (!rule.serverId || rule.serverId === serverId)
  );
  return scoped.length > 0 ? scoped : null;
}

/** Producers run after the write they announce, so a failed read must not unwind the caller. */
async function guarded(trigger: TriggerType, run: () => Promise<void>): Promise<void> {
  try {
    await run();
  } catch (error) {
    automationsLogger.error('Trigger dispatch failed', { trigger, error });
  }
}

/**
 * Every stop cancels its pause wake through the ref event; only a listening automation
 * pays for the account context, and only a stop that ended the stream evaluates at all.
 */
export async function dispatchSessionStopped(
  session: Session,
  durationMs: number,
  at: Date,
  reason: SessionStopReason = 'ended'
): Promise<void> {
  await guarded('session.stopped', async () => {
    await dispatch({
      type: 'session.ended',
      at,
      sessionId: session.id,
      serverId: session.serverId,
    });
    if (reason !== 'ended') return;
    const rules = await listeningRules('session.stopped');
    if (!rules) return;
    const context = await loadEvaluationContext(session.serverId, session.serverUserId, rules);
    if (!context) return;
    await dispatch(
      {
        type: 'session.stopped',
        at,
        server: context.server,
        serverUser: context.serverUser,
        session,
        durationMs,
      },
      context.inputs
    );
  });
}

/** The poller holds the server row its health check just flipped. */
export async function dispatchServerHealth(
  type: 'server.down' | 'server.up',
  server: EvaluationServer,
  at: Date
): Promise<void> {
  await guarded(type, async () => {
    const rules = await serverListeningRules(type, server.id);
    if (!rules) return;
    const { inputs } = await serverContextFor(server, rules);
    await dispatch({ type, at, server }, inputs);
  });
}

/** The SSE fallback holds only an id, and its down timer fires long after the row was read. */
export async function dispatchServerHealthById(
  type: 'server.down' | 'server.up',
  serverId: string,
  at: Date
): Promise<void> {
  await guarded(type, async () => {
    const rules = await serverListeningRules(type, serverId);
    if (!rules) return;
    const context = await loadServerContext(serverId, rules);
    if (!context) return;
    await dispatch({ type, at, server: context.server }, context.inputs);
  });
}

export async function dispatchPluginUpdate(args: {
  server: EvaluationServer;
  installedVersion: string | null;
  latestVersion: string;
  downloadUrl: string;
}): Promise<void> {
  await guarded('plugin.update_available', async () => {
    const rules = await serverListeningRules('plugin.update_available', args.server.id);
    if (!rules) return;
    const { inputs } = await serverContextFor(args.server, rules);
    await dispatch({ type: 'plugin.update_available', at: new Date(), ...args }, inputs);
  });
}

export async function dispatchServerUpdate(args: {
  server: EvaluationServer;
  installedVersion: string;
  latestVersion: string;
  releaseUrl: string;
}): Promise<void> {
  await guarded('server.update_available', async () => {
    const rules = await serverListeningRules('server.update_available', args.server.id);
    if (!rules) return;
    const { inputs } = await serverContextFor(args.server, rules);
    await dispatch({ type: 'server.update_available', at: new Date(), ...args }, inputs);
  });
}

export async function dispatchTracearrUpdate(args: {
  current: string;
  latest: string;
  releaseUrl: string;
}): Promise<void> {
  await guarded('tracearr.update_available', async () => {
    const rules = await listeningRules('tracearr.update_available');
    if (!rules) return;
    await dispatch(
      { type: 'tracearr.update_available', at: new Date(), ...args },
      installInputs(rules)
    );
  });
}
