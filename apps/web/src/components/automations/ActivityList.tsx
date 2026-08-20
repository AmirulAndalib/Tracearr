import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow } from 'date-fns';
import { Activity } from 'lucide-react';
import type { AutomationKind, AutomationRunSummary, RunOutcome } from '@tracearr/shared';
import { listPageCount } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import {
  createDataTableColumnHelper,
  DataTableBody,
  DataTableEmpty,
  DataTableHeader,
  DataTablePager,
  DataTableRoot,
  DataTableViewport,
  useDataTable,
} from '@/components/ui/data-table';
import { SeverityBadge } from '@/components/violations/SeverityBadge';
import { useAutomationRuns } from '@/hooks/queries/useRuns';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 20;

const columnHelper = createDataTableColumnHelper<AutomationRunSummary>();
const getRunId = (run: AutomationRunSummary) => run.id;

const OUTCOME_DOT: Record<RunOutcome, string> = {
  completed: 'bg-primary',
  stopped_by_condition: 'bg-muted-foreground',
  error: 'bg-destructive',
};

interface ActivityListProps {
  automationId: string;
  kind: AutomationKind;
  onSelectRun: (runId: string) => void;
}

export function ActivityList({ automationId, kind, onSelectRun }: ActivityListProps) {
  const { t } = useTranslation(['pages', 'common']);
  const [page, setPage] = useState(1);

  const { data, isLoading } = useAutomationRuns(automationId, { page, pageSize: PAGE_SIZE });
  const rows = data?.data;
  const pageCount = data ? listPageCount(data.meta) : 1;

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('outcome', {
          header: t('pages:automations.activity.outcome'),
          cell: ({ row }) => (
            <span className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn('size-2 shrink-0 rounded-full', OUTCOME_DOT[row.original.outcome])}
              />
              <Badge variant="secondary">
                {t(`pages:automations.activity.outcomes.${row.original.outcome}`)}
              </Badge>
            </span>
          ),
        }),
        columnHelper.accessor('humanSummary', {
          header: t('pages:automations.activity.summary'),
          cell: ({ row }) => (
            <span className="text-muted-foreground line-clamp-2 text-sm">
              {row.original.humanSummary ?? t('pages:automations.activity.noSummary')}
            </span>
          ),
        }),
        ...(kind === 'policy'
          ? [
              columnHelper.accessor('severity', {
                header: t('common:labels.severity'),
                cell: ({ row }) =>
                  row.original.severity ? (
                    <SeverityBadge severity={row.original.severity} />
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  ),
              }),
            ]
          : []),
        columnHelper.accessor('startedAt', {
          header: t('pages:automations.activity.started'),
          cell: ({ row }) => (
            <span className="text-muted-foreground whitespace-nowrap">
              {formatDistanceToNow(new Date(row.original.startedAt), { addSuffix: true })}
            </span>
          ),
        }),
        columnHelper.accessor('finishedAt', {
          header: t('pages:automations.activity.finished'),
          cell: ({ row }) => {
            const finishedAt = row.original.finishedAt;
            return (
              <span className="text-muted-foreground whitespace-nowrap">
                {finishedAt ? formatDistanceToNow(new Date(finishedAt), { addSuffix: true }) : '—'}
              </span>
            );
          },
        }),
      ]),
    [t, kind]
  );

  const { table, pager } = useDataTable<AutomationRunSummary>({
    columns,
    data: rows,
    getRowId: getRunId,
    pageSize: PAGE_SIZE,
    pageCount,
    page,
    onPageChange: setPage,
  });

  return (
    <DataTableRoot density="default">
      <DataTableViewport>
        <DataTableHeader table={table} />
        <DataTableBody
          table={table}
          isLoading={isLoading}
          loadingLabel={t('common:states.loading')}
          onRowClick={(run) => onSelectRun(run.id)}
          empty={
            <DataTableEmpty
              table={table}
              icon={Activity}
              title={t('pages:automations.activity.empty')}
              description={t('pages:automations.activity.emptyDescription')}
            />
          }
        />
      </DataTableViewport>
      <DataTablePager
        {...pager}
        labels={{
          navigation: t('common:table.pagination'),
          status: t('common:table.pageOf', { page: pager.page, total: pager.pageCount }),
          previous: t('common:actions.previous'),
          next: t('common:actions.next'),
        }}
      />
    </DataTableRoot>
  );
}
