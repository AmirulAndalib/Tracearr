/** Real i18n: the update banner names a version number, which key-echoing hides. */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { initI18n } from '@tracearr/translations';
import type { Automation, AutomationTemplateRef } from '@tracearr/shared';
import { CONCURRENT_STREAMS } from '@/components/automations/gallery/__tests__/fixtures';

vi.mock('@/hooks/useServer', () => ({ useServer: () => ({ servers: [] }) }));
vi.mock('@/hooks/queries/useSettings', () => ({
  useSettings: () => ({ data: { unitSystem: 'metric' } }),
}));
vi.mock('@/hooks/queries/useDestinations', () => ({ useDestinations: () => ({ data: [] }) }));
vi.mock('@/hooks/queries/useHistory', () => ({
  useAutomationFilterOptions: () => ({ data: undefined }),
}));
vi.mock('@/hooks/queries/useUsers', () => ({ useUsers: () => ({ data: undefined }) }));

const useTemplate = vi.fn();
const useTemplateVersion = vi.fn();
const rebind = vi.fn();
const detach = vi.fn();

vi.mock('@/hooks/queries', () => ({
  useTemplate: () => useTemplate(),
  useTemplateVersion: () => useTemplateVersion(),
  useRebindAutomation: () => ({ mutate: rebind, isPending: false }),
  useUpgradeAutomation: () => ({ mutate: vi.fn(), isPending: false }),
  useDetachAutomation: () => ({ mutate: detach, isPending: false }),
}));

import { TemplateBinding } from './TemplateBinding';

function renderBinding(template: AutomationTemplateRef) {
  render(
    <MemoryRouter>
      <TemplateBinding automation={automation} template={template} />
    </MemoryRouter>
  );
  return userEvent.setup();
}

const template = (overrides: Partial<AutomationTemplateRef> = {}): AutomationTemplateRef => ({
  id: CONCURRENT_STREAMS.id,
  slug: CONCURRENT_STREAMS.slug,
  name: CONCURRENT_STREAMS.name,
  version: 1,
  currentVersion: 1,
  source: 'builtin',
  author: null,
  addedAt: '2026-08-01T12:00:00.000Z',
  ...overrides,
});

const automation: Automation = {
  id: 'a-1',
  name: 'Concurrent cap',
  description: null,
  kind: 'policy',
  severity: 'warning',
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
  templateInputs: { max: 4 },
  origin: null,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

beforeAll(async () => {
  await initI18n({ lng: 'en' });
});

beforeEach(() => {
  vi.clearAllMocks();
  useTemplate.mockReturnValue({ data: CONCURRENT_STREAMS, isLoading: false });
  useTemplateVersion.mockReturnValue({ data: undefined });
});

describe('TemplateBinding', () => {
  it('names the version the template has moved on to', () => {
    renderBinding(template({ currentVersion: 4 }));

    expect(screen.getByText('The ready-made automation has moved on to v4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review and update' })).toBeInTheDocument();
  });

  it('puts what it says now beside what it would say after', () => {
    useTemplateVersion.mockReturnValue({ data: CONCURRENT_STREAMS.version });

    renderBinding(template({ currentVersion: 2 }));

    expect(screen.getByText('Now')).toBeInTheDocument();
    expect(screen.getByText('After the update')).toBeInTheDocument();
  });

  it('just saves when the row is already current', () => {
    renderBinding(template());

    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument();
    expect(screen.queryByText('Now')).not.toBeInTheDocument();
  });

  it('offers the builder beside the save, and leaves the name to the page header', () => {
    renderBinding(template());

    expect(screen.getByRole('button', { name: 'Open in the builder' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument();
  });

  it('asks before the second door detaches the row', async () => {
    const user = renderBinding(template());

    await user.click(screen.getByRole('button', { name: 'Open in the builder' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText('Make it yours?')).toBeInTheDocument();
    expect(detach).not.toHaveBeenCalled();

    await user.click(within(confirm).getByRole('button', { name: 'Open in the builder' }));

    expect(detach).toHaveBeenCalledWith('a-1', expect.anything());
  });

  it('says so when the template it followed is gone', () => {
    useTemplate.mockReturnValue({ data: undefined, isLoading: false });

    renderBinding(template());

    expect(
      screen.getByText('The ready-made automation this was built from is no longer on this server.')
    ).toBeInTheDocument();
  });
});
