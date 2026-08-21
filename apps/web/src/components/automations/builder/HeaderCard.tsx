import { useId, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Plus } from 'lucide-react';
import { AUTOMATION_KINDS, type AutomationKind, type ViolationSeverity } from '@tracearr/shared';
import { Card, CardContent } from '@/components/ui/card';
import {
  Field,
  FieldContent,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { SEVERITIES, severityLabel } from '@/lib/automations';
import { nodeDomId, type BuilderDispatch, type BuilderState } from './builderReducer';
import { ScopeField } from './ScopeField';
import { BUILDER_SECTIONS, type NodeIssues } from './validation';

interface HeaderCardProps {
  state: BuilderState;
  issues: NodeIssues;
  canEnforceAcrossServers: boolean;
  /** The live sentence, built by the page so it can reach every node. */
  sentence: ReactNode;
  dispatch: BuilderDispatch;
}

export function HeaderCard({
  state,
  issues,
  canEnforceAcrossServers,
  sentence,
  dispatch,
}: HeaderCardProps) {
  const { t } = useTranslation('pages');
  const fieldId = useId();
  const [descriptionAsked, setDescriptionAsked] = useState(false);
  const hasDescription = descriptionAsked || state.description.length > 0;

  const nameIssues = issues.get(BUILDER_SECTIONS.name);
  const scopeIssues = issues.get(BUILDER_SECTIONS.scope);
  // The name's anchor is the input itself, so jumping to the problem lands in it.
  const nameId = nodeDomId(BUILDER_SECTIONS.name);

  return (
    <Card className="@container">
      <CardContent>
        <FieldGroup className="gap-6">
          <Field>
            <FieldLabel htmlFor={nameId}>{t('automations.name')}</FieldLabel>
            <Input
              id={nameId}
              value={state.name}
              placeholder={t('automations.namePlaceholder')}
              aria-invalid={nameIssues !== undefined}
              onChange={(event) => dispatch({ type: 'setName', value: event.target.value })}
            />
            {nameIssues?.map((message) => (
              <FieldError key={message}>{message}</FieldError>
            ))}
            {hasDescription ? (
              <>
                <FieldLabel htmlFor={`${fieldId}-description`} className="sr-only">
                  {t('automations.builder.descriptionLabel')}
                </FieldLabel>
                <Textarea
                  id={`${fieldId}-description`}
                  rows={2}
                  value={state.description}
                  placeholder={t('automations.builder.descriptionPlaceholder')}
                  onChange={(event) =>
                    dispatch({ type: 'setDescription', value: event.target.value })
                  }
                />
              </>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-muted-foreground self-start"
                onClick={() => setDescriptionAsked(true)}
              >
                <Plus />
                {t('automations.builder.addDescription')}
              </Button>
            )}
            {sentence}
          </Field>

          <FieldSet>
            <FieldLegend variant="label">{t('automations.kindColumn')}</FieldLegend>
            {/* Equal cards, one per kind: the grid stretches them so a longer description
                cannot resize its option. Each kind states what it does before it is picked. */}
            <ToggleGroup
              type="single"
              variant="outline"
              size="sm"
              spacing={2}
              value={state.kind}
              onValueChange={(next) => {
                if (next) dispatch({ type: 'setKind', value: next as AutomationKind });
              }}
              className="grid w-full grid-cols-1 items-stretch @md:grid-cols-2"
            >
              {AUTOMATION_KINDS.map((option) => (
                <ToggleGroupItem
                  key={option}
                  value={option}
                  className="data-[state=on]:border-primary data-[state=on]:bg-primary/15 data-[state=on]:text-primary h-full flex-col items-start justify-start gap-1 rounded-lg p-3 text-left whitespace-normal"
                >
                  <span className="font-medium">{t(`automations.kind.${option}`)}</span>
                  <span className="text-muted-foreground text-xs font-normal">
                    {t(`automations.kind.${option}Description`)}
                  </span>
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </FieldSet>

          <div className="grid gap-4 @md:grid-cols-[minmax(0,1fr)_auto] @md:items-end">
            {state.kind === 'policy' && (
              <Field>
                <FieldLabel htmlFor={`${fieldId}-severity`}>
                  {t('automations.builder.severityLabel')}
                </FieldLabel>
                <Select
                  value={state.severity}
                  onValueChange={(value) =>
                    dispatch({ type: 'setSeverity', value: value as ViolationSeverity })
                  }
                >
                  <SelectTrigger id={`${fieldId}-severity`}>
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

            <Field orientation="horizontal" className="@md:col-start-2 @md:w-auto">
              <Switch
                id={`${fieldId}-active`}
                checked={state.isActive}
                onCheckedChange={(value) => dispatch({ type: 'setActive', value })}
              />
              <FieldContent>
                <FieldLabel htmlFor={`${fieldId}-active`}>
                  {t('automations.builder.activeLabel')}
                </FieldLabel>
              </FieldContent>
            </Field>
          </div>

          <div id={nodeDomId(BUILDER_SECTIONS.scope)} tabIndex={-1} className="outline-none">
            <ScopeField
              scope={state.scope}
              onChange={(value) => dispatch({ type: 'setScope', value })}
              enforceAcrossServers={state.enforceAcrossServers}
              onEnforceAcrossServersChange={(value) =>
                dispatch({ type: 'setEnforceAcrossServers', value })
              }
              canEnforceAcrossServers={canEnforceAcrossServers}
              showErrors={scopeIssues !== undefined}
            />
          </div>
        </FieldGroup>
      </CardContent>
    </Card>
  );
}
