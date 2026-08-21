import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { Automation, RulesFilterOptions, Server } from '@tracearr/shared';
import { ScopeChip } from './ScopeChip';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const servers: Server[] = [
  {
    id: 'srv-plex',
    name: 'Plex',
    type: 'plex',
    url: '',
    color: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  {
    id: 'srv-jf',
    name: 'Jellyfin',
    type: 'jellyfin',
    url: '',
    color: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  },
];

// The API returns one row per person, on the representative account.
const filterOptions: RulesFilterOptions = {
  platforms: [],
  products: [],
  devices: [],
  countries: [],
  cities: [],
  servers: [],
  users: [
    {
      id: 'su-plex',
      username: 'alice-plex',
      thumbUrl: null,
      serverId: 'srv-plex',
      identityName: 'Alice',
      serverUserIds: ['su-plex', 'su-jf'],
    },
  ],
};

function automation(serverUserId: string): Automation {
  return {
    id: 'a-1',
    name: 'Nudge',
    description: null,
    kind: 'notification',
    severity: null,
    triggers: [],
    conditions: { groups: [] },
    actions: { actions: [] },
    serverId: null,
    serverUserId,
    userId: null,
    enforceAcrossServers: false,
    isActive: true,
    cooldownMinutes: null,
    retentionDays: null,
    identityName: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
  };
}

describe('ScopeChip', () => {
  it('names the account and its server when the scope is the representative', () => {
    render(
      <ScopeChip
        automation={automation('su-plex')}
        servers={servers}
        filterOptions={filterOptions}
      />
    );

    expect(screen.getByText('alice-plex')).toBeInTheDocument();
    expect(screen.getByLabelText('Plex')).toBeInTheDocument();
  });

  it('falls back to the person for another of their accounts rather than the wrong server', () => {
    render(
      <ScopeChip automation={automation('su-jf')} servers={servers} filterOptions={filterOptions} />
    );

    expect(screen.getByText('Alice')).toBeInTheDocument();
    expect(screen.queryByLabelText('Plex')).not.toBeInTheDocument();
    expect(screen.queryByText('automations.scope.account')).not.toBeInTheDocument();
  });
});
