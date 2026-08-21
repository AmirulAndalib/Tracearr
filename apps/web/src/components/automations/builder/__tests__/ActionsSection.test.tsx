import { useState } from 'react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '@tracearr/translations';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AutomationActions, TriggerNode } from '@tracearr/shared';
import { ActionsSection } from '../ActionsSection';
import type { BuilderDispatch } from '../builderReducer';
import type { BranchExpansion, BuilderRefs } from '../builderRefs';

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

/** The page owns which branches are open, so the test plays that part. */
function Section({
  actions,
  kind,
  dispatch,
}: {
  actions: AutomationActions;
  kind: BuilderRefs['kind'];
  dispatch: BuilderDispatch;
}) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const [elses, setElses] = useState<ReadonlySet<string>>(() => new Set());
  const flip = (
    set: (update: (current: ReadonlySet<string>) => ReadonlySet<string>) => void,
    id: string
  ) =>
    set((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  const expansion: BranchExpansion = {
    isOpen: (id) => !closed.has(id),
    isElseOpen: (id) => elses.has(id),
    toggle: (id) => flip(setClosed, id),
    toggleElse: (id) => flip(setElses, id),
  };
  const refs: BuilderRefs = {
    triggers: [started],
    kind,
    conditions: { groups: [] },
    filterOptions: undefined,
    describe: {},
    unitSystem: 'metric',
  };

  return (
    <ActionsSection
      actions={actions}
      kind={kind}
      severity="warning"
      refs={refs}
      issues={new Map()}
      pulseId={null}
      expansion={expansion}
      dispatch={dispatch}
    />
  );
}

function renderSection(actions: AutomationActions, kind: BuilderRefs['kind'] = 'policy') {
  const dispatch = vi.fn();
  render(
    <TooltipProvider>
      <Section actions={actions} kind={kind} dispatch={dispatch} />
    </TooltipProvider>
  );
  return { dispatch };
}

/** The step is an <li> of its own, so its rows start after it. */
function rows() {
  return screen.getAllByRole('listitem').slice(1);
}

describe('ActionsSection', () => {
  it('says what the section is for while it is empty', () => {
    renderSection({ actions: [] });

    expect(screen.getByText('What should happen?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Choose what happens/ })).toBeInTheDocument();
  });

  it('asks how a run is recorded once there is something to record', () => {
    renderSection(pair);

    expect(screen.getByRole('radio', { name: 'A violation' })).toHaveAttribute('data-state', 'on');
    expect(screen.getByRole('combobox', { name: 'Severity' })).toBeInTheDocument();
  });

  it('leaves the recording question out while the step is empty', () => {
    renderSection({ actions: [] });

    expect(screen.queryByRole('radio', { name: 'A violation' })).not.toBeInTheDocument();
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

    rows()[1]?.focus();
    await user.keyboard('{Alt>}{ArrowUp}{/Alt}');

    expect(dispatch).toHaveBeenCalledWith({ type: 'moveAction', id: 'kill-2', delta: -1 });
  });

  it('folds a branch away with E', async () => {
    const user = userEvent.setup();
    renderSection(branching);

    expect(screen.getByText('Kill Stream')).toBeInTheDocument();

    rows()[0]?.focus();
    await user.keyboard('e');

    expect(screen.queryByText('Kill Stream')).not.toBeInTheDocument();
  });

  it('reorders the other way too', async () => {
    const user = userEvent.setup();
    const { dispatch } = renderSection(pair);

    rows()[0]?.focus();
    await user.keyboard('{Alt>}{ArrowDown}{/Alt}');

    expect(dispatch).toHaveBeenCalledWith({ type: 'moveAction', id: 'send-1', delta: 1 });
  });

  it('offers E only on the row that has something to open', () => {
    renderSection({ actions: [...branching.actions, ...pair.actions] });

    const listed = rows();
    expect(listed[0]).toHaveAttribute('aria-keyshortcuts', expect.stringContaining('E'));
    expect(listed[1]?.getAttribute('aria-keyshortcuts')).not.toContain('E');
  });

  it('adds what the picker was asked for', async () => {
    const user = userEvent.setup();
    const { dispatch } = renderSection({ actions: [] });

    await user.click(screen.getByRole('button', { name: /Choose what happens/ }));
    await user.click(await screen.findByRole('option', { name: /Send Notification/ }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'addAction', actionType: 'send' });
  });
});
