import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { AUTOMATION_NAME_MAX, type TemplateInput } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { useServer } from '@/hooks/useServer';
import { templateDraft, templateName, type AutomationDraft } from '@/lib/automations';
import { cn } from '@/lib/utils';
import type { AutomationTemplate } from '@/lib/api';
import { TemplateEffects } from './TemplateEffects';
import {
  boundInputValues,
  initialInputValues,
  missingInputs,
  serverInputKey,
  TemplateInputRows,
  TemplateSentencePanel,
  useTemplateBinding,
} from './TemplateInputs';

/** What the primary door is handed once every required answer is in. */
export interface TemplateBindingSubmission {
  inputs: Record<string, unknown>;
  name: string;
  isActive: boolean;
}

/** The two ways out, worded and wired by whoever is showing the form. */
export interface TemplateBindingDoors {
  primaryLabel: string;
  primaryIcon?: ReactNode;
  onPrimary: (submission: TemplateBindingSubmission) => void;
  pending: boolean;
  secondaryLabel: string;
  /** The draft is the answers as an automation; a row that already exists ignores it. */
  onSecondary: (draft: AutomationDraft) => void;
  helper?: string;
}

interface TemplateBindingFormProps {
  template: AutomationTemplate;
  doors: TemplateBindingDoors;
  /** The answers a bound row already carries; a new one opens on the defaults. */
  initialValues?: Record<string, unknown> | null;
  /** The page header owns the name and the switch once the automation exists. */
  showName?: boolean;
  /** Names the sentence panel when an upgrade puts the old one beside it. */
  sentenceLabel?: string;
  bodyClassName?: string;
  footerClassName?: string;
}

/** What it does, what it needs, what it will do, then the two doors. */
export function TemplateBindingForm({
  template,
  doors,
  initialValues,
  showName = true,
  sentenceLabel,
  bodyClassName,
  footerClassName,
}: TemplateBindingFormProps) {
  const { t } = useTranslation('pages');
  const { servers } = useServer();

  const { version } = template;
  const [values, setValues] = useState(() => initialInputValues(version.inputs, initialValues));
  const [name, setName] = useState(() => templateName(t, template));

  const [nameDirty, setNameDirty] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [submitted, setSubmitted] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  const { refs, fragments } = useTemplateBinding(version, values);

  const serverKey = serverInputKey(version.inputs);
  const boundServerId = String(values[serverKey ?? ''] ?? '');

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

  const submission = (): TemplateBindingSubmission => ({
    inputs: boundInputValues(values),
    name: name.trim() || defaultName(boundServerId),
    isActive,
  });

  const submit = () => {
    setSubmitted(true);
    if (missingInputs(version.inputs, values).length > 0) return;
    doors.onPrimary(submission());
  };

  const customize = () => {
    const { inputs, ...rest } = submission();
    doors.onSecondary(templateDraft(version, inputs, rest));
  };

  return (
    <>
      <div className={cn('flex flex-col gap-5', bodyClassName)}>
        <TemplateSentencePanel fragments={fragments} label={sentenceLabel} highlightKey={focused} />

        {version.inputs.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t('automations.bind.noInputs')}</p>
        ) : (
          <section className="flex flex-col gap-3.5">
            <h3 className="text-sm font-medium">{t('automations.bind.needs.title')}</h3>
            <FieldGroup className="gap-5">
              <TemplateInputRows
                version={version}
                values={values}
                onChange={setValue}
                boundServerId={boundServerId}
                submitted={submitted}
                onFocusInput={setFocused}
              />
            </FieldGroup>
          </section>
        )}

        <section className="flex flex-col gap-3.5">
          <h3 className="text-sm font-medium">{t('automations.effects.title')}</h3>
          <TemplateEffects
            definition={version.definition}
            hasServerInput={serverKey !== undefined}
            serverName={refs.servers?.[boundServerId]}
          />
        </section>

        {showName && (
          <>
            <Separator />
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
              <FieldDescription>{t('automations.bind.nameHelper')}</FieldDescription>
            </Field>
          </>
        )}
      </div>

      <div className={cn('flex flex-col gap-2.5', footerClassName)}>
        <div className="flex flex-wrap items-center gap-2.5">
          {showName && (
            <div className="flex items-center gap-2">
              <Switch id="template-active" checked={isActive} onCheckedChange={setIsActive} />
              <FieldLabel htmlFor="template-active">{t('automations.bind.activeLabel')}</FieldLabel>
            </div>
          )}
          <div className="flex gap-2 max-sm:w-full max-sm:flex-col-reverse sm:ml-auto">
            <Button type="button" variant="outline" onClick={customize} disabled={doors.pending}>
              {doors.secondaryLabel}
            </Button>
            <Button type="button" onClick={submit} disabled={doors.pending}>
              {doors.primaryIcon}
              {doors.primaryLabel}
            </Button>
          </div>
        </div>
        {doors.helper !== undefined && (
          <p className="text-muted-foreground text-xs leading-relaxed">{doors.helper}</p>
        )}
      </div>
    </>
  );
}
