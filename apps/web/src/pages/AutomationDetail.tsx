import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Pencil } from 'lucide-react';
import type { AutomationKind, CreateAutomationInput } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  ActivityList,
  AutomationSettings,
  EvaluationsList,
  RunDetail,
  ScopeChip,
  toBuilderInput,
} from '@/components/automations';
import { AutomationBuilderDialog } from '@/components/automations/builder';
import { automationIcon } from '@/lib/automations';
import { useAutomation, useToggleAutomation, useUpdateAutomation } from '@/hooks/queries';
import { useAutomationFilterOptions } from '@/hooks/queries/useHistory';
import { useServer } from '@/hooks/useServer';

const KIND_BADGE_VARIANT: Record<AutomationKind, 'default' | 'outline'> = {
  policy: 'default',
  notification: 'outline',
};

export function AutomationDetail() {
  const { t } = useTranslation(['pages', 'common']);
  const { id } = useParams<{ id: string }>();
  const { servers } = useServer();

  const [builderOpen, setBuilderOpen] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);

  const { data: automation, isLoading } = useAutomation(id);
  const { data: filterOptions } = useAutomationFilterOptions();
  const toggleAutomation = useToggleAutomation();
  const updateAutomation = useUpdateAutomation();

  const handleSave = async (payload: CreateAutomationInput) => {
    if (!automation) return;
    await updateAutomation.mutateAsync({ id: automation.id, data: payload });
    setBuilderOpen(false);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Skeleton className="h-64" />
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (!automation) {
    return (
      <div className="space-y-6">
        <BackLink label={t('common:actions.back')} />
        <Card>
          <CardContent className="flex h-32 items-center justify-center">
            <p className="text-muted-foreground">{t('pages:automations.detail.notFound')}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <BackLink label={t('common:actions.back')} />
          <div className="flex items-center gap-3">
            <div className="bg-muted flex h-10 w-10 items-center justify-center rounded-lg">
              {automationIcon(automation)}
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold">{automation.name}</h1>
                <Badge variant={KIND_BADGE_VARIANT[automation.kind]}>
                  {t(`pages:automations.kind.${automation.kind}`)}
                </Badge>
                <ScopeChip
                  automation={automation}
                  servers={servers}
                  filterOptions={filterOptions}
                />
              </div>
              {automation.description && (
                <p className="text-muted-foreground text-sm">{automation.description}</p>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Switch
            checked={automation.isActive}
            onCheckedChange={(isActive) => {
              toggleAutomation.mutate({ id: automation.id, isActive });
            }}
            aria-label={t('pages:automations.toggleAutomation', { name: automation.name })}
          />
          <Button variant="outline" onClick={() => setBuilderOpen(true)}>
            <Pencil />
            {t('common:actions.edit')}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('pages:automations.activity.title')}</CardTitle>
          <CardDescription>{t('pages:automations.activity.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <ActivityList
            automationId={automation.id}
            kind={automation.kind}
            onSelectRun={setSelectedRunId}
          />
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('pages:automations.evaluations.title')}</CardTitle>
            <CardDescription>{t('pages:automations.evaluations.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <EvaluationsList automationId={automation.id} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('pages:automations.settings.title')}</CardTitle>
            <CardDescription>{t('pages:automations.settings.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <AutomationSettings automation={automation} />
          </CardContent>
        </Card>
      </div>

      <RunDetail
        runId={selectedRunId}
        onOpenChange={(open) => {
          if (!open) setSelectedRunId(null);
        }}
      />

      <AutomationBuilderDialog
        open={builderOpen}
        onOpenChange={setBuilderOpen}
        automation={toBuilderInput(automation)}
        onSave={handleSave}
        isLoading={updateAutomation.isPending}
        filterOptions={filterOptions}
      />
    </div>
  );
}

function BackLink({ label }: { label: string }) {
  return (
    <Link to="/automations">
      <Button variant="ghost" size="sm">
        <ArrowLeft />
        {label}
      </Button>
    </Link>
  );
}
