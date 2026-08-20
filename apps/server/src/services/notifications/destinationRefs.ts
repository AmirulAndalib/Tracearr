import { isNotNull } from 'drizzle-orm';
import type { RuleActions } from '@tracearr/shared';
import { db } from '../../db/client.js';
import { automations } from '../../db/schema.js';
import { listDestinations } from './destinationStore.js';

/**
 * The destination ids a save names that no row backs. A send action storing one
 * would fail silently at match time, so the save paths reject it up front.
 */
export async function unknownDestinationIds(actions: RuleActions | undefined): Promise<string[]> {
  const sendIds = [
    ...new Set(actions?.actions.flatMap((a) => (a.type === 'send' ? a.to : [])) ?? []),
  ];
  if (sendIds.length === 0) return [];
  const known = new Set((await listDestinations()).map((d) => d.id));
  return sendIds.filter((id) => !known.has(id));
}

export interface DestinationRef {
  ruleId: string;
  ruleName: string;
  isActive: boolean;
}

/** Every rule, active or not; getActiveRulesV2 is cached and filters inactive rows, which must still block a delete. */
export async function rulesReferencingDestinations(): Promise<Map<string, DestinationRef[]>> {
  const rows = await db
    .select({
      id: automations.id,
      name: automations.name,
      isActive: automations.isActive,
      actions: automations.actions,
    })
    .from(automations)
    .where(isNotNull(automations.actions));

  const refs = new Map<string, DestinationRef[]>();
  for (const row of rows) {
    for (const action of row.actions?.actions ?? []) {
      if (action.type !== 'send') continue;
      for (const id of action.to) {
        const list = refs.get(id) ?? [];
        list.push({ ruleId: row.id, ruleName: row.name, isActive: row.isActive });
        refs.set(id, list);
      }
    }
  }
  return refs;
}
