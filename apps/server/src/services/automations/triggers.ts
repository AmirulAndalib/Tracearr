import { randomUUID } from 'node:crypto';
import type {
  ConditionField,
  NodeFields,
  RuleActions,
  RuleConditions,
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

const node = (type: TriggerType): TriggerNode => ({ id: randomUUID(), type, enabled: true });

/**
 * Mirrors the engine's condition sniffing: inactive_days routes to the account trigger and
 * suppresses session.started, while transcode and pause fields add their edge triggers either way.
 */
export function synthesizeTriggers(conditions: RuleConditions | null | undefined): TriggerNode[] {
  const fields = new Set<string>();
  for (const group of conditions?.groups ?? []) {
    for (const condition of group.conditions) fields.add(condition.field);
  }
  const usesAny = (candidates: ReadonlySet<ConditionField>): boolean =>
    [...candidates].some((field) => fields.has(field));

  const triggers: TriggerNode[] = [];
  if (!fields.has('inactive_days')) triggers.push(node('session.started'));
  if (usesAny(TRANSCODE_FIELDS)) triggers.push(node('session.transcode_changed'));
  if (usesAny(PAUSE_FIELDS)) triggers.push(node('session.paused'), node('session.held_for'));
  if (fields.has('inactive_days')) triggers.push(node('account.inactive_for'));
  return triggers;
}

const stamp = <T extends NodeFields>(item: T): T & Required<NodeFields> => ({
  ...item,
  id: item.id ?? randomUUID(),
  enabled: item.enabled ?? true,
});

/** The builder addresses nodes by id, so every condition and action needs one before it is stored. */
export function stampNodes(definition: {
  conditions: RuleConditions | null;
  actions: RuleActions | null;
}): { conditions: RuleConditions | null; actions: RuleActions } {
  return {
    conditions: definition.conditions
      ? {
          groups: definition.conditions.groups.map((group) => ({
            conditions: group.conditions.map((condition) => stamp(condition)),
          })),
        }
      : null,
    actions: { actions: (definition.actions?.actions ?? []).map((action) => stamp(action)) },
  };
}
