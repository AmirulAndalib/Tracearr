import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { nodeDomId, type BuilderDispatch } from './builderReducer';
import { RowIssues } from './RowActions';
import { SentencePanel } from './SentencePanel';
import { BUILDER_SECTIONS, type NodeIssues } from './validation';

interface SummaryCardProps {
  name: string;
  issues: NodeIssues;
  /** The automation in words, built by the page so every clause can reach its row. */
  sentence: ReactNode;
  liveCheck: ReactNode;
  dispatch: BuilderDispatch;
}

/** What the automation is called, what it says, and what it would do right now. */
export function SummaryCard({ name, issues, sentence, liveCheck, dispatch }: SummaryCardProps) {
  const { t } = useTranslation('pages');
  const nameIssues = issues.get(BUILDER_SECTIONS.name);
  // The name's anchor is the input itself, so jumping to the problem lands in it.
  const nameId = nodeDomId(BUILDER_SECTIONS.name);

  return (
    <div className="bg-card-raised rounded-xl border p-5">
      <Field>
        <FieldLabel htmlFor={nameId}>{t('automations.name')}</FieldLabel>
        <Input
          id={nameId}
          value={name}
          placeholder={t('automations.namePlaceholder')}
          aria-invalid={nameIssues !== undefined}
          onChange={(event) => dispatch({ type: 'setName', value: event.target.value })}
        />
        <RowIssues issues={nameIssues} />
      </Field>

      <SentencePanel className="mt-4">{sentence}</SentencePanel>

      {liveCheck}
    </div>
  );
}
