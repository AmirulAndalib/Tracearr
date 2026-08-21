import { describe, expect, it } from 'vitest';
import {
  TRIGGERS,
  TRIGGER_CONTEXT_RANK,
  TRIGGER_TYPES,
  contextOf,
  variablesFor,
} from '../index.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const started = { id: id(1), type: 'session.started', enabled: true } as const;
const down = { id: id(2), type: 'server.down', enabled: true } as const;

describe('trigger contexts', () => {
  it('ranks the contexts from the narrowest subject to the whole install', () => {
    expect(TRIGGER_CONTEXT_RANK.session).toBeGreaterThan(TRIGGER_CONTEXT_RANK.account);
    expect(TRIGGER_CONTEXT_RANK.account).toBeGreaterThan(TRIGGER_CONTEXT_RANK.server);
    expect(TRIGGER_CONTEXT_RANK.server).toBeGreaterThan(TRIGGER_CONTEXT_RANK.install);
  });

  it('lists every catalog key', () => {
    expect(TRIGGER_TYPES).toEqual(Object.keys(TRIGGERS));
  });

  it('ignores disabled triggers', () => {
    expect(contextOf([started, { ...down, enabled: false }])).toBe('session');
    expect(contextOf([{ ...started, enabled: false }])).toBeNull();
    expect(variablesFor([started, { ...down, enabled: false }])).toContain('user.username');
  });

  it('offers no variables when nothing is enabled', () => {
    expect(variablesFor([])).toEqual([]);
  });
});
