import { useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { AutomationBuilder } from '@/components/automations/builder';
import { Skeleton } from '@/components/ui/skeleton';
import { useAutomation } from '@/hooks/queries/useAutomations';

export function AutomationBuilderPage() {
  const { t } = useTranslation(['pages']);
  const { id } = useParams<{ id: string }>();
  const { data: automation, isLoading } = useAutomation(id);

  return (
    <div className="space-y-6">
      <div className="mx-auto w-full max-w-5xl">
        <h1 className="text-3xl font-bold">
          {id ? t('pages:automations.editAutomation') : t('pages:automations.createAutomation')}
        </h1>
        <p className="text-muted-foreground">
          {id ? t('pages:automations.updateDescription') : t('pages:automations.createDescription')}
        </p>
      </div>

      {isLoading ? (
        <Skeleton className="mx-auto h-96 w-full max-w-5xl" />
      ) : (
        <AutomationBuilder automation={automation} />
      )}
    </div>
  );
}
