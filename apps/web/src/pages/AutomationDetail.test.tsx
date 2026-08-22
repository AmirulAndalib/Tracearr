import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';
import type * as ReactRouter from 'react-router';
import type {
  Automation,
  AutomationRun,
  AutomationRunSummary,
  AutomationTemplateRef,
} from '@tracearr/shared';
import { CONCURRENT_STREAMS } from '@/components/automations/gallery/__tests__/fixtures';
import { AutomationDetail } from './AutomationDetail';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof ReactRouter>('react-router');
  return { ...actual, useParams: () => ({ id: 'a-1' }) };
});

const updateMutate = vi.fn();
const detachMutate = vi.fn();
const rebindMutate = vi.fn();
const upgradeMutate = vi.fn();

vi.mock('@/hooks/queries', () => ({
  useAutomation: vi.fn(),
  useToggleAutomation: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateAutomation: () => ({ mutate: updateMutate, mutateAsync: vi.fn(), isPending: false }),
  useDetachAutomation: () => ({ mutate: detachMutate, isPending: false }),
  useRebindAutomation: () => ({ mutate: rebindMutate, isPending: false }),
  useUpgradeAutomation: () => ({ mutate: upgradeMutate, isPending: false }),
  useTemplate: vi.fn(),
  useSettings: () => ({ data: undefined }),
}));

vi.mock('@/hooks/queries/useDestinations', () => ({ useDestinations: () => ({ data: [] }) }));
vi.mock('@/hooks/queries/useSettings', () => ({
  useSettings: () => ({ data: { unitSystem: 'metric' } }),
}));
vi.mock('@/hooks/queries/useUsers', () => ({ useUsers: () => ({ data: undefined }) }));

vi.mock('@/hooks/queries/useRuns', () => ({
  useAutomationRuns: vi.fn(),
  useAutomationEvaluations: vi.fn(),
  useRun: vi.fn(),
}));

vi.mock('@/hooks/queries/useHistory', () => ({
  useAutomationFilterOptions: () => ({ data: undefined }),
}));

vi.mock('@/hooks/useServer', () => ({
  useServer: () => ({ servers: [] }),
}));

import { useAutomation, useTemplate } from '@/hooks/queries';
import { useAutomationEvaluations, useAutomationRuns, useRun } from '@/hooks/queries/useRuns';

