import type { ActiveSession, RuleV2, Server, ServerUser, Session } from '@tracearr/shared';
import {
  batchGetRecentUserSessions,
  maxWindowHoursFromRules,
  mergeRecentSessionsForIdentity,
} from '../../../jobs/poller/database.js';
import { excludeUncountableSessions } from '../../../jobs/poller/utils.js';
import { rulesLogger } from '../../../utils/logger.js';
import { getIdentityServerUserIds } from '../../userService.js';
import type { EvaluationInputs, EvaluationServer, EvaluationServerUser } from './types.js';

export interface ContextAssemblyDeps {
  getAllActiveSessions: () => Promise<ActiveSession[]>;
  gracePeriodSessionIds: () => Set<string>;
}

let deps: ContextAssemblyDeps | null = null;

/** Wired by initializePoller: the active-session cache and the poller's grace map are producer state. */
export function setContextAssemblyDeps(next: ContextAssemblyDeps): void {
  deps = next;
}

export function toRuleServer(server: EvaluationServer): Server {
  return {
    id: server.id,
    name: server.name,
    type: server.type,
    url: '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

export function toRuleServerUser(serverUser: EvaluationServerUser, serverId: string): ServerUser {
  return {
    id: serverUser.id,
    userId: serverUser.userId,
    serverId,
    externalId: '',
    username: serverUser.username,
    email: null,
    thumbUrl: serverUser.thumbUrl,
    isServerAdmin: false,
    trustScore: serverUser.trustScore,
    joinedAt: null,
    lastActivityAt: serverUser.lastActivityAt,
    createdAt: serverUser.createdAt,
    removedAt: null,
    updatedAt: new Date(),
    identityName: serverUser.identityName,
  };
}

/**
 * The SSE processor and the wake scheduler have no tick; this builds the same
 * inputs the poller carries per tick. Failed identity/recent lookups degrade to
 * this server_user only, so a transient DB error narrows detection instead of
 * blocking the event.
 */
export async function assembleEvaluationInputs(args: {
  rules: RuleV2[];
  server: EvaluationServer;
  serverUser: EvaluationServerUser;
}): Promise<EvaluationInputs> {
  const { rules, serverUser } = args;
  if (rules.length === 0) {
    return {
      activeRulesV2: rules,
      activeSessions: [],
      recentSessions: [],
      identityServerUserIds: serverUser.identityServerUserIds,
    };
  }
  if (!deps) throw new Error('setContextAssemblyDeps has not been called');

  const activeSessions = excludeUncountableSessions(
    await deps.getAllActiveSessions(),
    deps.gracePeriodSessionIds()
  );

  let identityServerUserIds: string[];
  try {
    identityServerUserIds = await getIdentityServerUserIds(serverUser.userId);
  } catch (error) {
    rulesLogger.error('Failed to resolve identity server users, evaluating this server only', {
      serverUserId: serverUser.id,
      error,
    });
    identityServerUserIds = [serverUser.id];
  }

  const windowHours = maxWindowHoursFromRules(rules);
  const ids = identityServerUserIds.length > 1 ? identityServerUserIds : [serverUser.id];
  let recentSessions: Session[];
  try {
    const recentMap = await batchGetRecentUserSessions(ids, windowHours);
    recentSessions = mergeRecentSessionsForIdentity(recentMap, ids);
  } catch (error) {
    rulesLogger.error('Failed to fetch recent sessions, falling back to this server only', {
      serverUserId: serverUser.id,
      error,
    });
    const fallback = await batchGetRecentUserSessions([serverUser.id], windowHours);
    recentSessions = fallback.get(serverUser.id) ?? [];
  }

  return { activeRulesV2: rules, activeSessions, recentSessions, identityServerUserIds };
}
