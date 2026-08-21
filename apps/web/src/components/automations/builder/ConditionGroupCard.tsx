import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import type { ConditionGroup, ConditionMatch } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { ItemGroup } from '@/components/ui/item';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { idOf, type BuilderDispatch } from './builderReducer';
import { ConditionRow } from './ConditionRow';
import { useRowKeyboard } from './useRowKeyboard';
import type { BuilderRefs } from './builderRefs';
import type { NodeIssues } from './validation';

interface ConditionGroupCardProps {
  group: ConditionGroup;
  refs: BuilderRefs;
  issues: NodeIssues;
  pulseId: string | null;
  dispatch: BuilderDispatch;
}

/** One card of conditions that stand or fall together. */
export function ConditionGroupCard({
  group,
  refs,
  issues,
  pulseId,
  dispatch,
}: ConditionGroupCardProps) {
  const { t } = useTranslation('pages');
  const cardRef = useRef<HTMLDivElement>(null);
  const groupId = idOf(group);
  // A group saved before `match` existed matches any of its conditions.
  const match: ConditionMatch = group.match ?? 'any';

  const rows = useRowKeyboard({
    ids: group.conditions.map(idOf),
    sectionRef: cardRef,
    onToggle: (id) => dispatch({ type: 'toggleNode', id }),
    onRemove: (id, index) => {
      dispatch({ type: 'removeNode', id });
      rows.reclaim(index);
    },
  });

  const matchToggle = (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={match}
      aria-label={t('automations.builder.conditions.matchLabel')}
      onValueChange={(next) => {
        if (next === 'all' || next === 'any') {
          dispatch({ type: 'setConditionMatch', groupId, match: next });
        }
      }}
    >
      <ToggleGroupItem value="all">{t('automations.builder.conditions.all')}</ToggleGroupItem>
      <ToggleGroupItem value="any">{t('automations.builder.conditions.any')}</ToggleGroupItem>
    </ToggleGroup>
  );

  const lead = (index: number) => {
    if (index === 0) return t('automations.builder.conditions.where');
    if (index === 1) return matchToggle;
    return t(`automations.builder.conditions.${match}`);
  };

  return (
    <div ref={cardRef} className="bg-card @container space-y-2 rounded-lg border p-3">
      <ItemGroup className="gap-2">
        {group.conditions.map((condition, index) => (
          <ConditionRow
            key={idOf(condition)}
            condition={condition}
            lead={lead(index)}
            refs={refs}
            issues={issues.get(idOf(condition))}
            pulsing={pulseId === idOf(condition)}
            rowProps={rows.rowProps(index)}
            dispatch={dispatch}
          />
        ))}
      </ItemGroup>

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground"
        onClick={() => dispatch({ type: 'addCondition', groupId })}
      >
        <Plus />
        {t('automations.builder.conditions.addAnother')}
      </Button>
    </div>
  );
}
