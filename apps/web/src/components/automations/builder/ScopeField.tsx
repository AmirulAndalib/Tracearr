import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ServerSelect } from '@/components/server';
import { useServer } from '@/hooks/useServer';
import { useUsers } from '@/hooks/queries/useUsers';
import {
  isScopeComplete,
  offeredScopeModes,
  withScopeMode,
  type AutomationScope,
  type AutomationScopeMode,
} from '@/lib/automations/scope';

interface ScopeFieldProps {
  scope: AutomationScope;
  onChange: (scope: AutomationScope) => void;
  enforceAcrossServers: boolean;
  onEnforceAcrossServersChange: (value: boolean) => void;
  canEnforceAcrossServers: boolean;
  showErrors?: boolean;
}

export function ScopeField({
  scope,
  onChange,
  enforceAcrossServers,
  onEnforceAcrossServersChange,
  canEnforceAcrossServers,
  showErrors = false,
}: ScopeFieldProps) {
  const { t } = useTranslation('pages');
  const { servers } = useServer();
  const fieldId = useId();

  // One server needs no picking: the account roster can only come from it.
  const soleServerId = servers.length === 1 ? (servers[0]?.id ?? '') : '';
  const scopeServerId = ('serverId' in scope ? scope.serverId : '') || soleServerId;
  const asksForServer = scope.mode === 'server' || (scope.mode === 'account' && !soleServerId);

  // A stored scope can name a mode this install no longer offers; keep it as the current value.
  const offered = offeredScopeModes(servers.length);
  const modes = offered.includes(scope.mode) ? offered : [scope.mode, ...offered];

  const { data: accountsPage } = useUsers(
    scope.mode === 'account' && scopeServerId ? { serverId: scopeServerId, pageSize: 100 } : {}
  );
  const { data: identitiesPage } = useUsers(scope.mode === 'person' ? { pageSize: 100 } : {});

  const accounts = accountsPage?.data ?? [];
  const identities = identitiesPage?.data ?? [];

  const handleModeChange = (mode: string) => {
    if (!mode) return;
    onChange(withScopeMode(scope, mode as AutomationScopeMode, servers[0]?.id ?? ''));
  };

  const incomplete = showErrors && !isScopeComplete(scope);

  return (
    <FieldSet>
      <FieldLegend variant="label">{t('automations.builder.scope.label')}</FieldLegend>

      <ToggleGroup
        type="single"
        variant="outline"
        size="sm"
        value={scope.mode}
        onValueChange={handleModeChange}
        className="flex-wrap"
      >
        {modes.map((mode) => (
          <ToggleGroupItem
            key={mode}
            value={mode}
            className="data-[state=on]:bg-primary/15 data-[state=on]:text-primary"
          >
            {t(`automations.builder.scope.${mode}`)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {scope.mode !== 'global' && (
        <FieldGroup>
          {servers.length === 0 && scope.mode !== 'person' ? (
            <FieldDescription>{t('automations.builder.scope.noServers')}</FieldDescription>
          ) : (
            <div className="grid gap-4 @md:grid-cols-2">
              {asksForServer && 'serverId' in scope && (
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-server`}>
                    {t('automations.builder.scope.serverLabel')}
                  </FieldLabel>
                  <ServerSelect
                    id={`${fieldId}-server`}
                    servers={servers}
                    value={scope.serverId}
                    placeholder={t('automations.builder.scope.serverPlaceholder')}
                    onChange={(serverId) =>
                      onChange(
                        scope.mode === 'account'
                          ? { mode: 'account', serverId, serverUserId: '' }
                          : { mode: 'server', serverId }
                      )
                    }
                  />
                </Field>
              )}

              {scope.mode === 'account' && scopeServerId && (
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-account`}>
                    {t('automations.builder.scope.accountLabel')}
                  </FieldLabel>
                  <Select
                    value={scope.serverUserId}
                    onValueChange={(serverUserId) =>
                      onChange({ mode: 'account', serverId: scopeServerId, serverUserId })
                    }
                  >
                    <SelectTrigger id={`${fieldId}-account`}>
                      <SelectValue
                        placeholder={t('automations.builder.scope.accountPlaceholder')}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {accounts.map((account) => (
                        <SelectItem key={account.id} value={account.id}>
                          {account.identityName ?? account.username}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}

              {scope.mode === 'person' && (
                <Field>
                  <FieldLabel htmlFor={`${fieldId}-person`}>
                    {t('automations.builder.scope.personLabel')}
                  </FieldLabel>
                  <Select
                    value={scope.userId}
                    onValueChange={(userId) => onChange({ mode: 'person', userId })}
                  >
                    <SelectTrigger id={`${fieldId}-person`}>
                      <SelectValue placeholder={t('automations.builder.scope.personPlaceholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {identities.map((identity) => (
                        <SelectItem key={identity.userId} value={identity.userId}>
                          {identity.identityName ?? identity.username}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
              )}
            </div>
          )}

          {incomplete && <FieldError>{t('automations.builder.errors.scopeIncomplete')}</FieldError>}
        </FieldGroup>
      )}

      {canEnforceAcrossServers && (
        <Field orientation="horizontal">
          <Switch
            id={`${fieldId}-enforce`}
            checked={enforceAcrossServers}
            onCheckedChange={onEnforceAcrossServersChange}
          />
          <FieldContent>
            <FieldLabel htmlFor={`${fieldId}-enforce`}>
              {t('automations.builder.scope.enforceAcrossServers')}
            </FieldLabel>
            <FieldDescription className="max-w-prose">
              {t('automations.builder.scope.enforceAcrossServersDescription')}
            </FieldDescription>
          </FieldContent>
        </Field>
      )}
    </FieldSet>
  );
}
