/** The builder's action metadata registry: config fields, colours and per-type defaults. */

import {
  LEAF_ACTION_TYPES,
  type AutomationKind,
  type LeafAction,
  type LeafActionType,
  type TrustAction,
  type ViolationSeverity,
} from '@tracearr/shared';
import type { Translate } from './conditionFields';

// Config field types for rendering action configuration
export type ConfigFieldType = 'number' | 'text' | 'select' | 'slider' | 'destinations';

// Option definition for select fields
export interface ConfigFieldOption {
  value: string;
  label: string;
  /** Tooltip shown on hover */
  tooltip?: string;
}

// Config field definition
export interface ConfigField {
  name: string;
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  options?: ConfigFieldOption[];
  /** Options this field takes from a translated catalog instead of carrying inline. */
  optionSource?: 'sessionTargets';
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  placeholder?: string;
  description?: string;
  /** If true, renders on its own line below other fields */
  fullWidth?: boolean;
}

// Action definition interface
export interface ActionDefinition {
  type: LeafActionType;
  configFields: ConfigField[];
  color: 'default' | 'warning' | 'destructive';
}

export const SEVERITIES = [
  'low',
  'warning',
  'high',
] as const satisfies readonly ViolationSeverity[];

/** Which sessions a kill_stream or message_client action reaches. */
const SESSION_TARGETS = ['triggering', 'oldest', 'newest', 'all_except_one', 'all_user'] as const;

export function severityLabel(t: Translate, severity: ViolationSeverity): string {
  return t(`automations.severity.${severity}`);
}

export function actionLabel(t: Translate, type: LeafActionType): string {
  return t(`automations.actions.${type}.label`);
}

export function actionDescription(t: Translate, type: LeafActionType): string {
  return t(`automations.actions.${type}.description`);
}

/** Only message_client carries a caveat, so only it has a hint key. */
export function actionHint(t: Translate, type: LeafActionType): string | undefined {
  return type === 'message_client' ? t('automations.actions.message_client.hint') : undefined;
}

/** A config field's choices, translated when they come from a catalog. */
export function configFieldOptions(t: Translate, field: ConfigField): ConfigFieldOption[] {
  if (field.optionSource !== 'sessionTargets') return field.options ?? [];
  return SESSION_TARGETS.map((value) => ({
    value,
    label: t(`automations.sessionTargets.${value}.label`),
    tooltip: t(`automations.sessionTargets.${value}.tooltip`),
  }));
}

// The main action definitions registry
export const ACTION_DEFINITIONS: Record<LeafActionType, ActionDefinition> = {
  send: {
    type: 'send',
    color: 'default',
    configFields: [
      {
        name: 'to',
        label: 'Destinations',
        type: 'destinations',
        required: true,
      },
      {
        name: 'cooldown_minutes',
        label: 'Cooldown',
        type: 'number',
        min: 0,
        max: 1440,
        step: 5,
        unit: 'minutes',
        description: 'Minimum time between notifications',
      },
    ],
  },

  trust: {
    type: 'trust',
    color: 'default',
    configFields: [
      {
        name: 'mode',
        label: 'Mode',
        type: 'select',
        required: true,
        options: [
          { value: 'adjust', label: 'Adjust by amount' },
          { value: 'set', label: 'Set to value' },
          { value: 'reset', label: 'Reset to default (100)' },
        ],
      },
      {
        name: 'amount',
        label: 'Amount',
        type: 'number',
        min: -100,
        max: 100,
        step: 1,
        description: 'Positive to increase, negative to decrease',
      },
      {
        name: 'value',
        label: 'Value',
        type: 'slider',
        min: 0,
        max: 100,
        step: 1,
      },
    ],
  },

  kill_stream: {
    type: 'kill_stream',
    color: 'destructive',
    configFields: [
      {
        name: 'cooldown_minutes',
        label: 'Cooldown',
        type: 'number',
        min: 0,
        max: 1440,
        step: 5,
        unit: 'minutes',
        description: 'Minimum time between terminations for the same user',
      },
      {
        name: 'delay_seconds',
        label: 'Sustain window',
        type: 'number',
        min: 0,
        max: 300,
        step: 5,
        unit: 'seconds',
        description:
          'Wait this many seconds, then kill the stream only if the rule still matches. 0 kills immediately after a final re-check.',
      },
      {
        name: 'target',
        label: 'Target',
        type: 'select',
        optionSource: 'sessionTargets',
        description: 'Which sessions to terminate',
        fullWidth: true,
      },
      {
        name: 'message',
        label: 'Message',
        type: 'text',
        placeholder: 'Message shown to user (optional)',
        description: 'Text displayed before termination. Leave empty for silent termination.',
        fullWidth: true,
      },
    ],
  },

  message_client: {
    type: 'message_client',
    color: 'default',
    configFields: [
      {
        name: 'target',
        label: 'Target',
        type: 'select',
        optionSource: 'sessionTargets',
        description: 'Which sessions to message',
        fullWidth: true,
      },
      {
        name: 'message',
        label: 'Message',
        type: 'text',
        required: true,
        placeholder: 'Message to display...',
        description: 'Text shown to the user',
      },
    ],
  },
};

