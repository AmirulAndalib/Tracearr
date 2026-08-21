/**
 * Violation Handling
 *
 * Broadcasting for violations created inside session lifecycle transactions.
 */

import { eq } from 'drizzle-orm';
import type { Rule, RunFinishedEvent, ViolationWithDetails, RuleType } from '@tracearr/shared';
import { WS_EVENTS } from '@tracearr/shared';
import { db } from '../../db/client.js';
import { servers, serverUsers, sessions, users } from '../../db/schema.js';
import type { automationRuns } from '../../db/schema.js';
import { publishRunFinished, runFinishedOf } from '../../services/automations/runRecorder.js';
import type { PubSubService } from '../../services/cache.js';
import { enqueueNotification } from '../notificationQueue.js';

// ============================================================================
// Transaction-Aware Violation Creation
// ============================================================================

/**
 * Minimal rule info needed for violation broadcasting.
 * Supports both V1 (legacy) and V2 rules.
 */
export interface ViolationRuleInfo {
  id: string;
  name: string;
  type: RuleType | null; // null for V2 rules
}

/**
 * Result of creating a violation within a transaction.
 * Contains data needed for post-transaction broadcasting.
 */
export interface ViolationInsertResult {
  violation: typeof automationRuns.$inferSelect;
  rule: Rule | ViolationRuleInfo;
}

/**
 * Broadcast violation events after transaction has committed.
 * Call this AFTER the transaction to ensure data is persisted before broadcasting.
 *
 * @param violationResults - Array of violation insert results
 * @param subject - Session id, or { serverUserId } for violations that have no session
 * @param pubSubService - PubSub service for WebSocket broadcast
 */
export async function broadcastViolations(
  violationResults: ViolationInsertResult[],
  subject: string | { serverUserId: string },
  pubSubService: Pick<PubSubService, 'publish'> | null
): Promise<void> {
  if (!pubSubService || violationResults.length === 0) return;

  const detailFields = {
    userId: serverUsers.id,
    identityUserId: users.id,
    username: serverUsers.username,
    thumbUrl: serverUsers.thumbUrl,
    identityName: users.name,
    serverId: servers.id,
    serverName: servers.name,
    serverType: servers.type,
  };
  const [details] =
    typeof subject === 'string'
      ? await db
          .select(detailFields)
          .from(sessions)
          .innerJoin(serverUsers, eq(serverUsers.id, sessions.serverUserId))
          .innerJoin(users, eq(serverUsers.userId, users.id))
          .innerJoin(servers, eq(servers.id, sessions.serverId))
          .where(eq(sessions.id, subject))
          .limit(1)
      : await db
          .select(detailFields)
          .from(serverUsers)
          .innerJoin(users, eq(serverUsers.userId, users.id))
          .innerJoin(servers, eq(servers.id, serverUsers.serverId))
          .where(eq(serverUsers.id, subject.serverUserId))
          .limit(1);

  if (!details) return;

  const finished: RunFinishedEvent[] = [];
  for (const { violation, rule } of violationResults) {
    // Get rule type - null for V2 rules
    const ruleType = 'type' in rule ? rule.type : null;

    const violationWithDetails: ViolationWithDetails = {
      id: violation.id,
      ruleId: violation.automationId,
      // Policy runs always carry both; details.userId is the same server user.
      serverUserId: violation.serverUserId ?? details.userId,
      sessionId: violation.sessionId,
      severity: violation.severity ?? 'warning',
      data: violation.data,
      acknowledgedAt: violation.acknowledgedAt,
      createdAt: violation.createdAt,
      user: {
        id: details.userId,
        userId: details.identityUserId,
        username: details.username,
        thumbUrl: details.thumbUrl,
        serverId: details.serverId,
        identityName: details.identityName,
      },
      rule: {
        id: rule.id,
        name: rule.name,
        type: ruleType,
      },
      server: {
        id: details.serverId,
        name: details.serverName,
        type: details.serverType,
      },
    };

    await pubSubService.publish(WS_EVENTS.VIOLATION_NEW, violationWithDetails);
    finished.push(runFinishedOf(violation));
    console.log(`[Poller] Violation broadcast: ${rule.name} for user ${details.username}`);

    // Enqueue notification for async dispatch (Discord, webhooks, push)
    await enqueueNotification({ type: 'violation', payload: violationWithDetails });
  }

  await publishRunFinished(finished, pubSubService);
}
