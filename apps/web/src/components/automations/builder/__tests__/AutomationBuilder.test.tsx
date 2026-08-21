import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Destination } from '@tracearr/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AutomationBuilder, type AutomationBuilderInput } from '../AutomationBuilder';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: vi.fn(),
}));

vi.mock('@/hooks/queries/useUsers', () => ({
  useUsers: () => ({ data: { data: [{ userId: 'usr-3', username: 'ada', identityName: 'Ada' }] } }),
}));

vi.mock('@/hooks/queries', () => ({
  useSettings: () => ({ data: undefined }),
}));

vi.mock('@/hooks/queries/useDestinations', () => ({
  useDestinations: vi.fn(),
  useCreateDestination: vi.fn(),
  useUpdateDestination: vi.fn(),
  useTestDestination: vi.fn(),
  useTestUnsavedDestination: vi.fn(),
}));

import { useDestinations } from '@/hooks/queries/useDestinations';
import { useServer } from '@/hooks/useServer';

const mockServers = (count: number) => {
  const servers = Array.from({ length: count }, (_, index) => ({
    id: `srv-${index + 1}`,
    name: `Server ${index + 1}`,
    type: 'plex',
  }));
  vi.mocked(useServer).mockReturnValue({ servers } as unknown as ReturnType<typeof useServer>);
};

const discord: Destination = {
  id: 'dest-discord',
  name: 'Team Discord',
  type: 'discord',
  enabled: true,
  builtin: false,
  events: ['violation_detected'],
  configStatus: 'ok',
  config: { webhookUrl: null },
  secretsSet: ['webhookUrl'],
  referencedByAutomationCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const onSave = vi.fn();
const onCancel = vi.fn();

function renderBuilder(to: string[], scope: Partial<AutomationBuilderInput> = {}) {
  return render(
    <TooltipProvider>
      <AutomationBuilder
        initialAutomation={{
          id: 'rule-1',
          name: 'Too many streams',
          isActive: true,
          conditions: {
            groups: [{ conditions: [{ field: 'concurrent_streams', operator: 'gt', value: 3 }] }],
          },
          actions: { actions: [{ type: 'send', to }] },
          ...scope,
        }}
        onSave={onSave}
        onCancel={onCancel}
      />
    </TooltipProvider>
  );
}

const save = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole('button', { name: /automations.updateAutomation/ }));

const severityLabel = () => screen.queryByText('pages:automations.builder.severityLabel');

const kindOption = (kind: string) =>
  screen.getByRole('radio', { name: new RegExp(`automations.kind.${kind}Description`) });

beforeEach(() => {
  onSave.mockReset();
  onCancel.mockReset();
  mockServers(2);
  vi.mocked(useDestinations).mockReturnValue({
    data: [discord],
    isLoading: false,
  } as unknown as ReturnType<typeof useDestinations>);
});

describe('AutomationBuilder validation', () => {
  it('blocks save when a send action has no destination', async () => {
    const user = userEvent.setup();
    renderBuilder([]);

    await user.click(screen.getByRole('button', { name: /automations.updateAutomation/ }));

    expect(
      screen.getByText('pages:automations.builder.errors.sendNeedsDestination')
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves once a destination is picked', async () => {
    const user = userEvent.setup();
    renderBuilder(['dest-discord']);

    await user.click(screen.getByRole('button', { name: /automations.updateAutomation/ }));

    expect(
      screen.queryByText('pages:automations.builder.errors.sendNeedsDestination')
    ).not.toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('AutomationBuilder kind', () => {
  it('hides severity and nulls it in the payload once the kind is notification', async () => {
    const user = userEvent.setup();
    renderBuilder(['dest-discord']);

    expect(severityLabel()).toBeInTheDocument();

    await user.click(screen.getByText('pages:automations.kind.notification'));
    expect(severityLabel()).not.toBeInTheDocument();

    await save(user);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'notification', severity: null })
    );
  });

  it('restores the picked severity when the kind goes back to policy', async () => {
    const user = userEvent.setup();
    renderBuilder(['dest-discord'], { severity: 'high' });

    await user.click(screen.getByText('pages:automations.kind.notification'));
    await user.click(screen.getByText('pages:automations.kind.policy'));

    expect(severityLabel()).toBeInTheDocument();
    await save(user);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'policy', severity: 'high' })
    );
  });

  it('round-trips a stored notification automation', async () => {
    const user = userEvent.setup();
    renderBuilder(['dest-discord'], { kind: 'notification', severity: null });

    expect(severityLabel()).not.toBeInTheDocument();

    await save(user);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'notification', severity: null })
    );
  });
});

