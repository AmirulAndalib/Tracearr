import { describe, expect, it } from 'vitest';
import type { Automation, TriggerNode } from '@tracearr/shared';
import {
  builderReducer,
  builderStateFrom,
  emptyBuilderState,
  toCreateInput,
  type BuilderState,
} from '../builderReducer';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function added(...types: TriggerNode['type'][]): BuilderState {
  return types.reduce(
    (state, triggerType) => builderReducer(state, { type: 'addTrigger', triggerType }),
    emptyBuilderState()
  );
}

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'a1',
    name: 'Stored',
    description: 'kept',
    kind: 'notification',
    severity: null,
    triggers: [
      { id: '11111111-1111-4111-8111-111111111111', type: 'session.started', enabled: true },
    ],
    conditions: { groups: [] },
    actions: { actions: [] },
    serverId: null,
    serverUserId: null,
    userId: null,
    enforceAcrossServers: false,
    isActive: true,
    cooldownMinutes: null,
    retentionDays: null,
    scopeRef: null,
    template: null,
    origin: null,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('builderReducer triggers', () => {
  it('stamps a new trigger with an id and switches it on', () => {
    const state = added('session.started');

    expect(state.triggers).toHaveLength(1);
    expect(state.triggers[0]?.id).toMatch(UUID);
    expect(state.triggers[0]?.enabled).toBe(true);
    expect(state.dirty).toBe(true);
  });

  it('gives the two parameterised triggers their defaults', () => {
    const state = added('session.held_for', 'account.inactive_for');

    expect(state.triggers[0]).toMatchObject({
      type: 'session.held_for',
      params: { minutes: 30, measure: 'current' },
    });
    expect(state.triggers[1]).toMatchObject({
      type: 'account.inactive_for',
      params: { days: 30 },
    });
  });

  it('patches one held_for param and leaves the other alone', () => {
    const state = added('session.held_for');
    const id = state.triggers[0]?.id ?? '';

    const next = builderReducer(state, { type: 'setTriggerParam', id, patch: { minutes: 90 } });

    expect(next.triggers[0]).toMatchObject({ params: { minutes: 90, measure: 'current' } });

    const measured = builderReducer(next, {
      type: 'setTriggerParam',
      id,
      patch: { measure: 'total' },
    });

    expect(measured.triggers[0]).toMatchObject({ params: { minutes: 90, measure: 'total' } });
  });
});

describe('builderReducer nodes', () => {
  it('toggles a trigger by id', () => {
    const state = added('session.started');
    const id = state.triggers[0]?.id ?? '';

    expect(builderReducer(state, { type: 'toggleNode', id }).triggers[0]?.enabled).toBe(false);
  });

  it('removes a trigger by id and leaves its neighbour', () => {
    const state = added('session.started', 'session.paused');
    const id = state.triggers[0]?.id ?? '';

    const next = builderReducer(state, { type: 'removeNode', id });

    expect(next.triggers.map((trigger) => trigger.type)).toEqual(['session.paused']);
  });

  it('reaches a condition row nested in an if branch', () => {
    const loaded = builderStateFrom(
      automation({
        actions: {
          actions: [
            {
              id: 'if-1',
              type: 'if',
              conditions: {
                groups: [
                  {
                    id: 'g-1',
                    conditions: [{ id: 'c-1', field: 'trust_score', operator: 'lt', value: 50 }],
                  },
                ],
              },
              then: [{ id: 'kill-1', type: 'kill_stream' }],
              else: [],
            },
          ],
        },
      })
    );

    const toggled = builderReducer(loaded, { type: 'toggleNode', id: 'c-1' });
    const branch = toggled.actions.actions[0];

    expect(branch?.type === 'if' && branch.conditions.groups[0]?.conditions[0]?.enabled).toBe(
      false
    );

    const removed = builderReducer(loaded, { type: 'removeNode', id: 'kill-1' });
    const after = removed.actions.actions[0];

    expect(after?.type === 'if' && after.then).toEqual([]);
  });
});

describe('builderReducer lifecycle', () => {
  it('starts clean, dirties on a change and comes back clean on load', () => {
    expect(emptyBuilderState().dirty).toBe(false);

    const typed = builderReducer(emptyBuilderState(), { type: 'setName', value: 'Nightly' });
    expect(typed.dirty).toBe(true);

    const loaded = builderReducer(typed, { type: 'load', automation: automation() });
    expect(loaded.dirty).toBe(false);
    expect(loaded.name).toBe('Stored');
  });

  it('clears dirty once saved', () => {
    const typed = builderReducer(emptyBuilderState(), { type: 'setName', value: 'Nightly' });

    expect(builderReducer(typed, { type: 'saved' }).dirty).toBe(false);
  });
});

describe('toCreateInput', () => {
  it('carries the triggers and hands back conditions and actions untouched', () => {
    const stored = automation({
      conditions: {
        groups: [
          {
            id: 'g-1',
            conditions: [{ id: 'c-1', field: 'trust_score', operator: 'lt', value: 50 }],
          },
        ],
      },
      actions: { actions: [{ id: 'send-1', type: 'send', to: ['d1'] }] },
    });
    const state = builderStateFrom(stored);

    const input = toCreateInput(state);

    expect(input.triggers).toEqual(stored.triggers);
    expect(input.conditions).toEqual(stored.conditions);
    expect(input.actions).toEqual(stored.actions);
    expect(input.description).toBe('kept');
  });

  it('drops the severity a notification never uses', () => {
    const state = builderReducer(emptyBuilderState(), { type: 'setKind', value: 'notification' });

    expect(toCreateInput(state).severity).toBeNull();
    expect(
      toCreateInput(builderReducer(state, { type: 'setKind', value: 'policy' })).severity
    ).toBe('warning');
  });
});
