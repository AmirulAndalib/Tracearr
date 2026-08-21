import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { X, AlertTriangle } from 'lucide-react';
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
import {
  ACTION_DEFINITIONS,
  actionDescription,
  actionHint,
  actionIcon,
  actionLabel,
  actionTypesForKind,
  applyActionFieldChange,
  createDefaultAction,
  visibleConfigFields,
} from '@/lib/automations';
import { cn } from '@/lib/utils';
import { ActionConfigField } from '../builder/fields';

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
              {typeOptions.map((type) => (
                <SelectItem key={type} value={type}>
                  <span className="flex items-center gap-2">
                    {actionIcon(type)}
                    {actionLabel(t, type)}
                  </span>
                </SelectItem>
              ))}
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

export default ActionRow;
