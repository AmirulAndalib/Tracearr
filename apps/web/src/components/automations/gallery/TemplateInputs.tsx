import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TemplateInput, UnitSystem } from '@tracearr/shared';
import { SentencePanel } from '@/components/automations/builder/SentencePanel';
import { useDestinations } from '@/hooks/queries/useDestinations';
import { useAutomationFilterOptions } from '@/hooks/queries/useHistory';
import { useSettings } from '@/hooks/queries/useSettings';
import { useServer } from '@/hooks/useServer';
import { describeTemplate, isUnbound, type DescribeRefs } from '@/lib/automations';
import type { TemplateVersionPayload } from '@/lib/api';
import { TemplateSentence } from './TemplateCard';
import { TemplateInputField } from './TemplateInputField';

/**
 * An answer already given wins; anything else opens on its default, so no row is
 * ever blank. Keys the version no longer declares drop out.
 */
export function initialInputValues(
  inputs: TemplateInput[],
  bound?: Record<string, unknown> | null
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const input of inputs) {
    const answered = bound?.[input.key];
    if (answered !== undefined) values[input.key] = answered;
    else if ('default' in input && input.default !== undefined) values[input.key] = input.default;
  }
  return values;
}

export const serverInputKey = (inputs: TemplateInput[]): string | undefined =>
  inputs.find((input) => input.kind === 'server')?.key;

export const missingInputs = (
  inputs: TemplateInput[],
  values: Record<string, unknown>
): TemplateInput[] => inputs.filter((input) => input.required && isUnbound(values[input.key]));

/** What the values are worth as a bound answer: an unbound one is not an answer. */
export const boundInputValues = (values: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(values).filter(([, value]) => !isUnbound(value)));

/** Every name a template sentence can put in place of an id. */
function useDescribeRefs(): { refs: DescribeRefs; unitSystem: UnitSystem } {
  const { data: settings } = useSettings();
  const { data: destinations } = useDestinations();
  const { data: filterOptions } = useAutomationFilterOptions();
  const { servers } = useServer();

  const refs = useMemo<DescribeRefs>(
    () => ({
      servers: Object.fromEntries(servers.map((server) => [server.id, server.name])),
      destinations: Object.fromEntries(
        (destinations ?? []).map((destination) => [destination.id, destination.name])
      ),
      countries: Object.fromEntries(
        (filterOptions?.countries ?? []).map((country) => [country.code, country.name])
      ),
    }),
    [servers, destinations, filterOptions]
  );

  return { refs, unitSystem: settings?.unitSystem ?? 'metric' };
}

interface TemplateSentencePanelProps {
  version: TemplateVersionPayload;
  values: Record<string, unknown>;
  /** Names the panel when two of them sit side by side. */
  label?: string;
}

/** One version's sentence, filled in as far as the answers reach. */
export function TemplateSentencePanel({ version, values, label }: TemplateSentencePanelProps) {
  const { t } = useTranslation('pages');
  const { refs, unitSystem } = useDescribeRefs();

  return (
    <div className="space-y-1">
      {label !== undefined && <p className="text-muted-foreground text-xs">{label}</p>}
      <SentencePanel>
        <p className="text-muted-foreground text-[0.9375rem] leading-relaxed">
          <TemplateSentence
            fragments={describeTemplate(version, values, refs, t, unitSystem)}
            clauses
          />
        </p>
      </SentencePanel>
    </div>
  );
}

interface TemplateInputRowsProps {
  version: TemplateVersionPayload;
  values: Record<string, unknown>;
  onChange: (input: TemplateInput, value: unknown) => void;
  /** Marks the required rows that are still blank, once the reader has tried to submit. */
  submitted: boolean;
  /** Names the sentence panel when an upgrade puts the old one beside it. */
  sentenceLabel?: string;
}

/** What the automation will say, then the parts the reader supplies. */
export function TemplateInputRows({
  version,
  values,
  onChange,
  submitted,
  sentenceLabel,
}: TemplateInputRowsProps) {
  const { t } = useTranslation('pages');
  const { servers } = useServer();
  const { unitSystem } = useDescribeRefs();
  const { data: filterOptions } = useAutomationFilterOptions();

  const boundServerId = String(values[serverInputKey(version.inputs) ?? ''] ?? '');

  return (
    <>
      <TemplateSentencePanel version={version} values={values} label={sentenceLabel} />

      {version.inputs.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t('automations.bind.noInputs')}</p>
      ) : (
        version.inputs.map((input) => (
          <TemplateInputField
            key={input.key}
            input={input}
            definition={version.definition}
            value={values[input.key]}
            onChange={(value) => onChange(input, value)}
            servers={servers}
            boundServerId={boundServerId}
            filterOptions={filterOptions}
            unitSystem={unitSystem}
            invalid={submitted && input.required && isUnbound(values[input.key])}
          />
        ))
      )}
    </>
  );
}
