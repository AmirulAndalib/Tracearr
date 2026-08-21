import { Fragment, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { TRIGGERS, type TriggerNode, type TriggerType } from '@tracearr/shared';
import { FieldError, FieldSeparator } from '@/components/ui/field';
import { ItemGroup } from '@/components/ui/item';
import { Kbd } from '@/components/ui/kbd';
import { suggestedValues, triggerPickerEntries } from '@/lib/automations';
import { nodeDomId, type BuilderDispatch } from './builderReducer';
import { NodePicker } from './NodePicker';
import { TriggerRow } from './TriggerRow';
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
  const [activeIndex, setActiveIndex] = useState(0);
  const [reclaimIndex, setReclaimIndex] = useState<number | null>(null);

  const entries = useMemo(() => triggerPickerEntries(t), [t]);
  const suggested = useMemo(
    () =>
      suggestedValues(
        entries,
        triggers.map((trigger) => trigger.type)
      ),
    [entries, triggers]
  );

  const focusRow = (index: number) => {
    const target = triggers[index];
    if (!target) return;
    setActiveIndex(index);
    document.getElementById(nodeDomId(target.id))?.focus();
  };

  // A removed row takes the keyboard with it, so its neighbour or the picker takes over.
  useEffect(() => {
    if (reclaimIndex === null) return;
    setReclaimIndex(null);
    const next = Math.min(reclaimIndex, triggers.length - 1);
    const target = triggers[next];
    if (target) {
      setActiveIndex(next);
      document.getElementById(nodeDomId(target.id))?.focus();
      return;
    }
    sectionRef.current?.querySelector<HTMLElement>('[data-node-picker]')?.focus();
  }, [reclaimIndex, triggers]);

  const handleKeyDown = (index: number) => (event: KeyboardEvent<HTMLDivElement>) => {
    // Arrows and Delete belong to whatever control the row holds once focus is inside it,
    // and a modifier means the browser's shortcut, not the row's.
    if (event.target !== event.currentTarget) return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const trigger = triggers[index];
    if (!trigger) return;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      focusRow(index + (event.key === 'ArrowDown' ? 1 : -1));
      return;
    }
    if (event.key === 'd' || event.key === 'D') {
      event.preventDefault();
      dispatch({ type: 'toggleNode', id: trigger.id });
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      dispatch({ type: 'removeNode', id: trigger.id });
      setReclaimIndex(index);
    }
  };

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
                tabIndex={index === Math.min(activeIndex, triggers.length - 1) ? 0 : -1}
                dispatch={dispatch}
                onRowFocus={() => setActiveIndex(index)}
                onRowKeyDown={handleKeyDown(index)}
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
