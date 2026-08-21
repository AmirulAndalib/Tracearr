import { useId } from 'react';
import { HelpCircle } from 'lucide-react';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  configFieldOptions,
  type ConfigField,
  type ConfigFieldOption,
  type Translate,
} from '@/lib/automations';
import { cn } from '@/lib/utils';
import { DestinationsField } from '../DestinationsField';
import { FieldControl, type ControlSpec, type ControlValue } from './FieldControl';

interface ActionConfigFieldProps {
  t: Translate;
  field: ConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
}

/** One configurable part of an action, from the registry's declaration of it. */
export function ActionConfigField({ t, field, value, onChange }: ActionConfigFieldProps) {
  const controlId = useId();
  const labelId = useId();
  const options = configFieldOptions(t, field);

  if (field.type === 'destinations') {
    return (
      <Field className="col-span-full">
        <FieldLabel id={labelId}>{field.label}</FieldLabel>
        <DestinationsField
          value={(value as string[]) ?? []}
          onChange={onChange}
          label={field.label}
          labelledBy={labelId}
        />
        {field.description && <FieldDescription>{field.description}</FieldDescription>}
      </Field>
    );
  }

  const tooltips = options.filter((option) => option.tooltip);

  return (
    <Field className={cn(field.fullWidth && 'col-span-full')}>
      <FieldLabel htmlFor={controlId}>
        {field.label}
        {tooltips.length > 0 && (
          <Tooltip>
            <TooltipTrigger asChild>
              <HelpCircle className="text-muted-foreground/70 hover:text-muted-foreground h-3.5 w-3.5 cursor-help" />
            </TooltipTrigger>
            <TooltipContent side="bottom" align="start" className="w-max">
              <div className="space-y-1.5">
                {tooltips.map((option) => (
                  <div key={option.value}>
                    <span className="font-medium">{option.label}:</span>{' '}
                    <span className="text-muted-foreground">{option.tooltip}</span>
                  </div>
                ))}
              </div>
            </TooltipContent>
          </Tooltip>
        )}
      </FieldLabel>
      <FieldControl
        id={controlId}
        spec={toControlSpec(field, options)}
        value={value as ControlValue | undefined}
        onChange={onChange}
      />
      {field.description && <FieldDescription>{field.description}</FieldDescription>}
    </Field>
  );
}

function toControlSpec(field: ConfigField, options: ConfigFieldOption[]): ControlSpec {
  switch (field.type) {
    case 'number':
      return { kind: 'number', min: field.min, max: field.max, step: field.step, unit: field.unit };
    case 'select':
      return { kind: 'select', options, placeholder: field.placeholder };
    case 'slider':
      return { kind: 'slider', min: field.min ?? 0, max: field.max ?? 100, step: field.step ?? 1 };
    default:
      return { kind: 'text', placeholder: field.placeholder ?? field.label };
  }
}
