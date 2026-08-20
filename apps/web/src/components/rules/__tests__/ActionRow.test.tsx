import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Action, AutomationKind } from '@tracearr/shared';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ActionRow } from '../ActionRow';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/hooks/queries/useDestinations', () => ({
  useDestinations: () => ({ data: [], isLoading: false }),
  useCreateDestination: vi.fn(),
  useUpdateDestination: vi.fn(),
  useTestDestination: vi.fn(),
  useTestUnsavedDestination: vi.fn(),
}));

function renderRow(action: Action, kind: AutomationKind = 'policy') {
  const onChange = vi.fn();
  render(
    <TooltipProvider>
      <ActionRow action={action} kind={kind} onChange={onChange} onRemove={vi.fn()} />
    </TooltipProvider>
  );
  return onChange;
}

describe('ActionRow trust fields', () => {
  it('shows the amount field in adjust mode only', () => {
    renderRow({ type: 'trust', mode: 'adjust', amount: -10 });

    expect(screen.getByText('Amount')).toBeInTheDocument();
    expect(screen.queryByText('Value')).not.toBeInTheDocument();
  });

  it('shows the slider in set mode only', () => {
    renderRow({ type: 'trust', mode: 'set', value: 50 });

    expect(screen.getByText('Value')).toBeInTheDocument();
    expect(screen.queryByText('Amount')).not.toBeInTheDocument();
  });

  it('shows neither parameter in reset mode', () => {
    renderRow({ type: 'trust', mode: 'reset' });

    expect(screen.getByText('Mode')).toBeInTheDocument();
    expect(screen.queryByText('Amount')).not.toBeInTheDocument();
    expect(screen.queryByText('Value')).not.toBeInTheDocument();
  });
});

describe('ActionRow type picker', () => {
  it('leaves the legacy trust spellings out of the options', async () => {
    const user = userEvent.setup();
    renderRow({ type: 'send', to: [] });

    await user.click(screen.getByRole('combobox', { name: /typeLabel/ }));

    expect(screen.getByRole('option', { name: /Trust Score/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Adjust Trust Score/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Set Trust Score/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /Reset Trust Score/ })).not.toBeInTheDocument();
  });

  it('leads with send for a notification automation', async () => {
    const user = userEvent.setup();
    renderRow({ type: 'kill_stream' }, 'notification');

    await user.click(screen.getByRole('combobox', { name: /typeLabel/ }));

    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options[0]).toBe('Send Notification');
    expect(options).toContain('Kill Stream');
  });

  it('keeps a stored legacy spelling selectable as the current value', async () => {
    const user = userEvent.setup();
    renderRow({ type: 'adjust_trust', amount: -5 });

    await user.click(screen.getByRole('combobox', { name: /typeLabel/ }));

    expect(screen.getByRole('option', { name: /Adjust Trust Score/ })).toBeInTheDocument();
  });
});
