import { cn } from '@/lib/utils';
import type { StatsPeriod } from '@/hooks/queries';

interface PeriodSelectorProps {
  value: StatsPeriod;
  onChange: (value: StatsPeriod) => void;
  className?: string;
}

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'week', label: '7d' },
  { value: 'month', label: '30d' },
  { value: 'year', label: '1y' },
];

export function PeriodSelector({ value, onChange, className }: PeriodSelectorProps) {
  return (
    <div className={cn('inline-flex rounded-lg bg-muted p-1', className)}>
      {PERIODS.map((period) => (
        <button
          key={period.value}
          onClick={() => onChange(period.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            value === period.value
              ? 'bg-background text-foreground shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {period.label}
        </button>
      ))}
    </div>
  );
}
