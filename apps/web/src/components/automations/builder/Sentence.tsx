import { useTranslation } from 'react-i18next';
import { capFragments, type DescribeFragment } from '@/lib/automations';
import { cn } from '@/lib/utils';

interface SentenceProps {
  fragments: readonly DescribeFragment[];
  onFocusNode: (nodeId: string) => void;
  className?: string;
}

/** The automation in one line, where every clause jumps to the row it came from. */
export function Sentence({ fragments, onFocusNode, className }: SentenceProps) {
  const { t } = useTranslation('pages');
  const shown = capFragments(fragments, t);

  return (
    <p
      role="group"
      aria-live="polite"
      aria-label={t('automations.builder.sentence.label')}
      className={cn('text-muted-foreground text-sm leading-relaxed', className)}
    >
      {shown.map((fragment, index) => {
        const key = `${fragment.nodeId ?? 'text'}:${index}`;
        if (fragment.nodeId === null) {
          return <span key={key}>{fragment.text} </span>;
        }
        const nodeId = fragment.nodeId;
        return (
          <span key={key}>
            <button
              type="button"
              onClick={() => onFocusNode(nodeId)}
              className="text-foreground focus-visible:ring-ring/50 hover:decoration-foreground rounded-sm underline decoration-dotted underline-offset-4 focus-visible:ring-[3px] focus-visible:outline-none"
            >
              {fragment.text}
            </button>{' '}
          </span>
        );
      })}
    </p>
  );
}
