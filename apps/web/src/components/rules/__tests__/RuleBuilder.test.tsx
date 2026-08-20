import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Destination } from '@tracearr/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RuleBuilder, type RuleBuilderInput } from '../RuleBuilder';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: () => ({ servers: [] }),
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
  referencedByRuleCount: 0,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const onSave = vi.fn();
const onCancel = vi.fn();

function renderBuilder(to: string[], scope: Partial<RuleBuilderInput> = {}) {
  return render(
    <TooltipProvider>
      <RuleBuilder
        initialRule={{
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
  user.click(screen.getByRole('button', { name: /rules.updateRule/ }));

const severityLabel = () => screen.queryByText('pages:rules.builder.severityLabel');

beforeEach(() => {
  onSave.mockReset();
  onCancel.mockReset();
  vi.mocked(useDestinations).mockReturnValue({
    data: [discord],
    isLoading: false,
  } as unknown as ReturnType<typeof useDestinations>);
});

describe('RuleBuilder validation', () => {
  it('blocks save when a send action has no destination', async () => {
    const user = userEvent.setup();
    renderBuilder([]);

    await user.click(screen.getByRole('button', { name: /rules.updateRule/ }));

    expect(screen.getByText('pages:rules.builder.errors.sendNeedsDestination')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('saves once a destination is picked', async () => {
    const user = userEvent.setup();
    renderBuilder(['dest-discord']);

    await user.click(screen.getByRole('button', { name: /rules.updateRule/ }));

    expect(
      screen.queryByText('pages:rules.builder.errors.sendNeedsDestination')
    ).not.toBeInTheDocument();
    expect(onSave).toHaveBeenCalledTimes(1);
  });
});

describe('RuleBuilder kind', () => {
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

describe('RuleBuilder kind steering', () => {
  it('pre-adds a send action when a new automation turns into a notification', async () => {
    const user = userEvent.setup();
    render(
      <TooltipProvider>
        <RuleBuilder onSave={onSave} onCancel={onCancel} />
      </TooltipProvider>
    );

    expect(screen.queryByText('rules.builder.actions.typeLabel')).not.toBeInTheDocument();

    await user.click(screen.getByText('pages:automations.kind.notification'));

    expect(screen.getByText('rules.builder.actions.typeLabel')).toBeInTheDocument();
    expect(screen.getByText('Send Notification')).toBeInTheDocument();
  });

  it('leaves a new policy automation with no actions', () => {
    render(
      <TooltipProvider>
        <RuleBuilder onSave={onSave} onCancel={onCancel} />
      </TooltipProvider>
    );

    expect(screen.queryByText('rules.builder.actions.typeLabel')).not.toBeInTheDocument();
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

describe('RuleBuilder actions', () => {
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
        <RuleBuilder onSave={onSave} onCancel={onCancel} />
      </TooltipProvider>
    );

    expect(screen.queryByText('rules.builder.actions.typeLabel')).not.toBeInTheDocument();
  });
});

describe('RuleBuilder scope', () => {
  it('sends only the column the chosen scope owns', async () => {
    const user = userEvent.setup();
    renderBuilder(['dest-discord'], { userId: 'usr-3' });

    await user.click(screen.getByRole('button', { name: /rules.updateRule/ }));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'usr-3', serverId: null, serverUserId: null })
    );
  });

  it('blocks save when a targeted scope has no target picked', async () => {
    const user = userEvent.setup();
    renderBuilder(['dest-discord'], { serverId: 'srv-1' });

    await user.click(screen.getByText('rules.builder.scope.person'));
    await user.click(screen.getByRole('button', { name: /rules.updateRule/ }));

    expect(screen.getByText('pages:rules.builder.errors.scopeIncomplete')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});
