import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RuleBuilderDialog } from '../RuleBuilderDialog';

vi.mock('../RuleBuilder', () => ({
  RuleBuilder: () => <div />,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => TITLES[key] ?? key }),
}));

/** The dialog's own copy, as `pages.json` has it after the automations rename. */
const TITLES: Record<string, string> = {
  'rules.createRule': 'Create Automation',
  'rules.editRule': 'Edit Automation',
  'rules.createDescription': 'Set up a new automation for your media servers.',
  'rules.updateDescription': 'Update this automation below.',
};

const props = { open: true, onOpenChange: vi.fn(), onSave: vi.fn() };

describe('RuleBuilderDialog', () => {
  it('titles a fresh dialog as a new automation', () => {
    render(<RuleBuilderDialog {...props} />);

    expect(screen.getByRole('heading', { name: 'Create Automation' })).toBeInTheDocument();
    expect(screen.getByText(/new automation/i)).toBeInTheDocument();
  });

  it('titles an edit dialog as an automation too', () => {
    render(
      <RuleBuilderDialog {...props} rule={{ id: 'a-1', name: 'Concurrent cap', isActive: true }} />
    );

    expect(screen.getByRole('heading', { name: 'Edit Automation' })).toBeInTheDocument();
  });
});
