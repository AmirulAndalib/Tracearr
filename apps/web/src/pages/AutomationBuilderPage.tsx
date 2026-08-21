import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';

export function AutomationBuilderPage() {
  const { t } = useTranslation(['pages']);
  const { id } = useParams<{ id: string }>();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">
          {id ? t('pages:automations.editAutomation') : t('pages:automations.createAutomation')}
        </h1>
        <p className="text-muted-foreground">
          {id ? t('pages:automations.updateDescription') : t('pages:automations.createDescription')}
        </p>
      </div>
    </div>
  );
}
