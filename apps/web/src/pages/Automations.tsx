import { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  Pencil,
  Plus,
  Power,
  PowerOff,
  Settings2,
  Shield,
  Sparkles,
  Trash2,
} from 'lucide-react';
import type {
  Automation,
  AutomationKind,
  AutomationSortField,
  CreateAutomationInput,
} from '@tracearr/shared';
import { AUTOMATION_SORT_FIELDS, listPageCount } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { BulkActionsToolbar, type BulkAction } from '@/components/ui/bulk-actions-toolbar';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  createDataTableColumnHelper,
  DataTableBody,
  DataTableEmpty,
  DataTableHeader,
  DataTablePager,
  DataTableRoot,
  DataTableViewport,
  useDataTable,
  type SortingState,
} from '@/components/ui/data-table';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { countActiveFilters, FilterBar, useFilterState } from '@/components/ui/filters';
import type { FilterDescriptor } from '@/components/ui/filters';
import { Switch } from '@/components/ui/switch';
import { ErrorState } from '@/components/library/ErrorState';
import { ScopeChip, toBuilderInput } from '@/components/automations';
import { getRuleIcon, getRuleSummary, RuleBuilderDialog } from '@/components/rules';
import {
  useAutomations,
  useBulkDeleteAutomations,
  useBulkToggleAutomations,
  useCreateAutomation,
  useDeleteAutomation,
  useSettings,
  useToggleAutomation,
  useUpdateAutomation,
} from '@/hooks/queries';
import { useRulesFilterOptions } from '@/hooks/queries/useHistory';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useServer } from '@/hooks/useServer';
import { CLASSIC_RULE_TEMPLATES, type ClassicRuleTemplate } from '@/lib/rules';
import {
  AUTOMATIONS_FILTER_DEFAULTS,
  buildAutomationFilterParams,
  type AutomationsFilterState,
} from './automationsFilters';

const PAGE_SIZE = 20;

const SORT_FIELDS = new Set<string>(AUTOMATION_SORT_FIELDS);

/** Column ids are the API's sort fields, so a header click needs no mapping. */
function isAutomationSortField(id: string): id is AutomationSortField {
  return SORT_FIELDS.has(id);
}

const columnHelper = createDataTableColumnHelper<Automation>();
const getAutomationId = (automation: Automation) => automation.id;

const KIND_BADGE_VARIANT: Record<AutomationKind, 'default' | 'outline'> = {
  policy: 'default',
  notification: 'outline',
};

