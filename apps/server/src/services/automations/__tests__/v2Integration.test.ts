/**
 * V2 Integration Tests - Rule notification dependency
 *
 * The send executor already built the event; this dep only resolves the
 * destination ids and reports how many jobs landed, so a rule whose
 * destinations are all disabled can be logged as such.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Redis } from 'ioredis';
import { automationsLogger } from '../../../utils/logger.js';
import type { NotificationEvent } from '../../notifications/events.js';

const { mockEnqueueNotification } = vi.hoisted(() => ({
  mockEnqueueNotification: vi.fn().mockResolvedValue(2),
}));

vi.mock('../../../jobs/notificationQueue.js', () => ({
  enqueueNotification: mockEnqueueNotification,
}));

vi.mock('../../../db/client.js', () => ({ db: {} }));

vi.mock('../../../jobs/poller/database.js', () => ({
  invalidateAutomationsCache: vi.fn(),
}));

vi.mock('../../userService.js', () => ({
  recomputeIdentityAggregates: vi.fn(),
}));

import { createActionExecutorDeps } from '../v2Integration.js';

const event: NotificationEvent = {
  type: 'violation',
  payload: {
    id: 'v1',
    ruleId: 'rule-1',
    serverUserId: 'su-1',
    sessionId: 'sess-1',
    severity: 'warning',
    createdAt: new Date('2026-08-17T00:00:00.000Z'),
    acknowledgedAt: null,
    data: { ruleId: 'rule-1', serverUserId: 'su-1' },
    rule: { id: 'rule-1', name: 'Sharing', type: null },
    session: undefined,
    user: {
      id: 'su-1',
      username: 'alice',
      identityName: 'Alice',
      thumbUrl: null,
      serverId: 'srv-1',
    },
  },
};

describe('createActionExecutorDeps - enqueueAutomationNotification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const source = {
    kind: 'automation',
    automationId: 'rule-1',
    automationName: 'Sharing',
    body: 'over the limit',
  } as const;

  it('hands the event straight to the queue with the destination ids and the source', async () => {
    const deps = createActionExecutorDeps({} as unknown as Redis);

    const count = await deps.enqueueAutomationNotification({ to: ['d1', 'd2'], event, source });

    expect(count).toBe(2);
    expect(mockEnqueueNotification).toHaveBeenCalledWith(event, { to: ['d1', 'd2'], source });
  });

  it('returns the queue count when nothing was enqueued and does not log an enqueue', async () => {
    mockEnqueueNotification.mockResolvedValueOnce(0);
    const info = vi.spyOn(automationsLogger, 'info');
    const deps = createActionExecutorDeps({} as unknown as Redis);

    const count = await deps.enqueueAutomationNotification({ to: ['d1'], event, source });

    expect(count).toBe(0);
    expect(info).not.toHaveBeenCalledWith(
      expect.stringMatching(/^Notification enqueued/),
      expect.anything()
    );
  });
});
