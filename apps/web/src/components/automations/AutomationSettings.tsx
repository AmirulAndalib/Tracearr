import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';
import { RETENTION_DEFAULTS, type Automation } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useUpdateAutomation } from '@/hooks/queries';

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

export function AutomationSettings({ automation }: { automation: Automation }) {
  const { t } = useTranslation(['pages', 'common']);
  const updateAutomation = useUpdateAutomation();

  const [retentionDays, setRetentionDays] = useState(String(automation.retentionDays ?? ''));
  const [cooldownMinutes, setCooldownMinutes] = useState(String(automation.cooldownMinutes ?? ''));

  const retention = readOverride(retentionDays, 1);
  const cooldown = readOverride(cooldownMinutes, 0);
  const invalid = retention.invalid || cooldown.invalid;

  const handleSave = () => {
    updateAutomation.mutate({
      id: automation.id,
      data: { retentionDays: retention.value, cooldownMinutes: cooldown.value },
    });
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
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
