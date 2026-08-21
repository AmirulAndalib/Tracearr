import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type {
  Condition,
  ConditionField,
  ConditionFieldDescriptor,
  DeviceType,
  Operator,
  AutomationFilterOptions,
} from '@tracearr/shared';
import { fromMetricDistance, toMetricDistance, formatConditionFieldValue } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { NumericInput } from '@/components/ui/numeric-input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { MultiSelectOption } from '@/components/ui/multi-select';
import {
  categoryLabel,
  defaultParamsForField,
  fieldDescription,
  fieldDescriptor,
  fieldLabel,
  fieldOptions,
  fieldPlaceholder,
  fieldsByCategory,
  getDefaultOperatorForField,
  getDefaultValueForField,
  isArrayOperator,
  operatorLabel,
  unitLabel,
  FIELD_CATEGORIES,
  type Translate,
} from '@/lib/automations';
import { useSettings } from '@/hooks/queries';
import { FieldControl, type ControlSpec, type ControlValue } from '../builder/fields';

interface CountryGroupLabels {
  recentlySeen: string;
  allCountries: string;
}

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
  const unitSystem = settings?.unitSystem ?? 'metric';

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

  const updateParams = (params: Partial<NonNullable<Condition['params']>>) => {
    onChange({ ...condition, params: { ...condition.params, ...params } });
  };

  const handleCountDeviceTypesChange = (types: string[]) => {
    const { count_device_types: _dropped, ...rest } = condition.params ?? {};
    onChange({
      ...condition,
      params:
        types.length > 0 ? { ...rest, count_device_types: types as DeviceType[] } : { ...rest },
    });
  };

  const conversion = numberConversion(descriptor, condition, unitSystem);
  const valueSpec = buildValueSpec(t, condition.field, descriptor, {
    isArray: isArrayOperator(condition.operator),
    filterOptions,
    displayUnit: conversion.unit,
    countryGroups: {
      recentlySeen: t('automations.builder.conditions.recentlySeen'),
      allCountries: t('automations.builder.conditions.allCountries'),
    },
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
          spec={valueSpec}
          value={conversion.displayValue}
          onChange={(next) => onChange({ ...condition, value: conversion.toStored(next) })}
        />
      </div>

      {descriptor.flags.windowHours && (
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground text-sm whitespace-nowrap">
            {t('automations.builder.conditions.windowPrefix')}
          </span>
          <NumericInput
            className="w-16"
            aria-label={t('automations.builder.conditions.windowUnit')}
            min={1}
            max={168}
            value={condition.params?.window_hours ?? 24}
            onChange={(window_hours) => updateParams({ window_hours })}
          />
          <span className="text-muted-foreground text-sm">
            {t('automations.builder.conditions.windowUnit')}
          </span>
        </div>
      )}

      {descriptor.flags.excludeSameDevice && (
        <ConditionToggle
          label={t('automations.builder.conditions.uniqueDevices')}
          hint={t('automations.builder.conditions.uniqueDevicesHint')}
          checked={condition.params?.exclude_same_device ?? true}
          onChange={(exclude_same_device) => updateParams({ exclude_same_device })}
        />
      )}

      {descriptor.flags.excludeSameIp && (
        <ConditionToggle
          label={t('automations.builder.conditions.uniqueIps')}
          hint={t('automations.builder.conditions.uniqueIpsHint')}
          checked={condition.params?.exclude_same_ip ?? false}
          onChange={(exclude_same_ip) => updateParams({ exclude_same_ip })}
        />
      )}

      {descriptor.flags.countDeviceTypes && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-44 shrink-0">
              <FieldControl
                id={`${fieldId}-device-types`}
                spec={{
                  kind: 'multiSelect',
                  options: fieldOptions(t, 'device_type'),
                  placeholder: t('automations.builder.conditions.allDeviceTypes'),
                }}
                value={condition.params?.count_device_types ?? []}
                onChange={(types) => handleCountDeviceTypesChange(types as string[])}
              />
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-60">
            {t('automations.builder.conditions.deviceTypesHint')}
          </TooltipContent>
        </Tooltip>
      )}

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

interface ConditionToggleProps {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

function ConditionToggle({ label, hint, checked, onChange }: ConditionToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <label className="flex h-9 cursor-pointer items-center gap-2 whitespace-nowrap">
          <Checkbox checked={checked} onCheckedChange={onChange} />
          <span className="text-muted-foreground text-sm">{label}</span>
        </label>
      </TooltipTrigger>
      <TooltipContent side="top" className="max-w-60">
        {hint}
      </TooltipContent>
    </Tooltip>
  );
}

function dynamicOptions(
  field: ConditionField,
  filterOptions: AutomationFilterOptions | undefined,
  groupLabels: CountryGroupLabels
): MultiSelectOption[] | undefined {
  if (!filterOptions) return undefined;

  switch (fieldDescriptor(field)?.dynamicSource) {
    case 'countries':
      return filterOptions.countries?.map((country) => ({
        value: country.code,
        label: country.name,
        group: country.hasSessions ? groupLabels.recentlySeen : groupLabels.allCountries,
      }));
    case 'servers':
      return filterOptions.servers?.map((server) => ({ value: server.id, label: server.name }));
    case 'users':
      return filterOptions.users?.map((user) => ({
        value: user.id,
        label: user.identityName || user.username,
      }));
    default:
      return undefined;
  }
}

interface ValueSpecContext {
  isArray: boolean;
  filterOptions: AutomationFilterOptions | undefined;
  displayUnit: string | undefined;
  countryGroups: CountryGroupLabels;
}

function buildValueSpec(
  t: Translate,
  field: ConditionField,
  descriptor: ConditionFieldDescriptor,
  ctx: ValueSpecContext
): ControlSpec {
  const placeholder = fieldPlaceholder(t, field);

  switch (descriptor.valueType) {
    case 'boolean':
      return { kind: 'boolean' };
    case 'select':
    case 'multiSelect': {
      const options =
        dynamicOptions(field, ctx.filterOptions, ctx.countryGroups) ?? fieldOptions(t, field);
      return { kind: ctx.isArray ? 'multiSelect' : 'select', options, placeholder };
    }
    case 'number':
      return {
        kind: 'number',
        min: descriptor.min,
        max: descriptor.max,
        step: descriptor.step,
        unit: ctx.displayUnit ?? (descriptor.unit && unitLabel(t, descriptor.unit)),
      };
    default:
      return { kind: 'text', placeholder };
  }
}

interface NumberConversion {
  displayValue: ControlValue | undefined;
  toStored: (next: ControlValue) => Condition['value'];
  unit: string | undefined;
}

// Distances are stored metric; the picker shows whichever system the user set.
function numberConversion(
  descriptor: ConditionFieldDescriptor,
  condition: Condition,
  unitSystem: 'metric' | 'imperial'
): NumberConversion {
  const asIs: NumberConversion = {
    displayValue: condition.value,
    toStored: (next) => next,
    unit: undefined,
  };

  if (descriptor.valueType !== 'number' || typeof condition.value !== 'number') return asIs;

  const converted = formatConditionFieldValue(condition.value, condition.field, unitSystem);
  if (!converted.unit) return asIs;

  return {
    displayValue: Math.round(fromMetricDistance(condition.value, unitSystem)),
    toStored: (next) =>
      typeof next === 'number' ? Math.round(toMetricDistance(next, unitSystem)) : next,
    unit: converted.unit,
  };
}

export default ConditionRow;
