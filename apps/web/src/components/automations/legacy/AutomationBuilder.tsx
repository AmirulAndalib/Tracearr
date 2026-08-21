import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus, Save, Loader2 } from 'lucide-react';
import type {
  AutomationKind,
  ConditionGroup as ConditionGroupType,
  AutomationConditions,
  AutomationActions,
  Action,
  ViolationSeverity,
  CreateAutomationInput,
  AutomationFilterOptions,
} from '@tracearr/shared';
import { AUTOMATION_KINDS, CONDITION_FIELDS, INACTIVITY_COMPATIBLE_FIELDS } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { ConditionGroup } from './ConditionGroup';
import { ActionRow } from './ActionRow';
import { ScopeField } from '../builder/ScopeField';
import {
  DEFAULT_ACTION_TYPE,
  getDefaultOperatorForField,
  getDefaultValueForField,
  createDefaultAction,
  severityLabel,
  SEVERITIES,
  canEnforceAcrossServers as scopeAllowsCrossServer,
  isScopeComplete,
  scopeFromAutomation,
  scopeToPayload,
  type AutomationScope,
} from '@/lib/automations';
import { cn } from '@/lib/utils';

export interface AutomationBuilderInput {
  id: string;
  name: string;
  description?: string | null;
  kind?: AutomationKind;
  severity?: ViolationSeverity | null;
  isActive: boolean;
  serverId?: string | null;
  serverUserId?: string | null;
  userId?: string | null;
  enforceAcrossServers?: boolean;
  conditions?: AutomationConditions | null;
  actions?: AutomationActions | null;
}

interface AutomationBuilderProps {
  initialAutomation?: AutomationBuilderInput;
  onSave: (data: CreateAutomationInput) => Promise<void>;
  onCancel: () => void;
  isLoading?: boolean;
  filterOptions?: AutomationFilterOptions;
}

const DEFAULT_FIELD = 'concurrent_streams';

function createDefaultConditionGroup(): ConditionGroupType {
  return {
    conditions: [
      {
        field: DEFAULT_FIELD,
        operator: getDefaultOperatorForField(DEFAULT_FIELD),
        value: getDefaultValueForField(DEFAULT_FIELD),
      },
    ],
  };
}

function extractConditions(automation?: AutomationBuilderInput): AutomationConditions {
  if (automation?.conditions && 'groups' in automation.conditions) return automation.conditions;
  return { groups: [createDefaultConditionGroup()] };
}

function extractActions(automation?: AutomationBuilderInput): AutomationActions {
  if (automation?.actions && 'actions' in automation.actions) return automation.actions;
  return { actions: [] };
}

