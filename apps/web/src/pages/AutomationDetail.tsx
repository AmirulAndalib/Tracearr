import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, Pencil, Share2 } from 'lucide-react';
import type { AutomationKind } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import {
  ActivityList,
  AutomationSettings,
  EvaluationsList,
  ProvenanceLine,
  RunDetail,
  ScopeChip,
  TemplateBadge,
  TemplateBinding,
} from '@/components/automations';
import { AutomationSentencePanel } from '@/components/automations/gallery/TemplateInputs';
import { ExportDialog } from '@/components/automations/sharing/ExportDialog';
import { automationIcon } from '@/lib/automations';
import { useAutomation, useToggleAutomation } from '@/hooks/queries';
import { usePageTitle } from '@/hooks/useDocumentTitle';
import { useServer } from '@/hooks/useServer';

const KIND_BADGE_VARIANT: Record<AutomationKind, 'default' | 'outline'> = {
  policy: 'default',
  notification: 'outline',
};

export function AutomationDetail() {
  const { t } = useTranslation(['pages', 'common']);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { servers } = useServer();

  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const { data: automation, isLoading } = useAutomation(id);
  const toggleAutomation = useToggleAutomation();

  usePageTitle(automation?.name);

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

  const template = automation.template;

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
                <ScopeChip automation={automation} servers={servers} />
                {template && <TemplateBadge template={template} />}
              </div>
              {automation.description && (
                <p className="text-muted-foreground text-sm">{automation.description}</p>
              )}
              <ProvenanceLine automation={automation} />
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
          <Button variant="outline" onClick={() => setExportOpen(true)}>
            <Share2 />
            {t('common:actions.export')}
          </Button>
          {!template && (
            <Button
              variant="outline"
              onClick={() => void navigate(`/automations/${automation.id}/edit`)}
            >
              <Pencil />
              {t('common:actions.edit')}
            </Button>
          )}
        </div>
      </div>

      {!template && <AutomationSentencePanel automation={automation} />}

      {template && (
        <Card>
          <CardHeader>
            <CardTitle>{t('pages:automations.template.title')}</CardTitle>
            <CardDescription>{t('pages:automations.template.description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <TemplateBinding automation={automation} template={template} />
          </CardContent>
        </Card>
      )}

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

      {exportOpen && <ExportDialog automation={automation} open onOpenChange={setExportOpen} />}

      <RunDetail
        runId={selectedRunId}
        canReplay={template === null}
        onOpenChange={(open) => {
          if (!open) setSelectedRunId(null);
        }}
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
