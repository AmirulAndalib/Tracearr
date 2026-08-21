import type { KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { TriggerNode } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { FieldError } from '@/components/ui/field';
import { Item, ItemActions, ItemContent, ItemMedia, ItemTitle } from '@/components/ui/item';
import { NumericInput } from '@/components/ui/numeric-input';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { triggerIcon, triggerLabel } from '@/lib/automations';
import { cn } from '@/lib/utils';
import {
  nodeDomId,
  TRIGGER_PARAM_BOUNDS,
  type BuilderDispatch,
  type TriggerParamPatch,
} from './builderReducer';

/** The row's own sentence, with the threshold sitting inside it where it is read. */
function TriggerTitle({
  trigger,
  setParam,
}: {
  trigger: TriggerNode;
  setParam: (patch: TriggerParamPatch) => void;
}) {
  const { t } = useTranslation('pages');

  if (trigger.type === 'session.held_for') {
    return (
      <>
        {t('automations.builder.heldFor.prefix')}
        <NumericInput
          aria-label={t('automations.builder.heldFor.minutesLabel')}
          className="h-8 w-16"
          value={trigger.params.minutes}
          min={TRIGGER_PARAM_BOUNDS.minutes.min}
          max={TRIGGER_PARAM_BOUNDS.minutes.max}
          onChange={(minutes) => setParam({ minutes })}
        />
        {t('automations.builder.heldFor.unit')}
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          value={trigger.params.measure}
          aria-label={t('automations.builder.heldFor.measureLabel')}
          onValueChange={(measure) => {
            if (measure === 'current' || measure === 'total') setParam({ measure });
          }}
        >
          <ToggleGroupItem value="current">
            {t('automations.builder.heldFor.current')}
          </ToggleGroupItem>
          <ToggleGroupItem value="total">{t('automations.builder.heldFor.total')}</ToggleGroupItem>
        </ToggleGroup>
      </>
    );
  }

  if (trigger.type === 'account.inactive_for') {
    return (
      <>
        {t('automations.builder.inactiveFor.prefix')}
        <NumericInput
          aria-label={t('automations.builder.inactiveFor.daysLabel')}
          className="h-8 w-16"
          value={trigger.params.days}
          min={TRIGGER_PARAM_BOUNDS.days.min}
          max={TRIGGER_PARAM_BOUNDS.days.max}
          onChange={(days) => setParam({ days })}
        />
        {t('automations.builder.inactiveFor.unit')}
      </>
    );
  }

  return <>{triggerLabel(t, trigger.type)}</>;
}

interface TriggerRowProps {
  trigger: TriggerNode;
  issues: string[] | undefined;
  pulsing: boolean;
  tabIndex: number;
  dispatch: BuilderDispatch;
  onRowFocus: () => void;
  onRowKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/** One thing that can start the automation, with its threshold in the sentence itself. */
export function TriggerRow({
  trigger,
  issues,
  pulsing,
  tabIndex,
  dispatch,
  onRowFocus,
  onRowKeyDown,
}: TriggerRowProps) {
  const { t } = useTranslation('pages');
  const name = triggerLabel(t, trigger.type);

  const setParam = (patch: TriggerParamPatch) =>
    dispatch({ type: 'setTriggerParam', id: trigger.id, patch });

  return (
    <Item
      role="listitem"
      id={nodeDomId(trigger.id)}
      variant="outline"
      size="sm"
      tabIndex={tabIndex}
      aria-keyshortcuts="D Delete"
      data-pulse={pulsing}
      onFocus={onRowFocus}
      onKeyDown={onRowKeyDown}
      className={cn(
        'data-[pulse=true]:ring-primary/60 data-[pulse=true]:ring-2',
        !trigger.enabled && 'opacity-60'
      )}
    >
      <ItemMedia variant="icon">{triggerIcon(trigger.type)}</ItemMedia>
      <ItemContent>
        <ItemTitle className="flex-wrap gap-2">
          <TriggerTitle trigger={trigger} setParam={setParam} />
        </ItemTitle>
        {issues?.map((message) => (
          <FieldError key={message}>{message}</FieldError>
        ))}
      </ItemContent>
      <ItemActions>
        {!trigger.enabled && (
          <Badge variant="secondary">{t('automations.builder.rows.skipped')}</Badge>
        )}
        <Switch
          checked={trigger.enabled}
          aria-label={t('automations.builder.rows.toggle', { name })}
          onCheckedChange={() => dispatch({ type: 'toggleNode', id: trigger.id })}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('automations.builder.rows.remove', { name })}
          onClick={() => dispatch({ type: 'removeNode', id: trigger.id })}
        >
          <X />
        </Button>
      </ItemActions>
    </Item>
  );
}
