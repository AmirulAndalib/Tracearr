import { Fragment, useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { contextOf, fieldsAvailableFor, type AutomationConditions } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { FieldSeparator } from '@/components/ui/field';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { idOf, nodeDomId, type BuilderDispatch } from './builderReducer';
import { ConditionGroupCard } from './ConditionGroupCard';
import { RowIssues } from './RowActions';
import { BUILDER_SECTIONS, type NodeIssues } from './validation';
import type { BuilderRefs } from './builderRefs';

interface ConditionsSectionProps {
  conditions: AutomationConditions;
  refs: BuilderRefs;
  issues: NodeIssues;
  pulseId: string | null;
  dispatch: BuilderDispatch;
}

/** What has to hold before the automation goes ahead; absent until it is asked for. */
export function ConditionsSection({
  conditions,
  refs,
  issues,
  pulseId,
  dispatch,
}: ConditionsSectionProps) {
  const { t } = useTranslation('pages');
  const headingId = useId();

  const { groups } = conditions;
  const hasFields = fieldsAvailableFor(contextOf(refs.triggers)).length > 0;
  const sectionIssues = issues.get(BUILDER_SECTIONS.conditions);

  const addGroup = (
    <Button
      type="button"
      variant={groups.length === 0 ? 'outline' : 'ghost'}
      size="sm"
      disabled={!hasFields}
      className={groups.length === 0 ? undefined : 'text-muted-foreground'}
      onClick={() => dispatch({ type: 'addConditionGroup' })}
    >
      <Plus />
      {groups.length === 0
        ? t('automations.builder.conditions.reveal')
        : t('automations.builder.conditions.addGroup')}
    </Button>
  );

  return (
    <section
      id={nodeDomId(BUILDER_SECTIONS.conditions)}
      tabIndex={-1}
      aria-labelledby={groups.length > 0 ? headingId : undefined}
      className="space-y-3 outline-none"
    >
      {groups.length > 0 && (
        <h2 id={headingId} className="text-base font-semibold">
          {t('automations.builder.conditions.sectionTitle')}
        </h2>
      )}

      {groups.map((group, index) => (
        <Fragment key={idOf(group)}>
          {index > 0 && (
            <FieldSeparator role="presentation">
              {t('automations.builder.conditions.groupSeparator')}
            </FieldSeparator>
          )}
          <ConditionGroupCard
            group={group}
            refs={refs}
            issues={issues}
            pulseId={pulseId}
            dispatch={dispatch}
          />
        </Fragment>
      ))}

      <RowIssues issues={sectionIssues} />

      {hasFields ? (
        addGroup
      ) : (
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">{addGroup}</span>
          </TooltipTrigger>
          <TooltipContent>{t('automations.builder.conditions.noFields')}</TooltipContent>
        </Tooltip>
      )}
    </section>
  );
}
