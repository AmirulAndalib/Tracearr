import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, Plus } from 'lucide-react';
import type { IfAction, LeafActionType } from '@tracearr/shared';
import { LEAF_ACTION_TYPES } from '@tracearr/shared';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { FieldError } from '@/components/ui/field';
import {
  Item,
  ItemActions,
  ItemContent,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from '@/components/ui/item';
import {
  actionIcon,
  actionPickerEntries,
  capitalize,
  describeConditions,
  suggestedValues,
} from '@/lib/automations';
import { cn } from '@/lib/utils';
import { idOf, nodeDomId, type BuilderDispatch } from './builderReducer';
import { ActionRow } from './ActionRow';
import { ConditionGroupCard } from './ConditionGroupCard';
import { NodePicker } from './NodePicker';
import { RowActions } from './RowActions';
import { useRowKeyboard } from './useRowKeyboard';
import type { BuilderRefs } from './builderRefs';
import type { RowProps } from './useRowKeyboard';
import type { NodeIssues } from './validation';

interface IfRowProps {
  action: IfAction;
  refs: BuilderRefs;
  issues: NodeIssues;
  pulseId: string | null;
  rowProps: RowProps;
  shortcuts: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  menu?: ReactNode;
  onRemove: () => void;
  onRemoveBranchAction: (id: string, reclaim: () => void) => void;
  dispatch: BuilderDispatch;
}

function isLeafActionType(value: string): value is LeafActionType {
  return (LEAF_ACTION_TYPES as readonly string[]).includes(value);
}

/** A fork in the run: what holds decides which set of steps happens. */
export function IfRow({
  action,
  refs,
  issues,
  pulseId,
  rowProps,
  shortcuts,
  open,
  onOpenChange,
  menu,
  onRemove,
  onRemoveBranchAction,
  dispatch,
}: IfRowProps) {
  const { t } = useTranslation('pages');
  const id = idOf(action);
  const [elseOpen, setElseOpen] = useState(false);
  const enabled = action.enabled !== false;

  const summary = useMemo(() => {
    const fragments = describeConditions(
      action.conditions.groups,
      refs.describe,
      t,
      refs.unitSystem
    );
    const text =
      fragments.length > 0
        ? fragments.map((fragment) => fragment.text).join(' ')
        : t('automations.builder.actions.ifNothing');
    return `${capitalize(t('automations.describe.actions.if'))} ${text}`;
  }, [action.conditions.groups, refs, t]);

  return (
    <Item
      role="listitem"
      id={nodeDomId(id)}
      variant="outline"
      size="sm"
      tabIndex={rowProps.tabIndex}
      aria-keyshortcuts={shortcuts}
      data-pulse={pulseId === id}
      onFocus={rowProps.onFocus}
      onKeyDown={rowProps.onKeyDown}
      className={cn(
        'flex-col items-stretch gap-3',
        'data-[pulse=true]:ring-primary/60 data-[pulse=true]:ring-2',
        !enabled && 'opacity-60'
      )}
    >
      <div className="flex w-full items-start gap-3">
        <ItemMedia variant="icon">{actionIcon('if')}</ItemMedia>
        <ItemContent>
          <ItemTitle className="flex-wrap">{summary}</ItemTitle>
        </ItemContent>
        <ItemActions>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-expanded={open}
            aria-label={
              open
                ? t('automations.builder.actions.collapse', { name: summary })
                : t('automations.builder.actions.expand', { name: summary })
            }
            onClick={() => onOpenChange(!open)}
          >
            <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
          </Button>
          <RowActions
            name={t('automations.catalog.actions.if.label')}
            enabled={enabled}
            onToggle={() => dispatch({ type: 'toggleNode', id })}
            onRemove={onRemove}
          >
            {menu}
          </RowActions>
        </ItemActions>
      </div>

      <Collapsible open={open} onOpenChange={onOpenChange}>
        <CollapsibleContent className="border-primary/40 ml-2 space-y-4 border-l-2 pl-4">
          <div className="space-y-2">
            <p className="text-muted-foreground text-xs font-medium">
              {t('automations.builder.actions.ifConditions')}
            </p>
            {action.conditions.groups.map((group) => (
              <ConditionGroupCard
                key={idOf(group)}
                group={group}
                refs={refs}
                issues={issues}
                pulseId={pulseId}
                dispatch={dispatch}
              />
            ))}
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              onClick={() => dispatch({ type: 'addConditionGroup', ifId: id })}
            >
              <Plus />
              {action.conditions.groups.length === 0
                ? t('automations.builder.conditions.addCondition')
                : t('automations.builder.conditions.addGroup')}
            </Button>
            {issues.get(id)?.map((message) => (
              <FieldError key={message}>{message}</FieldError>
            ))}
          </div>

          <Branch
            ifId={id}
            side="then"
            label={t('automations.builder.actions.branchThen')}
            actions={action.then}
            issues={issues}
            pulseId={pulseId}
            onRemoveBranchAction={onRemoveBranchAction}
            dispatch={dispatch}
          />

          <Collapsible open={elseOpen} onOpenChange={setElseOpen}>
            <CollapsibleTrigger asChild>
              <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
                <ChevronDown className={cn('transition-transform', elseOpen && 'rotate-180')} />
                {t('automations.builder.actions.branchElse')}
                {action.else.length > 0 && <Badge variant="secondary">{action.else.length}</Badge>}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <Branch
                ifId={id}
                side="else"
                label={null}
                actions={action.else}
                issues={issues}
                pulseId={pulseId}
                onRemoveBranchAction={onRemoveBranchAction}
                dispatch={dispatch}
              />
            </CollapsibleContent>
          </Collapsible>

          {refs.kind === 'policy' && (
            <p className="text-muted-foreground text-xs">
              {t('automations.builder.actions.policyNote')}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
    </Item>
  );
}

interface BranchProps {
  ifId: string;
  side: 'then' | 'else';
  label: string | null;
  actions: IfAction['then'];
  issues: NodeIssues;
  pulseId: string | null;
  onRemoveBranchAction: (id: string, reclaim: () => void) => void;
  dispatch: BuilderDispatch;
}

/** One side of the fork: its own list of effects, and its own picker without `if`. */
function Branch({
  ifId,
  side,
  label,
  actions,
  issues,
  pulseId,
  onRemoveBranchAction,
  dispatch,
}: BranchProps) {
  const { t } = useTranslation('pages');
  const branchRef = useRef<HTMLDivElement>(null);

  const entries = useMemo(() => actionPickerEntries(t, { branch: true }), [t]);
  const suggested = useMemo(
    () =>
      suggestedValues(
        entries,
        actions.map((action) => action.type)
      ),
    [entries, actions]
  );

  const rows = useRowKeyboard({
    ids: actions.map(idOf),
    sectionRef: branchRef,
    onToggle: (id) => dispatch({ type: 'toggleNode', id }),
    onRemove: (id, index) => onRemoveBranchAction(id, () => rows.reclaim(index)),
    onMove: (id, delta) => dispatch({ type: 'moveAction', id, delta }),
  });

  return (
    <div ref={branchRef} className="space-y-2">
      {label !== null && <p className="text-muted-foreground text-xs font-medium">{label}</p>}

      {actions.length > 0 && (
        <ItemGroup className="gap-2">
          {actions.map((action, index) => (
            <ActionRow
              key={idOf(action)}
              action={action}
              issues={issues.get(idOf(action))}
              pulsing={pulseId === idOf(action)}
              rowProps={rows.rowProps(index)}
              shortcuts={rows.shortcuts}
              onRemove={() => onRemoveBranchAction(idOf(action), () => rows.reclaim(index))}
              dispatch={dispatch}
            />
          ))}
        </ItemGroup>
      )}

      <NodePicker
        entries={entries}
        suggested={suggested}
        label={t('automations.builder.actions.addBranch')}
        onSelect={(value) => {
          if (isLeafActionType(value)) {
            dispatch({ type: 'addAction', actionType: value, branch: { ifId, side } });
          }
        }}
      />
    </div>
  );
}
