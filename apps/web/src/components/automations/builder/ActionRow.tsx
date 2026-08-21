import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  X,
  AlertTriangle,
  Bell,
  TrendingUp,
  XCircle,
  MessageSquare,
  HelpCircle,
} from 'lucide-react';
import type { Action, AutomationKind, LeafActionType } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ACTION_DEFINITIONS,
  actionDescription,
  actionHint,
  actionLabel,
  actionTypesForKind,
  applyActionFieldChange,
  configFieldOptions,
  createDefaultAction,
  visibleConfigFields,
  type ConfigField,
  type ConfigFieldOption,
  type Translate,
} from '@/lib/automations';
import { cn } from '@/lib/utils';
import { DestinationsField } from './DestinationsField';
import { FieldControl, type ControlSpec, type ControlValue } from './fields';

const ACTION_ICONS: Record<LeafActionType, React.ComponentType<{ className?: string }>> = {
  send: Bell,
  trust: TrendingUp,
  kill_stream: XCircle,
  message_client: MessageSquare,
};

interface ActionRowProps {
  action: Action;
  kind: AutomationKind;
  onChange: (action: Action) => void;
  onRemove: () => void;
  showRemove?: boolean;
}

export function ActionRow({ action, kind, onChange, onRemove, showRemove = true }: ActionRowProps) {
  const { t } = useTranslation('pages');
  const typeId = useId();
  // A control node has no row of its own; its branches carry the effects.
  if (action.type === 'if') return null;
  const def = ACTION_DEFINITIONS[action.type];
  const hint = actionHint(t, action.type);

  const typeOptions = actionTypesForKind(kind);

  const readValue = (name: string) => (action as unknown as Record<string, unknown>)[name];

  return (
    <div
      className={cn(
        'relative rounded-lg border p-4',
        showRemove && 'pr-14',
        def.color === 'destructive' && 'border-destructive/50 bg-destructive/5',
        def.color === 'warning' && 'border-warning/50 bg-warning/5',
        def.color === 'default' && 'border-border bg-card'
      )}
    >
      {showRemove && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t('automations.builder.actions.remove')}
          className="text-muted-foreground hover:text-destructive absolute top-3 right-3"
          onClick={onRemove}
        >
          <X className="h-4 w-4" />
        </Button>
      )}

      <div className="grid gap-4 @md:grid-cols-2 @3xl:grid-cols-3">
        <Field>
          <FieldLabel htmlFor={typeId}>{t('automations.builder.actions.typeLabel')}</FieldLabel>
          <Select
            value={action.type}
            onValueChange={(type) => onChange(createDefaultAction(type as LeafActionType))}
          >
            <SelectTrigger id={typeId}>
              <SelectValue placeholder={t('automations.builder.actions.typePlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              {typeOptions.map((type) => {
                const ActionIcon = ACTION_ICONS[type];
                return (
                  <SelectItem key={type} value={type}>
                    <span className="flex items-center gap-2">
                      <ActionIcon className="h-4 w-4" />
                      {actionLabel(t, type)}
                    </span>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <FieldDescription>{actionDescription(t, action.type)}</FieldDescription>
        </Field>

        {visibleConfigFields(action).map((field) => (
          <ActionConfigField
            key={field.name}
            t={t}
            field={field}
            value={readValue(field.name)}
            onChange={(value) => onChange(applyActionFieldChange(action, field.name, value))}
          />
        ))}
      </div>

      {hint && (
        <p className="text-warning mt-3 flex items-start gap-1.5 text-xs">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          {hint}
        </p>
      )}
    </div>
  );
}

interface ActionConfigFieldProps {
  t: Translate;
  field: ConfigField;
  value: unknown;
  onChange: (value: unknown) => void;
}

function ActionConfigField({ t, field, value, onChange }: ActionConfigFieldProps) {
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

export default ActionRow;
