import { useTranslation } from 'react-i18next';
import { Check, ChevronDown, Radio, X } from 'lucide-react';
import {
  TRIGGERS,
  type ConditionEvidence,
  type CreateAutomationInput,
  type DryRunSample,
} from '@tracearr/shared';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Separator } from '@/components/ui/separator';
import { useDryRun } from '@/hooks/queries/useDryRun';
import { fieldLabel, operatorLabel, type Translate } from '@/lib/automations';
import { cn } from '@/lib/utils';

interface LiveCheckStripProps {
  definition: CreateAutomationInput;
  /** False while the page has problems of its own; the draft would be rejected as it stands. */
  ready: boolean;
  /** A save is in flight, so nothing is asked until it lands. */
  paused: boolean;
}

/** Why there is nothing to read yet, or nothing to read at all. */
function statusOf(
  t: Translate,
  state: {
    active: boolean;
    ready: boolean;
    check: { isPending: boolean; isError: boolean };
    samples: readonly unknown[];
  }
): string | null {
  if (!state.active) {
    return state.ready
      ? t('automations.builder.liveCheck.paused')
      : t('automations.builder.liveCheck.unfinished');
  }
  if (state.check.isPending) return t('automations.builder.liveCheck.checking');
  if (state.check.isError) return t('automations.builder.liveCheck.failed');
  return state.samples.length === 0 ? t('automations.builder.liveCheck.empty') : null;
}

/** A threshold or a reading, as the reader would say it. */
function valueText(t: Translate, value: unknown): string {
  if (typeof value === 'boolean') {
    return value ? t('automations.builder.conditions.yes') : t('automations.builder.conditions.no');
  }
  if (Array.isArray(value)) return value.map((entry) => String(entry)).join(', ');
  if (value === null || value === undefined) return '—';
  return String(value);
}

function conditionText(t: Translate, evidence: ConditionEvidence): string {
  return `${fieldLabel(t, evidence.field)} ${operatorLabel(t, evidence.operator)} ${valueText(t, evidence.threshold)}`;
}

/**
 * What the draft would do to the sessions playing right now. The page fetches no
 * sessions of its own: the answer names the ones it was checked against.
 */
export function LiveCheckStrip({ definition, ready, paused }: LiveCheckStripProps) {
  const { t } = useTranslation('pages');

  const reachesSessions = definition.triggers.some(
    (trigger) => trigger.enabled && TRIGGERS[trigger.type].context === 'session'
  );
  const active = ready && !paused;
  const check = useDryRun(definition, { enabled: active && reachesSessions });

  if (!reachesSessions) return null;

  const samples = active ? (check.data?.samples ?? []) : [];
  const status = statusOf(t, { active, ready, check, samples });

  return (
    <div className="mt-4 space-y-2" aria-live="polite">
      <Separator className="mb-4" />
      <p className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
        <Radio className="size-3.5" />
        {t('automations.builder.liveCheck.title')}
      </p>

      {status !== null && <p className="text-muted-foreground text-sm">{status}</p>}

      {samples.map((sample) => (
        <SampleRow key={sample.subject.sessionId} sample={sample} />
      ))}

      <p className="text-muted-foreground text-xs">{t('automations.builder.liveCheck.footnote')}</p>
    </div>
  );
}

/** One session, its verdict in words, and the conditions behind it when opened. */
function SampleRow({ sample }: { sample: DryRunSample }) {
  const { t } = useTranslation('pages');

  return (
    <Collapsible>
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            sample.wouldRun ? 'bg-success' : 'bg-muted-foreground/50'
          )}
        />
        <p className="flex-1 text-sm">{sample.summary}</p>
        {sample.conditions.length > 0 && (
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-6"
              aria-label={t('automations.builder.liveCheck.expand', {
                name: sample.subject.user.name,
              })}
            >
              <ChevronDown />
            </Button>
          </CollapsibleTrigger>
        )}
      </div>

      <CollapsibleContent>
        <ul className="mt-1 ml-4 space-y-1">
          {sample.conditions.map((condition) => (
            <li key={condition.nodeId} className="flex flex-wrap items-center gap-1.5 text-xs">
              {condition.passed ? (
                <Check className="text-success size-3.5 shrink-0" />
              ) : (
                <X className="text-destructive size-3.5 shrink-0" />
              )}
              <span className="sr-only">
                {condition.passed
                  ? t('automations.builder.liveCheck.passed')
                  : t('automations.builder.liveCheck.notPassed')}
              </span>
              <span>{conditionText(t, condition.evidence)}</span>
              <span className="text-muted-foreground">
                {t('automations.builder.liveCheck.actual', {
                  value: valueText(t, condition.evidence.actual),
                })}
              </span>
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}
