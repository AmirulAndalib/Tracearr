import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpCircle, Save } from 'lucide-react';
import type { Automation, AutomationTemplateRef, TemplateInput } from '@tracearr/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { FieldGroup } from '@/components/ui/field';
import { Skeleton } from '@/components/ui/skeleton';
import {
  boundInputValues,
  initialInputValues,
  missingInputs,
  TemplateInputRows,
  TemplateSentencePanel,
} from '@/components/automations/gallery/TemplateInputs';
import {
  useRebindAutomation,
  useTemplate,
  useTemplateVersion,
  useUpgradeAutomation,
} from '@/hooks/queries';
import type { AutomationTemplate } from '@/lib/api';

interface TemplateBindingProps {
  automation: Automation;
  template: AutomationTemplateRef;
}

/** A bound row's own answers, editable without opening the builder. */
export function TemplateBinding({ automation, template }: TemplateBindingProps) {
  const { t } = useTranslation(['pages', 'common']);
  const { data: catalogEntry, isLoading } = useTemplate(template.id);

  if (isLoading) return <Skeleton className="h-48 w-full" />;
  if (!catalogEntry) {
    return <p className="text-muted-foreground text-sm">{t('pages:automations.template.gone')}</p>;
  }

  return (
    <BindingFields
      key={catalogEntry.version.version}
      automation={automation}
      template={template}
      catalogEntry={catalogEntry}
    />
  );
}

function BindingFields({
  automation,
  template,
  catalogEntry,
}: TemplateBindingProps & { catalogEntry: AutomationTemplate }) {
  const { t } = useTranslation(['pages', 'common']);
  const rebindAutomation = useRebindAutomation();
  const upgradeAutomation = useUpgradeAutomation();

  const { version } = catalogEntry;
  const behind = template.version < template.currentVersion;

  // Only an upgrade needs the old version, and only to say what the row does today.
  const { data: pinned } = useTemplateVersion(
    behind ? template.id : undefined,
    behind ? template.version : undefined
  );

  const [values, setValues] = useState(() =>
    initialInputValues(version.inputs, automation.templateInputs)
  );
  const [submitted, setSubmitted] = useState(false);

  const setValue = (input: TemplateInput, value: unknown) =>
    setValues({ ...values, [input.key]: value });

  const pending = rebindAutomation.isPending || upgradeAutomation.isPending;

  const submit = () => {
    setSubmitted(true);
    if (missingInputs(version.inputs, values).length > 0) return;
    const inputs = boundInputValues(values);
    if (behind) upgradeAutomation.mutate({ id: automation.id, inputs });
    else rebindAutomation.mutate({ id: automation.id, inputs });
  };

  return (
    <div className="space-y-4">
      {behind && (
        <Alert>
          <ArrowUpCircle />
          <AlertTitle>
            {t('pages:automations.template.updatedTitle', { version: template.currentVersion })}
          </AlertTitle>
          <AlertDescription>{t('pages:automations.template.updatedBody')}</AlertDescription>
        </Alert>
      )}

      {behind && pinned && (
        <TemplateSentencePanel
          version={pinned}
          values={automation.templateInputs ?? {}}
          label={t('pages:automations.template.before')}
        />
      )}

      <FieldGroup className="gap-5">
        <TemplateInputRows
          version={version}
          values={values}
          onChange={setValue}
          submitted={submitted}
          sentenceLabel={behind ? t('pages:automations.template.after') : undefined}
        />
      </FieldGroup>

      <Button onClick={submit} disabled={pending}>
        {behind ? <ArrowUpCircle /> : <Save />}
        {behind ? t('pages:automations.template.review') : t('pages:automations.template.save')}
      </Button>
    </div>
  );
}
