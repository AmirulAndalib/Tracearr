/**
 * One-line summaries of an automation's conditions and actions for list rows.
 */

import type {
  Action,
  Condition,
  AutomationActions,
  AutomationConditions,
  AutomationFilterOptions,
} from '@tracearr/shared';
import { type UnitSystem, formatConditionFieldValue } from '@tracearr/shared';
import { storedActionLabel } from './actionDefinitions';
import {
  fieldDescriptor,
  fieldLabel,
  fieldOptions,
  operatorSymbol,
  optionLabel,
  unitLabel,
  type Translate,
} from './conditionFields';

/** The conditions/actions pair both a stored automation and a template carry. */
export interface AutomationDisplayInput {
  conditions?: AutomationConditions | null;
  actions?: AutomationActions | null;
}

function firstCondition(automation: AutomationDisplayInput): Condition | null {
  return automation.conditions?.groups?.[0]?.conditions?.[0] ?? null;
}

function countConditions(automation: AutomationDisplayInput): number {
  return (automation.conditions?.groups ?? []).reduce(
    (total, group) => total + (group.conditions?.length ?? 0),
    0
  );
}

/** Format a single condition to a human-readable string. */
function formatCondition(
  t: Translate,
  condition: Condition,
  filterOptions?: AutomationFilterOptions,
  unitSystem?: UnitSystem
): string {
  const descriptor = fieldDescriptor(condition.field);
  const label = fieldLabel(t, condition.field);
  const operator = operatorSymbol(condition.operator);

  if (descriptor?.valueType === 'boolean') {
    if (condition.value === true) return label;
    return t('automations.describe.negated', { label: label.toLowerCase() });
  }

  let formattedValue = formatValue(t, condition, filterOptions);
  let unit = '';

  if (typeof condition.value === 'number') {
    const converted = formatConditionFieldValue(
      condition.value,
      condition.field,
      unitSystem ?? 'metric'
    );
    if (converted.unit) {
      formattedValue = String(converted.displayValue);
      unit = ` ${converted.unit}`;
    }
  }

  if (!unit && descriptor?.unit) unit = ` ${unitLabel(t, descriptor.unit)}`;

  // A list already reads as a list; a threshold takes its unit.
  if (condition.operator === 'in' || condition.operator === 'not_in') {
    return `${label} ${operator} ${formattedValue}`;
  }

  let result = `${label} ${operator} ${formattedValue}${unit}`;

  const notes: string[] = [];
  // exclude_same_device defaults to true, so show when disabled
  if (condition.params?.exclude_same_device === false) {
    notes.push(t('automations.describe.includesSameDevice'));
  }
  // exclude_same_ip defaults to false, so show when enabled
  if (condition.params?.exclude_same_ip === true) {
    notes.push(t('automations.describe.uniqueIps'));
  }
  // count_device_types defaults to all devices, so show when set
  if (condition.params?.count_device_types?.length) {
    const types = condition.params.count_device_types.map((type) => optionLabel(t, type));
    notes.push(t('automations.describe.deviceTypesOnly', { types: types.join('/') }));
  }

  if (notes.length > 0) result += ` (${notes.join(', ')})`;

  return result;
}

/** A user, server or country id reads as its name once the filter options are loaded. */
function lookupDynamicValue(
  field: string,
  value: string,
  filterOptions?: AutomationFilterOptions
): string | null {
  if (!filterOptions) return null;

  switch (fieldDescriptor(field)?.dynamicSource) {
    case 'users': {
      const user = filterOptions.users?.find((u) => u.id === value);
      return user ? user.identityName || user.username : null;
    }
    case 'servers':
      return filterOptions.servers?.find((s) => s.id === value)?.name ?? null;
    case 'countries':
      return filterOptions.countries?.find((c) => c.code === value)?.name ?? null;
    default:
      return null;
  }
}

function formatValue(
  t: Translate,
  condition: Condition,
  filterOptions?: AutomationFilterOptions
): string {
  const { value, field } = condition;

  if (Array.isArray(value)) {
    if (value.length === 0) return t('automations.describe.noValues');
    const labels = value.map((entry) =>
      typeof entry === 'string'
        ? (lookupDynamicValue(field, entry, filterOptions) ?? entry)
        : String(entry)
    );
    if (labels.length > 3) return `${labels.slice(0, 3).join(', ')}...`;
    return labels.join(', ');
  }

  if (typeof value === 'string') {
    const dynamicLabel = lookupDynamicValue(field, value, filterOptions);
    if (dynamicLabel) return dynamicLabel;
    const option = fieldOptions(t, field).find((entry) => entry.value === value);
    if (option) return option.label;
  }

  return String(value);
}

function formatActions(t: Translate, actions: Action[]): string {
  const first = actions[0];
  if (!first) return t('automations.describe.noAction');

  const names = actions.map((action) => storedActionLabel(t, action.type));
  if (names.length <= 2) return names.join(', ');

  return `${names[0]} (${t('automations.describe.more', { count: actions.length - 1 })})`;
}

/**
 * A complete summary of an automation, as
 * "Days Inactive > 180 days (+2 more) → Send".
 */
export function describeAutomation(
  t: Translate,
  automation: AutomationDisplayInput,
  filterOptions?: AutomationFilterOptions,
  unitSystem?: UnitSystem
): string {
  const first = firstCondition(automation);
  const total = countConditions(automation);

  let conditionsPart: string;
  if (!first) {
    conditionsPart = t('automations.describe.noConditions');
  } else {
    conditionsPart = formatCondition(t, first, filterOptions, unitSystem);
    if (total > 1) conditionsPart += ` (${t('automations.describe.more', { count: total - 1 })})`;
  }

  return `${conditionsPart} → ${formatActions(t, automation.actions?.actions ?? [])}`;
}
