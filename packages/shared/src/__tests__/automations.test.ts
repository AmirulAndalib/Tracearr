import { describe, expect, it } from 'vitest';
import {
  AUTOMATION_KINDS,
  TRIGGER_TYPES,
  actionSchema,
  actionTypeSchema,
  createAutomationSchema,
  triggerNodeSchema,
  trustActionSchema,
  updateAutomationSchema,
} from '../index.js';

const conditions = {
  groups: [{ conditions: [{ field: 'is_transcoding', operator: 'eq', value: true }] }],
};

describe('trust action', () => {
  it('pairs mode with its parameter', () => {
    expect(
      trustActionSchema.safeParse({ type: 'trust', mode: 'adjust', amount: -10 }).success
    ).toBe(true);
    expect(trustActionSchema.safeParse({ type: 'trust', mode: 'set', value: 50 }).success).toBe(
      true
    );
    expect(trustActionSchema.safeParse({ type: 'trust', mode: 'reset' }).success).toBe(true);
    expect(trustActionSchema.safeParse({ type: 'trust', mode: 'adjust' }).success).toBe(false);
    expect(trustActionSchema.safeParse({ type: 'trust', mode: 'set' }).success).toBe(false);
    expect(trustActionSchema.safeParse({ type: 'trust', mode: 'reset', amount: 5 }).success).toBe(
      false
    );
    expect(trustActionSchema.safeParse({ type: 'trust', mode: 'adjust', value: 5 }).success).toBe(
      false
    );
    expect(trustActionSchema.safeParse({ type: 'trust', mode: 'set', amount: 5 }).success).toBe(
      false
    );
  });

  it('joins the action union alongside the trio', () => {
    expect(actionTypeSchema.safeParse('trust').success).toBe(true);
    expect(actionSchema.safeParse({ type: 'trust', mode: 'reset' }).success).toBe(true);
    expect(actionSchema.safeParse({ type: 'adjust_trust', amount: -10 }).success).toBe(true);
  });

  it('the union rejects a mismatched mode and parameter', () => {
    expect(actionSchema.safeParse({ type: 'trust', mode: 'set', amount: 5 }).success).toBe(false);
    expect(actionSchema.safeParse({ type: 'trust', mode: 'adjust' }).success).toBe(false);
  });
});

describe('automation payloads', () => {
  it('kind is closed and triggers are typed nodes', () => {
    expect(AUTOMATION_KINDS).toEqual(['policy', 'notification']);
    expect(TRIGGER_TYPES).toEqual([
      'session.started',
      'session.transcode_changed',
      'session.paused',
      'session.held_for',
      'account.inactive_for',
    ]);
    expect(
      triggerNodeSchema.safeParse({
        id: '3f2c8f0e-1c4d-4c1a-9c2e-6f0b6f5c9a11',
        type: 'session.started',
        enabled: true,
      }).success
    ).toBe(true);
    expect(triggerNodeSchema.safeParse({ id: 'x', type: 'nope', enabled: true }).success).toBe(
      false
    );
  });

  it('create requires name/kind/conditions/actions; update is partial', () => {
    const base = {
      name: 'kill long pauses',
      kind: 'notification',
      severity: null,
      conditions,
      actions: { actions: [] },
    };
    expect(createAutomationSchema.safeParse(base).success).toBe(true);
    expect(updateAutomationSchema.safeParse({ isActive: false }).success).toBe(true);
    expect(createAutomationSchema.safeParse({ ...base, kind: 'other' }).success).toBe(false);
    expect(createAutomationSchema.safeParse({ ...base, name: '' }).success).toBe(false);
    const { conditions: _dropped, ...withoutConditions } = base;
    expect(createAutomationSchema.safeParse(withoutConditions).success).toBe(false);
  });

  it('takes at most one scope', () => {
    const base = {
      name: 'one scope only',
      kind: 'policy',
      severity: 'warning',
      conditions,
      actions: { actions: [{ type: 'trust', mode: 'adjust', amount: -5 }] },
    };
    const serverId = '3f2c8f0e-1c4d-4c1a-9c2e-6f0b6f5c9a11';
    const userId = '5a1d9b2c-7e3f-4a8b-9c0d-1e2f3a4b5c6d';
    expect(createAutomationSchema.safeParse({ ...base, serverId }).success).toBe(true);
    expect(createAutomationSchema.safeParse({ ...base, serverId, userId }).success).toBe(false);
    expect(updateAutomationSchema.safeParse({ serverId, userId }).success).toBe(false);
  });

  it('a server-scoped automation cannot enforce across servers', () => {
    const serverId = '3f2c8f0e-1c4d-4c1a-9c2e-6f0b6f5c9a11';
    const base = {
      name: 'scoped',
      kind: 'policy',
      severity: 'warning',
      conditions,
      actions: { actions: [] },
    };
    expect(
      createAutomationSchema.safeParse({ ...base, serverId, enforceAcrossServers: true }).success
    ).toBe(false);
    expect(
      createAutomationSchema.safeParse({ ...base, serverId, enforceAcrossServers: false }).success
    ).toBe(true);
  });
});