describe('AutomationBuilder kind steering', () => {
  it('describes both kinds and moves the selection to the one picked', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <AutomationBuilder onSave={onSave} onCancel={onCancel} />
      </TooltipProvider>
    );

    expect(screen.getByText('pages:automations.kind.policyDescription')).toBeInTheDocument();
    expect(screen.getByText('pages:automations.kind.notificationDescription')).toBeInTheDocument();
    expect(kindOption('policy')).toHaveAttribute('data-state', 'on');
    expect(kindOption('notification')).toHaveAttribute('data-state', 'off');

    await user.click(screen.getByText('pages:automations.kind.notification'));

    expect(kindOption('policy')).toHaveAttribute('data-state', 'off');
    expect(kindOption('notification')).toHaveAttribute('data-state', 'on');
  });

  it('pre-adds a send action when a new automation turns into a notification', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <AutomationBuilder onSave={onSave} onCancel={onCancel} />
      </TooltipProvider>
    );

    expect(screen.queryByText('automations.builder.actions.typeLabel')).not.toBeInTheDocument();

    await user.click(screen.getByText('pages:automations.kind.notification'));

    expect(screen.getByText('automations.builder.actions.typeLabel')).toBeInTheDocument();
    expect(screen.getByText('automations.actions.send.label')).toBeInTheDocument();
  });

  it('leaves a new policy automation with no actions', () => {
    render(
      <TooltipProvider>
        <AutomationBuilder onSave={onSave} onCancel={onCancel} />
      </TooltipProvider>
    );

    expect(screen.queryByText('automations.builder.actions.typeLabel')).not.toBeInTheDocument();
  });

  it('takes the pre-added send row back when the kind returns to policy', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <AutomationBuilder onSave={onSave} onCancel={onCancel} />
      </TooltipProvider>
    );

    await user.click(screen.getByText('pages:automations.kind.notification'));
    expect(screen.getByText('automations.builder.actions.typeLabel')).toBeInTheDocument();

    await user.click(screen.getByText('pages:automations.kind.policy'));

    expect(screen.queryByText('automations.builder.actions.typeLabel')).not.toBeInTheDocument();
  });

  it('keeps a pre-added send row the user has already edited', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <AutomationBuilder onSave={onSave} onCancel={onCancel} />
      </TooltipProvider>
    );

    await user.click(screen.getByText('pages:automations.kind.notification'));
    await user.type(screen.getByLabelText('Cooldown'), '15');
    await user.click(screen.getByText('pages:automations.kind.policy'));

    expect(screen.getByText('automations.builder.actions.typeLabel')).toBeInTheDocument();
  });

  it('keeps configured actions across a kind switch', async () => {
    const user = userEvent.setup();
    renderBuilder(['dest-discord'], { actions: { actions: [{ type: 'kill_stream' }] } });

    await user.click(screen.getByText('pages:automations.kind.notification'));
    await save(user);

    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'notification',
        actions: { actions: [{ type: 'kill_stream' }] },
      })
    );
  });
});

describe('AutomationBuilder actions', () => {
  it('saves an automation that has no actions at all', async () => {
    const user = userEvent.setup();
    renderBuilder([], { actions: { actions: [] } });

    await save(user);

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ actions: { actions: [] } }));
  });

  it('starts a new automation with no actions', () => {
    render(
      <TooltipProvider>
        <AutomationBuilder onSave={onSave} onCancel={onCancel} />
      </TooltipProvider>
    );

    expect(screen.queryByText('automations.builder.actions.typeLabel')).not.toBeInTheDocument();
  });

  it('adds a send row on a policy automation, whatever the catalog order is', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <AutomationBuilder onSave={onSave} onCancel={onCancel} />
      </TooltipProvider>
    );

    await user.click(screen.getByRole('button', { name: /automations.builder.actions.add/ }));

    expect(screen.getByText('automations.actions.send.label')).toBeInTheDocument();
  });
});

describe('AutomationBuilder scope', () => {
  it('sends only the column the chosen scope owns', async () => {
    const user = userEvent.setup();
    renderBuilder(['dest-discord'], { userId: 'usr-3' });

    await user.click(screen.getByRole('button', { name: /automations.updateAutomation/ }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'usr-3', serverId: null, serverUserId: null })
    );
  });

  it('blocks save when a targeted scope has no target picked', async () => {
    const user = userEvent.setup();
    renderBuilder(['dest-discord'], { serverId: 'srv-1' });

    await user.click(screen.getByText('automations.builder.scope.person'));
    await user.click(screen.getByRole('button', { name: /automations.updateAutomation/ }));

    expect(
      screen.getByText('pages:automations.builder.errors.scopeIncomplete')
    ).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('offers only the two modes a single server can tell apart', () => {
    mockServers(1);
    renderBuilder(['dest-discord']);

    expect(screen.getByText('automations.builder.scope.global')).toBeInTheDocument();
    expect(screen.getByText('automations.builder.scope.account')).toBeInTheDocument();
    expect(screen.queryByText('automations.builder.scope.server')).not.toBeInTheDocument();
    expect(screen.queryByText('automations.builder.scope.person')).not.toBeInTheDocument();
  });

  it('offers all four modes once a second server exists', () => {
    renderBuilder(['dest-discord']);

    for (const mode of ['global', 'server', 'account', 'person']) {
      expect(screen.getByText(`automations.builder.scope.${mode}`)).toBeInTheDocument();
    }
  });

  it('still shows a stored server scope on a single-server install', () => {
    mockServers(1);
    renderBuilder(['dest-discord'], { serverId: 'srv-1' });

    expect(screen.getByRole('radio', { name: 'automations.builder.scope.server' })).toHaveAttribute(
      'data-state',
      'on'
    );
  });

  it('skips the one-option server picker in account scope', async () => {
    const user = userEvent.setup();
    mockServers(1);
    renderBuilder(['dest-discord']);

    await user.click(screen.getByText('automations.builder.scope.account'));

    expect(screen.queryByText('automations.builder.scope.serverLabel')).not.toBeInTheDocument();
    expect(screen.getByText('automations.builder.scope.accountLabel')).toBeInTheDocument();
  });
});
