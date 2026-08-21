import { useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { TriangleAlert } from 'lucide-react';
import {
  contextOf,
  fieldsAvailableFor,
  type Condition,
  type ConditionField,
  type Operator,
} from '@tracearr/shared';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import { FieldError } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  categoryLabel,
  defaultParamsForField,
  fieldDescription,
  fieldDescriptor,
  fieldLabel,
  fieldsByCategory,
  getDefaultOperatorForField,
  getDefaultValueForField,
  isArrayOperator,
  operatorLabel,
  orphaningTriggers,
  unreachableNote,
  FIELD_CATEGORIES,
} from '@/lib/automations';
import { cn } from '@/lib/utils';
import { idOf, nodeDomId, type BuilderDispatch } from './builderReducer';
import { ConditionParams, FieldControl, conditionValueView } from './fields';
import { RowActions } from './RowActions';
import type { BuilderRefs } from './builderRefs';
import type { RowProps } from './useRowKeyboard';

interface ConditionRowProps {
  condition: Condition;
  /** The cell that opens the row: "Where", the logic toggle, or the logic in words. */
  lead: ReactNode;
  refs: BuilderRefs;
  issues: string[] | undefined;
  pulsing: boolean;
  rowProps: RowProps;
  dispatch: BuilderDispatch;
}

export function ConditionRow({
  condition,
  lead,
  refs,
  issues,
  pulsing,
  rowProps,
  dispatch,
}: ConditionRowProps) {
  const { t } = useTranslation('pages');
  const id = idOf(condition);
  const descriptor = fieldDescriptor(condition.field);

  const available = useMemo(
    () => new Set(fieldsAvailableFor(contextOf(refs.triggers))),
    [refs.triggers]
  );
  const options = useMemo<ComboboxOption<ConditionField>[]>(() => {
    const byCategory = fieldsByCategory();
    return FIELD_CATEGORIES.flatMap((category) =>
      byCategory[category]
        // The row's own field stays listed so the picker keeps a label for it.
        .filter((field) => available.has(field) || field === condition.field)
        .map((field) => ({
          value: field,
          label: fieldLabel(t, field),
          description: fieldDescription(t, field),
          group: categoryLabel(t, category),
        }))
    );
  }, [available, condition.field, t]);

  // A stored automation can carry a field this build no longer defines
  // (library_id was removed); rendering nothing beats taking the page down.
  if (!descriptor) return null;

  const change = (next: Condition) =>
    dispatch({ type: 'setCondition', id, condition: { ...next, id, enabled: condition.enabled } });

  const changeField = (field: ConditionField) => {
    const params = defaultParamsForField(field);
    change({
      field,
      operator: getDefaultOperatorForField(field),
      value: getDefaultValueForField(field),
      ...(Object.keys(params).length > 0 ? { params } : {}),
    });
  };

  const changeOperator = (operator: Operator) => {
    const wasArray = isArrayOperator(condition.operator);
    const isArray = isArrayOperator(operator);

    let value = condition.value;
    if (wasArray && !isArray && Array.isArray(condition.value)) {
      value = condition.value[0] ?? getDefaultValueForField(condition.field);
    } else if (!wasArray && isArray && !Array.isArray(condition.value)) {
      value = condition.value ? [String(condition.value)] : [];
    }
    change({ ...condition, operator, value });
  };

  const view = conditionValueView(t, condition, descriptor, {
    filterOptions: refs.filterOptions,
    unitSystem: refs.unitSystem,
  });
  const name = fieldLabel(t, condition.field);
  const orphaned = orphaningTriggers(t, refs.triggers, condition.field);
  const unreachable = unreachableNote(t, refs.triggers, condition);
  const enabled = condition.enabled !== false;

  return (
    <div
      role="listitem"
      id={nodeDomId(id)}
      tabIndex={rowProps.tabIndex}
      aria-keyshortcuts="D Delete"
      data-pulse={pulsing}
      data-orphaned={orphaned.length > 0 && issues !== undefined}
      onFocus={rowProps.onFocus}
      onKeyDown={rowProps.onKeyDown}
      className={cn(
        'rounded-md p-1 outline-none',
        'data-[pulse=true]:ring-primary/60 data-[pulse=true]:ring-2',
        'data-[orphaned=true]:ring-warning/50 data-[orphaned=true]:ring-1',
        !enabled && 'opacity-60'
      )}
    >
      <div className="flex flex-wrap items-start gap-2">
        <div className="text-muted-foreground flex h-9 w-28 shrink-0 items-center text-sm">
          {lead}
        </div>

        <Combobox
          aria-label={t('automations.builder.conditions.fieldLabel')}
          className="w-full @sm:w-52"
          value={condition.field}
          options={options}
          onChange={changeField}
          placeholder={t('automations.builder.conditions.fieldPlaceholder')}
          searchPlaceholder={t('automations.builder.searchPlaceholder')}
          emptyText={t('automations.builder.noMatches')}
        />

        <Select value={condition.operator} onValueChange={changeOperator}>
          <SelectTrigger
            className="w-full @sm:w-40"
            aria-label={t('automations.builder.conditions.operatorLabel')}
          >
            <SelectValue placeholder={t('automations.builder.conditions.operatorPlaceholder')} />
          </SelectTrigger>
          <SelectContent>
            {descriptor.operators.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {operatorLabel(t, operator)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="min-w-36 flex-1">
          <FieldControl
            spec={view.spec}
            value={view.value}
            aria-label={t('automations.builder.conditions.valueLabel')}
            onChange={(next) => change({ ...condition, value: view.toStored(next) })}
          />
        </div>

        <ConditionParams condition={condition} descriptor={descriptor} onChange={change} />

        <div className="flex items-center gap-1">
          <RowActions
            name={name}
            enabled={enabled}
            onToggle={() => dispatch({ type: 'toggleNode', id })}
            onRemove={() => dispatch({ type: 'removeNode', id })}
          />
        </div>
      </div>

      {orphaned.length > 0
        ? issues?.map((message) => <RowWarning key={message} message={message} />)
        : issues?.map((message) => <FieldError key={message}>{message}</FieldError>)}
      {unreachable && <RowWarning message={unreachable} />}
    </div>
  );
}

/** A row that will not do what it looks like it does, said in plain words. */
export function RowWarning({ message }: { message: string }) {
  return (
    <p className="text-warning mt-1.5 flex items-start gap-1.5 text-xs">
      <TriangleAlert className="mt-0.5 size-3 shrink-0" />
      {message}
    </p>
  );
}
