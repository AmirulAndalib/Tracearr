import type { ReactElement, ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck } from 'lucide-react';
import { Item, ItemContent, ItemDescription, ItemMedia, ItemTitle } from '@/components/ui/item';
import { Skeleton } from '@/components/ui/skeleton';
import { useSettings } from '@/hooks/queries/useSettings';
import {
  describeTemplate,
  templateIcon,
  templateName,
  type DescribeFragment,
  type DescribeRefs,
} from '@/lib/automations';
import { cn } from '@/lib/utils';
import type { TemplateSummary, TemplateVersionPayload } from '@/lib/api';

/** A card names no ids of its own: every value it shows is a default or a placeholder. */
const NO_REFS: DescribeRefs = {};

const PLACEHOLDER = /(\[[^\]]*\])/;

interface TemplateSentenceProps {
  fragments: readonly DescribeFragment[];
  /** Lifts the clauses out of the connective words, as the binding form's panel does. */
  clauses?: boolean;
  className?: string;
}

/** The sentence as text, with the parts the reader still supplies standing out. */
export function TemplateSentence({ fragments, clauses, className }: TemplateSentenceProps) {
  return (
    <>
      {fragments.map((fragment, index) => {
        const key = `${fragment.nodeId ?? 'text'}:${index}`;
        return (
          <span
            key={key}
            className={cn(clauses && fragment.nodeId !== null && 'text-foreground', className)}
          >
            {fragment.text.split(PLACEHOLDER).map((part, partIndex) => {
              const partKey = `${key}:${partIndex}`;
              return PLACEHOLDER.test(part) ? (
                <span key={partKey} className="text-foreground">
                  {part}
                </span>
              ) : (
                <span key={partKey}>{part}</span>
              );
            })}{' '}
          </span>
        );
      })}
    </>
  );
}

interface GalleryRowProps {
  icon: ReactElement;
  title: string;
  description: ReactNode;
  meta?: ReactNode;
  /** The two rows that are doors rather than ready-made automations. */
  dashed?: boolean;
  onSelect?: () => void;
  className?: string;
}

/** One row of the gallery: icon, name, what it does, and where it came from. */
export function GalleryRow({
  icon,
  title,
  description,
  meta,
  dashed,
  onSelect,
  className,
}: GalleryRowProps) {
  const body = (
    <>
      <ItemMedia variant="icon" className={cn(dashed && 'border-dashed bg-transparent')}>
        {icon}
      </ItemMedia>
      <ItemContent className="gap-0.5">
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="line-clamp-none text-[0.8125rem] text-pretty">
          {description}
        </ItemDescription>
        {meta && (
          <div className="text-muted-foreground flex flex-wrap items-center gap-2 text-xs">
            {meta}
          </div>
        )}
      </ItemContent>
    </>
  );

  const classes = cn('w-full items-start gap-3 px-3 py-2.5 text-left', className);

  if (!onSelect) {
    return (
      <Item variant="outline" size="sm" className={classes}>
        {body}
      </Item>
    );
  }

  return (
    <Item asChild variant="outline" size="sm" className={cn(classes, 'hover:bg-accent/40')}>
      <button type="button" onClick={onSelect}>
        {body}
      </button>
    </Item>
  );
}

interface TemplateCardProps {
  template: TemplateSummary;
  /** Undefined until the version body lands; the sentence needs the definition. */
  version: TemplateVersionPayload | undefined;
  /** The gallery says where every card came from; the empty state's four are all built in. */
  showOrigin?: boolean;
  onSelect?: () => void;
  className?: string;
}

/** A ready-made automation, in the gallery and on the empty page alike. */
export function TemplateCard({
  template,
  version,
  showOrigin = true,
  onSelect,
  className,
}: TemplateCardProps) {
  const { t } = useTranslation('pages');
  const { data: settings } = useSettings();
  const fragments = version
    ? describeTemplate(version, {}, NO_REFS, t, settings?.unitSystem ?? 'metric')
    : undefined;

  return (
    <GalleryRow
      icon={version ? templateIcon(version.definition) : <ShieldCheck />}
      title={templateName(t, template)}
      description={
        fragments ? <TemplateSentence fragments={fragments} /> : <Skeleton className="h-4 w-64" />
      }
      meta={
        <>
          <span className="text-foreground font-medium">
            {t(`automations.gallery.kind.${template.kind}`)}
          </span>
          {showOrigin && template.builtin && (
            <>
              <span aria-hidden className="opacity-50">
                ·
              </span>
              <span className="inline-flex items-center gap-1">
                <ShieldCheck className="size-3" />
                {t('automations.gallery.builtin')}
              </span>
            </>
          )}
        </>
      }
      onSelect={onSelect}
      className={className}
    />
  );
}
