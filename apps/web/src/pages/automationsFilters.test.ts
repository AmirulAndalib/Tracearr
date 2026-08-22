import { describe, it, expect } from 'vitest';
import { AUTOMATIONS_FILTER_DEFAULTS, buildAutomationFilterParams } from './automationsFilters';

describe('buildAutomationFilterParams', () => {
  it('sends no narrowing at all for the default filters', () => {
    expect(buildAutomationFilterParams(AUTOMATIONS_FILTER_DEFAULTS)).toEqual({
      search: undefined,
      source: undefined,
      serverId: undefined,
      kind: undefined,
      enabled: undefined,
    });
  });

  it('carries where a row came from and the server it watches', () => {
    const params = buildAutomationFilterParams({ source: 'import', serverId: 'server-1' });

    expect(params).toMatchObject({ source: 'import', serverId: 'server-1' });
  });

  it('reads the rows no template wrote as their own source', () => {
    expect(buildAutomationFilterParams({ source: 'own' }).source).toBe('own');
  });

  it('turns the two status words into the boolean the API takes', () => {
    expect(buildAutomationFilterParams({ status: 'active' }).enabled).toBe(true);
    expect(buildAutomationFilterParams({ status: 'inactive' }).enabled).toBe(false);
    expect(buildAutomationFilterParams({}).enabled).toBeUndefined();
  });

  it('carries the search text and the kind', () => {
    expect(buildAutomationFilterParams({ search: 'discord', kind: 'notification' })).toMatchObject({
      search: 'discord',
      kind: 'notification',
    });
  });
});
