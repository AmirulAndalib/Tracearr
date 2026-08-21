import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { initI18n } from '@tracearr/translations';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { AutomationConditions, Condition, TriggerNode } from '@tracearr/shared';
import { ConditionsSection } from '../ConditionsSection';
import type { BuilderRefs } from '../builderRefs';
import type { NodeIssues } from '../validation';

beforeAll(async () => {
  await initI18n({ lng: 'en' });
});

const started: TriggerNode = {
  id: '11111111-1111-4111-8111-111111111111',
  type: 'session.started',
  enabled: true,
};
const down: TriggerNode = {
  id: '22222222-2222-4222-8222-222222222222',
  type: 'server.down',
  enabled: true,
};
const held: TriggerNode = {
  id: '33333333-3333-4333-8333-333333333333',
  type: 'session.held_for',
  enabled: true,
  params: { minutes: 30, measure: 'current' },
};

function condition(overrides: Partial<Condition> & { id: string }): Condition {
  return { enabled: true, field: 'concurrent_streams', operator: 'gte', value: 3, ...overrides };
}

function group(conditions: Condition[], match: 'all' | 'any' = 'all'): AutomationConditions {
  return { groups: [{ id: 'group-1', enabled: true, match, conditions }] };
}

function renderSection(
  conditions: AutomationConditions,
  triggers: TriggerNode[] = [started],
  issues: NodeIssues = new Map()
) {
  const dispatch = vi.fn();
  const refs: BuilderRefs = {
    triggers,
    kind: 'policy',
    conditions,
    filterOptions: undefined,
    describe: {},
    unitSystem: 'metric',
  };
  render(
    <TooltipProvider>
      <ConditionsSection
        conditions={conditions}
        refs={refs}
        issues={issues}
        pulseId={null}
        dispatch={dispatch}
      />
    </TooltipProvider>
  );
  return { dispatch };
}

describe('ConditionsSection', () => {
  it('stays behind one affordance until the first group is asked for', async () => {
    const user = userEvent.setup();
    const { dispatch } = renderSection({ groups: [] });

    expect(screen.queryByText('Where')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Only when/ }));

    expect(dispatch).toHaveBeenCalledWith({ type: 'addConditionGroup' });
  });

  it('leads the first row with Where and the second with the logic toggle', async () => {
    const user = userEvent.setup();
    const { dispatch } = renderSection(
      group([
        condition({ id: 'c-1' }),
        condition({ id: 'c-2', field: 'is_local_network', operator: 'eq', value: true }),
      ])
    );

    expect(screen.getByText('Where')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'all of these' })).toHaveAttribute('data-state', 'on');

    await user.click(screen.getByRole('radio', { name: 'any of these' }));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'setConditionMatch',
      groupId: 'group-1',
      match: 'any',
    });
  });

  it('offers only the comparisons the picked field has', async () => {
    const user = userEvent.setup();
    renderSection(
      group([condition({ id: 'c-1', field: 'is_local_network', operator: 'eq', value: true })])
    );

    await user.click(screen.getByRole('combobox', { name: 'Comparison' }));

    expect(screen.getAllByRole('option')).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'equals' })).toBeInTheDocument();
  });

  it('leaves one value behind when a list field moves from is one of to equals', async () => {
    const user = userEvent.setup();
    const { dispatch } = renderSection(
      group([condition({ id: 'c-1', field: 'country', operator: 'in', value: ['US', 'CA'] })])
    );

    await user.click(screen.getByRole('combobox', { name: 'Is it' }));
    await user.click(await screen.findByRole('option', { name: 'equals' }));

    expect(dispatch).toHaveBeenCalledWith({
      type: 'setCondition',
      id: 'c-1',
      condition: { id: 'c-1', enabled: true, field: 'country', operator: 'eq', value: 'US' },
    });
  });

  it('turns a row amber and names the trigger that cannot supply it', () => {
    renderSection(
      group([condition({ id: 'c-1', field: 'trust_score', operator: 'lt', value: 50 })]),
      [down],
      new Map([
        [
          'c-1',
          [
            {
              nodeId: 'c-1',
              message: 'Not available for: A server goes down',
              tone: 'warning' as const,
            },
          ],
        ],
      ])
    );

    expect(screen.getByText('Not available for: A server goes down')).toHaveClass('text-warning');
  });

  it('says so when a threshold sits past the trigger that would fire it', () => {
    renderSection(
      group([condition({ id: 'c-1', field: 'current_pause_minutes', operator: 'gte', value: 60 })]),
      [held]
    );

    expect(screen.getByText('Can never pass: the trigger fires at 30 minutes')).toBeInTheDocument();
  });

  it('toggles the focused row with D', async () => {
    const user = userEvent.setup();
    const { dispatch } = renderSection(group([condition({ id: 'c-1' })]));

    screen.getAllByRole('listitem')[0]?.focus();
    await user.keyboard('d');

    expect(dispatch).toHaveBeenCalledWith({ type: 'toggleNode', id: 'c-1' });
  });
});