const mockUseAutomation = vi.mocked(useAutomation);
const mockUseTemplate = vi.mocked(useTemplate);
const mockUseAutomationRuns = vi.mocked(useAutomationRuns);
const mockUseAutomationEvaluations = vi.mocked(useAutomationEvaluations);
const mockUseRun = vi.mocked(useRun);

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
    templateInputs: null,
    origin: null,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function run(overrides: Partial<AutomationRunSummary> = {}): AutomationRunSummary {
  return {
    id: 'run-1',
    automationId: 'a-1',
    automationName: 'Concurrent cap',
    kind: 'policy',
    outcome: 'completed',
    humanSummary: null,
    severity: 'warning',
    serverUserId: null,
    sessionId: null,
    serverId: null,
    subjectKey: 'sess-1',
    subject: {
      kind: 'session',
      name: 'ada@plex',
      personName: 'Ada',
      serverName: 'Basement',
      libraryName: null,
      mediaType: null,
    },
    startedAt: '2026-08-19T00:00:00.000Z',
    finishedAt: '2026-08-19T00:00:01.000Z',
    acknowledgedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

const templateRef = (overrides: Partial<AutomationTemplateRef> = {}): AutomationTemplateRef => ({
  id: CONCURRENT_STREAMS.id,
  slug: CONCURRENT_STREAMS.slug,
  name: CONCURRENT_STREAMS.name,
  version: 1,
  currentVersion: 1,
  source: 'builtin',
  author: null,
  addedAt: '2026-08-01T00:00:00.000Z',
  ...overrides,
});

/** Two cards on the page carry a Save; this one is the template's. */
function templateCard() {
  const card = screen.getByText('pages:automations.template.title').closest('[data-slot="card"]');
  if (!(card instanceof HTMLElement)) throw new Error('the template card is not on the page');
  return within(card);
}

/** A bound row, with the catalog answering for the template it names. */
function setBound(template: AutomationTemplateRef, inputs: Record<string, unknown> = { max: 4 }) {
  mockUseAutomation.mockReturnValue({
    data: automation({ template, templateInputs: inputs }),
    isLoading: false,
  } as unknown as ReturnType<typeof useAutomation>);
  mockUseTemplate.mockReturnValue({
    data: CONCURRENT_STREAMS,
    isLoading: false,
  } as unknown as ReturnType<typeof useTemplate>);
}

function renderDetail() {
  return render(
    <MemoryRouter initialEntries={['/automations/a-1']}>
      <Routes>
        <Route path="/automations/:id" element={<AutomationDetail />} />
        <Route path="/automations/:id/edit" element={<p>the builder page</p>} />
      </Routes>
    </MemoryRouter>
  );
}

function setRuns(rows: AutomationRunSummary[]) {
  mockUseAutomationRuns.mockReturnValue({
    data: { data: rows, meta: { page: 1, pageSize: 20, total: rows.length } },
    isLoading: false,
  } as unknown as ReturnType<typeof useAutomationRuns>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseAutomation.mockReturnValue({
    data: automation(),
    isLoading: false,
  } as unknown as ReturnType<typeof useAutomation>);
  setRuns([run()]);
  mockUseAutomationEvaluations.mockReturnValue({
    data: { data: [] },
    isLoading: false,
  } as unknown as ReturnType<typeof useAutomationEvaluations>);
  mockUseRun.mockReturnValue({ data: undefined, isLoading: false } as unknown as ReturnType<
    typeof useRun
  >);
  mockUseTemplate.mockReturnValue({ data: undefined, isLoading: false } as unknown as ReturnType<
    typeof useTemplate
  >);
});

describe('AutomationDetail', () => {
  it('renders the header, activity, evaluations and settings sections', () => {
    renderDetail();

    expect(screen.getByRole('heading', { name: 'Concurrent cap' })).toBeInTheDocument();
    expect(screen.getByText('pages:automations.kind.policy')).toBeInTheDocument();
    expect(screen.getByText('pages:automations.activity.title')).toBeInTheDocument();
    expect(screen.getByText('pages:automations.evaluations.title')).toBeInTheDocument();
    expect(screen.getByText('pages:automations.settings.title')).toBeInTheDocument();
  });

  it('shows a skeleton while the automation loads', () => {
    mockUseAutomation.mockReturnValue({
      data: undefined,
      isLoading: true,
    } as unknown as ReturnType<typeof useAutomation>);

    const { container } = renderDetail();

    expect(container.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
  });

  it('reports a missing automation', () => {
    mockUseAutomation.mockReturnValue({
      data: undefined,
      isLoading: false,
    } as unknown as ReturnType<typeof useAutomation>);

    renderDetail();

    expect(screen.getByText('pages:automations.detail.notFound')).toBeInTheDocument();
  });

  it('sends the edit action to the builder page', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'common:actions.edit' }));

    expect(screen.getByText('the builder page')).toBeInTheDocument();
  });

  it('names the person a person-scoped automation targets', () => {
    mockUseAutomation.mockReturnValue({
      data: automation({
        userId: 'usr-1',
        scopeRef: { kind: 'person', id: 'usr-1', name: 'Ada' },
      }),
      isLoading: false,
    } as unknown as ReturnType<typeof useAutomation>);

    renderDetail();

    expect(screen.getByText('Ada')).toBeInTheDocument();
  });
});

describe('AutomationDetail template binding', () => {
  it('offers the template inputs instead of the builder', () => {
    setBound(templateRef());

    renderDetail();

    expect(screen.getByText('pages:automations.template.title')).toBeInTheDocument();
    expect(screen.getByLabelText('Streams allowed')).toHaveValue('4');
    expect(screen.queryByRole('button', { name: 'common:actions.edit' })).not.toBeInTheDocument();
  });

  it('saves new answers against the row rather than opening the builder', async () => {
    const user = userEvent.setup();
    setBound(templateRef());

    renderDetail();
    await user.clear(screen.getByLabelText('Streams allowed'));
    await user.type(screen.getByLabelText('Streams allowed'), '6');
    await user.click(templateCard().getByRole('button', { name: 'common:actions.save' }));

    expect(rebindMutate).toHaveBeenCalledWith({ id: 'a-1', inputs: { max: 6 } });
    expect(upgradeMutate).not.toHaveBeenCalled();
  });

  it('reviews the new version rather than saving when the template has moved on', async () => {
    const user = userEvent.setup();
    setBound(templateRef({ version: 1, currentVersion: 2 }));

    renderDetail();

    expect(screen.getByText('pages:automations.template.updatedTitle')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'pages:automations.template.review' }));

    expect(upgradeMutate).toHaveBeenCalledWith({ id: 'a-1', inputs: { max: 4 } });
    expect(rebindMutate).not.toHaveBeenCalled();
  });

  it('detaches on a confirmed customize and opens the builder', async () => {
    const user = userEvent.setup();
    setBound(templateRef());

    renderDetail();
    await user.click(screen.getByRole('button', { name: 'pages:automations.template.customize' }));
    await user.click(
      screen.getByRole('button', { name: 'pages:automations.template.customizeConfirmAction' })
    );

    expect(detachMutate).toHaveBeenCalledWith('a-1', expect.anything());
  });

  it('names where a detached row came from', () => {
    mockUseAutomation.mockReturnValue({
      data: automation({ origin: { templateId: 't-1', version: 2, name: 'Too many streams' } }),
      isLoading: false,
    } as unknown as ReturnType<typeof useAutomation>);

    renderDetail();

    expect(screen.getByText('automations.provenance.customized')).toBeInTheDocument();
  });
});

