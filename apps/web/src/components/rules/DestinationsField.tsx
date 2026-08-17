import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Destination } from '@tracearr/shared';
import { Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { DestinationDialog } from '@/components/settings/destinations/DestinationDialog';
import { iconFor } from '@/components/settings/destinations/destinationIcons';
import { useDestinations } from '@/hooks/queries/useDestinations';
import { cn } from '@/lib/utils';

interface DestinationsFieldProps {
  value: string[];
  onChange: (ids: string[]) => void;
  label: string;
}

function byBuiltinThenName(a: Destination, b: Destination): number {
  if (a.builtin !== b.builtin) return Number(b.builtin) - Number(a.builtin);
  return a.name.localeCompare(b.name);
}

export function DestinationsField({ value, onChange, label }: DestinationsFieldProps) {
  const { t } = useTranslation(['pages', 'common']);
  const { data: destinations, isLoading } = useDestinations();
  const [addOpen, setAddOpen] = useState(false);

  if (isLoading) {
    return <Skeleton className="h-8 w-64" />;
  }

  const rows = [...(destinations ?? [])].sort(byBuiltinThenName);
  // A rule can outlive the destination it sends to; keep those ids visible so they can be dropped.
  const missingIds = value.filter((id) => !rows.some((row) => row.id === id));

  const toggle = (id: string) => {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  };

  const addButton = (
    <Button type="button" variant="outline" size="sm" onClick={() => setAddOpen(true)}>
      <Plus className="h-4 w-4" />
      {t('pages:settings.destinations.add')}
    </Button>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-muted-foreground text-sm">{label}:</span>

      {rows.length === 0 && (
        <span className="text-muted-foreground text-sm">
          {t('pages:rules.builder.noDestinations')}
        </span>
      )}

      <TooltipProvider delayDuration={100}>
        {rows.map((row) => {
          const Icon = iconFor(row.type);
          const selected = value.includes(row.id);
          const button = (
            <Button
              key={row.id}
              type="button"
              variant={selected && row.enabled ? 'default' : 'outline'}
              size="sm"
              aria-pressed={selected}
              className={cn(!row.enabled && 'opacity-60')}
              onClick={() => toggle(row.id)}
            >
              <Icon className="h-4 w-4" />
              {row.name}
            </Button>
          );

          if (row.enabled) return button;

          return (
            <Tooltip key={row.id}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent>{t('pages:rules.builder.destinationDisabled')}</TooltipContent>
            </Tooltip>
          );
        })}
      </TooltipProvider>

      {missingIds.map((id) => (
        <Badge key={id} variant="outline" className="gap-1 font-mono">
          {id.slice(0, 8)}
          <button
            type="button"
            aria-label={`${t('common:actions.remove')} ${id.slice(0, 8)}`}
            className="text-muted-foreground hover:text-destructive"
            onClick={() => onChange(value.filter((v) => v !== id))}
          >
            <X className="h-3 w-3" />
          </button>
        </Badge>
      ))}

      {addButton}

      {addOpen && (
        <DestinationDialog
          open
          onOpenChange={setAddOpen}
          mode="create"
          onCreated={(created) => onChange([...value, created.id])}
        />
      )}
    </div>
  );
}

export default DestinationsField;
