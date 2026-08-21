import { randomUUID } from 'node:crypto';
import type {
  ConditionField,
  NodeFields,
  AutomationActions,
  AutomationConditions,
  TriggerNode,
  TriggerType,
} from '@tracearr/shared';

const TRANSCODE_FIELDS: ReadonlySet<ConditionField> = new Set([
  'is_transcoding',
  'is_transcode_downgrade',
  'output_resolution',
]);
const PAUSE_FIELDS: ReadonlySet<ConditionField> = new Set([
  'current_pause_minutes',
  'total_pause_minutes',
]);

const node = (
  type: Exclude<TriggerType, 'session.held_for' | 'account.inactive_for'>
): TriggerNode => ({ id: randomUUID(), type, enabled: true });

// Synthesized params sit at their minimum: the thresholds the engine acts on live in the
// pause and inactivity conditions, not on the trigger node.
const heldForNode = (): TriggerNode => ({
  id: randomUUID(),
  type: 'session.held_for',
  enabled: true,
  params: { minutes: 1, measure: 'current' },
});
const inactiveForNode = (): TriggerNode => ({
  id: randomUUID(),
  type: 'account.inactive_for',
  enabled: true,
  params: { days: 1 },
});

/**
 * Mirrors the engine's condition sniffing: inactive_days routes to the account trigger and
 * suppresses session.started, while transcode and pause fields add their edge triggers either way.
 */
export function synthesizeTriggers(
  conditions: AutomationConditions | null | undefined
): TriggerNode[] {
  const fields = new Set<string>();
  for (const group of conditions?.groups ?? []) {
    for (const condition of group.conditions) fields.add(condition.field);
  }
  const usesAny = (candidates: ReadonlySet<ConditionField>): boolean =>
    [...candidates].some((field) => fields.has(field));

  const triggers: TriggerNode[] = [];
  if (!fields.has('inactive_days')) triggers.push(node('session.started'));
  if (usesAny(TRANSCODE_FIELDS)) triggers.push(node('session.transcode_changed'));
  if (usesAny(PAUSE_FIELDS)) triggers.push(node('session.paused'), heldForNode());
  if (fields.has('inactive_days')) triggers.push(inactiveForNode());
  return triggers;
}

/**
 * A trigger type that survives an edit keeps the node id it already had. The
 * notification gate reads that id off past runs, so a fresh one re-notifies
 * every subject the automation has already reached.
 */
export function carryTriggerIds(
  next: TriggerNode[],
  existing: TriggerNode[] | null | undefined
): TriggerNode[] {
  const byType = new Map((existing ?? []).map((trigger) => [trigger.type, trigger.id]));
  return next.map((trigger) => {
    const priorId = byType.get(trigger.type);
    return priorId ? { ...trigger, id: priorId } : trigger;
  });
}

/** Re-synthesis for a save, with the surviving node ids carried across. */
export function resynthesizeTriggers(
  conditions: AutomationConditions | null | undefined,
  existing: TriggerNode[] | null | undefined
): TriggerNode[] {
  return carryTriggerIds(synthesizeTriggers(conditions), existing);
}

const stamp = <T extends NodeFields>(item: T): T & Required<NodeFields> => ({
  ...item,
  id: item.id ?? randomUUID(),
  enabled: item.enabled ?? true,
});

/** The builder addresses nodes by id, so every condition and action needs one before it is stored. */
export function stampNodes(definition: {
  conditions: AutomationConditions | null;
  actions: AutomationActions | null;
}): { conditions: AutomationConditions | null; actions: AutomationActions } {
  return {
    conditions: definition.conditions
      ? {
          groups: definition.conditions.groups.map((group) => ({
            ...group,
            conditions: group.conditions.map((condition) => stamp(condition)),
          })),
        }
      : null,
    actions: { actions: (definition.actions?.actions ?? []).map((action) => stamp(action)) },
  };
}
