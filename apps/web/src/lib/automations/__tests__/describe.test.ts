import { beforeAll, describe, expect, it } from 'vitest';
import { i18n, initI18n } from '@tracearr/translations';
import type { AutomationFilterOptions, Condition } from '@tracearr/shared';
import { describeAutomation, type AutomationDisplayInput } from '../describe';
import type { Translate } from '../conditionFields';

let t: Translate;

beforeAll(async () => {
  await initI18n({ lng: 'en' });
  t = i18n.getFixedT(null, 'pages');
});

function automation(conditions: Condition[]): AutomationDisplayInput {
  return { conditions: { groups: [{ conditions }] } };
}

function filterOptions(overrides: Partial<AutomationFilterOptions> = {}): AutomationFilterOptions {
  return {
    platforms: [],
    products: [],
    devices: [],
    cities: [],
    users: [],
    countries: [],
    servers: [],
    ...overrides,
  };
}

describe('describeAutomation', () => {
  it('names the field, operator and unit of the first condition', () => {
    const summary = describeAutomation(
      t,
      automation([{ field: 'inactive_days', operator: 'gte', value: 180 }])
    );

    expect(summary).toBe('Days Inactive ≥ 180 days → No action');
  });

  it('counts the conditions past the first', () => {
    const summary = describeAutomation(
      t,
      automation([
        { field: 'concurrent_streams', operator: 'gt', value: 3 },
        { field: 'trust_score', operator: 'lt', value: 50 },
      ])
    );

    expect(summary).toContain('(+1 more)');
  });

  it('describes a field this build retired without throwing, showing the stored id', () => {
    // A rule saved before library_id was dropped still renders in the list.
    const retired = { field: 'library_id', operator: 'eq', value: 'lib-4' } as unknown as Condition;

    const summary = describeAutomation(t, automation([retired]));

    expect(summary).toBe('library_id = lib-4 → No action');
  });

  it('falls back to the stored operator when this build no longer knows it', () => {
    const retired = {
      field: 'trust_score',
      operator: 'between',
      value: 50,
    } as unknown as Condition;

    expect(describeAutomation(t, automation([retired]))).toBe('Trust Score between 50 → No action');
  });

  it('reads a country code as its name once the filter options are loaded', () => {
    const summary = describeAutomation(
      t,
      automation([{ field: 'country', operator: 'in', value: ['US'] }]),
      filterOptions({ countries: [{ code: 'US', name: 'United States', hasSessions: true }] })
    );

    expect(summary).toContain('United States');
  });

  it('says so when there is nothing to describe', () => {
    expect(describeAutomation(t, { conditions: { groups: [] } })).toBe('No conditions → No action');
  });
});
