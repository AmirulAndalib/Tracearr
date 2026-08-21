/**
 * The builder page's whole state. Conditions and actions are held as the API sent
 * them so an edit started from the page saves back everything it loaded.
 */

import type { Dispatch } from 'react';
import {
  type Automation,
  type AutomationActions,
  type AutomationConditions,
  type AutomationKind,
  type CreateAutomationInput,
  type TriggerNode,
  type TriggerType,
  type ViolationSeverity,
} from '@tracearr/shared';
import {
  canEnforceAcrossServers,
  scopeFromAutomation,
  scopeToPayload,
  type AutomationScope,
} from '@/lib/automations';

export interface BuilderState {
  name: string;
  description: string;
  kind: AutomationKind;
  /** Kept across a switch to notification so switching back restores the picked severity. */
  severity: ViolationSeverity;
  isActive: boolean;
  scope: AutomationScope;
  enforceAcrossServers: boolean;
  triggers: TriggerNode[];
  conditions: AutomationConditions;
  actions: AutomationActions;
  dirty: boolean;
}

/** Only the two parameterised triggers carry anything; a patch names one part of it. */
export interface TriggerParamPatch {
  minutes?: number;
  measure?: 'current' | 'total';
  days?: number;
}

export type BuilderAction =
  | { type: 'setName'; value: string }
  | { type: 'setKind'; value: AutomationKind }
  | { type: 'setSeverity'; value: ViolationSeverity }
  | { type: 'setActive'; value: boolean }
  | { type: 'setScope'; value: AutomationScope }
  | { type: 'setEnforceAcrossServers'; value: boolean }
  | { type: 'addTrigger'; triggerType: TriggerType }
  | { type: 'setTriggerParam'; id: string; patch: TriggerParamPatch }
  | { type: 'toggleNode'; id: string }
  | { type: 'removeNode'; id: string }
  | { type: 'load'; automation: Automation }
  | { type: 'saved' };

export type BuilderDispatch = Dispatch<BuilderAction>;

const HELD_FOR_DEFAULTS = { minutes: 30, measure: 'current' } as const;
const INACTIVE_FOR_DEFAULTS = { days: 30 } as const;

/** The bounds `heldForParamsSchema` and `inactiveForParamsSchema` enforce, for the steppers
 * that offer them and the message that names them when a typed value lands outside. */
export const TRIGGER_PARAM_BOUNDS = {
  minutes: { min: 1, max: 1440 },
  days: { min: 1, max: 3650 },
} as const;

/** The element id a node's row carries, so the sentence and the error count can reach it. */
export function nodeDomId(nodeId: string): string {
  return `automation-node-${nodeId}`;
}

export function emptyBuilderState(): BuilderState {
  return {
    name: '',
    description: '',
    kind: 'policy',
    severity: 'warning',
    isActive: true,
    scope: { mode: 'global' },
    enforceAcrossServers: false,
    triggers: [],
    conditions: { groups: [] },
    actions: { actions: [] },
    dirty: false,
  };
}

export function builderStateFrom(automation: Automation): BuilderState {
  return {
    name: automation.name,
    description: automation.description ?? '',
    kind: automation.kind,
    severity: automation.severity ?? 'warning',
    isActive: automation.isActive,
    scope: scopeFromAutomation(automation),
    enforceAcrossServers: automation.enforceAcrossServers,
    triggers: automation.triggers,
    conditions: automation.conditions,
    actions: automation.actions,
    dirty: false,
  };
}

export function toCreateInput(state: BuilderState): CreateAutomationInput {
  return {
    name: state.name.trim(),
    description: state.description.trim() || null,
    kind: state.kind,
    severity: state.kind === 'policy' ? state.severity : null,
    isActive: state.isActive,
    triggers: state.triggers,
    conditions: state.conditions,
    actions: state.actions,
    ...scopeToPayload(state.scope),
    enforceAcrossServers: canEnforceAcrossServers(state.scope, state.conditions)
      ? state.enforceAcrossServers
      : false,
  };
}

function newTrigger(triggerType: TriggerType): TriggerNode {
  const node = { id: crypto.randomUUID(), enabled: true };
  if (triggerType === 'session.held_for') {
    return { ...node, type: triggerType, params: { ...HELD_FOR_DEFAULTS } };
  }
  if (triggerType === 'account.inactive_for') {
    return { ...node, type: triggerType, params: { ...INACTIVE_FOR_DEFAULTS } };
  }
  return { ...node, type: triggerType };
}

function withParams(trigger: TriggerNode, patch: TriggerParamPatch): TriggerNode {
  if (trigger.type === 'session.held_for') {
    return {
      ...trigger,
      params: {
        minutes: patch.minutes ?? trigger.params.minutes,
        measure: patch.measure ?? trigger.params.measure,
      },
    };
  }
  if (trigger.type === 'account.inactive_for') {
    return { ...trigger, params: { days: patch.days ?? trigger.params.days } };
  }
  return trigger;
}

type NodeEdit = 'toggle' | 'remove';

/** A node left without `enabled` counts as on, so toggling one writes `false` first. */
function editNodes<T extends { id?: string; enabled?: boolean }>(
  nodes: readonly T[],
  id: string,
  edit: NodeEdit
): T[] {
  return nodes.flatMap((node): T[] => {
    if (node.id !== id) return [node];
    return edit === 'remove' ? [] : [{ ...node, enabled: node.enabled === false }];
  });
}

function editConditions(
  conditions: AutomationConditions,
  id: string,
  edit: NodeEdit
): AutomationConditions {
  return {
    groups: editNodes(conditions.groups, id, edit).map((group) => ({
      ...group,
      conditions: editNodes(group.conditions, id, edit),
    })),
  };
}

function editActions(actions: AutomationActions, id: string, edit: NodeEdit): AutomationActions {
  return {
    actions: editNodes(actions.actions, id, edit).map((action) =>
      action.type === 'if'
        ? {
            ...action,
            conditions: editConditions(action.conditions, id, edit),
            then: editNodes(action.then, id, edit),
            else: editNodes(action.else, id, edit),
          }
        : action
    ),
  };
}

function editNode(state: BuilderState, id: string, edit: NodeEdit): BuilderState {
  return {
    ...state,
    triggers: editNodes(state.triggers, id, edit),
    conditions: editConditions(state.conditions, id, edit),
    actions: editActions(state.actions, id, edit),
    dirty: true,
  };
}

export function builderReducer(state: BuilderState, action: BuilderAction): BuilderState {
  switch (action.type) {
    case 'setName':
      return { ...state, name: action.value, dirty: true };
    case 'setKind':
      return { ...state, kind: action.value, dirty: true };
    case 'setSeverity':
      return { ...state, severity: action.value, dirty: true };
    case 'setActive':
      return { ...state, isActive: action.value, dirty: true };
    case 'setScope':
      return { ...state, scope: action.value, dirty: true };
    case 'setEnforceAcrossServers':
      return { ...state, enforceAcrossServers: action.value, dirty: true };
    case 'addTrigger':
      return {
        ...state,
        triggers: [...state.triggers, newTrigger(action.triggerType)],
        dirty: true,
      };
    case 'setTriggerParam':
      return {
        ...state,
        triggers: state.triggers.map((trigger) =>
          trigger.id === action.id ? withParams(trigger, action.patch) : trigger
        ),
        dirty: true,
      };
    case 'toggleNode':
      return editNode(state, action.id, 'toggle');
    case 'removeNode':
      return editNode(state, action.id, 'remove');
    case 'load':
      return builderStateFrom(action.automation);
    case 'saved':
      return { ...state, dirty: false };
  }
}
