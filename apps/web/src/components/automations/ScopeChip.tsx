import { useTranslation } from 'react-i18next';
import { User } from 'lucide-react';
import type { Automation, AutomationFilterOptions, Server } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { ServerBadge } from '@/components/server';
import { scopeFromRule } from '@/lib/rules';

interface ScopeChipProps {
  automation: Automation;
  servers: Server[];
  filterOptions?: AutomationFilterOptions;
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
        {(automation.scopeRef?.kind === 'person' ? automation.scopeRef.name : null) ??
          t('automations.scope.person')}
      </Badge>
    );
  }

  // One option per person, keyed by a representative account. Only that
  // representative carries a username and a server the scope can claim.
  const account = automation.serverUserId;
  const userOption = account
    ? filterOptions?.users.find((user) => user.serverUserIds.includes(account))
    : undefined;
  const representative = userOption?.id === account ? userOption : undefined;
  const server = representative ? servers.find((s) => s.id === representative.serverId) : undefined;
  const label = representative?.username ?? userOption?.identityName ?? userOption?.username;

  return (
    <span className="inline-flex items-center gap-1">
      {server && <ServerBadge server={server} variant="compact" />}
      <Badge variant="secondary">
        <User aria-hidden="true" />
        {label ?? t('automations.scope.account')}
      </Badge>
    </span>
  );
}
