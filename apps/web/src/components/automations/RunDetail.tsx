import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Check, CircleDot, MinusCircle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Skeleton } from '@/components/ui/skeleton';
import { useRun } from '@/hooks/queries/useRuns';

/** Step zero, as the recorder writes it. */
interface TriggerStep {
  trigger: { type: string; edgeKey?: string | null };
}

/** Every later step is one action result. */
interface ActionStep {
  action: string;
  success: boolean;
  skipped?: boolean;
  skipReason?: string | null;
  message?: string | null;
}

const isRecord = (step: unknown): step is Record<string, unknown> =>
  typeof step === 'object' && step !== null;

const asTriggerStep = (step: unknown): TriggerStep | null =>
  isRecord(step) && isRecord(step.trigger) && typeof step.trigger.type === 'string'
    ? { trigger: step.trigger as TriggerStep['trigger'] }
    : null;

const asActionStep = (step: unknown): ActionStep | null =>
  isRecord(step) && typeof step.action === 'string' && typeof step.success === 'boolean'
    ? (step as unknown as ActionStep)
    : null;

interface RunDetailProps {
  runId: string | null;
  onOpenChange: (open: boolean) => void;
}

export function RunDetail({ runId, onOpenChange }: RunDetailProps) {
  const { t } = useTranslation(['pages', 'common']);
  const { data: run, isLoading } = useRun(runId ?? undefined);

  return (
    <Sheet open={runId !== null} onOpenChange={onOpenChange}>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>{t('pages:automations.activity.runTitle')}</SheetTitle>
          <SheetDescription>
            {run
              ? format(new Date(run.startedAt), 'PPpp')
              : t('pages:automations.activity.runLoading')}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 px-4 pb-6">
          {isLoading && <Skeleton className="h-40 w-full" />}

          {run && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">
                  {t(`pages:automations.activity.outcomes.${run.outcome}`)}
                </Badge>
                <Badge variant="outline">{t(`pages:automations.kind.${run.kind}`)}</Badge>
              </div>

              {run.humanSummary && <p className="text-sm">{run.humanSummary}</p>}

              <ol className="space-y-2">
                {run.steps.map((step, index) => (
                  <li key={index} className="flex items-start gap-3 rounded-lg border p-3">
                    <StepIcon step={step} isTrigger={index === 0} />
                    <div className="min-w-0 space-y-1">
                      <StepLabel step={step} isTrigger={index === 0} />
                    </div>
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function StepIcon({ step, isTrigger }: { step: unknown; isTrigger: boolean }) {
  if (isTrigger) return <CircleDot className="text-muted-foreground mt-0.5 size-4 shrink-0" />;
  const action = asActionStep(step);
  if (action?.skipped)
    return <MinusCircle className="text-muted-foreground mt-0.5 size-4 shrink-0" />;
  if (action?.success) return <Check className="text-primary mt-0.5 size-4 shrink-0" />;
  return <XCircle className="text-destructive mt-0.5 size-4 shrink-0" />;
}

function StepLabel({ step, isTrigger }: { step: unknown; isTrigger: boolean }) {
  const { t } = useTranslation('pages');

  if (isTrigger) {
    const trigger = asTriggerStep(step);
    return (
      <>
        <p className="text-sm font-medium">
          {t('automations.activity.triggeredBy', {
            trigger: trigger?.trigger.type ?? t('automations.activity.unknownStep'),
          })}
        </p>
        {trigger?.trigger.edgeKey && (
          <p className="text-muted-foreground font-mono text-xs break-all">
            {trigger.trigger.edgeKey}
          </p>
        )}
      </>
    );
  }

  const action = asActionStep(step);
  if (!action) {
    return <p className="text-muted-foreground text-sm">{t('automations.activity.unknownStep')}</p>;
  }

  const note = action.skipped ? action.skipReason : action.success ? null : action.message;
  return (
    <>
      <p className="text-sm font-medium">{action.action}</p>
      {note && <p className="text-muted-foreground text-xs">{note}</p>}
    </>
  );
}
