import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type {
  Condition,
  ConditionField,
  Operator,
  AutomationFilterOptions,
} from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
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
  FIELD_CATEGORIES,
} from '@/lib/automations';
import { useSettings } from '@/hooks/queries';
import { ConditionParams, FieldControl, conditionValueView } from '../builder/fields';

interface ConditionRowProps {
  condition: Condition;
  onChange: (condition: Condition) => void;
  onRemove: () => void;
  showRemove?: boolean;
  filterOptions?: AutomationFilterOptions;
  allowedFields?: ReadonlySet<string>;
}

export function ConditionRow({
  condition,
  onChange,
  onRemove,
  showRemove = true,
  filterOptions,
  allowedFields,
}: ConditionRowProps) {
  const { t } = useTranslation('pages');
  const { data: settings } = useSettings();
  const fieldId = useId();

  const descriptor = fieldDescriptor(condition.field);
  const byCategory = fieldsByCategory();

  // A stored automation can carry a field this build no longer defines
  // (library_id was removed); rendering nothing beats taking the builder down.
  if (!descriptor) return null;

  const handleFieldChange = (newField: ConditionField) => {
    const params = defaultParamsForField(newField);

    onChange({
      field: newField,
      operator: getDefaultOperatorForField(newField),
      value: getDefaultValueForField(newField),
      ...(Object.keys(params).length > 0 ? { params } : {}),
    });
  };

  const handleOperatorChange = (newOperator: Operator) => {
    const wasArray = isArrayOperator(condition.operator);
    const isNowArray = isArrayOperator(newOperator);

    let newValue = condition.value;
    if (wasArray && !isNowArray && Array.isArray(condition.value)) {
      newValue = condition.value[0] ?? getDefaultValueForField(condition.field);
    } else if (!wasArray && isNowArray && !Array.isArray(condition.value)) {
      newValue = condition.value ? [condition.value as string] : [];
    }

    onChange({ ...condition, operator: newOperator, value: newValue });
  };

  const view = conditionValueView(t, condition, descriptor, {
    filterOptions,
    unitSystem: settings?.unitSystem ?? 'metric',
  });

  return (
    <div className="flex flex-wrap items-start gap-2">
      <Select value={condition.field} onValueChange={handleFieldChange}>
        <SelectTrigger
          className="w-full @sm:w-52"
          aria-label={t('automations.builder.conditions.fieldPlaceholder')}
        >
          <SelectValue placeholder={t('automations.builder.conditions.fieldPlaceholder')} />
        </SelectTrigger>
        <SelectContent className="min-w-60">
          {FIELD_CATEGORIES.map((category) => {
            // The row's own field always stays listed so the trigger keeps its
            // label even when the rest of the automation disallows it.
            const fields = byCategory[category].filter(
              (field) => !allowedFields || allowedFields.has(field) || field === condition.field
            );
            if (fields.length === 0) return null;
            return (
              <SelectGroup key={category}>
                <SelectLabel>{categoryLabel(t, category)}</SelectLabel>
                {fields.map((field) => (
                  <SelectItem key={field} value={field} title={fieldDescription(t, field)}>
                    {fieldLabel(t, field)}
                  </SelectItem>
                ))}
              </SelectGroup>
            );
          })}
        </SelectContent>
      </Select>

      <Select value={condition.operator} onValueChange={handleOperatorChange}>
        <SelectTrigger
          className="w-full @sm:w-40"
          aria-label={t('automations.builder.conditions.operatorPlaceholder')}
        >
          <SelectValue placeholder={t('automations.builder.conditions.operatorPlaceholder')} />
        </SelectTrigger>
        <SelectContent>
          {descriptor.operators.map((op) => (
            <SelectItem key={op} value={op}>
              {operatorLabel(t, op)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <div className="min-w-36 flex-1">
        <FieldControl
          id={`${fieldId}-value`}
          spec={view.spec}
          value={view.value}
          onChange={(next) => onChange({ ...condition, value: view.toStored(next) })}
        />
      </div>

      <ConditionParams condition={condition} descriptor={descriptor} onChange={onChange} />

      {showRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('automations.builder.conditions.removeCondition')}
          className="text-muted-foreground hover:text-destructive shrink-0"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

export default ConditionRow;
