/**
 * Every problem the page can show, addressed to the row that has to fix it. The
 * shared schema does the judging; this only translates it and finds the node.
 */

import { createAutomationSchema, type Action, type ConditionGroup } from '@tracearr/shared';
import { ApiError } from '@/lib/api';
import type { Translate } from '@/lib/automations';
import { TRIGGER_PARAM_BOUNDS, toCreateInput, type BuilderState } from './builderReducer';

/** What a problem points at when it belongs to the page rather than to a node. */
export const BUILDER_SECTIONS = {
  name: 'name',
  triggers: 'triggers',
  scope: 'scope',
} as const;

export interface BuilderIssue {
  nodeId: string;
  message: string;
}

export type NodeIssues = Map<string, string[]>;

/** `path` starts at the `groups` key, whether the groups are the page's or an `if`'s. */
function groupsNodeId(
  groups: readonly ConditionGroup[],
  path: readonly PropertyKey[]
): string | undefined {
  const groupIndex = path[1];
  if (typeof groupIndex !== 'number') return undefined;
  const group = groups[groupIndex];
  if (!group) return undefined;

  const conditionIndex = path[3];
  if (path[2] !== 'conditions' || typeof conditionIndex !== 'number') return group.id;
  return group.conditions[conditionIndex]?.id ?? group.id;
}

/** `path` starts at the `actions` key of the actions container. */
function actionsNodeId(
  actions: readonly Action[],
  path: readonly PropertyKey[]
): string | undefined {
  const actionIndex = path[1];
  if (typeof actionIndex !== 'number') return undefined;
  const action = actions[actionIndex];
  if (action?.type !== 'if') return action?.id;

  if (path[2] === 'conditions') {
    return groupsNodeId(action.conditions.groups, path.slice(3)) ?? action.id;
  }
  if (path[2] === 'then' || path[2] === 'else') {
    const leafIndex = path[3];
    if (typeof leafIndex === 'number') return action[path[2]][leafIndex]?.id ?? action.id;
  }
  return action.id;
}

function nodeIdForPath(state: BuilderState, path: readonly PropertyKey[]): string {
  const head = path[0];

  if (head === 'triggers') {
    const index = path[1];
    if (typeof index === 'number') return state.triggers[index]?.id ?? BUILDER_SECTIONS.triggers;
    return BUILDER_SECTIONS.triggers;
  }
  if (head === 'conditions') {
    return groupsNodeId(state.conditions.groups, path.slice(1)) ?? BUILDER_SECTIONS.name;
  }
  if (head === 'actions') {
    return actionsNodeId(state.actions.actions, path.slice(1)) ?? BUILDER_SECTIONS.name;
  }
  if (head === 'serverId' || head === 'serverUserId' || head === 'userId') {
    return BUILDER_SECTIONS.scope;
  }
  return BUILDER_SECTIONS.name;
}

/** The path's last key says what went wrong; the schema's English is the last resort. */
function messageFor(t: Translate, path: readonly PropertyKey[], fallback: string): string {
  switch (path[path.length - 1]) {
    case 'field':
      return t('automations.builder.errors.fieldUnavailable');
    case 'operator':
      return t('automations.builder.errors.operatorInvalid');
    case 'value':
      return t('automations.builder.errors.valueInvalid');
    case 'type':
      return t('automations.builder.errors.actionUnavailable');
    case 'title':
    case 'body':
      return t('automations.builder.errors.variableUnavailable');
    case 'minutes':
      return t('automations.builder.errors.minutesRange', { ...TRIGGER_PARAM_BOUNDS.minutes });
    case 'days':
      return t('automations.builder.errors.daysRange', { ...TRIGGER_PARAM_BOUNDS.days });
    case 'measure':
      return t('automations.builder.errors.measureInvalid');
    case 'name':
      return t('automations.builder.errors.nameRequired');
    case 'serverId':
    case 'serverUserId':
    case 'userId':
      return t('automations.builder.errors.scopeIncomplete');
    case 'triggers':
      return t('automations.builder.errors.policyNeedsSubject');
    default:
      return fallback;
  }
}

export function builderIssues(state: BuilderState, t: Translate): BuilderIssue[] {
  const issues: BuilderIssue[] = [];

  const parsed = createAutomationSchema.safeParse(toCreateInput(state));
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push({
        nodeId: nodeIdForPath(state, issue.path),
        message: messageFor(t, issue.path, issue.message),
      });
    }
  }

  // The schema accepts a definition with no triggers so a template can leave them out.
  if (!state.triggers.some((trigger) => trigger.enabled)) {
    issues.push({
      nodeId: BUILDER_SECTIONS.triggers,
      message: t('automations.builder.errors.triggerRequired'),
    });
  }
  return issues;
}

interface ServerField {
  field: string;
  message: string;
}

function isServerField(value: unknown): value is ServerField {
  if (typeof value !== 'object' || value === null) return false;
  const record: Record<string, unknown> = { ...value };
  return typeof record.field === 'string' && typeof record.message === 'string';
}

/** The API names a rejected field as `body.conditions.groups.0.conditions.1.field`. */
function pathFromField(field: string): PropertyKey[] {
  const parts = field.split('.');
  const start = parts[0] === 'body' ? 1 : 0;
  return parts.slice(start).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
}

/** What the API rejected, pointed at the same rows the local check uses. */
export function serverIssues(state: BuilderState, error: unknown, t: Translate): BuilderIssue[] {
  if (!(error instanceof ApiError)) return [];
  const details = error.body.details;
  if (typeof details !== 'object' || details === null) return [];
  const record: Record<string, unknown> = { ...details };
  if (!Array.isArray(record.fields)) return [];

  return record.fields.filter(isServerField).map((entry) => {
    const path = pathFromField(entry.field);
    return { nodeId: nodeIdForPath(state, path), message: messageFor(t, path, entry.message) };
  });
}

export function issuesByNode(issues: readonly BuilderIssue[]): NodeIssues {
  const byNode: NodeIssues = new Map();
  for (const issue of issues) {
    const messages = byNode.get(issue.nodeId);
    if (messages) messages.push(issue.message);
    else byNode.set(issue.nodeId, [issue.message]);
  }
  return byNode;
}