export function AutomationBuilder({
  initialAutomation,
  onSave,
  onCancel,
  isLoading = false,
  filterOptions,
}: AutomationBuilderProps) {
  const { t } = useTranslation(['pages', 'common']);

  const [name, setName] = useState(initialAutomation?.name ?? '');
  const [description, setDescription] = useState(initialAutomation?.description ?? '');
  const [kind, setKind] = useState<AutomationKind>(initialAutomation?.kind ?? 'policy');
  // Kept across a switch to notification so switching back restores the picked severity.
  const [severity, setSeverity] = useState<ViolationSeverity>(
    initialAutomation?.severity ?? 'warning'
  );
  const [isActive, setIsActive] = useState(initialAutomation?.isActive ?? true);
  const [conditions, setConditions] = useState<AutomationConditions>(() =>
    extractConditions(initialAutomation)
  );
  const [actions, setActions] = useState<AutomationActions>(() =>
    extractActions(initialAutomation)
  );
  const [scope, setScope] = useState<AutomationScope>(() => scopeFromAutomation(initialAutomation));
  const [enforceAcrossServers, setEnforceAcrossServers] = useState(
    initialAutomation?.enforceAcrossServers ?? false
  );
  const [errors, setErrors] = useState<string[]>([]);
  const [submitted, setSubmitted] = useState(false);
  // The row the notification kind pre-adds, by identity: any edit replaces the object.
  const [preAddedAction, setPreAddedAction] = useState<Action | null>(null);

  // The backend rejects mixing inactive_days with session fields, so the field
  // picker offers only the still-valid choices for the automation as built.
  const allowedFields = useMemo<ReadonlySet<string> | undefined>(() => {
    const compatible = INACTIVITY_COMPATIBLE_FIELDS as readonly string[];
    const fields = conditions.groups.flatMap((g) => g.conditions.map((c) => c.field));
    if (fields.includes('inactive_days')) return new Set(compatible);
    if (fields.some((f) => !compatible.includes(f))) {
      return new Set(Object.keys(CONDITION_FIELDS).filter((f) => f !== 'inactive_days'));
    }
    return undefined;
  }, [conditions]);

  const canEnforce = useMemo(() => scopeAllowsCrossServer(scope, conditions), [scope, conditions]);

  // A notification automation exists to send something, so an empty list starts with `send`.
  // Leaving the kind takes that suggestion back; anything the user built or edited stays.
  const handleKindChange = (next: AutomationKind) => {
    setKind(next);
    if (next === 'notification') {
      if (actions.actions.length > 0) return;
      const suggested = createDefaultAction('send');
      setPreAddedAction(suggested);
      setActions({ actions: [suggested] });
      return;
    }
    if (!preAddedAction) return;
    setActions({ actions: actions.actions.filter((action) => action !== preAddedAction) });
    setPreAddedAction(null);
  };

  const validate = (): boolean => {
    const found: string[] = [];

    if (!name.trim()) found.push(t('pages:automations.builder.errors.nameRequired'));
    if (!isScopeComplete(scope)) found.push(t('pages:automations.builder.errors.scopeIncomplete'));
    if (conditions.groups.length === 0)
      found.push(t('pages:automations.builder.errors.groupRequired'));
    if (conditions.groups.some((group) => group.conditions.length === 0)) {
      found.push(t('pages:automations.builder.errors.conditionRequired'));
    }
    if (actions.actions.some((a) => a.type === 'send' && a.to.length === 0)) {
      found.push(t('pages:automations.builder.errors.sendNeedsDestination'));
    }

    setErrors(found);
    return found.length === 0;
  };

  const handleSubmit = async () => {
    setSubmitted(true);
    if (!validate()) return;

    await onSave({
      name: name.trim(),
      description: description.trim() || null,
      kind,
      severity: kind === 'policy' ? severity : null,
      isActive,
      conditions,
      actions,
      ...scopeToPayload(scope),
      enforceAcrossServers: canEnforce ? enforceAcrossServers : false,
    });
  };

  const updateConditionGroup = (index: number, group: ConditionGroupType) => {
    const groups = [...conditions.groups];
    groups[index] = group;
    setConditions({ groups });
  };

  const removeConditionGroup = (index: number) => {
    if (conditions.groups.length === 1) return;
    setConditions({ groups: conditions.groups.filter((_, i) => i !== index) });
  };

  const updateAction = (index: number, action: Action) => {
    const next = [...actions.actions];
    next[index] = action;
    setActions({ actions: next });
  };

  return (
    // min-w-0: DialogContent is a grid, and a grid item can't shrink below its
    // min-content, so one too-wide row would otherwise widen the whole form.
    // @container: rows respond to the dialog, not the viewport.
    <div className="@container min-w-0 space-y-6">
      {errors.length > 0 && (
        <div className="border-destructive/50 bg-destructive/5 rounded-lg border p-4" role="alert">
          <p className="text-destructive font-medium">
            {t('pages:automations.builder.errors.title')}
          </p>
          <ul className="text-destructive mt-2 list-inside list-disc text-sm">
            {errors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      <FieldGroup className="gap-4">
        <FieldSet>
          <FieldLegend variant="label">{t('pages:automations.kindColumn')}</FieldLegend>
          {/* Equal cards, one per kind: the grid stretches them so a longer description
              cannot resize its option. Each kind states what it does before it is picked. */}
          <ToggleGroup
            type="single"
            variant="outline"
            size="sm"
            spacing={2}
            value={kind}
            onValueChange={(next) => {
              if (next) handleKindChange(next as AutomationKind);
            }}
            className="grid w-full grid-cols-1 items-stretch @md:grid-cols-2"
          >
            {AUTOMATION_KINDS.map((option) => (
              <ToggleGroupItem
                key={option}
                value={option}
                className="data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-primary h-full flex-col items-start justify-start gap-1 rounded-lg p-3 text-left whitespace-normal"
              >
                <span className="font-medium">{t(`pages:automations.kind.${option}`)}</span>
                <span className="text-muted-foreground text-xs font-normal">
                  {t(`pages:automations.kind.${option}Description`)}
                </span>
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </FieldSet>

        <div
          className={cn(
            'grid gap-4 @2xl:items-end',
            kind === 'policy'
              ? '@2xl:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_minmax(0,1fr)_auto]'
              : '@2xl:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_auto]'
          )}
        >
          <Field>
            <FieldLabel htmlFor="automation-name">{t('pages:automations.name')}</FieldLabel>
            <Input
              id="automation-name"
              placeholder={t('pages:automations.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={submitted && !name.trim()}
            />
          </Field>

          <Field>
            <FieldLabel htmlFor="automation-description">
              {t('pages:automations.builder.descriptionLabel')}
            </FieldLabel>
            <Input
              id="automation-description"
              placeholder={t('pages:automations.builder.descriptionPlaceholder')}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </Field>

          {kind === 'policy' && (
            <Field>
              <FieldLabel htmlFor="automation-severity">
                {t('pages:automations.builder.severityLabel')}
              </FieldLabel>
              <Select value={severity} onValueChange={(v) => setSeverity(v as ViolationSeverity)}>
                <SelectTrigger id="automation-severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SEVERITIES.map((option) => (
                    <SelectItem key={option} value={option}>
                      {severityLabel(t, option)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}

          <Field className="@2xl:w-auto">
            <FieldLabel htmlFor="automation-active">
              {t('pages:automations.builder.activeLabel')}
            </FieldLabel>
            <div className="flex h-9 items-center">
              <Switch id="automation-active" checked={isActive} onCheckedChange={setIsActive} />
            </div>
          </Field>
        </div>

        <ScopeField
          scope={scope}
          onChange={setScope}
          enforceAcrossServers={enforceAcrossServers}
          onEnforceAcrossServersChange={setEnforceAcrossServers}
          canEnforceAcrossServers={canEnforce}
          showErrors={submitted}
        />
      </FieldGroup>

      <section className="bg-muted/30 space-y-4 rounded-lg border p-4">
        <header className="border-b pb-3">
          <h3 className="text-base font-semibold">
            {t('pages:automations.builder.conditions.title')}
          </h3>
          <p className="text-muted-foreground text-sm">
            {t('pages:automations.builder.conditions.description')}
          </p>
        </header>

        <div className="space-y-4">
          {conditions.groups.map((group, index) => (
            <div key={index}>
              {index > 0 && (
                <div className="my-4 flex items-center gap-2">
                  <div className="bg-border h-px flex-1" />
                  <span className="text-muted-foreground bg-muted rounded-full px-3 py-1 text-sm font-bold">
                    AND
                  </span>
                  <div className="bg-border h-px flex-1" />
                </div>
              )}
              <ConditionGroup
                group={group}
                groupIndex={index}
                onChange={(g) => updateConditionGroup(index, g)}
                onRemove={() => removeConditionGroup(index)}
                showRemove={conditions.groups.length > 1}
                filterOptions={filterOptions}
                allowedFields={allowedFields}
              />
            </div>
          ))}
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setConditions({ groups: [...conditions.groups, createDefaultConditionGroup()] })
          }
        >
          <Plus />
          {t('pages:automations.builder.conditions.addGroup')}
        </Button>
      </section>

      <section className="bg-muted/30 space-y-4 rounded-lg border p-4">
        <header className="border-b pb-3">
          <h3 className="text-base font-semibold">
            {t('pages:automations.builder.actions.title')}
          </h3>
          <p className="text-muted-foreground text-sm">
            {t('pages:automations.builder.actions.description')}
          </p>
        </header>

        {actions.actions.length > 0 && (
          <div className="space-y-3">
            {actions.actions.map((action, index) => (
              <ActionRow
                key={index}
                action={action}
                kind={kind}
                onChange={(a) => updateAction(index, a)}
                onRemove={() =>
                  setActions({ actions: actions.actions.filter((_, i) => i !== index) })
                }
                showRemove
              />
            ))}
          </div>
        )}

        <Button
          type="button"
          variant="outline"
          onClick={() =>
            setActions({
              actions: [...actions.actions, createDefaultAction(DEFAULT_ACTION_TYPE)],
            })
          }
        >
          <Plus />
          {t('pages:automations.builder.actions.add')}
        </Button>
      </section>

      <div className="flex items-center justify-end gap-3 border-t pt-4">
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('common:actions.cancel')}
        </Button>
        <Button onClick={handleSubmit} disabled={isLoading}>
          {isLoading ? (
            <>
              <Loader2 className="animate-spin" />
              {t('pages:automations.builder.saving')}
            </>
          ) : (
            <>
              <Save />
              {initialAutomation
                ? t('pages:automations.updateAutomation')
                : t('pages:automations.createAutomation')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
}

export default AutomationBuilder;
