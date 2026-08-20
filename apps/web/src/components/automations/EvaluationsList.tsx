import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { ScanEye } from 'lucide-react';
import { EmptyState } from '@/components/ui/empty-state';
import { Skeleton } from '@/components/ui/skeleton';
import { useAutomationEvaluations } from '@/hooks/queries/useRuns';

/** The capped near-miss ring: trigger matched, nothing recorded. */
export function EvaluationsList({ automationId }: { automationId: string }) {
  const { t } = useTranslation('pages');
  const { data, isLoading } = useAutomationEvaluations(automationId);
  const entries = data?.data ?? [];

  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-full" />
      </div>
    );
  }

  if (entries.length === 0) {
    return (
      <EmptyState
        icon={ScanEye}
        title={t('automations.evaluations.empty')}
        description={t('automations.evaluations.emptyDescription')}
        className="py-6"
      />
    );
  }

  return (
    <ul className="text-muted-foreground divide-y text-sm">
      {entries.map((entry) => (
        <li
          key={`${entry.at}-${entry.subjectKey}`}
          className="flex flex-wrap items-center justify-between gap-2 py-2"
        >
          <span>{t(`automations.evaluations.reasons.${entry.reason}`)}</span>
          <span className="flex items-center gap-3">
            <span className="font-mono text-xs">{entry.trigger}</span>
            <span className="whitespace-nowrap">
              {formatDistanceToNow(new Date(entry.at), { addSuffix: true })}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
