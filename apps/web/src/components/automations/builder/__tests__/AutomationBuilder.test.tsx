import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { initI18n } from '@tracearr/translations';
import type { Automation } from '@tracearr/shared';
import { ApiError } from '@/lib/api';

vi.mock('@/hooks/useServer', () => ({ useServer: () => ({ servers: [] }) }));
vi.mock('@/hooks/queries/useSettings', () => ({
  useSettings: () => ({ data: { unitSystem: 'metric' } }),
}));
vi.mock('@/hooks/queries/useUsers', () => ({ useUsers: () => ({ data: undefined }) }));
vi.mock('@/hooks/queries/useHistory', () => ({
  useAutomationFilterOptions: () => ({ data: undefined }),
}));
vi.mock('@/hooks/queries/useDestinations', () => ({ useDestinations: () => ({ data: [] }) }));

const create = vi.fn();
const update = vi.fn();

vi.mock('@/hooks/queries/useAutomations', () => ({
  useCreateAutomation: () => ({ mutateAsync: create, isPending: false }),
  useUpdateAutomation: () => ({ mutateAsync: update, isPending: false }),
}));

import { AutomationBuilder } from '../AutomationBuilder';
import { nodeDomId } from '../builderReducer';
import { BUILDER_SECTIONS } from '../validation';

beforeAll(async () => {
  await initI18n({ lng: 'en' });
});

beforeEach(() => {
  create.mockReset();
  create.mockResolvedValue({ id: 'new-1' });
  update.mockReset();
  update.mockResolvedValue({ id: 'a1' });
});

function storedAutomation(overrides: Partial<Automation>): Automation {
  return {
    id: 'a1',
    name: 'Stored',
    description: null,
    kind: 'notification',
    severity: null,
    triggers: [],
    conditions: { groups: [] },
    actions: { actions: [] },
    serverId: null,
    serverUserId: null,
    userId: null,
    enforceAcrossServers: false,
    isActive: true,
    cooldownMinutes: null,
    retentionDays: null,
    scopeRef: null,
    template: null,
    origin: null,
    createdAt: '2026-08-21T00:00:00.000Z',
    updatedAt: '2026-08-21T00:00:00.000Z',
    ...overrides,
  };
}

function renderBuilder(automation?: Automation) {
  const router = createMemoryRouter(
    [{ path: '/automations/*', element: <AutomationBuilder automation={automation} /> }],
    { initialEntries: ['/automations/new'] }
  );
  return render(<RouterProvider router={router} />);
}

async function addTrigger(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByRole('button', { name: /Add trigger/ }));
  await user.click(await screen.findByRole('option', { name }));
}

