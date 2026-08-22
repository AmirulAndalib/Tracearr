import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '@tracearr/translations';
import type { Destination } from '@tracearr/shared';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { BLOCKED_COUNTRIES, CONCURRENT_STREAMS, STREAM_STARTED } from './fixtures';

vi.mock('@/hooks/queries/useSettings', () => ({
  useSettings: () => ({ data: { unitSystem: 'metric' } }),
}));
vi.mock('@/hooks/useServer', () => ({
  useServer: () => ({ servers: [{ id: 'server-1', name: 'Beehive' }] }),
}));
vi.mock('@/hooks/queries/useUsers', () => ({ useUsers: () => ({ data: undefined }) }));
vi.mock('@/hooks/queries/useHistory', () => ({
  useAutomationFilterOptions: () => ({ data: undefined }),
}));

const destination: Destination = {
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

vi.mock('@/hooks/queries/useDestinations', () => ({
  useDestinations: () => ({ data: [destination] }),
}));

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

const instantiate = vi.fn();

vi.mock('@/hooks/queries/useTemplates', () => ({
  useInstantiateTemplate: () => ({ mutate: instantiate, isPending: false }),
}));

import { TemplateBindingForm } from '../TemplateBindingForm';

beforeAll(async () => {
  await initI18n({ lng: 'en' });
});

beforeEach(() => {
  instantiate.mockReset();
});

function renderForm(template = STREAM_STARTED) {
  const onDone = vi.fn();
  render(<TemplateBindingForm template={template} onBack={vi.fn()} onDone={onDone} />);
  return { onDone, user: userEvent.setup() };
}

const sentence = () => screen.getByText('In plain words').parentElement?.textContent ?? '';

describe('TemplateBindingForm', () => {
  it('opens on Any server, with the template name and Active on', () => {
    renderForm();

    expect(screen.getByLabelText('Name')).toHaveValue('Stream started');
    expect(screen.getByRole('combobox', { name: /Which server/ })).toHaveTextContent('Any server');
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('names the destination in the sentence once one is picked', async () => {
    const { user } = renderForm();

    expect(sentence()).toContain('[Send to]');

    await user.click(screen.getByRole('button', { name: 'Team Discord' }));

    expect(sentence()).toContain('send to Team Discord');
  });

  it('lets the reader add a destination without leaving the form', async () => {
    const { user } = renderForm();

    await user.click(screen.getByRole('button', { name: 'Add destination' }));

    expect(await screen.findByText('New destination')).toBeInTheDocument();
  });

  it('follows the server into the name until the name is edited', async () => {
    const { user } = renderForm();

    await user.click(screen.getByRole('combobox', { name: /Which server/ }));
    await user.click(await screen.findByRole('option', { name: 'Beehive' }));

    expect(screen.getByLabelText('Name')).toHaveValue('Stream started — Beehive');
    expect(sentence()).toContain('Applies to Beehive.');

    await user.type(screen.getByLabelText('Name'), '!');
    await user.click(screen.getByRole('combobox', { name: /Which server/ }));
    await user.click(await screen.findByRole('option', { name: 'Any server' }));

    expect(screen.getByLabelText('Name')).toHaveValue('Stream started — Beehive!');
  });

  it('holds a missing destination back until the reader submits', async () => {
    const { user, onDone } = renderForm();

    expect(screen.queryByText('Pick at least one.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Use this' }));

    expect(screen.getByText('Pick at least one.')).toBeInTheDocument();
    expect(instantiate).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
  });

  it('sends the bound inputs and the name it shows', async () => {
    const { user } = renderForm();

    await user.click(screen.getByRole('button', { name: 'Team Discord' }));
    await user.click(screen.getByRole('button', { name: 'Use this' }));

    expect(instantiate).toHaveBeenCalledWith(
      {
        id: 'template-stream-started',
        inputs: { to: ['dest-discord'] },
        name: 'Stream started',
        isActive: true,
      },
      expect.anything()
    );
  });

  it('sends a policy template with its numbers already filled in', async () => {
    const { user } = renderForm(CONCURRENT_STREAMS);

    expect(sentence()).toContain('the stream count is above 3');

    await user.click(screen.getByRole('button', { name: 'Use this' }));

    expect(instantiate).toHaveBeenCalledWith(
      expect.objectContaining({ inputs: { max: 3 }, isActive: true }),
      expect.anything()
    );
  });

  it('drops a clause from the sentence when the switch that gates it goes off', async () => {
    const { user } = renderForm(BLOCKED_COUNTRIES);

    expect(sentence()).toContain('the user is not on the local network');

    await user.click(screen.getByRole('switch', { name: 'Ignore local network sessions' }));

    expect(sentence()).not.toContain('the user is not on the local network');
  });

  it('falls back to the template name when the name is emptied', async () => {
    const { user } = renderForm(CONCURRENT_STREAMS);

    await user.clear(screen.getByLabelText('Name'));
    await user.tab();

    expect(screen.getByLabelText('Name')).toHaveValue('Too many streams at once');

    await user.click(screen.getByRole('button', { name: 'Use this' }));

    expect(instantiate).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'Too many streams at once' }),
      expect.anything()
    );
  });

  it('lands the automation paused when Active is turned off', async () => {
    const { user } = renderForm(CONCURRENT_STREAMS);

    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: 'Use this' }));

    expect(instantiate).toHaveBeenCalledWith(
      expect.objectContaining({ isActive: false }),
      expect.anything()
    );
  });
});
