import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';
import type { Automation, RulesFilterOptions, Server } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { ServerBadge } from '@/components/server';
import { scopeFromRule } from '@/lib/rules';

interface ScopeChipProps {
  automation: Automation;
  servers: Server[];
  filterOptions?: RulesFilterOptions;
}

/** Where the automation applies, as one chip beside its name. */
export function ScopeChip({ automation, servers, filterOptions }: ScopeChipProps) {
  const { t } = useTranslation('pages');
  const scope = scopeFromRule(automation).mode;

  if (scope === 'global') {
    return <Badge variant="secondary">{t('automations.scope.global')}</Badge>;
  }

  if (scope === 'server') {
    const server = servers.find((candidate) => candidate.id === automation.serverId);
    return server ? <ServerBadge server={server} variant="outlined" /> : null;
  }

  if (scope === 'person') {
    return (
      <Badge variant="secondary">
        <User aria-hidden="true" />
        {automation.identityName ?? t('automations.scope.person')}
      </Badge>
    );
  }

  const userOption = filterOptions?.users.find((user) => user.id === automation.serverUserId);
  const server = userOption ? servers.find((s) => s.id === userOption.serverId) : undefined;

  return (
    <span className="inline-flex items-center gap-1">
      {server && <ServerBadge server={server} variant="compact" />}
      <Badge variant="secondary">
        <User aria-hidden="true" />
        {userOption?.username ?? userOption?.identityName ?? t('automations.scope.account')}
      </Badge>
    </span>
  );
}
