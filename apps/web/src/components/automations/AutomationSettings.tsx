import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Save } from 'lucide-react';
import type { Automation } from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { useUpdateAutomation } from '@/hooks/queries';

/** What retention falls back to when the automation names no window of its own. */
const KIND_RETENTION_DEFAULT = { policy: 365, notification: 30 } as const;

/** An empty box means "no override"; anything else has to parse as a whole number. */
const toNullableInt = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number.parseInt(trimmed, 10);
  return Number.isNaN(parsed) ? null : parsed;
};

export function AutomationSettings({ automation }: { automation: Automation }) {
  const { t } = useTranslation(['pages', 'common']);
  const updateAutomation = useUpdateAutomation();

  const [retentionDays, setRetentionDays] = useState(String(automation.retentionDays ?? ''));
  const [cooldownMinutes, setCooldownMinutes] = useState(String(automation.cooldownMinutes ?? ''));

  const handleSave = () => {
    updateAutomation.mutate({
      id: automation.id,
      data: {
        retentionDays: toNullableInt(retentionDays),
        cooldownMinutes: toNullableInt(cooldownMinutes),
      },
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
            placeholder={String(KIND_RETENTION_DEFAULT[automation.kind])}
            value={retentionDays}
            onChange={(event) => setRetentionDays(event.target.value)}
          />
          <FieldDescription>
            {t('pages:automations.settings.retentionHint', {
              days: KIND_RETENTION_DEFAULT[automation.kind],
            })}
          </FieldDescription>
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
          />
          <FieldDescription>{t('pages:automations.settings.cooldownHint')}</FieldDescription>
        </Field>
      </div>

      <Button onClick={handleSave} disabled={updateAutomation.isPending}>
        <Save />
        {t('common:actions.save')}
      </Button>
    </div>
  );
}
