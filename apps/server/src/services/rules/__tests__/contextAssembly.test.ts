import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActiveSession, RuleV2, Session } from '@tracearr/shared';

const mockGetIdentityServerUserIds = vi.fn();
vi.mock('../../userService.js', () => ({
  getIdentityServerUserIds: (...args: unknown[]) => mockGetIdentityServerUserIds(...args),
}));

const mockBatchGetRecentUserSessions = vi.fn();
const mockMergeRecentSessionsForIdentity = vi.fn();
vi.mock('../../../jobs/poller/database.js', () => ({
  batchGetRecentUserSessions: (...args: unknown[]) => mockBatchGetRecentUserSessions(...args),
  mergeRecentSessionsForIdentity: (...args: unknown[]) =>
    mockMergeRecentSessionsForIdentity(...args),
  maxWindowHoursFromRules: (rules: RuleV2[]) => (rules.length > 0 ? 72 : 24),
}));

vi.mock('../../../utils/logger.js', () => ({
  rulesLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  assembleEvaluationInputs,
  setContextAssemblyDeps,
  toRuleServer,
  toRuleServerUser,
} from '../events/contextAssembly.js';

const server = { id: 'srv1', name: 'Plex', type: 'plex' as const };
const serverUser = {
  id: 'su1',
  userId: 'u1',
  username: 'connor',
  thumbUrl: null,
  identityName: 'Connor',
  trustScore: 90,
  lastActivityAt: null,
  createdAt: new Date('2026-01-01'),
  identityServerUserIds: ['su1'],
};

function session(id: string, overrides: Partial<Session> = {}): ActiveSession {
  return {
    id,
    serverId: 'srv1',
    serverUserId: 'su1',
    state: 'playing',
    ...overrides,
  } as ActiveSession;
}

describe('toRuleServer / toRuleServerUser', () => {
  it('builds the evaluator-shaped Server with placeholders where nothing evaluates', () => {
    const s = toRuleServer(server);
    expect(s).toMatchObject({ id: 'srv1', name: 'Plex', type: 'plex', url: '' });
  });

  it('builds the evaluator-shaped ServerUser carrying the fields evaluators read', () => {
    const su = toRuleServerUser(serverUser, 'srv1');
    expect(su).toMatchObject({
      id: 'su1',
      userId: 'u1',
      serverId: 'srv1',
      username: 'connor',
      trustScore: 90,
      lastActivityAt: null,
      identityName: 'Connor',
      externalId: '',
      isServerAdmin: false,
    });
    expect(su.createdAt).toEqual(new Date('2026-01-01'));
  });
});

describe('assembleEvaluationInputs', () => {
  const graceIds = new Set<string>();
  const cached: ActiveSession[] = [];

  beforeEach(() => {
    vi.clearAllMocks();
    graceIds.clear();
    cached.length = 0;
    setContextAssemblyDeps({
      getAllActiveSessions: async () => cached,
      gracePeriodSessionIds: () => graceIds,
    });
    mockGetIdentityServerUserIds.mockResolvedValue(['su1', 'su2']);
    mockBatchGetRecentUserSessions.mockResolvedValue(new Map([['su1', []]]));
    mockMergeRecentSessionsForIdentity.mockReturnValue([session('old')]);
  });

  it('short-circuits with empty arrays when there are no rules', async () => {
    const result = await assembleEvaluationInputs({ rules: [], server, serverUser });
    expect(result).toEqual({
      activeRulesV2: [],
      activeSessions: [],
      recentSessions: [],
      identityServerUserIds: serverUser.identityServerUserIds,
    });
    expect(mockGetIdentityServerUserIds).not.toHaveBeenCalled();
    expect(mockBatchGetRecentUserSessions).not.toHaveBeenCalled();
  });

  it('filters grace-flagged sessions, resolves identity, and fetches recent with the rules window', async () => {
    cached.push(session('a'), session('b'));
    graceIds.add('b');
    const rules = [{ id: 'r1' } as RuleV2];

    const result = await assembleEvaluationInputs({ rules, server, serverUser });

    expect(result.activeRulesV2).toBe(rules);
    expect(result.activeSessions.map((s) => s.id)).toEqual(['a']);
    expect(mockGetIdentityServerUserIds).toHaveBeenCalledWith('u1');
    expect(result.identityServerUserIds).toEqual(['su1', 'su2']);
    expect(mockBatchGetRecentUserSessions).toHaveBeenCalledWith(['su1', 'su2'], 72);
    expect(result.recentSessions.map((s) => s.id)).toEqual(['old']);
  });

  it('falls back to this server user only when identity or recent lookups fail', async () => {
    cached.push(session('a'));
    mockGetIdentityServerUserIds.mockRejectedValueOnce(new Error('db down'));
    mockBatchGetRecentUserSessions
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce(new Map([['su1', [session('mine')]]]));

    const result = await assembleEvaluationInputs({
      rules: [{ id: 'r1' } as RuleV2],
      server,
      serverUser,
    });

    expect(result.identityServerUserIds).toEqual(['su1']);
    expect(mockBatchGetRecentUserSessions).toHaveBeenLastCalledWith(['su1'], 72);
    expect(result.recentSessions.map((s) => s.id)).toEqual(['mine']);
  });
});
