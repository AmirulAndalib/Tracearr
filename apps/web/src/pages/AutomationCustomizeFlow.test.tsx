/**
 * The customize hand-off, with the real query hooks: detaching seeds the row the
 * builder page reads on the next tick, so it must not bounce back to the detail page.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { initI18n } from '@tracearr/translations';
import type { Automation, AutomationTemplateRef } from '@tracearr/shared';

vi.mock('sonner', () => ({ toast: { info: vi.fn(), success: vi.fn(), error: vi.fn() } }));

vi.mock('@/lib/api', () => ({
  api: {
    automations: { get: vi.fn(), detach: vi.fn(), update: vi.fn() },
    templates: { get: vi.fn(), getVersion: vi.fn() },
  },
}));

vi.mock('@/hooks/useServer', () => ({ useServer: () => ({ servers: [] }) }));
vi.mock('@/hooks/useDocumentTitle', () => ({ usePageTitle: () => undefined }));
vi.mock('@/components/automations/ActivityList', () => ({ ActivityList: () => null }));
vi.mock('@/components/automations/EvaluationsList', () => ({ EvaluationsList: () => null }));
vi.mock('@/components/automations/RunDetail', () => ({ RunDetail: () => null }));
vi.mock('@/components/automations/TemplateBinding', () => ({
  TemplateBinding: () => <p>the binding form</p>,
}));
vi.mock('@/components/automations/builder', () => ({
  AutomationBuilder: () => <p>the builder</p>,
}));

import { toast } from 'sonner';
import { api } from '@/lib/api';
import { AutomationDetail } from './AutomationDetail';
import { AutomationBuilderPage } from './AutomationBuilderPage';

const template: AutomationTemplateRef = {
  id: 't-1',
  slug: 'concurrent-streams',
  name: 'Too many streams at once',
  version: 1,
  currentVersion: 1,
  source: 'builtin',
  author: null,
  addedAt: '2026-08-01T00:00:00.000Z',
};

function automation(overrides: Partial<Automation> = {}): Automation {
  return {
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
    templateInputs: null,
    origin: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

const bound = automation({ template, templateInputs: { max: 4 } });
const detached = automation({ origin: { templateId: 't-1', version: 1, name: template.name } });

beforeEach(async () => {
  await initI18n({ lng: 'en' });
  vi.clearAllMocks();
});

function renderFlow() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/automations/a-1']}>
        <Routes>
          <Route path="/automations/:id" element={<AutomationDetail />} />
          <Route path="/automations/:id/edit" element={<AutomationBuilderPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
  return client;
}

describe('customizing a template-bound automation', () => {
  it('lands in the builder instead of bouncing back to the detail page', async () => {
    const user = userEvent.setup();
    // The route answers with whatever the row is now, so the refetch the invalidation
    // starts cannot put the template back.
    let current = bound;
    vi.mocked(api.automations.get).mockImplementation(() => Promise.resolve(current));
    vi.mocked(api.automations.detach).mockImplementation(() => {
      current = detached;
      return Promise.resolve(detached);
    });

    const client = renderFlow();
    await screen.findByText('the binding form');

    await user.click(screen.getByRole('button', { name: 'Open in the builder' }));
    await user.click(
      screen.getAllByRole('button', { name: 'Open in the builder' }).slice(-1)[0] as HTMLElement
    );
    await waitFor(() => expect(api.automations.detach).toHaveBeenCalledWith('a-1'));

    await screen.findByText('the builder');
    // The row the builder read was the detached one, so nothing sent it back.
    expect(client.getQueryData(['automations', 'detail', 'a-1'])).toEqual(detached);
    expect(toast.info).not.toHaveBeenCalled();
    expect(screen.queryByText('the binding form')).not.toBeInTheDocument();
  });

  it('still turns a bound row away from the builder', async () => {
    vi.mocked(api.automations.get).mockResolvedValue(bound);

    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter initialEntries={['/automations/a-1/edit']}>
          <Routes>
            <Route path="/automations/:id" element={<p>the detail page</p>} />
            <Route path="/automations/:id/edit" element={<AutomationBuilderPage />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    );

    await screen.findByText('the detail page');
    await waitFor(() =>
      expect(toast.info).toHaveBeenCalledWith(
        'This one still follows a ready-made automation. Make it yours first.'
      )
    );
  });
});
