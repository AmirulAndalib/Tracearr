import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';

interface RowActionsProps {
  /** The row's own name, so the switch and the remove button say what they act on. */
  name: string;
  enabled: boolean;
  onToggle: () => void;
  onRemove: () => void;
  /** An overflow menu, sitting between the switch and the remove button. */
  children?: ReactNode;
}

/** What every node row carries on its right: whether it runs, and how to drop it. */
export function RowActions({ name, enabled, onToggle, onRemove, children }: RowActionsProps) {
  const { t } = useTranslation('pages');

  return (
    <>
      {!enabled && <Badge variant="secondary">{t('automations.builder.rows.skipped')}</Badge>}
      <Switch
        checked={enabled}
        aria-label={t('automations.builder.rows.toggle', { name })}
        onCheckedChange={onToggle}
      />
      {children}
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={t('automations.builder.rows.remove', { name })}
        onClick={onRemove}
      >
        <X />
      </Button>
    </>
  );
}
