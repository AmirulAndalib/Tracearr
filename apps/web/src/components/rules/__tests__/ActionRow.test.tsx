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
  it('offers one trust action', async () => {
    const user = userEvent.setup();
    renderRow({ type: 'send', to: [] });

    await user.click(screen.getByRole('combobox', { name: /typeLabel/ }));

    const trustOptions = screen
      .getAllByRole('option')
      .filter((option) => option.textContent?.includes('Trust'));
    expect(trustOptions.map((option) => option.textContent)).toEqual(['Trust Score']);
  });

  it('leads with send for a notification automation', async () => {
    const user = userEvent.setup();
    renderRow({ type: 'kill_stream' }, 'notification');

    await user.click(screen.getByRole('combobox', { name: /typeLabel/ }));

    const options = screen.getAllByRole('option').map((option) => option.textContent);
    expect(options[0]).toBe('Send Notification');
    expect(options).toContain('Kill Stream');
  });
});