describe('AutomationDetail activity', () => {
  it('translates each run outcome', () => {
    setRuns([
      run({ id: 'run-1', outcome: 'completed' }),
      run({ id: 'run-2', outcome: 'stopped_by_condition', humanSummary: 'No condition matched' }),
      run({ id: 'run-3', outcome: 'error' }),
    ]);

    renderDetail();

    expect(screen.getByText('pages:automations.activity.outcomes.completed')).toBeInTheDocument();
    expect(
      screen.getByText('pages:automations.activity.outcomes.stopped_by_condition')
    ).toBeInTheDocument();
    expect(screen.getByText('pages:automations.activity.outcomes.error')).toBeInTheDocument();
    expect(screen.getByText('No condition matched')).toBeInTheDocument();
  });

  it('drops the severity column for a notification automation', () => {
    mockUseAutomation.mockReturnValue({
      data: automation({ kind: 'notification', severity: null }),
      isLoading: false,
    } as unknown as ReturnType<typeof useAutomation>);

    renderDetail();

    expect(screen.queryByText('common:labels.severity')).not.toBeInTheDocument();
  });

  it('says so when the automation has never run', () => {
    setRuns([]);

    renderDetail();

    expect(screen.getByText('pages:automations.activity.empty')).toBeInTheDocument();
  });

  it('opens the run sheet with its steps in order', async () => {
    const user = userEvent.setup();
    const detail: AutomationRun = {
      ...run(),
      definitionVersionId: 'ver-1',
      session: null,
      evidence: [],
      steps: [
        { trigger: { id: 'n1', type: 'session.started', edgeKey: 'edge-7' } },
        { action: 'kill_stream', success: true },
        { action: 'send', success: false, message: 'webhook refused' },
      ],
    };
    mockUseRun.mockReturnValue({ data: detail, isLoading: false } as unknown as ReturnType<
      typeof useRun
    >);

    renderDetail();
    await user.click(screen.getByText('pages:automations.activity.outcomes.completed'));

    const steps = screen.getAllByRole('listitem');
    expect(steps).toHaveLength(3);
    expect(steps[0]).toHaveTextContent('automations.activity.triggeredBy');
    expect(steps[0]).toHaveTextContent('edge-7');
    expect(steps[1]).toHaveTextContent('automations.actions.kill_stream.label');
    expect(steps[2]).toHaveTextContent('webhook refused');
  });
});

describe('AutomationDetail evaluations', () => {
  it('lists each near miss with its translated reason', () => {
    mockUseAutomationEvaluations.mockReturnValue({
      data: {
        data: [
          {
            reason: 'cooldown_active',
            at: '2026-08-19T00:00:00.000Z',
            subjectKey: 'sess-1',
            trigger: 'session.paused',
          },
        ],
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useAutomationEvaluations>);

    renderDetail();

    expect(screen.getByText('automations.evaluations.reasons.cooldown_active')).toBeInTheDocument();
    expect(screen.getByText('session.paused')).toBeInTheDocument();
  });

  it('shows the shared empty state when the ring is empty', () => {
    renderDetail();

    expect(screen.getByText('automations.evaluations.empty')).toBeInTheDocument();
  });
});

describe('AutomationDetail settings', () => {
  it('saves retention and cooldown as nulls when both boxes are empty', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.click(screen.getByRole('button', { name: 'common:actions.save' }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'a-1',
      data: { retentionDays: null, cooldownMinutes: null },
    });
  });

  it('saves the retention override that was typed in', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.type(screen.getByLabelText('pages:automations.settings.retentionLabel'), '90');
    await user.click(screen.getByRole('button', { name: 'common:actions.save' }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'a-1',
      data: { retentionDays: 90, cooldownMinutes: null },
    });
  });

  it('refuses a retention of zero instead of letting the API reject it', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.type(screen.getByLabelText('pages:automations.settings.retentionLabel'), '0');

    expect(screen.getByText('pages:automations.settings.retentionInvalid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common:actions.save' })).toBeDisabled();
    expect(updateMutate).not.toHaveBeenCalled();
  });

  it('refuses input that is not a whole number rather than clearing the override', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.type(screen.getByLabelText('pages:automations.settings.cooldownLabel'), '10m');

    expect(screen.getByText('pages:automations.settings.cooldownInvalid')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common:actions.save' })).toBeDisabled();
  });

  it('takes a cooldown of zero, which its schema allows', async () => {
    const user = userEvent.setup();
    renderDetail();

    await user.type(screen.getByLabelText('pages:automations.settings.cooldownLabel'), '0');
    await user.click(screen.getByRole('button', { name: 'common:actions.save' }));

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'a-1',
      data: { retentionDays: null, cooldownMinutes: 0 },
    });
  });
});
