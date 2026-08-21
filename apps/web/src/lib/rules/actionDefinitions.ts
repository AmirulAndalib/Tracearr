/** The builder's action metadata registry: labels, config fields and per-type defaults. */

import {
  actionTypeSchema,
  type Action,
  type ActionType,
  type AutomationKind,
  type TrustAction,
  type ViolationSeverity,
} from '@tracearr/shared';

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
  type: ActionType;
  label: string;
  description: string;
  icon: string; // Lucide icon name
  configFields: ConfigField[];
  color: 'default' | 'warning' | 'destructive';
  hint?: string; // Optional warning/info message to display
}

// Severity options for violation actions
export const SEVERITY_OPTIONS: { value: ViolationSeverity; label: string; color: string }[] = [
  { value: 'low', label: 'Low', color: 'bg-blue-500' },
  { value: 'warning', label: 'Warning', color: 'bg-yellow-500' },
  { value: 'high', label: 'High', color: 'bg-red-500' },
];

// Session target options for kill_stream and message_client actions
export const SESSION_TARGET_OPTIONS: ConfigFieldOption[] = [
  {
    value: 'triggering',
    label: 'Triggering session',
    tooltip: 'Only the session that triggered this rule',
  },
  {
    value: 'oldest',
    label: 'Oldest session',
    tooltip: "The user's longest-running active session",
  },
  {
    value: 'newest',
    label: 'Newest session',
    tooltip: "The user's most recently started session",
  },
  {
    value: 'all_except_one',
    label: 'All except one (keep oldest)',
    tooltip: 'All sessions except the oldest, bringing user down to 1 stream',
  },
  {
    value: 'all_user',
    label: 'All user sessions',
    tooltip: 'Every active session for this user',
  },
];

// The main action definitions registry
export const ACTION_DEFINITIONS: Record<ActionType, ActionDefinition> = {
  send: {
    type: 'send',
    label: 'Send Notification',
    description: 'Send to one or more destinations',
    icon: 'Bell',
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
    label: 'Trust Score',
    description: 'Adjust, set, or reset the trust score',
    icon: 'TrendingUp',
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
    label: 'Kill Stream',
    description: 'Terminate the active stream',
    icon: 'XCircle',
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
        options: SESSION_TARGET_OPTIONS,
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
    label: 'Message Client',
    description: 'Send message to the media player',
    icon: 'MessageSquare',
    color: 'default',
    hint: 'Jellyfin and Emby only. Plex only supports messages when killing a stream.',
    configFields: [
      {
        name: 'target',
        label: 'Target',
        type: 'select',
        options: SESSION_TARGET_OPTIONS,
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

// Short action labels for one-line summaries
export const COMPACT_ACTION_LABELS: Record<ActionType, string> = {
  send: 'Send',
  trust: 'Trust score',
  kill_stream: 'Kill stream',
  message_client: 'Message',
};

/** Run steps name their action as a plain string, including types this build never knew. */
export function compactActionLabel(action: string): string {
  const labels: Record<string, string> = COMPACT_ACTION_LABELS;
  return labels[action] ?? action;
}

/** The parameter each trust mode carries; the schema rejects a mode with its sibling's parameter. */
export const TRUST_MODE_PARAMS: Record<TrustAction['mode'], Partial<TrustAction>> = {
  adjust: { amount: -10 },
  set: { value: 50 },
  reset: {},
};

/** Trust carries one parameter per mode, so a row shows only that mode's field. */
export function visibleConfigFields(action: Action): ConfigField[] {
  const { configFields } = ACTION_DEFINITIONS[action.type];
  if (action.type !== 'trust') return configFields;
  const params = Object.keys(TRUST_MODE_PARAMS[action.mode]);
  return configFields.filter((field) => field.name === 'mode' || params.includes(field.name));
}

/** Switching trust mode swaps the parameter set wholesale; the node fields and cooldown survive. */
export function applyActionFieldChange(action: Action, name: string, value: unknown): Action {
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
const OFFERED_ACTION_TYPES: readonly ActionType[] = actionTypeSchema.options;

/** The action type a freshly added row starts on, for either kind. */
export const DEFAULT_ACTION_TYPE: ActionType = 'send';

/** Both kinds may use every action; a notification automation just leads with `send`. */
export function actionTypesForKind(kind: AutomationKind): ActionType[] {
  const types: ActionType[] = [...OFFERED_ACTION_TYPES];
  if (kind !== 'notification') return types;
  return ['send', ...types.filter((type) => type !== 'send')];
}

/** Create a default action of a given type. */
export function createDefaultAction(type: ActionType): Action {
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
