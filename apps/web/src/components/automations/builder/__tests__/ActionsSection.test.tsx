import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '@tracearr/translations';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AutomationActions, TriggerNode } from '@tracearr/shared';
import { ActionsSection } from '../ActionsSection';
import type { BuilderRefs } from '../builderRefs';

vi.mock('@/hooks/queries/useDestinations', () => ({
  useDestinations: () => ({ data: [], isLoading: false }),
}));

beforeAll(async () => {
  await initI18n({ lng: 'en' });
});

const started: TriggerNode = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'session.started',
  enabled: true,
};

const branching: AutomationActions = {
  actions: [
    {
      id: 'if-1',
      enabled: true,
      type: 'if',
      conditions: { groups: [] },
      then: [{ id: 'kill-1', enabled: true, type: 'kill_stream' }],
      else: [{ id: 'trust-1', enabled: true, type: 'trust', mode: 'reset' }],
    },
  ],
};

const pair: AutomationActions = {
  actions: [
    { id: 'send-1', enabled: true, type: 'send', to: [] },
    { id: 'kill-2', enabled: true, type: 'kill_stream' },
  ],
};

function renderSection(actions: AutomationActions, kind: BuilderRefs['kind'] = 'policy') {
  const dispatch = vi.fn();
  const refs: BuilderRefs = {
    triggers: [started],
    kind,
    filterOptions: undefined,
    describe: {},
    unitSystem: 'metric',
  };
  render(
    <TooltipProvider>
      <ActionsSection
        actions={actions}
        refs={refs}
        issues={new Map()}
        pulseId={null}
        dispatch={dispatch}
      />
    </TooltipProvider>
  );
  return { dispatch };
}

describe('ActionsSection', () => {
  it('says what the section is for while it is empty', () => {
    renderSection({ actions: [] });

    expect(
      screen.getByText('Nothing happens yet. Pick what this automation should do.')
    ).toBeInTheDocument();
  });

  it('shows the then rows and keeps Otherwise folded away until asked', async () => {
    const user = userEvent.setup();
    renderSection(branching);

    expect(screen.getByText('Kill Stream')).toBeInTheDocument();
    expect(screen.queryByText('Trust Score')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Otherwise/ }));

    expect(screen.getByText('Trust Score')).toBeInTheDocument();
  });

  it('warns that a branch does not decide the flag on a policy', () => {
    renderSection(branching);

    expect(
      screen.getByText("This doesn't decide whether it's flagged — use Only when… for that")
    ).toBeInTheDocument();
  });

  it('reorders the focused row with Alt and an arrow', async () => {
    const user = userEvent.setup();
    const { dispatch } = renderSection(pair);

    screen.getAllByRole('listitem')[1]?.focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');

    expect(dispatch).toHaveBeenCalledWith({ type: 'moveAction', id: 'kill-2', delta: -1 });
  });

  it('folds a branch away with E', async () => {
    const user = userEvent.setup();
    renderSection(branching);

    expect(screen.getByText('Kill Stream')).toBeInTheDocument();

    screen.getAllByRole('listitem')[0]?.focus();
    await user.keyboard('e');

    expect(screen.queryByText('Kill Stream')).not.toBeInTheDocument();
  });

  it('adds what the picker was asked for', async () => {
    const user = userEvent.setup();
    const { dispatch } = renderSection({ actions: [] });

    await user.click(screen.getByRole('button', { name: /Add action/ }));
    await user.click(await screen.findByRole('option', { name: /Send Notification/ }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'addAction', actionType: 'send' });
  });
});
