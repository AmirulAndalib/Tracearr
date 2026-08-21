import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '@tracearr/translations';
import type { CreateAutomationInput, DryRunSample } from '@tracearr/shared';

const { dryRun } = vi.hoisted(() => ({ dryRun: vi.fn() }));
vi.mock('@/hooks/queries/useDryRun', () => ({ useDryRun: dryRun }));

import { LiveCheckStrip } from '../LiveCheckStrip';

beforeAll(async () => {
  await initI18n({ lng: 'en' });
});

beforeEach(() => {
  dryRun.mockReset();
});

const sample: DryRunSample = {
  subject: {
    sessionId: 's1',
    user: { id: 'u1', name: 'Connor' },
    server: { id: 'srv1', name: 'Beehive' },
  },
  triggers: ['session.started'],
  conditions: [
    {
      nodeId: 'c-1',
      passed: false,
      evidence: {
        field: 'is_local_network',
        operator: 'eq',
        threshold: false,
        actual: true,
        matched: false,
      },
    },
    {
      nodeId: 'c-2',
      passed: true,
      evidence: {
        field: 'concurrent_streams',
        operator: 'gte',
        threshold: 2,
        actual: 3,
        matched: true,
      },
    },
  ],
  actions: [],
  wouldRun: false,
  summary: 'Would not run for Connor on Beehive: the user is on the local network.',
};

function definition(overrides: Partial<CreateAutomationInput> = {}): CreateAutomationInput {
  return {
    name: 'Nightly sweep',
    kind: 'policy',
    severity: 'warning',
    triggers: [
      { id: '11111111-1111-4111-8111-111111111111', type: 'session.started', enabled: true },
    ],
    conditions: { groups: [] },
    actions: { actions: [] },
    ...overrides,
  };
}

function renderStrip(input = definition()) {
  render(<LiveCheckStrip definition={input} ready paused={false} />);
}

describe('LiveCheckStrip', () => {
  it('says nothing when no session trigger can reach a session', () => {
    dryRun.mockReturnValue({ data: undefined, isPending: false, isError: false });
    renderStrip(
      definition({
        triggers: [
          { id: '22222222-2222-4222-8222-222222222222', type: 'server.down', enabled: true },
        ],
      })
    );

    expect(screen.queryByText('Right now on the servers')).not.toBeInTheDocument();
  });

  it('reads the verdict for each session back in words', () => {
    dryRun.mockReturnValue({ data: { samples: [sample] }, isPending: false, isError: false });
    renderStrip();

    expect(screen.getByText(sample.summary)).toBeInTheDocument();
    expect(
      screen.getByText("Cooldowns and sessions already handled aren't simulated.")
    ).toBeInTheDocument();
  });

  it('marks each condition once a session is opened', async () => {
    const user = userEvent.setup();
    dryRun.mockReturnValue({ data: { samples: [sample] }, isPending: false, isError: false });
    renderStrip();

    expect(screen.queryByText(/Local Network/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Connor/ }));

    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Did not pass');
    expect(rows[1]).toHaveTextContent('Passed');
  });
});
