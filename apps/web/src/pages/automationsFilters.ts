/**
 * Pure filter-composition logic for the Automations page. The list query reads
 * the same function the filter bar writes, so a filter added here reaches the
 * wire without a second mapping to keep in step.
 */

import type { AutomationKind } from '@tracearr/shared';
import type { FilterState } from '@/components/ui/filters';

export type AutomationStatusFilter = 'active' | 'inactive';

export type AutomationsFilterState = FilterState & {
  search?: string;
  kind?: AutomationKind;
  status?: AutomationStatusFilter;
};

export const AUTOMATIONS_FILTER_DEFAULTS: AutomationsFilterState = {};

export interface AutomationsFilterParams {
  search: string | undefined;
  kind: AutomationKind | undefined;
  enabled: boolean | undefined;
}

export function buildAutomationFilterParams(
  filters: AutomationsFilterState
): AutomationsFilterParams {
  return {
    search: filters.search,
    kind: filters.kind,
    enabled: filters.status === undefined ? undefined : filters.status === 'active',
  };
}