export function Automations() {
  const { t } = useTranslation(['pages', 'common']);
  const navigate = useNavigate();
  const { servers } = useServer();
  const { data: settings } = useSettings();

  const [page, setPage] = useState(1);
  const [sorting, setSorting] = useState<SortingState>([{ id: 'name', desc: false }]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(false);
  const [editing, setEditing] = useState<Automation | undefined>();
  const [template, setTemplate] = useState<ClassicRuleTemplate | undefined>();

  const unitSystem = settings?.unitSystem ?? 'metric';

  const descriptors = useMemo<FilterDescriptor[]>(
    () => [
      {
        kind: 'search',
        key: 'search',
        label: t('common:actions.search'),
        placeholder: t('pages:automations.searchPlaceholder'),
        clearLabel: t('common:filters.clearSearch'),
        inline: true,
        className: 'w-full sm:w-64',
      },
      {
        kind: 'select',
        key: 'kind',
        label: t('pages:automations.kindColumn'),
        allLabel: t('pages:automations.allKinds'),
        options: [
          { value: 'policy', label: t('pages:automations.kind.policy') },
          { value: 'notification', label: t('pages:automations.kind.notification') },
        ],
      },
      {
        kind: 'select',
        key: 'status',
        label: t('common:labels.status'),
        allLabel: t('pages:automations.allStatuses'),
        options: [
          { value: 'active', label: t('common:states.active') },
          { value: 'inactive', label: t('common:states.inactive') },
        ],
      },
    ],
    [t]
  );

  const { filters, setFilters } = useFilterState<AutomationsFilterState>({
    descriptors,
    defaults: AUTOMATIONS_FILTER_DEFAULTS,
    persistence: 'url',
  });

  const filterParams = useMemo(() => buildAutomationFilterParams(filters), [filters]);

  const activeSort = sorting[0];
  const orderBy = activeSort && isAutomationSortField(activeSort.id) ? activeSort.id : undefined;
  const orderDir = orderBy ? (activeSort?.desc ? 'desc' : 'asc') : undefined;

  const { data, isLoading, isError, error, refetch } = useAutomations({
    page,
    pageSize: PAGE_SIZE,
    orderBy,
    orderDir,
    ...filterParams,
  });
  const { data: filterOptions } = useRulesFilterOptions();

  const createAutomation = useCreateAutomation();
  const updateAutomation = useUpdateAutomation();
  const toggleAutomation = useToggleAutomation();
  const deleteAutomation = useDeleteAutomation();
  const bulkToggle = useBulkToggleAutomations();
  const bulkDelete = useBulkDeleteAutomations();

  const rows = data?.data;
  const total = data?.meta.total ?? 0;
  const pageCount = data ? listPageCount(data.meta) : 1;

  const { selectedIds, selectedCount, toggleRow, togglePage, clearSelection } = useRowSelection({
    getRowId: getAutomationId,
    totalCount: total,
    loadedRows: rows,
    loadKey: page,
  });

  const handleFiltersChange = useCallback(
    (next: AutomationsFilterState) => {
      setFilters(next);
      setPage(1);
      clearSelection();
    },
    [setFilters, clearSelection]
  );

  const handleSortingChange = useCallback(
    (next: SortingState) => {
      setSorting(next);
      setPage(1);
      clearSelection();
    },
    [clearSelection]
  );

  const openCreateDialog = () => {
    setTemplate(undefined);
    setEditing(undefined);
    setBuilderOpen(true);
  };

  const handleTemplateSelect = (selected: ClassicRuleTemplate) => {
    setTemplate(selected);
    setTemplatePickerOpen(false);
    setEditing(undefined);
    setBuilderOpen(true);
  };

  const handleSave = async (payload: CreateAutomationInput) => {
    if (editing) {
      await updateAutomation.mutateAsync({ id: editing.id, data: payload });
    } else {
      await createAutomation.mutateAsync(payload);
    }
    setBuilderOpen(false);
    setEditing(undefined);
  };

  const handleBulkToggle = (isActive: boolean) => {
    bulkToggle.mutate({ ids: Array.from(selectedIds), isActive }, { onSuccess: clearSelection });
  };

  const handleBulkDelete = () => {
    bulkDelete.mutate(Array.from(selectedIds), {
      onSuccess: () => {
        clearSelection();
        setBulkDeleteConfirmOpen(false);
      },
    });
  };

  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('name', {
          header: t('common:labels.name'),
          cell: ({ row }) => {
            const automation = row.original;
            return (
              <div className="flex items-center gap-3">
                <div className="bg-muted flex h-9 w-9 shrink-0 items-center justify-center rounded-lg">
                  {getRuleIcon(automation)}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{automation.name}</span>
                    <ScopeChip
                      automation={automation}
                      servers={servers}
                      filterOptions={filterOptions}
                    />
                    {automation.enforceAcrossServers && (
                      <Badge variant="secondary">{t('pages:automations.scope.crossServer')}</Badge>
                    )}
                    {automation.actions.actions.length === 0 && (
                      <Badge variant="secondary">{t('pages:automations.recordsOnly')}</Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground truncate text-sm">
                    {automation.description ??
                      getRuleSummary(automation, filterOptions, unitSystem)}
                  </p>
                </div>
              </div>
            );
          },
        }),
        columnHelper.accessor('kind', {
          header: t('pages:automations.kindColumn'),
          cell: ({ row }) => (
            <Badge variant={KIND_BADGE_VARIANT[row.original.kind]}>
              {t(`pages:automations.kind.${row.original.kind}`)}
            </Badge>
          ),
        }),
        columnHelper.accessor('isActive', {
          header: t('common:labels.status'),
          cell: ({ row }) => {
            const automation = row.original;
            return (
              <div
                className="flex items-center gap-2"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <Switch
                  checked={automation.isActive}
                  onCheckedChange={(isActive) => {
                    toggleAutomation.mutate({ id: automation.id, isActive });
                  }}
                  aria-label={t('pages:automations.toggleAutomation', { name: automation.name })}
                />
                <span className="text-muted-foreground text-sm">
                  {automation.isActive ? t('common:states.active') : t('common:states.disabled')}
                </span>
              </div>
            );
          },
        }),
        columnHelper.display({
          id: 'actions',
          header: '',
          meta: { align: 'end' },
          cell: ({ row }) => {
            const automation = row.original;
            return (
              <div
                className="flex items-center justify-end gap-1"
                onClick={(event) => {
                  event.stopPropagation();
                }}
              >
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common:actions.edit')}
                  onClick={() => {
                    setTemplate(undefined);
                    setEditing(automation);
                    setBuilderOpen(true);
                  }}
                >
                  <Pencil />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common:actions.delete')}
                  className="text-destructive hover:text-destructive"
                  onClick={() => setDeleteConfirmId(automation.id)}
                >
                  <Trash2 />
                </Button>
              </div>
            );
          },
        }),
      ]),
    [t, servers, filterOptions, unitSystem, toggleAutomation]
  );

  const selection = useMemo(
    () => ({
      selectedIds,
      onToggleRow: toggleRow,
      onTogglePage: togglePage,
      labels: {
        selectAllOnPage: t('common:table.selectAllOnPage'),
        selectRow: t('common:table.selectRow'),
      },
    }),
    [selectedIds, toggleRow, togglePage, t]
  );

  const { table, pager } = useDataTable<Automation>({
    columns,
    data: rows,
    getRowId: getAutomationId,
    pageSize: PAGE_SIZE,
    pageCount,
    page,
    onPageChange: setPage,
    sorting,
    onSortingChange: handleSortingChange,
    selection,
  });

  const bulkActions: BulkAction[] = [
    {
      key: 'enable',
      label: t('pages:automations.enable'),
      icon: <Power className="h-4 w-4" />,
      variant: 'default',
      onClick: () => handleBulkToggle(true),
      isLoading: bulkToggle.isPending,
    },
    {
      key: 'disable',
      label: t('pages:automations.disable'),
      icon: <PowerOff className="h-4 w-4" />,
      variant: 'secondary',
      onClick: () => handleBulkToggle(false),
      isLoading: bulkToggle.isPending,
    },
    {
      key: 'delete',
      label: t('common:actions.delete'),
      icon: <Trash2 className="h-4 w-4" />,
      variant: 'destructive',
      onClick: () => setBulkDeleteConfirmOpen(true),
      isLoading: bulkDelete.isPending,
    },
  ];

  const hasActiveFilters = countActiveFilters(descriptors, filters) > 0;

  const addMenu = (align: 'start' | 'end') => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button>
          <Plus />
          {t('pages:automations.addAutomation')}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align}>
        <DropdownMenuItem onClick={() => setTemplatePickerOpen(true)}>
          <Settings2 />
          {t('pages:automations.fromTemplate')}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={openCreateDialog}>
          <Sparkles />
          {t('pages:automations.custom')}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{t('pages:automations.title')}</h1>
          <p className="text-muted-foreground">{t('pages:automations.description')}</p>
        </div>
        {addMenu('end')}
      </div>

      <Card>
        <CardContent className="space-y-4">
          <FilterBar
            descriptors={descriptors}
            value={filters}
            onChange={handleFiltersChange}
            defaults={AUTOMATIONS_FILTER_DEFAULTS}
            labels={{
              trigger: t('common:labels.filters'),
              panelTitle: t('common:labels.filters'),
              clearAll: t('common:filters.clearAll'),
              done: t('common:filters.done'),
              removeFilter: (label: string) => t('common:filters.remove', { label }),
            }}
          />

          {isError ? (
            <ErrorState
              title={t('common:errors.somethingWentWrong')}
              message={error?.message ?? t('common:errors.unexpectedError')}
              onRetry={() => void refetch()}
            />
          ) : (
            <DataTableRoot density="default">
              <DataTableViewport>
                <DataTableHeader table={table} />
                <DataTableBody
                  table={table}
                  isLoading={isLoading}
                  loadingLabel={t('common:states.loading')}
                  onRowClick={(automation) => {
                    void navigate(`/automations/${automation.id}`);
                  }}
                  empty={
                    <DataTableEmpty
                      table={table}
                      icon={Shield}
                      title={
                        hasActiveFilters
                          ? t('pages:automations.noAutomationsFound')
                          : t('pages:automations.noAutomationsConfigured')
                      }
                      description={
                        hasActiveFilters
                          ? t('pages:automations.tryAdjustingFilters')
                          : t('pages:automations.createFirstAutomation')
                      }
                      action={hasActiveFilters ? undefined : addMenu('start')}
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
          )}
        </CardContent>
      </Card>

      <BulkActionsToolbar
        selectedCount={selectedCount}
        totalCount={total}
        actions={bulkActions}
        onClearSelection={clearSelection}
      />

      <ConfirmDialog
        open={bulkDeleteConfirmOpen}
        onOpenChange={setBulkDeleteConfirmOpen}
        title={t('pages:automations.deleteAutomation', { count: selectedCount })}
        description={t('pages:automations.deleteAutomationsConfirm')}
        confirmLabel={t('common:actions.delete')}
        onConfirm={handleBulkDelete}
        isLoading={bulkDelete.isPending}
      />

      <ConfirmDialog
        open={deleteConfirmId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteConfirmId(null);
        }}
        title={t('pages:automations.deleteAutomation', { count: 1 })}
        description={t('pages:automations.deleteAutomationConfirm')}
        confirmLabel={t('common:actions.delete')}
        onConfirm={() => {
          if (deleteConfirmId) {
            deleteAutomation.mutate(deleteConfirmId, {
              onSuccess: () => setDeleteConfirmId(null),
            });
          }
        }}
        isLoading={deleteAutomation.isPending}
      />

      <Dialog open={templatePickerOpen} onOpenChange={setTemplatePickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{t('pages:automations.chooseTemplate')}</DialogTitle>
            <DialogDescription>{t('pages:automations.chooseTemplateDesc')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2">
            {CLASSIC_RULE_TEMPLATES.map((entry) => (
              <button
                key={entry.type}
                onClick={() => handleTemplateSelect(entry)}
                className="hover:bg-accent flex items-center gap-4 rounded-lg border p-4 text-left transition-colors"
              >
                <div className="bg-muted flex h-10 w-10 shrink-0 items-center justify-center rounded-lg">
                  {getRuleIcon({ conditions: entry.conditions, actions: entry.actions })}
                </div>
                <div>
                  <div className="font-medium">{entry.label}</div>
                  <div className="text-muted-foreground text-sm">{entry.description}</div>
                </div>
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <RuleBuilderDialog
        open={builderOpen}
        onOpenChange={(open) => {
          setBuilderOpen(open);
          if (!open) {
            setTemplate(undefined);
            setEditing(undefined);
          }
        }}
        rule={
          editing
            ? toBuilderInput(editing)
            : template
              ? {
                  id: '',
                  name: template.defaultName,
                  description: template.description,
                  severity: template.severity,
                  isActive: true,
                  conditions: template.conditions,
                  actions: template.actions,
                }
              : undefined
        }
        onSave={handleSave}
        isLoading={createAutomation.isPending || updateAutomation.isPending}
        filterOptions={filterOptions}
      />
    </div>
  );
}
