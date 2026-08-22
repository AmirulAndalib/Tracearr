/** Real i18n: the tab counts and the outcome words are what these cases are about. */
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { initI18n } from '@tracearr/translations';
import type { AutomationRunSummary, RunCounts } from '@tracearr/shared';

const useAutomationRuns = vi.fn();
const useRunCounts = vi.fn();
vi.mock('@/hooks/queries/useRuns', () => ({
  useAutomationRuns: () => useAutomationRuns(),
  useRunCounts: () => useRunCounts(),
}));

import { ActivityList } from './ActivityList';

function run(overrides: Partial<AutomationRunSummary> = {}): AutomationRunSummary {
  return {
    id: 'run-1',
    automationId: 'a-1',
    automationName: 'Impossible travel',
    kind: 'policy',
    outcome: 'completed',
    humanSummary: null,
    severity: 'warning',
    serverUserId: 'su-1',
    sessionId: 'sess-1',
    serverId: 'srv-1',
    subjectKey: 'sess-1',
    subject: {
      kind: 'session',
      name: 'rebecc101',
      personName: 'Rebecca Lin',
      serverName: 'Basement',
      libraryName: null,
      mediaType: null,
    },
    startedAt: '2026-08-19T12:00:00.000Z',
    finishedAt: '2026-08-19T12:00:01.000Z',
    acknowledgedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

const counts = (overrides: Partial<RunCounts> = {}): RunCounts => ({
  completed: 12,
  stopped_by_condition: 340,
  error: 0,
  total: 352,
  lastRunAt: '2026-08-19T12:00:00.000Z',
  ...overrides,
});

beforeAll(async () => {
  await initI18n({ lng: 'en' });
});

beforeEach(() => {
  vi.clearAllMocks();
});

function renderList(rows: AutomationRunSummary[], tallies: RunCounts = counts()) {
  useAutomationRuns.mockReturnValue({
    data: { data: rows, meta: { page: 1, pageSize: 20, total: rows.length } },
    isLoading: false,
  });
  useRunCounts.mockReturnValue({ data: tallies });
  render(
    <MemoryRouter>
      <ActivityList automationId="a-1" kind="policy" onSelectRun={vi.fn()} />
    </MemoryRouter>
  );
}

const tab = (name: RegExp) => screen.getByRole('radio', { name });

describe('ActivityList', () => {
  it('says how many runs each tab holds', () => {
    renderList([run()]);

    expect(tab(/^Ran/)).toHaveTextContent('Ran12');
    expect(tab(/^No match/)).toHaveTextContent('No match340');
    expect(tab(/^Failed/)).toHaveTextContent('Failed0');
    expect(tab(/^All/)).toHaveTextContent('All352');
  });

  it('calls a run that matched nothing a non-match rather than a stop', () => {
    renderList([run({ outcome: 'stopped_by_condition' })]);

    expect(screen.getAllByText('No match')).toHaveLength(2);
  });

  it('says nothing has run when nothing has', () => {
    renderList([], counts({ completed: 0, stopped_by_condition: 0, total: 0, lastRunAt: null }));

    expect(screen.getByText('No runs yet')).toBeInTheDocument();
    expect(screen.getByText('Runs are listed here once a trigger matches.')).toBeInTheDocument();
  });

  it('counts the checks that ran when the Ran tab is the empty one', () => {
    renderList([], counts({ completed: 0, total: 340, lastRunAt: null }));

    expect(screen.getByText('Nothing has matched yet')).toBeInTheDocument();
    expect(screen.getByText('340 checks ran and did not match.')).toBeInTheDocument();
  });
});
