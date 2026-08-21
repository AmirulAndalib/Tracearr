import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { Automation } from '@tracearr/shared';
import { Automations } from './Automations';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const toggleMutate = vi.fn();
const deleteMutate = vi.fn();

vi.mock('@/hooks/queries', () => ({
  useAutomations: vi.fn(),
  useSettings: () => ({ data: { unitSystem: 'metric' } }),
  useCreateAutomation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateAutomation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useToggleAutomation: () => ({ mutate: toggleMutate, isPending: false }),
  useDeleteAutomation: () => ({ mutate: deleteMutate, isPending: false }),
  useBulkToggleAutomations: () => ({ mutate: vi.fn(), isPending: false }),
  useBulkDeleteAutomations: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock('@/hooks/queries/useHistory', () => ({
  useAutomationFilterOptions: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: () => ({ servers: [{ id: 'server-1', name: 'Server One' }] }),
}));

import { useAutomations } from '@/hooks/queries';

const mockUseAutomations = vi.mocked(useAutomations);

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
    id: 'a-1',
    name: 'Concurrent cap',
    description: null,
    kind: 'policy',
    severity: 'warning',
    triggers: [],
    conditions: {
      groups: [{ conditions: [{ field: 'concurrent_streams', operator: 'gt', value: 3 }] }],
    },
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
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function mockList(rows: Automation[], total = rows.length) {
  mockUseAutomations.mockReturnValue({
    data: { data: rows, meta: { page: 1, pageSize: 20, total } },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useAutomations>);
}

function lastQueryArgs() {
  const calls = mockUseAutomations.mock.calls;
  return calls[calls.length - 1]?.[0];
}

function bodyRows() {
  const table = screen.getByRole('table');
  const [, ...bodies] = within(table).getAllByRole('rowgroup');
  return bodies.flatMap((body) => within(body).queryAllByRole('row'));
}

function renderAutomations(path = '/automations') {
  // The builder dialog reaches for destinations the moment it opens.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      {/* Layout's SidebarProvider carries this in the app. */}
      <TooltipProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/automations" element={<Automations />} />
            <Route path="/automations/:id" element={<p>the automation detail</p>} />
          </Routes>
        </MemoryRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

const openedDetail = () => screen.queryByText('the automation detail');

describe('Automations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList([automation()]);
  });

  it('renders one row per automation with its translated kind badge', () => {
    mockList([automation(), automation({ id: 'a-2', name: 'Nudge', kind: 'notification' })]);

    renderAutomations();

    expect(bodyRows()).toHaveLength(2);
    expect(screen.getByText('Concurrent cap')).toBeInTheDocument();
    expect(screen.getByText('pages:automations.kind.policy')).toBeInTheDocument();
    expect(screen.getByText('pages:automations.kind.notification')).toBeInTheDocument();
  });

  it('reads the kind filter out of the URL and sends it to the query', () => {
    renderAutomations('/automations?kind=notification');

    expect(lastQueryArgs()).toMatchObject({ kind: 'notification' });
  });

  it('maps the status filter onto the enabled param', () => {
    renderAutomations('/automations?status=inactive');

    expect(lastQueryArgs()).toMatchObject({ enabled: false });
  });

  it('sends a header click as a server-side sort and returns to page one', async () => {
    const user = userEvent.setup();
    renderAutomations();

    await user.click(screen.getByRole('button', { name: /pages:automations.kindColumn/ }));

    expect(lastQueryArgs()).toMatchObject({ page: 1, orderBy: 'kind', orderDir: 'asc' });
  });

  it('offers the create affordance in the empty state when nothing is filtered out', () => {
    mockList([]);

    renderAutomations();

    expect(screen.getByText('pages:automations.noAutomationsConfigured')).toBeInTheDocument();
    expect(screen.getByText('pages:automations.createFirstAutomation')).toBeInTheDocument();
  });

  it('blames the filters for an empty page when some are set', () => {
    mockList([]);

    renderAutomations('/automations?kind=policy');

    expect(screen.getByText('pages:automations.noAutomationsFound')).toBeInTheDocument();
    expect(screen.getByText('pages:automations.tryAdjustingFilters')).toBeInTheDocument();
  });

  it('opens the automation when its row is clicked', async () => {
    const user = userEvent.setup();
    renderAutomations();

    await user.click(screen.getByText('Concurrent cap'));

    expect(openedDetail()).toBeInTheDocument();
  });

  it('toggles a row without navigating away from the list', async () => {
    const user = userEvent.setup();
    renderAutomations();

    await user.click(screen.getByRole('switch'));

    expect(toggleMutate).toHaveBeenCalledWith({ id: 'a-1', isActive: false });
    expect(openedDetail()).not.toBeInTheDocument();
  });

  it('toggles a row from the keyboard without navigating away from the list', async () => {
    const user = userEvent.setup();
    renderAutomations();

    screen.getByRole('switch').focus();
    await user.keyboard('{Enter}');

    expect(toggleMutate).toHaveBeenCalledWith({ id: 'a-1', isActive: false });
    expect(openedDetail()).not.toBeInTheDocument();
  });

  it('keeps the row actions from opening the automation', async () => {
    const user = userEvent.setup();
    renderAutomations();

    await user.click(screen.getByRole('button', { name: 'common:actions.edit' }));

    expect(openedDetail()).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('asks for confirmation before deleting a single automation', async () => {
    const user = userEvent.setup();
    renderAutomations();

    await user.click(screen.getByRole('button', { name: 'common:actions.delete' }));

    expect(screen.getByText('pages:automations.deleteAutomationConfirm')).toBeInTheDocument();
    expect(deleteMutate).not.toHaveBeenCalled();
    expect(openedDetail()).not.toBeInTheDocument();
  });
});
