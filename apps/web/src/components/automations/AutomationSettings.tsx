import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';
import {
  AUTOMATION_NAME_MAX,
  RETENTION_DEFAULTS,
  type Automation,
  type ViolationSeverity,
} from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useUpdateAutomation } from '@/hooks/queries';
import { SEVERITIES, severityLabel } from '@/lib/automations';

interface Override {
  value: number | null;
  invalid: boolean;
}

/** An empty box means "no override"; anything else has to be a whole number the API accepts. */
const readOverride = (raw: string, min: number): Override => {
  const trimmed = raw.trim();
  if (trimmed === '') return { value: null, invalid: false };
  if (!/^\d+$/.test(trimmed)) return { value: null, invalid: true };
  const parsed = Number.parseInt(trimmed, 10);
  return parsed < min ? { value: null, invalid: true } : { value: parsed, invalid: false };
};

/**
 * Every field a row owns itself, template-bound or not: what the template decides is
 * refused by the API, and none of these six are its to decide.
 */
export function AutomationSettings({ automation }: { automation: Automation }) {
  const { t } = useTranslation(['pages', 'common']);
  const updateAutomation = useUpdateAutomation();

  const [name, setName] = useState(automation.name);
  const [description, setDescription] = useState(automation.description ?? '');
  const [severity, setSeverity] = useState<ViolationSeverity>(automation.severity ?? 'warning');
  const [retentionDays, setRetentionDays] = useState(String(automation.retentionDays ?? ''));
  const [cooldownMinutes, setCooldownMinutes] = useState(String(automation.cooldownMinutes ?? ''));

  const retention = readOverride(retentionDays, 1);
  const cooldown = readOverride(cooldownMinutes, 0);
  const nameInvalid = name.trim() === '';
  const invalid = retention.invalid || cooldown.invalid || nameInvalid;

  const handleSave = () => {
    updateAutomation.mutate({
      id: automation.id,
      data: {
        name: name.trim(),
        description: description.trim() === '' ? null : description.trim(),
        ...(automation.kind === 'policy' ? { severity } : {}),
        retentionDays: retention.value,
        cooldownMinutes: cooldown.value,
      },
    });
  };

  return (
    <div className="space-y-4">
      <Field>
        <FieldLabel htmlFor="automation-name">
          {t('pages:automations.settings.nameLabel')}
        </FieldLabel>
        <Input
          id="automation-name"
          value={name}
          maxLength={AUTOMATION_NAME_MAX}
          onChange={(event) => setName(event.target.value)}
          aria-invalid={nameInvalid}
        />
        {nameInvalid && <FieldError>{t('pages:automations.settings.nameInvalid')}</FieldError>}
      </Field>

      <Field>
        <FieldLabel htmlFor="automation-description">
          {t('pages:automations.settings.descriptionLabel')}
        </FieldLabel>
        <Textarea
          id="automation-description"
          rows={2}
          value={description}
          placeholder={t('pages:automations.settings.descriptionPlaceholder')}
          onChange={(event) => setDescription(event.target.value)}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        {automation.kind === 'policy' && (
          <Field>
            <FieldLabel htmlFor="automation-severity">
              {t('pages:automations.settings.severityLabel')}
            </FieldLabel>
            <Select
              value={severity}
              onValueChange={(value) => setSeverity(value as ViolationSeverity)}
            >
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
            <FieldDescription>{t('pages:automations.settings.severityHint')}</FieldDescription>
          </Field>
        )}

        <Field>
          <FieldLabel htmlFor="automation-retention">
            {t('pages:automations.settings.retentionLabel')}
          </FieldLabel>
          <Input
            id="automation-retention"
            inputMode="numeric"
            placeholder={String(RETENTION_DEFAULTS[automation.kind])}
            value={retentionDays}
            onChange={(event) => setRetentionDays(event.target.value)}
            aria-invalid={retention.invalid}
          />
          {retention.invalid ? (
            <FieldError>{t('pages:automations.settings.retentionInvalid')}</FieldError>
          ) : (
            <FieldDescription>
              {t('pages:automations.settings.retentionHint', {
                days: RETENTION_DEFAULTS[automation.kind],
              })}
            </FieldDescription>
          )}
        </Field>

        <Field>
          <FieldLabel htmlFor="automation-cooldown">
            {t('pages:automations.settings.cooldownLabel')}
          </FieldLabel>
          <Input
            id="automation-cooldown"
            inputMode="numeric"
            placeholder="0"
            value={cooldownMinutes}
            onChange={(event) => setCooldownMinutes(event.target.value)}
            aria-invalid={cooldown.invalid}
          />
          {cooldown.invalid ? (
            <FieldError>{t('pages:automations.settings.cooldownInvalid')}</FieldError>
          ) : (
            <FieldDescription>{t('pages:automations.settings.cooldownHint')}</FieldDescription>
          )}
        </Field>
      </div>

      <Button onClick={handleSave} disabled={invalid || updateAutomation.isPending}>
        <Save />
        {t('common:actions.save')}
      </Button>
    </div>
  );
}
