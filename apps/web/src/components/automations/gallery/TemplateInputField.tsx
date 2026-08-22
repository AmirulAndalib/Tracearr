import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  AutomationFilterOptions,
  Condition,
  Server,
  TemplateDefinition,
  TemplateInput,
  UnitSystem,
} from '@tracearr/shared';
import { Combobox, type ComboboxOption } from '@/components/ui/combobox';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { MultiSelect } from '@/components/ui/multi-select';
import { NumericInput } from '@/components/ui/numeric-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { DestinationsField } from '@/components/automations/builder/DestinationsField';
import { conditionValueView, FieldControl } from '@/components/automations/builder/fields';
import { useUsers } from '@/hooks/queries/useUsers';
import {
  conditionFieldForInput,
  fieldDescriptor,
  messageSlotForInput,
  templateInputLabel,
} from '@/lib/automations';

/** Longer than a line: the two viewer messages both are, and both want the box. */
const TEXTAREA_OVER = 120;

interface TemplateInputFieldProps {
  input: TemplateInput;
  /** Where the input's value lands, which is what decides a number's control and its unit. */
  definition: TemplateDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  servers: readonly Server[];
  /** The server the form has bound, so an account picker knows whose accounts to offer. */
  boundServerId: string;
  filterOptions: AutomationFilterOptions | undefined;
  unitSystem: UnitSystem;
  /** A required input left empty, once the reader has tried to submit. */
  invalid: boolean;
  /** Told which row has focus, so the sentence can light the clause it wrote. */
  onFocusInput?: (key: string | null) => void;
}

