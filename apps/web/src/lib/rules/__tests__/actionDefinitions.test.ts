import { describe, expect, it } from 'vitest';
import { trustActionSchema } from '@tracearr/shared';
import { applyActionFieldChange, createDefaultAction } from '../actionDefinitions';

describe('applyActionFieldChange', () => {
  it('swaps trust parameters when the mode changes, so every mode stays savable', () => {
    const adjust = createDefaultAction('trust');
    const set = applyActionFieldChange(adjust, 'mode', 'set');
    expect(set).toEqual({ type: 'trust', mode: 'set', value: 50 });
    expect(trustActionSchema.safeParse(set).success).toBe(true);

    const reset = applyActionFieldChange(set, 'mode', 'reset');
    expect(reset).toEqual({ type: 'trust', mode: 'reset' });
    expect(trustActionSchema.safeParse(reset).success).toBe(true);

    const back = applyActionFieldChange(reset, 'mode', 'adjust');
    expect(trustActionSchema.safeParse(back).success).toBe(true);
  });

  it('keeps the cooldown across a mode change', () => {
    const withCooldown = { ...createDefaultAction('trust'), cooldown_minutes: 15 };
    const next = applyActionFieldChange(withCooldown, 'mode', 'set');
    expect(next).toEqual({ type: 'trust', mode: 'set', value: 50, cooldown_minutes: 15 });
  });

  it('merges plainly for every other field', () => {
    const kill = createDefaultAction('kill_stream');
    expect(applyActionFieldChange(kill, 'cooldown_minutes', 30)).toEqual({
      type: 'kill_stream',
      cooldown_minutes: 30,
    });
  });
});