describe('AutomationBuilder', () => {
  it('opens on an empty When section and a sentence that says so', () => {
    renderBuilder();

    expect(screen.getByText('Pick what starts this automation.')).toBeInTheDocument();
    expect(screen.getByText(/When nothing yet/)).toBeInTheDocument();
  });

  it('grows the sentence as triggers land', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await addTrigger(user, /play is pressed/);

    expect(await screen.findByRole('button', { name: /When a stream starts/ })).toBeInTheDocument();
  });

  it('counts what is left to fix and clears the count as the form fills', async () => {
    const user = userEvent.setup();
    renderBuilder();

    expect(screen.getByRole('button', { name: /2 problems/ })).toBeInTheDocument();

    await addTrigger(user, /play is pressed/);
    await user.type(screen.getByLabelText('Automation Name'), 'Nightly sweep');

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /problem/ })).not.toBeInTheDocument()
    );
  });

  it('greets a new automation without red until Save asks for the whole form', async () => {
    const user = userEvent.setup();
    renderBuilder();

    expect(screen.queryByText('Automation name is required')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Automation Name')).not.toHaveAttribute('aria-invalid', 'true');

    await user.click(screen.getByRole('button', { name: 'Create Automation' }));

    expect(screen.getByText('Automation name is required')).toBeInTheDocument();
    expect(
      screen.getByText('Pick at least one trigger, or switch one back on')
    ).toBeInTheDocument();
    expect(create).not.toHaveBeenCalled();
  });

  it('takes the problem count to the scope when that is what is unfinished', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await addTrigger(user, /play is pressed/);
    await user.type(screen.getByLabelText('Automation Name'), 'Nightly sweep');
    await user.click(screen.getByRole('radio', { name: 'Specific account' }));

    await user.click(screen.getByRole('button', { name: /1 problem/ }));

    expect(document.activeElement).toBe(document.getElementById(nodeDomId(BUILDER_SECTIONS.scope)));
  });

  it('lets the user fix what the API rejected and try again', async () => {
    const user = userEvent.setup();
    create.mockRejectedValueOnce(
      new ApiError('Validation failed', 400, {
        details: { fields: [{ field: 'body.triggers.0.params.minutes', message: 'Too big' }] },
      })
    );
    renderBuilder();

    await addTrigger(user, /paused longer than the set number of minutes/);
    await user.type(screen.getByLabelText('Automation Name'), 'Nightly sweep');
    await user.click(screen.getByRole('button', { name: 'Create Automation' }));

    expect(await screen.findByText('Between 1 and 1440 minutes')).toBeInTheDocument();

    const minutes = screen.getByLabelText('Minutes');
    await user.clear(minutes);
    await user.type(minutes, '45');

    expect(screen.queryByText('Between 1 and 1440 minutes')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Create Automation' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(2));
  });

  it('opens the nearest picker on slash', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.keyboard('/');

    expect(
      await screen.findByPlaceholderText('Search or describe what should happen')
    ).toBeInTheDocument();
  });

  it('keeps the description out of the way until it is asked for', async () => {
    const user = userEvent.setup();
    renderBuilder();

    expect(screen.queryByPlaceholderText('Optional description')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Add description/ }));
    await user.type(screen.getByPlaceholderText('Optional description'), 'Nightly sweep');

    expect(screen.getByPlaceholderText('Optional description')).toHaveValue('Nightly sweep');
  });

  it('takes the caret to an open picker rather than shutting it', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await user.keyboard('/');
    const search = await screen.findByPlaceholderText('Search or describe what should happen');

    await user.keyboard('/');

    expect(screen.getByPlaceholderText('Search or describe what should happen')).toBe(search);
    expect(document.activeElement).toBe(search);
  });

  it('refuses to save a condition the triggers cannot supply, and says which', async () => {
    const user = userEvent.setup();
    renderBuilder(
      storedAutomation({
        name: 'Server watch',
        triggers: [
          { id: '99999999-9999-4999-8999-999999999999', type: 'server.down', enabled: true },
        ],
        conditions: {
          groups: [
            {
              id: '88888888-8888-4888-8888-888888888888',
              conditions: [
                {
                  id: '77777777-7777-4777-8777-777777777777',
                  field: 'trust_score',
                  operator: 'lt',
                  value: 50,
                },
              ],
            },
          ],
        },
      })
    );

    await user.click(screen.getByRole('button', { name: 'Update Automation' }));

    expect(await screen.findByText('Not available for: A server goes down')).toBeInTheDocument();
    expect(update).not.toHaveBeenCalled();
  });

  it('saves the triggers it was given', async () => {
    const user = userEvent.setup();
    renderBuilder();

    await addTrigger(user, /play is pressed/);
    await user.type(screen.getByLabelText('Automation Name'), 'Nightly sweep');
    await user.click(screen.getByRole('button', { name: 'Create Automation' }));

    await waitFor(() => expect(create).toHaveBeenCalledTimes(1));
    expect(create.mock.calls[0]?.[0]).toMatchObject({
      name: 'Nightly sweep',
      kind: 'policy',
      triggers: [expect.objectContaining({ type: 'session.started', enabled: true })],
    });
  });
});
