import type { LucideIcon } from 'lucide-react';
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
}

/** The app's one empty placeholder: the Empty primitives behind a flat title/description API. */
export function EmptyState({
  icon: Icon,
  title,
  description,
  children,
  className,
}: EmptyStateProps) {
  return (
    // md:p-6 caps the primitive's md:p-12 so a consumer's own py-* holds at every width.
    <Empty className={cn('p-6 py-12 md:p-6', className)}>
      <EmptyHeader>
        {Icon && (
          <EmptyMedia variant="icon" className="text-muted-foreground size-16 rounded-full">
            <Icon className="size-8" />
          </EmptyMedia>
        )}
        {/* EmptyTitle renders a div; the role keeps the heading this has always exposed. */}
        <EmptyTitle role="heading" aria-level={3}>
          {title}
        </EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {children && <EmptyContent>{children}</EmptyContent>}
    </Empty>
  );
}