/** One template input as the row that fills it in. */
export function TemplateInputField({
  input,
  definition,
  value,
  onChange,
  servers,
  boundServerId,
  filterOptions,
  unitSystem,
  invalid,
  onFocusInput,
}: TemplateInputFieldProps) {
  const { t } = useTranslation('pages');
  const controlId = useId();
  const labelId = `${controlId}-label`;
  const label = templateInputLabel(t, input);

  const needsAccounts = input.kind === 'account' && boundServerId !== '';
  const { data: accountsPage } = useUsers(
    { serverId: boundServerId, pageSize: 100 },
    { enabled: needsAccounts }
  );
  const { data: identitiesPage } = useUsers(
    { pageSize: 100 },
    { enabled: input.kind === 'person' }
  );

  const pickerLabels = {
    searchPlaceholder: t('automations.builder.searchPlaceholder'),
    emptyText: t('automations.builder.noMatches'),
  };

  // A value that fills a condition is edited exactly as the builder edits that condition,
  // which is where the unit system conversion and the option lists come from.
  const valueField =
    input.kind === 'field_value' ? input.field : conditionFieldForInput(definition, input.key);
  const descriptor = valueField ? fieldDescriptor(valueField) : undefined;
  const conditionView = (current: unknown) => {
    if (!valueField || !descriptor) return undefined;
    const condition = {
      field: valueField,
      operator: descriptor.valueType === 'multiSelect' ? 'in' : 'eq',
      value: current as Condition['value'],
    } satisfies Condition;
    return conditionValueView(t, condition, descriptor, { filterOptions, unitSystem });
  };

  const control = () => {
    switch (input.kind) {
      case 'destinations':
        return (
          <DestinationsField
            label={label}
            labelledBy={labelId}
            value={Array.isArray(value) ? value.map(String) : []}
            onChange={onChange}
          />
        );

      case 'server': {
        const options: ComboboxOption[] = [
          { value: '', label: t('automations.bind.anyServer') },
          ...servers.map((server) => ({ value: server.id, label: server.name })),
        ];
        return (
          <Combobox
            id={controlId}
            value={typeof value === 'string' ? value : ''}
            options={options}
            onChange={onChange}
            placeholder={t('automations.bind.anyServer')}
            {...pickerLabels}
          />
        );
      }

      case 'account':
        return (
          <Combobox
            id={controlId}
            value={typeof value === 'string' ? value : null}
            options={(accountsPage?.data ?? []).map((account) => ({
              value: account.id,
              label: account.identityName ?? account.username,
            }))}
            onChange={onChange}
            placeholder={label}
            {...pickerLabels}
          />
        );

      case 'person':
        return (
          <Combobox
            id={controlId}
            value={typeof value === 'string' ? value : null}
            options={(identitiesPage?.data ?? []).map((identity) => ({
              value: identity.userId,
              label: identity.identityName ?? identity.username,
            }))}
            onChange={onChange}
            placeholder={label}
            {...pickerLabels}
          />
        );

      case 'field_value': {
        const view = conditionView(value ?? []);
        if (!view) return null;
        return (
          <FieldControl
            id={controlId}
            aria-labelledby={labelId}
            spec={view.spec}
            value={view.value}
            onChange={(next) => onChange(view.toStored(next))}
          />
        );
      }

      case 'duration':
        return (
          <div className="flex items-center gap-2">
            <NumericInput
              id={controlId}
              className="max-w-24"
              min={input.min}
              max={input.max}
              value={typeof value === 'number' ? value : (input.default ?? input.min ?? 1)}
              onChange={onChange}
            />
            <span className="text-muted-foreground text-sm">
              {t(`automations.units.${input.unit}`)}
            </span>
          </div>
        );

      case 'number': {
        const view = conditionView(typeof value === 'number' ? value : (input.default ?? 0));
        if (view) {
          return (
            <FieldControl
              id={controlId}
              aria-labelledby={labelId}
              spec={view.spec}
              value={view.value}
              onChange={(next) => onChange(view.toStored(next))}
            />
          );
        }
        return (
          <div className="flex items-center gap-2">
            <NumericInput
              id={controlId}
              className="max-w-24"
              min={input.min}
              max={input.max}
              step={input.step}
              value={typeof value === 'number' ? value : (input.default ?? input.min ?? 0)}
              onChange={onChange}
            />
            {input.unit && <span className="text-muted-foreground text-sm">{input.unit}</span>}
          </div>
        );
      }

      case 'boolean':
        return (
          <Switch
            id={controlId}
            checked={value === true}
            onCheckedChange={onChange}
            aria-labelledby={labelId}
          />
        );

      case 'select': {
        const options = input.options.map((option) => ({
          value: option.value,
          label: option.label,
        }));
        if (input.multiple) {
          return (
            <MultiSelect
              id={controlId}
              aria-labelledby={labelId}
              options={options}
              value={Array.isArray(value) ? value.map(String) : []}
              onChange={onChange}
              placeholder={label}
              searchPlaceholder={pickerLabels.searchPlaceholder}
              emptyMessage={pickerLabels.emptyText}
              clearLabel={t('automations.builder.clearSelection')}
              countLabel={(count) => t('automations.builder.selectedCount', { count })}
            />
          );
        }
        return (
          <Select value={typeof value === 'string' ? value : ''} onValueChange={onChange}>
            <SelectTrigger id={controlId} aria-labelledby={labelId}>
              <SelectValue placeholder={label} />
            </SelectTrigger>
            <SelectContent>
              {options.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      }

      case 'text': {
        const text = typeof value === 'string' ? value : '';
        const props = {
          id: controlId,
          maxLength: input.maxLength,
          value: text,
          onChange: (event: { target: { value: string } }) => onChange(event.target.value),
        };
        return (input.maxLength ?? 0) > TEXTAREA_OVER ? (
          <Textarea {...props} />
        ) : (
          <Input {...props} />
        );
      }
    }
  };

  const messageSlot = messageSlotForInput(definition, input.key);
  // The envelope's own words win; these two slots get the app's when it carries none.
  const ownHelper = messageSlot
    ? t(`automations.bind.helper.${messageSlot}`)
    : input.kind === 'server'
      ? t('automations.bind.serverHelper')
      : undefined;
  const description = input.description ?? ownHelper;

  // Capture catches the focus of every control the switch below can render.
  const focus = {
    onFocusCapture: () => onFocusInput?.(input.key),
    onBlurCapture: () => onFocusInput?.(null),
  };

  if (input.kind === 'boolean') {
    return (
      <Field orientation="horizontal" {...focus}>
        {control()}
        <FieldContent>
          <FieldLabel id={labelId} htmlFor={controlId}>
            {label}
          </FieldLabel>
          {description && <FieldDescription>{description}</FieldDescription>}
        </FieldContent>
      </Field>
    );
  }

  return (
    <Field data-invalid={invalid || undefined} {...focus}>
      {/* Destinations are a chip group with no single control to point a label at. */}
      <FieldLabel id={labelId} htmlFor={input.kind === 'destinations' ? undefined : controlId}>
        {label}
      </FieldLabel>
      {control()}
      {description && <FieldDescription>{description}</FieldDescription>}
      {invalid && <FieldError>{t('automations.bind.required')}</FieldError>}
    </Field>
  );
}
