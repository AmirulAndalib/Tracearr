import type {
  AutomationFilterOptions,
  AutomationKind,
  TriggerNode,
  UnitSystem,
} from '@tracearr/shared';
import type { DescribeRefs } from '@/lib/automations';

/** What a row needs beyond its own node: the definition around it, and the names behind ids. */
export interface BuilderRefs {
  triggers: readonly TriggerNode[];
  kind: AutomationKind;
  filterOptions: AutomationFilterOptions | undefined;
  describe: DescribeRefs;
  unitSystem: UnitSystem;
}
