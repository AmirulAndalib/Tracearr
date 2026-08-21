import { describe, expect, it, vi } from 'vitest';
import type {
  ConditionField,
  AutomationConditions,
  EngineAutomation,
  Session,
  TriggerNode,
} from '@tracearr/shared';
import type {
  AccountInactiveForEvent,
  EvaluationInputs,
  SessionPausedEvent,
  SessionStartedEvent,
  SessionTranscodeChangedEvent,
  TriggerType,
} from '../events/types.js';

vi.mock('../../../utils/logger.js', () => ({
  rulesLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { synthesizeTriggers } from '../triggers.js';
import { matchesTrigger, rulesForTrigger, triggerCandidates } from '../events/evaluate.js';

/** A rule the boot migration would have produced from these conditions. */
function rule(id: string, ...fields: ConditionField[]): EngineAutomation {
  const conditions: AutomationConditions = {
    groups: fields.map((field) => ({ conditions: [{ field, operator: 'gte', value: 1 }] })),
  };
  return {
    id,
    name: id,
    isActive: true,
    severity: 'warning',
    conditions,
    actions: { actions: [] },
    triggers: synthesizeTriggers(conditions),
  } as unknown as EngineAutomation;
}

const transcodeRule = rule('t', 'is_transcoding');
const pauseRule = rule('p', 'current_pause_minutes');
const concurrentRule = rule('c', 'concurrent_streams');
const inactivityRule = rule('i', 'inactive_days');
const all = [transcodeRule, pauseRule, concurrentRule, inactivityRule];

const server = { id: 'srv1', name: 'S', type: 'plex' as const };
const serverUser = {
  id: 'su1',
  userId: 'u1',
  username: 'x',
  thumbUrl: null,
  identityName: null,
  trustScore: 100,
  lastActivityAt: null,
  createdAt: new Date(),
  identityServerUserIds: ['su1'],
};
const session = { id: 's1', serverId: 'srv1', serverUserId: 'su1', state: 'playing' } as Session;

describe('rulesForTrigger', () => {
  it('session.started evaluates every rule except inactivity rules', () => {
    expect(rulesForTrigger('session.started', all).map((r) => r.id)).toEqual(['t', 'p', 'c']);
  });
  it('account.inactive_for evaluates only inactivity rules', () => {
    expect(rulesForTrigger('account.inactive_for', all).map((r) => r.id)).toEqual(['i']);
  });
  it('transcode_changed evaluates only transcode rules', () => {
    expect(rulesForTrigger('session.transcode_changed', all).map((r) => r.id)).toEqual(['t']);
  });
  it('paused and held_for evaluate only pause rules', () => {
    expect(rulesForTrigger('session.paused', all).map((r) => r.id)).toEqual(['p']);
    expect(rulesForTrigger('session.held_for', all).map((r) => r.id)).toEqual(['p']);
  });
  it('cancel-only triggers evaluate nothing', () => {
    expect(rulesForTrigger('session.stopped', all)).toEqual([]);
  });

  it('skips a disabled trigger node', () => {
    const disabled = {
      ...transcodeRule,
      triggers: (transcodeRule.triggers ?? []).map((node) =>
        node.type === 'session.transcode_changed' ? { ...node, enabled: false } : node
      ),
    };
    expect(rulesForTrigger('session.transcode_changed', [disabled])).toEqual([]);
    expect(rulesForTrigger('session.started', [disabled]).map((r) => r.id)).toEqual(['t']);
  });

  it('matches nothing for an empty trigger list', () => {
    const empty = { ...transcodeRule, triggers: [] };
    for (const trigger of [
      'session.started',
      'session.transcode_changed',
      'session.paused',
      'session.held_for',
      'account.inactive_for',
    ] as const) {
      expect(rulesForTrigger(trigger, [empty])).toEqual([]);
    }
  });

  it('ignores a stored node whose type is not the event', () => {
    expect(matchesTrigger({ triggers: synthesizeTriggers(null) }, 'session.paused')).toBe(false);
    expect(matchesTrigger({ triggers: synthesizeTriggers(null) }, 'session.started')).toBe(true);
  });
});

/** Pins trigger matching against what synthesis stores for each corpus shape. */
describe('stored triggers match the synthesized routing per corpus shape', () => {
  const EVALUATING: TriggerType[] = [
    'session.started',
    'session.transcode_changed',
    'session.paused',
    'session.held_for',
    'account.inactive_for',
  ];

  const corpus: { name: string; fields: ConditionField[]; expected: TriggerType[] }[] = [
    {
      name: 'transcode-only',
      fields: ['is_transcoding'],
      expected: ['session.started', 'session.transcode_changed'],
    },
    {
      name: 'pause-only',
      fields: ['total_pause_minutes'],
      expected: ['session.started', 'session.paused', 'session.held_for'],
    },
    { name: 'inactive-only', fields: ['inactive_days'], expected: ['account.inactive_for'] },
    {
      name: 'mixed inactive and pause',
      fields: ['inactive_days', 'current_pause_minutes'],
      expected: ['session.paused', 'session.held_for', 'account.inactive_for'],
    },
    {
      name: 'mixed inactive and transcode',
      fields: ['inactive_days', 'output_resolution'],
      expected: ['session.transcode_changed', 'account.inactive_for'],
    },
    { name: 'account-attribute-only', fields: ['trust_score'], expected: ['session.started'] },
    { name: 'plain session rule', fields: ['concurrent_streams'], expected: ['session.started'] },
  ];

  it.each(corpus)('$name', ({ fields, expected }) => {
    const migrated = rule('r', ...fields);
    const matched = EVALUATING.filter((trigger) => rulesForTrigger(trigger, [migrated]).length > 0);
    expect(matched).toEqual(EVALUATING.filter((trigger) => expected.includes(trigger)));
  });
});

describe('triggerCandidates', () => {
  it('builds the context around the event session and appends it to activeSessions by reference', () => {
    const other = { id: 's2', serverId: 'srv1', serverUserId: 'su1', state: 'playing' } as Session;
    const inputs: EvaluationInputs = {
      activeAutomations: all,
      activeSessions: [other],
      recentSessions: [],
      identityServerUserIds: ['su1', 'su2'],
    };
    const event: SessionTranscodeChangedEvent = {
      type: 'session.transcode_changed',
      at: new Date(),
      server,
      serverUser,
      session,
      previous: { videoDecision: 'directplay', audioDecision: 'directplay' },
      next: { videoDecision: 'transcode', audioDecision: 'copy' },
    };

    const { rules, baseContext } = triggerCandidates(event, inputs);

    expect(rules.map((r) => r.id)).toEqual(['t']);
    expect(baseContext.session).toBe(session);
    expect(baseContext.activeSessions).toHaveLength(2);
    expect(baseContext.activeSessions[1]).toBe(session);
    expect(baseContext.identityServerUserIds).toEqual(['su1', 'su2']);
    expect(baseContext.server).toMatchObject({ id: 'srv1', type: 'plex' });
    expect(baseContext.serverUser).toMatchObject({ id: 'su1', userId: 'u1' });
  });

  it('does not double-append when the session is already in activeSessions', () => {
    const inputs: EvaluationInputs = {
      activeAutomations: all,
      activeSessions: [session],
      recentSessions: [],
    };
    const event: SessionPausedEvent = {
      type: 'session.paused',
      at: new Date(),
      server,
      serverUser,
      session,
      pauseData: { lastPausedAt: new Date(), pausedDurationMs: 0 },
    };
    const { baseContext } = triggerCandidates(event, inputs);
    expect(baseContext.activeSessions).toHaveLength(1);
  });

  it('builds a session-less context for account.inactive_for and leaves activeSessions alone', () => {
    const other = { id: 's2', serverId: 'srv1', serverUserId: 'su1', state: 'playing' } as Session;
    const inputs: EvaluationInputs = {
      activeAutomations: all,
      activeSessions: [other],
      recentSessions: [],
    };
    const event: AccountInactiveForEvent = {
      type: 'account.inactive_for',
      at: new Date(),
      server,
      serverUser,
      session: null,
    };

    const { rules, baseContext } = triggerCandidates(event, inputs);

    expect(rules.map((r) => r.id)).toEqual(['i']);
    expect(baseContext.session).toBeNull();
    expect(baseContext.activeSessions).toBe(inputs.activeSessions);
  });

  it('returns no candidates when no rule matches the trigger', () => {
    const inputs: EvaluationInputs = {
      activeAutomations: [concurrentRule],
      activeSessions: [],
      recentSessions: [],
    };
    const event: SessionPausedEvent = {
      type: 'session.paused',
      at: new Date(),
      server,
      serverUser,
      session,
      pauseData: { lastPausedAt: new Date(), pausedDurationMs: 0 },
    };
    expect(triggerCandidates(event, inputs).rules).toEqual([]);
  });

  it('drops rules the scope filters exclude before anything is evaluated', () => {
    const inputs: EvaluationInputs = {
      activeAutomations: [
        { ...concurrentRule, id: 'inactive', isActive: false },
        { ...concurrentRule, id: 'other-server', serverId: 'srv2' },
        { ...concurrentRule, id: 'other-account', serverUserId: 'su9' },
        { ...concurrentRule, id: 'other-identity', userId: 'u9' },
        concurrentRule,
      ],
      activeSessions: [],
      recentSessions: [],
    };
    const event: SessionStartedEvent = {
      type: 'session.started',
      at: new Date(),
      server,
      serverUser,
      session,
    };

    expect(triggerCandidates(event, inputs).rules.map((r) => r.id)).toEqual(['c']);
  });
});

describe('trigger matching does not read conditions', () => {
  it('a rule whose stored triggers disagree with its conditions follows the triggers', () => {
    const handWritten: TriggerNode[] = [
      { id: '0f5b8d4a-9c6e-4a2b-8d1f-3c7e5a9b1d20', type: 'session.paused', enabled: true },
    ];
    const mislabelled = { ...transcodeRule, triggers: handWritten };
    expect(rulesForTrigger('session.paused', [mislabelled]).map((r) => r.id)).toEqual(['t']);
    expect(rulesForTrigger('session.transcode_changed', [mislabelled])).toEqual([]);
    expect(rulesForTrigger('session.started', [mislabelled])).toEqual([]);
  });
});
