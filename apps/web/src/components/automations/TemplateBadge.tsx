import { useTranslation } from 'react-i18next';
import { LayoutTemplate } from 'lucide-react';
import type { AutomationTemplateRef } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { templateName } from '@/lib/automations';

/** The template a row is bound to, with a dot when the template has moved on. */
export function TemplateBadge({ template }: { template: AutomationTemplateRef }) {
  const { t } = useTranslation('pages');
  const behind = template.version < template.currentVersion;
  const name = templateName(t, { slug: template.slug, name: template.name });

  return (
    <Badge variant="secondary">
      <LayoutTemplate aria-hidden="true" />
      {name}
      {behind && (
        <span
          className="bg-primary size-1.5 rounded-full"
          aria-label={t('automations.template.updateAvailable')}
          title={t('automations.template.updateAvailable')}
        />
      )}
    </Badge>
  );
}
