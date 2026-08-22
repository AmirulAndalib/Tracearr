import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { i18n, initI18n } from '@tracearr/translations';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { describeTemplate, describeText, type Translate } from '@/lib/automations';
import { BLOCKED_COUNTRIES, TEMPLATES } from './fixtures';

vi.mock('@/hooks/queries/useSettings', () => ({
  useSettings: () => ({ data: { unitSystem: 'metric' } }),
}));
vi.mock('@/hooks/useServer', () => ({ useServer: () => ({ servers: [] }) }));
vi.mock('@/hooks/queries/useUsers', () => ({ useUsers: () => ({ data: undefined }) }));
vi.mock('@/hooks/queries/useHistory', () => ({
  useAutomationFilterOptions: () => ({ data: undefined }),
}));
vi.mock('@/hooks/queries/useDestinations', () => ({ useDestinations: () => ({ data: [] }) }));

vi.mock('@/components/settings/destinations/DestinationDialog', () => ({
  DestinationDialog: ({
    open,
    onOpenChange,
  }: {
    open: boolean;
    onOpenChange: (open: boolean) => void;
  }) => (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>New destination</DialogTitle>
      </DialogContent>
    </Dialog>
  ),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const instantiate = vi.fn();

vi.mock('@/hooks/queries/useTemplates', () => ({
  useTemplates: () => ({ data: TEMPLATES, isLoading: false, isError: false, refetch: vi.fn() }),
  useInstantiateTemplate: () => ({ mutate: instantiate, isPending: false }),
}));

import { toast } from 'sonner';
import { NewAutomationDialog } from '../NewAutomationDialog';

let t: Translate;

beforeAll(async () => {
  await initI18n({ lng: 'en' });
  t = i18n.getFixedT(null, 'pages');
});

beforeEach(() => {
  instantiate.mockReset();
});

function renderDialog(props: { templateId?: string } = {}) {
  const onOpenChange = vi.fn();
  render(
    <MemoryRouter initialEntries={['/automations']}>
      <Routes>
        <Route
          path="/automations"
          element={<NewAutomationDialog open onOpenChange={onOpenChange} {...props} />}
        />
        <Route path="/automations/new" element={<p>the builder page</p>} />
      </Routes>
    </MemoryRouter>
  );
  return { onOpenChange, user: userEvent.setup() };
}

const gallery = () => screen.getByRole('dialog');

describe('NewAutomationDialog', () => {
  it('lists the groups in ascending consequence, with the other ways in last', () => {
    renderDialog();

    const headings = [...gallery().querySelectorAll('[cmdk-group-heading]')].map(
      (node) => node.textContent
    );

    expect(headings).toEqual([
      'Notifications',
      'Server health',
      'Limits and rules',
      'Housekeeping',
      'Other ways to start',
    ]);
  });

  it('finds a template by a word only its synonyms carry', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByRole('combobox'), 'reclaim');

    expect(screen.getByText('Stop paused streams')).toBeInTheDocument();
    expect(screen.queryByText('Server down')).not.toBeInTheDocument();
  });

  it('finds a template by a word only the tail of its long sentence carries', async () => {
    const { user } = renderDialog();
    // The capped sentence stops before the last clause; the search index must not.
    const capped = describeText(
      describeTemplate(BLOCKED_COUNTRIES.version, {}, {}, t, 'metric'),
      t
    );
    expect(capped).not.toContain('message the player');

    await user.type(screen.getByRole('combobox'), 'message the player');

    expect(screen.getByText('Blocked countries')).toBeInTheDocument();
  });

  it('puts the cursor back in the search box when / is pressed', async () => {
    const { user } = renderDialog();
    const search = screen.getByRole('combobox');

    screen.getByRole('button', { name: 'Close' }).focus();
    expect(search).not.toHaveFocus();

    await user.keyboard('/');

    expect(search).toHaveFocus();
  });

  it('keeps the two other ways in when nothing matches', async () => {
    const { user } = renderDialog();

    await user.type(screen.getByRole('combobox'), 'zzzzz');

    expect(screen.getByText(/Nothing matches/)).toBeInTheDocument();
    expect(screen.getByText('Paste a share code')).toBeInTheDocument();
    expect(screen.getByText('Start from scratch')).toBeInTheDocument();
  });

  it('swaps to the binding form when a card is picked', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByText('Stream started'));

    expect(await screen.findByRole('heading', { name: 'Stream started' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use this' })).toBeInTheDocument();
  });

  it('opens straight into the binding form for a deep link', () => {
    renderDialog({ templateId: 'template-concurrent-streams' });

    expect(screen.getByRole('heading', { name: 'Too many streams at once' })).toBeInTheDocument();
  });

  it('falls back to the gallery when the deep link names nothing this server has', async () => {
    renderDialog({ templateId: 'template-nothing-here' });

    expect(await screen.findByText('Stream started')).toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith("That ready-made automation is not on this server.");
  });

  it('sends Esc back to the gallery before it closes anything', async () => {
    const { onOpenChange, user } = renderDialog({ templateId: 'template-stream-started' });

    await user.keyboard('{Escape}');

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByText('Server down')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('leaves the outer dialog alone when Esc closes the destination dialog on top', async () => {
    const { onOpenChange, user } = renderDialog({ templateId: 'template-stream-started' });

    await user.click(screen.getByRole('button', { name: 'Add destination' }));
    expect(await screen.findByText('New destination')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'Stream started' })).toBeInTheDocument();
  });

  it('takes the scratch row to the builder page', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByText('Start from scratch'));

    expect(await screen.findByText('the builder page')).toBeInTheDocument();
  });

  it('parks the paste row on a view of its own until import lands', async () => {
    const { user } = renderDialog();

    await user.click(screen.getByText('Paste a share code'));

    expect(await screen.findByText(/arrives with import/)).toBeInTheDocument();
  });
});
