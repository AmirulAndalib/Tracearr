import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import { initI18n } from '@tracearr/translations';
import { RuleBuilderDialog } from '../RuleBuilderDialog';

// The real bundle, so the copy asserted here is the copy pages.json ships.
beforeAll(async () => {
  await initI18n({ lng: 'en' });
});

vi.mock('../RuleBuilder', () => ({
  RuleBuilder: () => <div />,
}));

const props = { open: true, onOpenChange: vi.fn(), onSave: vi.fn() };

describe('RuleBuilderDialog', () => {
  it('titles a fresh dialog as a new automation', () => {
    render(<RuleBuilderDialog {...props} />);

    expect(screen.getByRole('heading', { name: 'Create Automation' })).toBeInTheDocument();
    expect(screen.getByText('Set up a new automation for your media servers.')).toBeInTheDocument();
  });

  it('titles an edit dialog as an automation too', () => {
    render(
      <RuleBuilderDialog {...props} rule={{ id: 'a-1', name: 'Concurrent cap', isActive: true }} />
    );

    expect(screen.getByRole('heading', { name: 'Edit Automation' })).toBeInTheDocument();
    expect(screen.getByText('Update this automation below.')).toBeInTheDocument();
  });
});