/** Run steps name their action as a plain string, including types this build never knew. */
export function storedActionLabel(t: Translate, action: string): string {
  if (action === 'if') return t('automations.catalog.actions.if.label');
  const known = (LEAF_ACTION_TYPES as readonly string[]).includes(action);
  return known ? actionLabel(t, action as LeafActionType) : action;
}

/** The parameter each trust mode carries; the schema rejects a mode with its sibling's parameter. */
export const TRUST_MODE_PARAMS: Record<TrustAction['mode'], Partial<TrustAction>> = {
  adjust: { amount: -10 },
  set: { value: 50 },
  reset: {},
};

/** Trust carries one parameter per mode, so a row shows only that mode's field. */
export function visibleConfigFields(action: LeafAction): ConfigField[] {
  const { configFields } = ACTION_DEFINITIONS[action.type];
  if (action.type !== 'trust') return configFields;
  const params = Object.keys(TRUST_MODE_PARAMS[action.mode]);
  return configFields.filter((field) => field.name === 'mode' || params.includes(field.name));
}

/** Switching trust mode swaps the parameter set wholesale; the node fields and cooldown survive. */
export function applyActionFieldChange(
  action: LeafAction,
  name: string,
  value: unknown
): LeafAction {
  if (action.type === 'trust' && name === 'mode') {
    const mode = value as TrustAction['mode'];
    const { id, enabled, cooldown_minutes } = action;
    const next: TrustAction = { type: 'trust', mode, ...TRUST_MODE_PARAMS[mode] };
    if (id !== undefined) next.id = id;
    if (enabled !== undefined) next.enabled = enabled;
    if (cooldown_minutes !== undefined) next.cooldown_minutes = cooldown_minutes;
    return next;
  }
  return { ...action, [name]: value };
}

/** The picker offers whatever the contract declares, so a new action type cannot go unoffered. */
const OFFERED_ACTION_TYPES: readonly LeafActionType[] = LEAF_ACTION_TYPES;

/** The action type a freshly added row starts on, for either kind. */
export const DEFAULT_ACTION_TYPE: LeafActionType = 'send';

/** Both kinds may use every action; a notification automation just leads with `send`. */
export function actionTypesForKind(kind: AutomationKind): LeafActionType[] {
  const types: LeafActionType[] = [...OFFERED_ACTION_TYPES];
  if (kind !== 'notification') return types;
  return ['send', ...types.filter((type) => type !== 'send')];
}

/** Create a default action of a given type. */
export function createDefaultAction(type: LeafActionType): LeafAction {
  switch (type) {
    case 'send':
      return { type: 'send', to: [] };
    case 'trust':
      return { type: 'trust', mode: 'adjust', ...TRUST_MODE_PARAMS.adjust };
    case 'kill_stream':
      return { type: 'kill_stream' };
    case 'message_client':
      return { type: 'message_client', message: '' };
  }
}
