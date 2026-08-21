import { Fragment, useId, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { TRIGGERS, type TriggerNode, type TriggerType } from '@tracearr/shared';
import { FieldError, FieldSeparator } from '@/components/ui/field';
import { ItemGroup } from '@/components/ui/item';
import { Kbd } from '@/components/ui/kbd';
import { suggestedValues, triggerPickerEntries } from '@/lib/automations';
import { nodeDomId, type BuilderDispatch } from './builderReducer';
import { NodePicker } from './NodePicker';
import { TriggerRow } from './TriggerRow';
import { useRowKeyboard } from './useRowKeyboard';
import { BUILDER_SECTIONS, type NodeIssues } from './validation';

interface TriggersSectionProps {
  triggers: readonly TriggerNode[];
  issues: NodeIssues;
  pulseId: string | null;
  dispatch: BuilderDispatch;
}

function isTriggerType(value: string): value is TriggerType {
  return value in TRIGGERS;
}

export function TriggersSection({ triggers, issues, pulseId, dispatch }: TriggersSectionProps) {
  const { t } = useTranslation('pages');
  const headingId = useId();
  const sectionRef = useRef<HTMLElement>(null);

  const entries = useMemo(() => triggerPickerEntries(t), [t]);
  const suggested = useMemo(
    () =>
      suggestedValues(
        entries,
        triggers.map((trigger) => trigger.type)
      ),
    [entries, triggers]
  );

  const rows = useRowKeyboard({
    ids: triggers.map((trigger) => trigger.id),
    sectionRef,
    onToggle: (id) => dispatch({ type: 'toggleNode', id }),
    onRemove: (id, index) => {
      dispatch({ type: 'removeNode', id });
      rows.reclaim(index);
    },
  });

  const sectionIssues = issues.get(BUILDER_SECTIONS.triggers);

  return (
    <section
      ref={sectionRef}
      id={nodeDomId(BUILDER_SECTIONS.triggers)}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="space-y-3 outline-none"
    >
      <h2 id={headingId} className="text-base font-semibold">
        {t('automations.builder.when.title')}
      </h2>

      {triggers.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('automations.builder.when.empty')}</p>
      ) : (
        <ItemGroup className="gap-2">
          {triggers.map((trigger, index) => (
            <Fragment key={trigger.id}>
              {index > 0 && (
                <FieldSeparator role="presentation">
                  {t('automations.builder.when.or')}
                </FieldSeparator>
              )}
              <TriggerRow
                trigger={trigger}
                issues={issues.get(trigger.id)}
                pulsing={pulseId === trigger.id}
                rowProps={rows.rowProps(index)}
                dispatch={dispatch}
              />
            </Fragment>
          ))}
        </ItemGroup>
      )}

      {sectionIssues?.map((message) => (
        <FieldError key={message}>{message}</FieldError>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <NodePicker
          entries={entries}
          suggested={suggested}
          label={t('automations.builder.when.add')}
          onSelect={(value) => {
            if (isTriggerType(value)) dispatch({ type: 'addTrigger', triggerType: value });
          }}
        />
        {triggers.length > 0 && (
          <span className="text-muted-foreground flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1">
              <Kbd>D</Kbd>
              {t('automations.builder.rows.toggleHint')}
            </span>
            <span className="flex items-center gap-1">
              <Kbd>Del</Kbd>
              {t('automations.builder.rows.removeHint')}
            </span>
          </span>
        )}
      </div>
    </section>
  );
}
