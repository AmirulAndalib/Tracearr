import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AUTOMATION_NAME_MAX, type TemplateInput } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { SentencePanel } from '@/components/automations/builder/SentencePanel';
import { useDestinations } from '@/hooks/queries/useDestinations';
import { useAutomationFilterOptions } from '@/hooks/queries/useHistory';
import { useSettings } from '@/hooks/queries/useSettings';
import { useInstantiateTemplate } from '@/hooks/queries/useTemplates';
import { useServer } from '@/hooks/useServer';
import { describeTemplate, isUnbound, templateName, type DescribeRefs } from '@/lib/automations';
import type { AutomationTemplate } from '@/lib/api';
import { TemplateSentence } from './TemplateCard';
import { TemplateInputField } from './TemplateInputField';

/** Every optional input opens on its default, so no row is ever blank. */
function initialValues(inputs: TemplateInput[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const input of inputs) {
    if ('default' in input && input.default !== undefined) values[input.key] = input.default;
  }
  return values;
}

const serverInputKey = (inputs: TemplateInput[]): string | undefined =>
  inputs.find((input) => input.kind === 'server')?.key;

interface TemplateBindingFormProps {
  template: AutomationTemplate;
  onBack: () => void;
  onDone: () => void;
}

/** Name it, see what it will say, fill in the parts that are yours. */
export function TemplateBindingForm({ template, onBack, onDone }: TemplateBindingFormProps) {
  const { t } = useTranslation('pages');
  const { servers } = useServer();
  const { data: settings } = useSettings();
  const { data: destinations } = useDestinations();
  const { data: filterOptions } = useAutomationFilterOptions();
  const instantiate = useInstantiateTemplate();

  const { version } = template;
  const [values, setValues] = useState(() => initialValues(version.inputs));
  const [name, setName] = useState(() => templateName(t, template));

  const [nameDirty, setNameDirty] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [submitted, setSubmitted] = useState(false);

  const unitSystem = settings?.unitSystem ?? 'metric';
  const boundServerId = String(values[serverInputKey(version.inputs) ?? ''] ?? '');

  const refs = useMemo<DescribeRefs>(
    () => ({
      servers: Object.fromEntries(servers.map((server) => [server.id, server.name])),
      destinations: Object.fromEntries(
        (destinations ?? []).map((destination) => [destination.id, destination.name])
      ),
      countries: Object.fromEntries(
        (filterOptions?.countries ?? []).map((country) => [country.code, country.name])
      ),
    }),
    [servers, destinations, filterOptions]
  );

  const fragments = describeTemplate(version, values, refs, t, unitSystem);
  const missing = version.inputs.filter((input) => input.required && isUnbound(values[input.key]));

  /** What the name reads as until it is edited, and what an emptied field falls back to. */
  const defaultName = (serverId: string) => {
    const base = templateName(t, template);
    const server = servers.find((entry) => entry.id === serverId);
    return (server ? `${base} — ${server.name}` : base).slice(0, AUTOMATION_NAME_MAX);
  };

  const setValue = (input: TemplateInput, value: unknown) => {
    setValues({ ...values, [input.key]: value });
    if (input.kind !== 'server' || nameDirty) return;
    setName(defaultName(typeof value === 'string' ? value : ''));
  };

  const submit = () => {
    setSubmitted(true);
    if (missing.length > 0) return;
    const inputs = Object.fromEntries(
      Object.entries(values).filter(([, value]) => !isUnbound(value))
    );
    instantiate.mutate(
      { id: template.id, inputs, name: name.trim() || defaultName(boundServerId), isActive },
      { onSuccess: onDone }
    );
  };

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <FieldGroup className="gap-5">
          <Field>
            <FieldLabel htmlFor="template-name">{t('automations.bind.nameLabel')}</FieldLabel>
            <Input
              id="template-name"
              value={name}
              maxLength={AUTOMATION_NAME_MAX}
              placeholder={t('automations.bind.namePlaceholder')}
              onChange={(event) => {
                setName(event.target.value);
                setNameDirty(true);
              }}
              onBlur={() => {
                if (name.trim() !== '') return;
                setName(defaultName(boundServerId));
                setNameDirty(false);
              }}
            />
          </Field>

          <SentencePanel>
            <p className="text-muted-foreground text-[0.9375rem] leading-relaxed">
              <TemplateSentence fragments={fragments} clauses />
            </p>
          </SentencePanel>

          {version.inputs.length === 0 ? (
            <p className="text-muted-foreground text-sm">{t('automations.bind.noInputs')}</p>
          ) : (
            version.inputs.map((input) => (
              <TemplateInputField
                key={input.key}
                input={input}
                definition={version.definition}
                value={values[input.key]}
                onChange={(value) => setValue(input, value)}
                servers={servers}
                boundServerId={boundServerId}
                filterOptions={filterOptions}
                unitSystem={unitSystem}
                invalid={submitted && input.required && isUnbound(values[input.key])}
              />
            ))
          )}
        </FieldGroup>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t px-6 py-4 max-sm:flex-col max-sm:items-stretch">
        <div className="flex items-center gap-2">
          <Switch id="template-active" checked={isActive} onCheckedChange={setIsActive} />
          <FieldLabel htmlFor="template-active">{t('automations.bind.activeLabel')}</FieldLabel>
        </div>
        <div className="flex gap-2 max-sm:flex-col sm:ml-auto">
          <Button type="button" variant="outline" onClick={onBack}>
            {t('automations.bind.back')}
          </Button>
          <Button type="button" onClick={submit} disabled={instantiate.isPending}>
            {instantiate.isPending
              ? t('automations.bind.submitting')
              : t('automations.bind.submit')}
          </Button>
        </div>
      </div>
    </>
  );
}
