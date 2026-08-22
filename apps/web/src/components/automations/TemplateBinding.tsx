import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowUpCircle, Save } from 'lucide-react';
import type { Automation, AutomationTemplateRef } from '@tracearr/shared';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { TemplateBindingForm } from '@/components/automations/gallery/TemplateBindingForm';
import {
  TemplateSentencePanel,
  useTemplateBinding,
} from '@/components/automations/gallery/TemplateInputs';
import {
  useDetachAutomation,
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
  const navigate = useNavigate();
  const rebindAutomation = useRebindAutomation();
  const upgradeAutomation = useUpgradeAutomation();
  const detachAutomation = useDetachAutomation();
  const [customizeOpen, setCustomizeOpen] = useState(false);

  const behind = template.version < template.currentVersion;

  // Only an upgrade needs the old version, and only to say what the row does today.
  const { data: pinned } = useTemplateVersion(
    behind ? template.id : undefined,
    behind ? template.version : undefined
  );
  const { fragments: pinnedFragments } = useTemplateBinding(
    behind ? pinned : undefined,
    automation.templateInputs ?? {}
  );

  const pending = rebindAutomation.isPending || upgradeAutomation.isPending;

  const save = ({ inputs }: { inputs: Record<string, unknown> }) => {
    if (behind) upgradeAutomation.mutate({ id: automation.id, inputs });
    else rebindAutomation.mutate({ id: automation.id, inputs });
  };

  const detach = () => {
    detachAutomation.mutate(automation.id, {
      onSuccess: () => {
        setCustomizeOpen(false);
        void navigate(`/automations/${automation.id}/edit`);
      },
    });
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
          fragments={pinnedFragments}
          label={t('pages:automations.template.before')}
        />
      )}

      <TemplateBindingForm
        template={catalogEntry}
        initialValues={automation.templateInputs}
        showName={false}
        sentenceLabel={behind ? t('pages:automations.template.after') : undefined}
        doors={{
          primaryLabel: behind
            ? t('pages:automations.template.review')
            : t('pages:automations.template.save'),
          primaryIcon: behind ? <ArrowUpCircle /> : <Save />,
          pending,
          onPrimary: save,
          secondaryLabel: t('pages:automations.template.customize'),
          onSecondary: () => setCustomizeOpen(true),
        }}
      />

      <ConfirmDialog
        open={customizeOpen}
        onOpenChange={setCustomizeOpen}
        title={t('pages:automations.template.customizeTitle')}
        description={t('pages:automations.template.customizeConfirm')}
        confirmLabel={t('pages:automations.template.customizeConfirmAction')}
        onConfirm={detach}
        isLoading={detachAutomation.isPending}
      />
    </div>
  );
}
